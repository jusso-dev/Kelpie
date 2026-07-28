/**
 * Shared case close / reopen path (issue #57).
 *
 * Every mutation that closes or reopens a case must go through these
 * functions so policy evaluation, snapshot persistence, override auditing,
 * and version checks stay identical for UI, REST, and automation callers.
 */
import { db } from "@/db";
import {
  caseClosureSnapshots,
  cases,
  type Case,
} from "@/db/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import { newId } from "@/lib/utils";
import { writeTimelineEvent } from "@/lib/timeline";
import { recordAuditEvent } from "@/lib/audit/events";
import { CaseVersionConflictError } from "@/lib/cases-errors";
import {
  evaluateCaseClosure,
  resolveApplicableClosurePolicy,
  loadClosureEvaluationContext,
  evaluateClosureRequirements,
} from "./evaluate";
import { assertUserInOrg } from "./policy-core";
import {
  ClosureOverrideError,
  ClosurePathError,
  ClosureRequirementsError,
  type ClosureDispositionInput,
  type ClosureEvaluation,
} from "./types";

export type CloseCaseInput = ClosureDispositionInput & {
  /** Optimistic concurrency token from the client. */
  expectedVersion?: number;
  /**
   * Privileged override of failed requirements. Requires admin session role
   * or `cases:override_closure` API scope (checked by the caller via
   * `canOverride`), plus a non-empty reason. When the resolved policy has
   * `requireTwoPersonOverride`, `approverId` must be a distinct admin.
   */
  override?: boolean;
  overrideReason?: string | null;
  /** Caller already verified override permission. */
  canOverride?: boolean;
};

export type CloseCaseResult = {
  version: number;
  snapshotId: string;
  evaluation: ClosureEvaluation;
  wasOverride: boolean;
};

function caseSnapshot(existing: Case): Record<string, unknown> {
  return {
    version: existing.version,
    status: existing.status,
    severity: existing.severity,
    classification: existing.classification,
    tlp: existing.tlp,
    pap: existing.pap,
    assigneeId: existing.assigneeId,
    title: existing.title,
    summary: existing.summary,
  };
}

async function loadCaseInOrg(caseId: string, organisationId: string) {
  const [c] = await db
    .select()
    .from(cases)
    .where(and(eq(cases.id, caseId), eq(cases.organisationId, organisationId)))
    .limit(1);
  return c ?? null;
}

/**
 * Pre-flight evaluation for the close form / API without mutating state.
 */
export async function previewCaseClosure(
  organisationId: string,
  caseId: string,
  input: ClosureDispositionInput,
): Promise<ClosureEvaluation | null> {
  return evaluateCaseClosure(organisationId, caseId, input);
}

