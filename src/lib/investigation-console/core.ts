/**
 * Investigation console execution engine (issue #62).
 *
 * - Only trusted registry handlers may run.
 * - Parameters are schema-validated and injection/SSRF-guarded.
 * - Scopes fail closed via caller-supplied tokenScopes + handler.requiredScopes.
 * - Write commands require dual-control approval (like response actions).
 * - Results are redacted, size-bounded, and access-controlled by org.
 * - Cancel is best-effort via AbortSignal; terminal runs cannot be re-cancelled.
 */

import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  alerts,
  attachments,
  cases,
  entities,
  investigationExecutions,
  type InvestigationExecution,
} from "@/db/schema";
import {
  authorizeCase,
  evaluateCasePermissions,
  hasPermission,
  loadCaseAccessContexts,
  resolveUserActor,
  type AccessActor,
  type AccessPermission,
} from "@/lib/access";
import { newId } from "@/lib/utils";
import { writeTimelineEvent } from "@/lib/timeline";
import { tokenHasScope, type ScopeValue } from "@/lib/scopes";
import { uploadEvidenceCore } from "@/lib/evidence/core";
import {
  assertWithinRateLimit,
  InvestigationConsoleError,
  safeStringify,
} from "./limits";
import { validateCommandParams } from "./params";
import { redactError, redactParams } from "./redaction";
import {
  getInvestigationHandler,
  isProhibitedCommandName,
  listPublicCommands,
} from "./registry";
import { loadFullResultPayload, storeCommandResult } from "./result-store";
import {
  INVESTIGATION_APPROVAL_WINDOW_MS,
  type PublicCommandDescriptor,
} from "./types";

export { listPublicCommands, InvestigationConsoleError };
export type { PublicCommandDescriptor };

const TERMINAL = new Set([
  "succeeded",
  "failed",
  "cancelled",
  "rejected",
  "timed_out",
]);

export function investigationApprovalExpiry(now = new Date()): Date {
  return new Date(now.getTime() + INVESTIGATION_APPROVAL_WINDOW_MS);
}

function assertScopes(
  tokenScopes: string[] | null | undefined,
  required: ScopeValue[],
): void {
  // Session users pass null → scope check skipped (role gate is separate).
  if (tokenScopes === null || tokenScopes === undefined) return;
  for (const scope of required) {
    if (!tokenHasScope(tokenScopes, scope)) {
      throw new InvestigationConsoleError(
        `Missing required scope: ${scope}`,
        403,
      );
    }
  }
}

async function assertCaseInOrg(
  organisationId: string,
  caseId: string,
): Promise<void> {
  const [row] = await db
    .select({ id: cases.id })
    .from(cases)
    .where(and(eq(cases.id, caseId), eq(cases.organisationId, organisationId)))
    .limit(1);
  if (!row) {
    throw new InvestigationConsoleError("Case not found", 404);
  }
}

/** Resolve a request-path AccessActor for handlers and list filters. */
export async function resolveInvestigationActor(
  organisationId: string,
  actorId: string | null | undefined,
): Promise<AccessActor> {
  if (actorId) {
    const actor = await resolveUserActor(organisationId, actorId);
    if (actor) return actor;
  }
  return {
    organisationId,
    userId: null,
    role: "system",
    teamIds: [],
  };
}

/**
 * When an execution is bound to a case, require the given permission.
 * Missing/unauthorised cases share the same 404 shape.
 */
export async function assertExecutionCaseAccess(
  organisationId: string,
  execution: InvestigationExecution,
  actor: AccessActor,
  required: AccessPermission = "know_exists",
): Promise<void> {
  if (!execution.caseId) return;
  const gate = await authorizeCase(
    organisationId,
    execution.caseId,
    actor,
    required,
  );
  if (!gate.ok) {
    throw new InvestigationConsoleError(gate.error, gate.status);
  }
}