export async function closeCaseCore(
  organisationId: string,
  actorId: string | null,
  caseId: string,
  input: CloseCaseInput,
): Promise<CloseCaseResult> {
  if (!input.disposition?.trim()) {
    throw new ClosurePathError("Closure disposition is required");
  }
  if (!input.conclusion?.trim()) {
    throw new ClosurePathError("Closure conclusion/summary is required");
  }

  const existing = await loadCaseInOrg(caseId, organisationId);
  if (!existing) throw new ClosurePathError("Case not found");
  if (existing.status === "closed") {
    throw new ClosurePathError("Case is already closed");
  }
  if (
    input.expectedVersion !== undefined &&
    input.expectedVersion !== existing.version
  ) {
    throw new CaseVersionConflictError(caseSnapshot(existing));
  }

  const evaluation = await evaluateCaseClosure(organisationId, caseId, input);
  if (!evaluation) throw new ClosurePathError("Case not found");

  let wasOverride = false;
  let overrideReason: string | null = null;
  let overrideFailedSnapshot: ClosureEvaluation["failed"] | null = null;

  if (!evaluation.ok) {
    if (!input.override) {
      throw new ClosureRequirementsError(evaluation);
    }
    if (!input.canOverride) {
      throw new ClosureOverrideError(
        "Closing with unmet requirements requires cases:override_closure (or admin)",
        403,
      );
    }
    const reason = input.overrideReason?.trim() ?? "";
    if (reason.length < 3) {
      throw new ClosureOverrideError(
        "An override reason of at least 3 characters is required",
        400,
      );
    }
    if (!actorId) {
      throw new ClosureOverrideError(
        "Override close requires an authenticated user actor",
        400,
      );
    }
    if (evaluation.requireTwoPersonOverride) {
      // Dual-control must not be satisfiable by nominating another admin id
      // without that admin authenticating. Until a second-party approval
      // handshake exists, refuse override on two-person policies — complete
      // requirements or disable the flag.
      throw new ClosureOverrideError(
        "This policy requires two-person override, which is not available via a nominated approver alone. Complete all requirements, or disable two-person override on the policy until second-party approval is configured.",
        400,
      );
    }
    wasOverride = true;
    overrideReason = reason;
    overrideFailedSnapshot = evaluation.failed;
  } else if (input.approverId) {
    // required_approver may have passed with an approver id — verify membership.
    const approver = await assertUserInOrg(organisationId, input.approverId);
    if (!approver) {
      throw new ClosurePathError("Approver not found in this organisation");
    }
    if (actorId && input.approverId === actorId) {
      // Still allow when policy didn't require approver; when it did, the
      // evaluator already only checks presence. Enforce distinctness here.
      const needsApprover = evaluation.requirements.some(
        (r) => r.type === "required_approver",
      );
      if (needsApprover) {
        throw new ClosurePathError("Approver must be distinct from the closer");
      }
    }
  }

  const nextVersion = existing.version + 1;
  const snapshotId = newId("ccs");
  const now = new Date();
  const disposition = input.disposition.trim();
  const conclusion = input.conclusion.trim();
  const determination = input.determination?.trim() || null;
  const rootCause = input.rootCause?.trim() || null;
  const businessImpact = input.businessImpact?.trim() || null;
  const lessonsLearned = input.lessonsLearned?.trim() || null;
  // required_approver may record a nominated reviewer; that is not dual-control
  // approval of an override (override path never sets approvedAt).
  const approverId = wasOverride ? null : input.approverId?.trim() || null;

  try {
    await db.transaction(async (tx) => {
      // Optimistic lock on the case row + snapshot in one txn so we never
      // leave a closed case without a snapshot row.
      const [updated] = await tx
        .update(cases)
        .set({
          status: "closed",
          closedAt: now,
          resolvedAt: existing.resolvedAt ?? now,
          closureReason: disposition,
          closureSummary: conclusion,
          closureDetermination: determination,
          rootCause,
          businessImpact,
          lessonsLearned,
          closedBy: actorId,
          activeClosureSnapshotId: snapshotId,
          version: nextVersion,
        })
        .where(
          and(
            eq(cases.id, caseId),
            eq(cases.organisationId, organisationId),
            input.expectedVersion !== undefined
              ? eq(cases.version, input.expectedVersion)
              : eq(cases.version, existing.version),
          ),
        )
        .returning({ version: cases.version });

      if (!updated) {
        throw new Error("__version_conflict__");
      }

      await tx.insert(caseClosureSnapshots).values({
        id: snapshotId,
        organisationId,
        caseId,
        policyId: evaluation.policyId,
        policyVersionId: evaluation.policyVersionId,
        policyVersion: evaluation.policyVersion,
        disposition,
        determination,
        rootCause,
        conclusion,
        businessImpact,
        lessonsLearned,
        requirementsEvaluated: evaluation.requirements,
        failedRequirements: evaluation.failed,
        closedBy: actorId,
        closedAt: now,
        approverId,
        approvedAt: null,
        wasOverride,
        overrideReason,
        overrideActorId: wasOverride ? actorId : null,
        overrideFailedSnapshot,
        caseVersionAtClose: nextVersion,
      });
    });
  } catch (error) {
    if (error instanceof Error && error.message === "__version_conflict__") {
      const current = await loadCaseInOrg(caseId, organisationId);
      if (!current) throw new ClosurePathError("Case not found");
      throw new CaseVersionConflictError(caseSnapshot(current));
    }
    throw error;
  }

  await writeTimelineEvent({
    caseId,
    actorId,
    eventType: "status_change",
    payload: {
      from: existing.status,
      to: "closed",
      reason: disposition,
      determination,
      snapshot_id: snapshotId,
      policy_id: evaluation.policyId,
      policy_version: evaluation.policyVersion,
      override: wasOverride,
      override_reason: overrideReason,
      failed_requirements: wasOverride
        ? evaluation.failed.map((f) => ({
            type: f.type,
            missing: f.missing,
          }))
        : [],
    },
  });

  if (wasOverride) {
    await recordAuditEvent({
      organisationId,
      actorId,
      actorType: actorId ? "user" : "system",
      action: "case.closure_override",
      targetType: "case",
      targetId: caseId,
      targetLabel: existing.caseNumber,
      metadata: {
        snapshot_id: snapshotId,
        override_reason: overrideReason,
        failed_requirements: evaluation.failed,
        policy_id: evaluation.policyId,
        policy_version: evaluation.policyVersion,
        approver_id: approverId,
      },
    });
  }

  return {
    version: nextVersion,
    snapshotId,
    evaluation,
    wasOverride,
  };
}

export type ReopenCaseInput = {
  reason: string;
  /** Status to reopen into. Defaults to in_progress. */
  nextStatus?: "open" | "in_progress" | "contained" | "eradicated" | "recovered";
  expectedVersion?: number;
};

export type ReopenCaseResult = {
  version: number;
  snapshotId: string | null;
};