/** True when a params tree still contains the redaction placeholder. */
export function paramsContainRedactedMarker(value: unknown): boolean {
  if (value === "[redacted]") return true;
  if (Array.isArray(value)) {
    return value.some((v) => paramsContainRedactedMarker(v));
  }
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some((v) =>
      paramsContainRedactedMarker(v),
    );
  }
  return false;
}

/**
 * Filter executions so case-bound rows require know_exists. Rows without a
 * caseId stay visible to org members with investigation:read (caller-gated).
 */
export async function filterExecutionsForActor(
  organisationId: string,
  actor: AccessActor,
  rows: InvestigationExecution[],
): Promise<InvestigationExecution[]> {
  if (rows.length === 0) return [];
  const caseIds = [
    ...new Set(
      rows
        .map((r) => r.caseId)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  ];
  if (caseIds.length === 0) return rows;

  const contexts = await loadCaseAccessContexts(organisationId, caseIds);
  const allowed = new Set<string>();
  for (const caseId of caseIds) {
    const ctx = contexts.get(caseId);
    if (!ctx) continue;
    const perms = evaluateCasePermissions(ctx, actor);
    if (hasPermission(perms, "know_exists")) allowed.add(caseId);
  }

  return rows.filter((row) => {
    if (!row.caseId) return true;
    return allowed.has(row.caseId);
  });
}

async function clearSealedParams(executionId: string): Promise<void> {
  await db
    .update(investigationExecutions)
    .set({ paramsSealed: null })
    .where(eq(investigationExecutions.id, executionId));
}

async function assertOptionalRefs(
  organisationId: string,
  refs: {
    entityId?: string | null;
    evidenceId?: string | null;
    alertId?: string | null;
  },
): Promise<void> {
  if (refs.entityId) {
    const [row] = await db
      .select({ id: entities.id })
      .from(entities)
      .where(
        and(
          eq(entities.id, refs.entityId),
          eq(entities.organisationId, organisationId),
        ),
      )
      .limit(1);
    if (!row) throw new InvestigationConsoleError("Entity not found", 404);
  }
  if (refs.evidenceId) {
    const [row] = await db
      .select({ id: attachments.id })
      .from(attachments)
      .where(
        and(
          eq(attachments.id, refs.evidenceId),
          eq(attachments.organisationId, organisationId),
        ),
      )
      .limit(1);
    if (!row) throw new InvestigationConsoleError("Evidence not found", 404);
  }
  if (refs.alertId) {
    const [row] = await db
      .select({ id: alerts.id })
      .from(alerts)
      .where(
        and(
          eq(alerts.id, refs.alertId),
          eq(alerts.organisationId, organisationId),
        ),
      )
      .limit(1);
    if (!row) throw new InvestigationConsoleError("Alert not found", 404);
  }
}

export type ExecuteCommandInput = {
  organisationId: string;
  actorId: string;
  /** API token scopes; null for interactive session users. */
  tokenScopes: string[] | null;
  commandName: string;
  params: unknown;
  caseId?: string | null;
  entityId?: string | null;
  evidenceId?: string | null;
  alertId?: string | null;
  idempotencyKey?: string | null;
};

export type ExecuteCommandResult = {
  execution: InvestigationExecution;
  /** True when this call reused an existing idempotent execution. */
  reused: boolean;
};

/**
 * Create an execution. Read commands run immediately; write commands with
 * approvalRequired enter awaiting_approval and do not execute yet.
 */
export async function executeInvestigationCommand(
  input: ExecuteCommandInput,
): Promise<ExecuteCommandResult> {
  if (isProhibitedCommandName(input.commandName)) {
    throw new InvestigationConsoleError(
      "Arbitrary shell, script, and unrestricted HTTP commands are prohibited",
      400,
    );
  }
  const handler = getInvestigationHandler(input.commandName);
  if (!handler) {
    throw new InvestigationConsoleError(
      `Unknown investigation command: ${input.commandName}`,
      404,
    );
  }

  // Write commands must declare approval; refuse misconfigured handlers.
  if (handler.accessClass === "write" && !handler.approvalRequired) {
    throw new InvestigationConsoleError(
      "Write commands must require approval",
      500,
    );
  }
  if (handler.accessClass === "read" && handler.approvalRequired) {
    throw new InvestigationConsoleError(
      "Read commands must not require approval",
      500,
    );
  }

  assertScopes(input.tokenScopes, handler.requiredScopes);
  // Read path also needs investigation:read when using tokens? Callers check
  // investigation:execute for execute; list uses investigation:read.

  if (input.caseId) {
    await assertCaseInOrg(input.organisationId, input.caseId);
  }
  await assertOptionalRefs(input.organisationId, {
    entityId: input.entityId,
    evidenceId: input.evidenceId,
    alertId: input.alertId,
  });

  const params = validateCommandParams(handler, input.params ?? {});
  const fieldRedact = handler.parameters
    .filter((p) => p.redact)
    .map((p) => p.key);
  const paramsRedacted = redactParams(params, [
    ...(handler.redactParamKeys ?? []),
    ...fieldRedact,
  ]);

  await assertWithinRateLimit(input.organisationId, handler);

  const idempotencyKey =
    input.idempotencyKey?.trim() ||
    newId("iei");

  if (input.idempotencyKey?.trim()) {
    const [existing] = await db
      .select()
      .from(investigationExecutions)
      .where(
        and(
          eq(investigationExecutions.organisationId, input.organisationId),
          eq(investigationExecutions.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);
    if (existing) {
      return { execution: existing, reused: true };
    }
  }

  const executionId = newId("iex");
  const needsApproval =
    handler.accessClass === "write" && handler.approvalRequired;
  const initialStatus = needsApproval ? "awaiting_approval" : "queued";
  const expiresAt = needsApproval ? investigationApprovalExpiry() : null;

  const [created] = await db
    .insert(investigationExecutions)
    .values({
      id: executionId,
      organisationId: input.organisationId,
      caseId: input.caseId ?? null,
      entityId: input.entityId ?? null,
      evidenceId: input.evidenceId ?? null,
      alertId: input.alertId ?? null,
      commandName: handler.name,
      commandVersion: handler.version,
      accessClass: handler.accessClass,
      status: initialStatus,
      resultRenderer: handler.resultRenderers[0] ?? "json",
      paramsRedacted,
      // Keep full params only while dual-control is pending; never public.
      paramsSealed: needsApproval ? params : null,
      requestedBy: input.actorId,
      expiresAt,
      idempotencyKey,
    })
    .returning();

  if (!created) {
    throw new InvestigationConsoleError("Failed to create execution", 500);
  }

  if (input.caseId) {
    await writeTimelineEvent({
      caseId: input.caseId,
      actorId: input.actorId,
      eventType: "investigation_command",
      payload: {
        executionId,
        command: handler.name,
        version: handler.version,
        status: initialStatus,
        accessClass: handler.accessClass,
      },
    });
  }

  if (needsApproval) {
    return { execution: created, reused: false };
  }

  const finished = await runExecution({
    execution: created,
    handler,
    params,
    actorId: input.actorId,
  });
  return { execution: finished, reused: false };
}

async function runExecution(opts: {
  execution: InvestigationExecution;
  handler: NonNullable<ReturnType<typeof getInvestigationHandler>>;
  params: Record<string, unknown>;
  actorId: string;
}): Promise<InvestigationExecution> {
  const { execution, handler, params, actorId } = opts;

  const [claimed] = await db
    .update(investigationExecutions)
    .set({ status: "running" })
    .where(
      and(
        eq(investigationExecutions.id, execution.id),
        eq(investigationExecutions.organisationId, execution.organisationId),
        inArray(investigationExecutions.status, [
          "queued",
          "awaiting_approval",
          "running",
        ]),
      ),
    )
    .returning();

  // If already terminal, return as-is.
  if (!claimed) {
    const [fresh] = await db
      .select()
      .from(investigationExecutions)
      .where(eq(investigationExecutions.id, execution.id))
      .limit(1);
    return fresh ?? execution;
  }

  // If cancel was requested while queued, exit without running the handler.
  if (claimed.cancelRequestedAt) {
    const [cancelled] = await db
      .update(investigationExecutions)
      .set({
        status: "cancelled",
        completedAt: new Date(),
        errorSummary: "Cancelled before execution",
        paramsSealed: null,
      })
      .where(eq(investigationExecutions.id, claimed.id))
      .returning();
    return cancelled ?? claimed;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), handler.timeoutMs);

  // Poll cancel flag while running (best-effort for long handlers).
  const cancelPoll = setInterval(async () => {
    try {
      const [row] = await db
        .select({
          cancelRequestedAt: investigationExecutions.cancelRequestedAt,
        })
        .from(investigationExecutions)
        .where(eq(investigationExecutions.id, claimed.id))
        .limit(1);
      if (row?.cancelRequestedAt) controller.abort();
    } catch {
      // ignore poll errors
    }
  }, 250);

  try {
    // Drop sealed params as soon as execution starts (write dual-control).
    if (claimed.paramsSealed != null) {
      await clearSealedParams(claimed.id);
    }

    const accessActor = await resolveInvestigationActor(
      claimed.organisationId,
      actorId,
    );
    const result = await handler.execute(params, {
      organisationId: claimed.organisationId,
      actorId,
      accessActor,
      caseId: claimed.caseId,
      entityId: claimed.entityId,
      evidenceId: claimed.evidenceId,
      alertId: claimed.alertId,
      signal: controller.signal,
    });

    if (controller.signal.aborted && !result.ok) {
      const timedOut = !claimed.cancelRequestedAt;
      // Re-check cancel marker.
      const [row] = await db
        .select({
          cancelRequestedAt: investigationExecutions.cancelRequestedAt,
        })
        .from(investigationExecutions)
        .where(eq(investigationExecutions.id, claimed.id))
        .limit(1);
      const status = row?.cancelRequestedAt ? "cancelled" : "timed_out";
      const [updated] = await db
        .update(investigationExecutions)
        .set({
          status,
          completedAt: new Date(),
          errorSummary: redactError(
            status === "timed_out"
              ? `Timed out after ${handler.timeoutMs}ms`
              : "Cancelled",
          ),
          providerRequestId: result.providerRequestId ?? null,
        })
        .where(eq(investigationExecutions.id, claimed.id))
        .returning();
      void timedOut;
      return updated ?? claimed;
    }

    const stored = await storeCommandResult({
      organisationId: claimed.organisationId,
      executionId: claimed.id,
      data: result.data,
      maxResultBytes: handler.maxResultBytes,
      renderer: result.renderer,
      summary: result.summary,
    });

    const status = result.ok ? "succeeded" : "failed";
    const [updated] = await db
      .update(investigationExecutions)
      .set({
        status,
        resultRenderer: result.renderer,
        resultSummary: stored.resultSummary,
        resultStorageKey: stored.resultStorageKey,
        resultSha256: stored.resultSha256,
        resultSizeBytes: stored.resultSizeBytes,
        providerRequestId: result.providerRequestId ?? null,
        errorSummary: result.ok
          ? null
          : redactError(result.error ?? result.summary),
        completedAt: new Date(),
      })
      .where(eq(investigationExecutions.id, claimed.id))
      .returning();

    if (claimed.caseId) {
      await writeTimelineEvent({
        caseId: claimed.caseId,
        actorId,
        eventType: "investigation_command",
        payload: {
          executionId: claimed.id,
          command: handler.name,
          version: handler.version,
          status,
          summary: result.summary,
          providerRequestId: result.providerRequestId ?? null,
        },
      });
    }

    return updated ?? claimed;
  } catch (err) {
    const aborted = controller.signal.aborted;
    const [row] = await db
      .select({
        cancelRequestedAt: investigationExecutions.cancelRequestedAt,
      })
      .from(investigationExecutions)
      .where(eq(investigationExecutions.id, claimed.id))
      .limit(1);
    let status: "cancelled" | "timed_out" | "failed" = "failed";
    if (aborted) {
      status = row?.cancelRequestedAt ? "cancelled" : "timed_out";
    }
    const message =
      status === "timed_out"
        ? `Timed out after ${handler.timeoutMs}ms`
        : status === "cancelled"
          ? "Cancelled"
          : (err as Error).message;
    const [updated] = await db
      .update(investigationExecutions)
      .set({
        status,
        completedAt: new Date(),
        errorSummary: redactError(message),
      })
      .where(eq(investigationExecutions.id, claimed.id))
      .returning();
    return updated ?? claimed;
  } finally {
    clearTimeout(timeout);
    clearInterval(cancelPoll);
  }
}

export async function approveInvestigationExecution(opts: {
  organisationId: string;
  approverId: string;
  executionId: string;
  tokenScopes: string[] | null;
}): Promise<InvestigationExecution> {
  const [row] = await db
    .select()
    .from(investigationExecutions)
    .where(
      and(
        eq(investigationExecutions.id, opts.executionId),
        eq(investigationExecutions.organisationId, opts.organisationId),
      ),
    )
    .limit(1);
  if (!row) throw new InvestigationConsoleError("Execution not found", 404);
  if (row.status !== "awaiting_approval") {
    throw new InvestigationConsoleError(
      "Execution is no longer awaiting approval",
      409,
    );
  }
  if (row.requestedBy === opts.approverId) {
    throw new InvestigationConsoleError(
      "Requester cannot approve their own investigation command",
      403,
    );
  }
  if (!row.expiresAt || row.expiresAt <= new Date()) {
    throw new InvestigationConsoleError(
      "Investigation command approval request has expired",
      409,
    );
  }

  const handler = getInvestigationHandler(row.commandName);
  if (!handler || !handler.approvalRequired) {
    throw new InvestigationConsoleError(
      "Command approval policy changed or handler missing",
      409,
    );
  }
  assertScopes(opts.tokenScopes, handler.requiredScopes);

  // Prefer sealed params stored at request time. Never re-run from redacted
  // placeholders — if sealed is missing and redacted markers remain, fail.
  const sealed = row.paramsSealed;
  let rawParams: Record<string, unknown>;
  if (sealed && typeof sealed === "object" && !Array.isArray(sealed)) {
    rawParams = sealed as Record<string, unknown>;
  } else {
    const fallback =
      (row.paramsRedacted as Record<string, unknown> | null) ?? {};
    if (paramsContainRedactedMarker(fallback)) {
      throw new InvestigationConsoleError(
        "Cannot approve: sealed parameters unavailable (redacted keys present). Re-submit the command.",
        409,
      );
    }
    const redactKeys = [
      ...(handler.redactParamKeys ?? []),
      ...handler.parameters.filter((p) => p.redact).map((p) => p.key),
    ];
    if (redactKeys.length > 0) {
      throw new InvestigationConsoleError(
        "Cannot approve: sealed parameters unavailable for redacted write params. Re-submit the command.",
        409,
      );
    }
    rawParams = fallback;
  }
  // Re-run schema validation so version/schema drift cannot slip through.
  const validated = validateCommandParams(handler, rawParams);

  const [claimed] = await db
    .update(investigationExecutions)
    .set({
      status: "running",
      approvedBy: opts.approverId,
      approvedAt: new Date(),
      paramsSealed: null,
    })
    .where(
      and(
        eq(investigationExecutions.id, row.id),
        eq(investigationExecutions.organisationId, opts.organisationId),
        eq(investigationExecutions.status, "awaiting_approval"),
      ),
    )
    .returning();
  if (!claimed) {
    throw new InvestigationConsoleError(
      "Execution is no longer awaiting approval",
      409,
    );
  }

  return runExecution({
    execution: claimed,
    handler,
    params: validated,
    actorId: opts.approverId,
  });
}

export async function rejectInvestigationExecution(opts: {
  organisationId: string;
  actorId: string;
  executionId: string;
  reason?: string;
}): Promise<InvestigationExecution> {
  const [row] = await db
    .select()
    .from(investigationExecutions)
    .where(
      and(
        eq(investigationExecutions.id, opts.executionId),
        eq(investigationExecutions.organisationId, opts.organisationId),
      ),
    )
    .limit(1);
  if (!row) throw new InvestigationConsoleError("Execution not found", 404);
  if (row.status !== "awaiting_approval") {
    throw new InvestigationConsoleError(
      "Execution is no longer awaiting approval",
      409,
    );
  }
  if (row.requestedBy === opts.actorId) {
    throw new InvestigationConsoleError(
      "Requester cannot reject their own investigation command",
      403,
    );
  }
  const [rejected] = await db
    .update(investigationExecutions)
    .set({
      status: "rejected",
      rejectedBy: opts.actorId,
      rejectedAt: new Date(),
      rejectionReason: opts.reason?.slice(0, 500) ?? null,
      completedAt: new Date(),
      paramsSealed: null,
    })
    .where(
      and(
        eq(investigationExecutions.id, row.id),
        eq(investigationExecutions.status, "awaiting_approval"),
      ),
    )
    .returning();
  if (!rejected) {
    throw new InvestigationConsoleError(
      "Execution is no longer awaiting approval",
      409,
    );
  }
  return rejected;
}

export async function cancelInvestigationExecution(opts: {
  organisationId: string;
  actorId: string;
  executionId: string;
}): Promise<{
  execution: InvestigationExecution;
  bestEffort: boolean;
}> {
  const [row] = await db
    .select()
    .from(investigationExecutions)
    .where(
      and(
        eq(investigationExecutions.id, opts.executionId),
        eq(investigationExecutions.organisationId, opts.organisationId),
      ),
    )
    .limit(1);
  if (!row) throw new InvestigationConsoleError("Execution not found", 404);

  if (TERMINAL.has(row.status)) {
    throw new InvestigationConsoleError(
      "Execution is already terminal",
      409,
    );
  }

  if (row.status === "awaiting_approval" || row.status === "queued") {
    const [cancelled] = await db
      .update(investigationExecutions)
      .set({
        status: "cancelled",
        cancelRequestedAt: new Date(),
        cancelRequestedBy: opts.actorId,
        completedAt: new Date(),
        errorSummary: "Cancelled",
        paramsSealed: null,
      })
      .where(
        and(
          eq(investigationExecutions.id, row.id),
          inArray(investigationExecutions.status, [
            "awaiting_approval",
            "queued",
          ]),
        ),
      )
      .returning();
    if (!cancelled) {
      throw new InvestigationConsoleError("Execution is already terminal", 409);
    }
    return { execution: cancelled, bestEffort: false };
  }

  // running: best-effort marker only
  const [marked] = await db
    .update(investigationExecutions)
    .set({
      cancelRequestedAt: new Date(),
      cancelRequestedBy: opts.actorId,
    })
    .where(
      and(
        eq(investigationExecutions.id, row.id),
        eq(investigationExecutions.status, "running"),
      ),
    )
    .returning();
  return {
    execution: marked ?? row,
    bestEffort: true,
  };
}

export async function getInvestigationExecution(
  organisationId: string,
  executionId: string,
): Promise<InvestigationExecution | null> {
  const [row] = await db
    .select()
    .from(investigationExecutions)
    .where(
      and(
        eq(investigationExecutions.id, executionId),
        eq(investigationExecutions.organisationId, organisationId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function listInvestigationExecutions(opts: {
  organisationId: string;
  caseId?: string | null;
  commandName?: string | null;
  limit?: number;
}): Promise<InvestigationExecution[]> {
  const limit = Math.min(100, Math.max(1, opts.limit ?? 50));
  const conditions = [
    eq(investigationExecutions.organisationId, opts.organisationId),
  ];
  if (opts.caseId) {
    conditions.push(eq(investigationExecutions.caseId, opts.caseId));
  }
  if (opts.commandName) {
    conditions.push(eq(investigationExecutions.commandName, opts.commandName));
  }
  return db
    .select()
    .from(investigationExecutions)
    .where(and(...conditions))
    .orderBy(desc(investigationExecutions.startedAt))
    .limit(limit);
}

/**
 * Save a completed execution result as case evidence, preserving command
 * version, redacted params, provider request id, timestamps, and hash.
 */
export async function saveExecutionAsEvidence(opts: {
  organisationId: string;
  actorId: string | null;
  executionId: string;
  caseId?: string | null;
}): Promise<{ evidenceId: string; sha256: string }> {
  const execution = await getInvestigationExecution(
    opts.organisationId,
    opts.executionId,
  );
  if (!execution) {
    throw new InvestigationConsoleError("Execution not found", 404);
  }
  if (execution.status !== "succeeded") {
    throw new InvestigationConsoleError(
      "Only successful executions can be saved as evidence",
      409,
    );
  }
  // Never allow saving into a different case than the execution context.
  if (
    opts.caseId &&
    execution.caseId &&
    opts.caseId !== execution.caseId
  ) {
    throw new InvestigationConsoleError(
      "caseId must match the execution case",
      400,
    );
  }
  const caseId = execution.caseId ?? opts.caseId;
  if (!caseId) {
    throw new InvestigationConsoleError(
      "A case id is required to save evidence",
      400,
    );
  }
  await assertCaseInOrg(opts.organisationId, caseId);

  if (execution.savedEvidenceId) {
    return {
      evidenceId: execution.savedEvidenceId,
      sha256: execution.resultSha256 ?? "",
    };
  }

  const full = await loadFullResultPayload({
    resultSummary: execution.resultSummary,
    resultStorageKey: execution.resultStorageKey,
  });
  const envelope = {
    kind: "investigation_console_result",
    commandName: execution.commandName,
    commandVersion: execution.commandVersion,
    paramsRedacted: execution.paramsRedacted,
    providerRequestId: execution.providerRequestId,
    startedAt: execution.startedAt?.toISOString?.() ?? execution.startedAt,
    completedAt:
      execution.completedAt?.toISOString?.() ?? execution.completedAt,
    resultSha256: execution.resultSha256,
    resultSizeBytes: execution.resultSizeBytes,
    result: full,
  };
  const buffer = Buffer.from(safeStringify(envelope), "utf8");
  const filename = `investigation-${execution.commandName.replace(/[^a-z0-9._-]+/gi, "_")}-${execution.id}.json`;

  const evidence = await uploadEvidenceCore({
    organisationId: opts.organisationId,
    caseId,
    actorId: opts.actorId,
    buffer,
    filename,
    declaredContentType: "application/json",
    source: "investigation_console",
    acquisitionSource: execution.commandName,
    acquiredAt: execution.completedAt ?? new Date(),
    examinerNotes: [
      `command=${execution.commandName}`,
      `version=${execution.commandVersion}`,
      execution.providerRequestId
        ? `providerRequestId=${execution.providerRequestId}`
        : null,
      execution.resultSha256 ? `resultSha256=${execution.resultSha256}` : null,
    ]
      .filter(Boolean)
      .join("; "),
  });

  await db
    .update(investigationExecutions)
    .set({ savedEvidenceId: evidence.id })
    .where(
      and(
        eq(investigationExecutions.id, execution.id),
        eq(investigationExecutions.organisationId, opts.organisationId),
      ),
    );

  return { evidenceId: evidence.id, sha256: evidence.sha256 };
}

export async function linkExecutionTargets(opts: {
  organisationId: string;
  executionId: string;
  entityIds?: string[];
  alertIds?: string[];
}): Promise<InvestigationExecution> {
  const execution = await getInvestigationExecution(
    opts.organisationId,
    opts.executionId,
  );
  if (!execution) {
    throw new InvestigationConsoleError("Execution not found", 404);
  }

  const entityIds = [...new Set(opts.entityIds ?? [])].slice(0, 50);
  const alertIds = [...new Set(opts.alertIds ?? [])].slice(0, 50);

  if (entityIds.length > 0) {
    const found = await db
      .select({ id: entities.id })
      .from(entities)
      .where(
        and(
          eq(entities.organisationId, opts.organisationId),
          inArray(entities.id, entityIds),
        ),
      );
    if (found.length !== entityIds.length) {
      throw new InvestigationConsoleError(
        "One or more entities not found in this organisation",
        404,
      );
    }
  }
  if (alertIds.length > 0) {
    const found = await db
      .select({ id: alerts.id })
      .from(alerts)
      .where(
        and(
          eq(alerts.organisationId, opts.organisationId),
          inArray(alerts.id, alertIds),
        ),
      );
    if (found.length !== alertIds.length) {
      throw new InvestigationConsoleError(
        "One or more alerts not found in this organisation",
        404,
      );
    }
  }

  const prevEntities = Array.isArray(execution.linkedEntityIds)
    ? (execution.linkedEntityIds as string[])
    : [];
  const prevAlerts = Array.isArray(execution.linkedAlertIds)
    ? (execution.linkedAlertIds as string[])
    : [];

  const [updated] = await db
    .update(investigationExecutions)
    .set({
      linkedEntityIds: [...new Set([...prevEntities, ...entityIds])],
      linkedAlertIds: [...new Set([...prevAlerts, ...alertIds])],
    })
    .where(
      and(
        eq(investigationExecutions.id, execution.id),
        eq(investigationExecutions.organisationId, opts.organisationId),
      ),
    )
    .returning();

  return updated ?? execution;
}

export function toPublicExecution(row: InvestigationExecution) {
  return {
    id: row.id,
    organisationId: row.organisationId,
    caseId: row.caseId,
    entityId: row.entityId,
    evidenceId: row.evidenceId,
    alertId: row.alertId,
    commandName: row.commandName,
    commandVersion: row.commandVersion,
    accessClass: row.accessClass,
    status: row.status,
    resultRenderer: row.resultRenderer,
    paramsRedacted: row.paramsRedacted,
    resultSummary: row.resultSummary,
    resultSha256: row.resultSha256,
    resultSizeBytes: row.resultSizeBytes,
    hasStoredResult: Boolean(row.resultStorageKey),
    providerRequestId: row.providerRequestId,
    requestedBy: row.requestedBy,
    approvedBy: row.approvedBy,
    approvedAt: row.approvedAt?.toISOString?.() ?? row.approvedAt,
    rejectedBy: row.rejectedBy,
    rejectedAt: row.rejectedAt?.toISOString?.() ?? row.rejectedAt,
    rejectionReason: row.rejectionReason,
    expiresAt: row.expiresAt?.toISOString?.() ?? row.expiresAt,
    cancelRequestedAt:
      row.cancelRequestedAt?.toISOString?.() ?? row.cancelRequestedAt,
    errorSummary: row.errorSummary,
    savedEvidenceId: row.savedEvidenceId,
    linkedEntityIds: row.linkedEntityIds,
    linkedAlertIds: row.linkedAlertIds,
    startedAt: row.startedAt?.toISOString?.() ?? row.startedAt,
    completedAt: row.completedAt?.toISOString?.() ?? row.completedAt,
  };
}