export async function reopenCaseCore(
  organisationId: string,
  actorId: string | null,
  caseId: string,
  input: ReopenCaseInput,
): Promise<ReopenCaseResult> {
  const reason = input.reason?.trim() ?? "";
  if (reason.length < 3) {
    throw new ClosurePathError("A reopen reason of at least 3 characters is required");
  }

  const existing = await loadCaseInOrg(caseId, organisationId);
  if (!existing) throw new ClosurePathError("Case not found");
  if (existing.status !== "closed") {
    throw new ClosurePathError("Only closed cases can be reopened");
  }
  if (
    input.expectedVersion !== undefined &&
    input.expectedVersion !== existing.version
  ) {
    throw new CaseVersionConflictError(caseSnapshot(existing));
  }

  const nextStatus = input.nextStatus ?? "in_progress";
  if (nextStatus === ("closed" as string)) {
    throw new ClosurePathError("Cannot reopen to closed");
  }

  const now = new Date();
  const nextVersion = existing.version + 1;

  // Stamp the active (un-reopened) snapshot if present. Prior snapshots keep
  // their evaluation payload; we only mark this one as reopened.
  let snapshotId: string | null = existing.activeClosureSnapshotId;
  if (snapshotId) {
    const [stamped] = await db
      .update(caseClosureSnapshots)
      .set({
        reopenedAt: now,
        reopenedBy: actorId,
        reopenReason: reason,
      })
      .where(
        and(
          eq(caseClosureSnapshots.id, snapshotId),
          eq(caseClosureSnapshots.organisationId, organisationId),
          eq(caseClosureSnapshots.caseId, caseId),
        ),
      )
      .returning({ id: caseClosureSnapshots.id });
    if (!stamped) snapshotId = null;
  } else {
    // Fall back to latest unreopened snapshot for this case.
    const [latest] = await db
      .select({ id: caseClosureSnapshots.id })
      .from(caseClosureSnapshots)
      .where(
        and(
          eq(caseClosureSnapshots.caseId, caseId),
          eq(caseClosureSnapshots.organisationId, organisationId),
          sql`${caseClosureSnapshots.reopenedAt} is null`,
        ),
      )
      .orderBy(desc(caseClosureSnapshots.closedAt))
      .limit(1);
    if (latest) {
      await db
        .update(caseClosureSnapshots)
        .set({
          reopenedAt: now,
          reopenedBy: actorId,
          reopenReason: reason,
        })
        .where(eq(caseClosureSnapshots.id, latest.id));
      snapshotId = latest.id;
    }
  }

  const [updated] = await db
    .update(cases)
    .set({
      status: nextStatus,
      closedAt: null,
      closedBy: null,
      // Keep disposition narrative on the case for history display; snapshots
      // remain the source of truth. Clear the active pointer so a new close
      // creates a fresh snapshot.
      activeClosureSnapshotId: null,
      lastReopenedAt: now,
      version: nextVersion,
    })
    .where(
      and(
        eq(cases.id, caseId),
        eq(cases.organisationId, organisationId),
        input.expectedVersion !== undefined
          ? eq(cases.version, input.expectedVersion)
          : eq(cases.version, existing.version),
      ),
    )
    .returning({ version: cases.version });

  if (!updated) {
    const current = await loadCaseInOrg(caseId, organisationId);
    if (!current) throw new ClosurePathError("Case not found");
    throw new CaseVersionConflictError(caseSnapshot(current));
  }

  await writeTimelineEvent({
    caseId,
    actorId,
    eventType: "status_change",
    payload: {
      from: "closed",
      to: nextStatus,
      reopen_reason: reason,
      snapshot_id: snapshotId,
    },
  });

  await recordAuditEvent({
    organisationId,
    actorId,
    actorType: actorId ? "user" : "system",
    action: "case.reopened",
    targetType: "case",
    targetId: caseId,
    targetLabel: existing.caseNumber,
    metadata: {
      reason,
      snapshot_id: snapshotId,
      next_status: nextStatus,
    },
  });

  return { version: updated.version, snapshotId };
}

export async function listClosureSnapshotsCore(
  organisationId: string,
  caseId: string,
) {
  return db
    .select()
    .from(caseClosureSnapshots)
    .where(
      and(
        eq(caseClosureSnapshots.caseId, caseId),
        eq(caseClosureSnapshots.organisationId, organisationId),
      ),
    )
    .orderBy(desc(caseClosureSnapshots.closedAt));
}

/**
 * Re-evaluate against a specific historical policy version id. Used when a
 * case was already bound to a version (not the common path — open cases use
 * the policy's current version). Kept for explicit migration tooling.
 */
export async function evaluateAgainstPolicyVersion(
  organisationId: string,
  caseId: string,
  input: ClosureDispositionInput,
  policy: Awaited<ReturnType<typeof resolveApplicableClosurePolicy>>,
): Promise<ClosureEvaluation | null> {
  const ctx = await loadClosureEvaluationContext(organisationId, caseId);
  if (!ctx) return null;
  return evaluateClosureRequirements(policy.requirements, ctx, input, policy);
}
