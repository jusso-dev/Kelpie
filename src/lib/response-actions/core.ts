import { db } from "@/db";
import {
  cases,
  observables,
  responseActions,
  responseActionRuns,
} from "@/db/schema";
import { and, desc, eq, gt } from "drizzle-orm";
import { newId } from "@/lib/utils";
import { writeTimelineEvent } from "@/lib/timeline";
import { getActionHandler } from "./registry";
import type { ActionResult, CaseObservable } from "./types";

export const RESPONSE_ACTION_APPROVAL_WINDOW_MS = 15 * 60 * 1000;

export function responseActionApprovalExpiry(now = new Date()): Date {
  return new Date(now.getTime() + RESPONSE_ACTION_APPROVAL_WINDOW_MS);
}

async function caseObservables(caseId: string): Promise<CaseObservable[]> {
  const rows = await db
    .select({ type: observables.type, value: observables.value })
    .from(observables)
    .where(eq(observables.caseId, caseId));
  return rows.map((r) => ({ type: r.type, value: r.value }));
}

export type AvailableAction = {
  id: string;
  kind: string;
  name: string;
  label: string;
  description: string;
  approvalRequired: boolean;
  inputFields: ReturnType<
    NonNullable<ReturnType<typeof getActionHandler>>["inputFields"]
  >;
};

export type CaseResponseActionRun = {
  id: string;
  actionName: string;
  actionKind: string;
  status: string;
  target: string | null;
  requestedBy: string | null;
  approvedBy: string | null;
  requestedAt: string;
  approvedAt: string | null;
  expiresAt: string | null;
  completedAt: string | null;
  summary: string | null;
};

/** Active configured actions whose observable requirements match this case. */
export async function listAvailableActions(
  organisationId: string,
  caseId: string,
): Promise<AvailableAction[]> {
  const [configured, obs] = await Promise.all([
    db
      .select()
      .from(responseActions)
      .where(
        and(
          eq(responseActions.organisationId, organisationId),
          eq(responseActions.isActive, true),
        ),
      ),
    caseObservables(caseId),
  ]);
  const presentTypes = new Set(obs.map((o) => o.type));
  const out: AvailableAction[] = [];
  for (const action of configured) {
    const handler = getActionHandler(action.kind);
    if (!handler) continue;
    const satisfied =
      handler.requiresObservableTypes.length === 0 ||
      handler.requiresObservableTypes.some((type) => presentTypes.has(type));
    if (!satisfied) continue;
    out.push({
      id: action.id,
      kind: action.kind,
      name: action.name,
      label: handler.label,
      description: handler.description,
      approvalRequired: handler.approvalRequired,
      inputFields: handler.inputFields(obs),
    });
  }
  return out;
}

export async function listCaseResponseActionRuns(
  organisationId: string,
  caseId: string,
): Promise<CaseResponseActionRun[]> {
  const rows = await db
    .select({ run: responseActionRuns, action: responseActions })
    .from(responseActionRuns)
    .innerJoin(responseActions, eq(responseActionRuns.actionId, responseActions.id))
    .where(
      and(
        eq(responseActionRuns.organisationId, organisationId),
        eq(responseActionRuns.caseId, caseId),
        eq(responseActions.organisationId, organisationId),
      ),
    )
    .orderBy(desc(responseActionRuns.startedAt));
  return rows.map(({ run, action }) => {
    const response = (run.response as Record<string, unknown>) ?? {};
    return {
      id: run.id,
      actionName: action.name,
      actionKind: action.kind,
      status: run.status,
      target: run.target,
      requestedBy: run.requestedBy,
      approvedBy: run.approvedBy,
      requestedAt: run.startedAt.toISOString(),
      approvedAt: run.approvedAt?.toISOString() ?? null,
      expiresAt: run.expiresAt?.toISOString() ?? null,
      completedAt: run.completedAt?.toISOString() ?? null,
      summary: typeof response.summary === "string" ? response.summary : null,
    };
  });
}

async function findRunnableAction(
  organisationId: string,
  actionId: string,
  caseId: string,
) {
  const [row] = await db
    .select({ action: responseActions, caseId: cases.id })
    .from(responseActions)
    .innerJoin(cases, eq(cases.id, caseId))
    .where(
      and(
        eq(responseActions.id, actionId),
        eq(responseActions.organisationId, organisationId),
        eq(responseActions.isActive, true),
        eq(cases.organisationId, organisationId),
      ),
    )
    .limit(1);
  if (!row) throw new Error("Action, case, or tenant is no longer valid");
  const handler = getActionHandler(row.action.kind);
  if (!handler) throw new Error(`Unknown action kind: ${row.action.kind}`);
  return { action: row.action, handler };
}

/** Records a governed request. This never calls an external provider. */
export async function runResponseAction(
  organisationId: string,
  actorId: string,
  actionId: string,
  caseId: string,
  input: Record<string, string>,
): Promise<{ runId: string; ok: boolean; summary: string; status: "awaiting_approval" }> {
  const { action, handler } = await findRunnableAction(
    organisationId,
    actionId,
    caseId,
  );
  if (!handler.approvalRequired) {
    throw new Error("Response action must declare an approval policy");
  }
  const validationError = handler.validate(input);
  if (validationError) throw new Error(validationError);
  const target = handler.target(input);
  if (!target) throw new Error("Response action target is required");
  if (handler.requiresObservableTypes.length > 0) {
    const currentObservables = await caseObservables(caseId);
    const evidenceTarget = handler.evidenceTarget?.(input) ?? target;
    const targetIsEvidence = currentObservables.some(
      (observable) =>
        handler.requiresObservableTypes.includes(observable.type) &&
        observable.value === evidenceTarget,
    );
    if (!targetIsEvidence) {
      throw new Error("Response action target is no longer evidence on this case");
    }
  }

  const runId = newId("car");
  const expiresAt = responseActionApprovalExpiry();
  await db.insert(responseActionRuns).values({
    id: runId,
    organisationId,
    actionId: action.id,
    caseId,
    requestedBy: actorId,
    status: "awaiting_approval",
    idempotencyKey: newId("rai"),
    target,
    // Input is intentionally separate from provider configuration, which may contain secrets.
    request: { input, target, action: { id: action.id, kind: action.kind, name: action.name } },
    expiresAt,
  });
  await writeTimelineEvent({
    caseId,
    actorId,
    eventType: "response_action",
    payload: {
      action: action.name,
      kind: action.kind,
      target,
      status: "awaiting_approval",
      expiresAt: expiresAt.toISOString(),
    },
  });
  return {
    runId,
    ok: true,
    status: "awaiting_approval",
    summary: `Approval requested for ${action.name} on ${target}`,
  };
}

async function executeApprovedRun(opts: {
  runId: string;
  organisationId: string;
  actionId: string;
  caseId: string;
  actorId: string;
  input: Record<string, string>;
}) {
  const { action, handler } = await findRunnableAction(
    opts.organisationId,
    opts.actionId,
    opts.caseId,
  );
  let result: ActionResult;
  try {
    result = await handler.execute({
      organisationId: opts.organisationId,
      caseId: opts.caseId,
      config: (action.config as Record<string, unknown>) ?? {},
      input: opts.input,
    });
  } catch (error) {
    result = {
      ok: false,
      summary: "Response action provider call failed",
      error: (error as Error).message,
    };
  }

  await db
    .update(responseActionRuns)
    .set({
      status: result.ok ? "succeeded" : "failed",
      target: result.target ?? null,
      response: {
        ok: result.ok,
        summary: result.summary,
        providerExternalId: result.providerExternalId ?? null,
        data: result.data ?? null,
        error: result.error ?? null,
      },
      completedAt: new Date(),
    })
    .where(eq(responseActionRuns.id, opts.runId));
  await writeTimelineEvent({
    caseId: opts.caseId,
    actorId: opts.actorId,
    eventType: "response_action",
    payload: {
      action: action.name,
      kind: action.kind,
      target: result.target ?? null,
      status: result.ok ? "succeeded" : "failed",
      summary: result.summary,
      providerExternalId: result.providerExternalId ?? null,
    },
  });
  return result;
}

/** Approver must be a different administrator; server action enforces role. */
export async function approveResponseAction(
  organisationId: string,
  approverId: string,
  runId: string,
): Promise<{ ok: boolean; summary: string }> {
  const [row] = await db
    .select({ run: responseActionRuns, action: responseActions })
    .from(responseActionRuns)
    .innerJoin(responseActions, eq(responseActionRuns.actionId, responseActions.id))
    .innerJoin(cases, eq(responseActionRuns.caseId, cases.id))
    .where(
      and(
        eq(responseActionRuns.id, runId),
        eq(responseActionRuns.organisationId, organisationId),
        eq(responseActions.organisationId, organisationId),
        eq(responseActions.isActive, true),
        eq(cases.organisationId, organisationId),
      ),
    )
    .limit(1);
  if (!row) throw new Error("Approval request not found or no longer valid");
  if (row.run.requestedBy === approverId) {
    throw new Error("Requester cannot approve their own response action");
  }
  if (row.run.status !== "awaiting_approval") {
    throw new Error("Response action is no longer awaiting approval");
  }
  if (!row.run.expiresAt || row.run.expiresAt <= new Date()) {
    throw new Error("Response action approval request has expired");
  }
  const handler = getActionHandler(row.action.kind);
  if (!handler?.approvalRequired) throw new Error("Action approval policy changed");
  const request = (row.run.request as { input?: Record<string, string> }) ?? {};
  const input = request.input ?? {};
  const validationError = handler.validate(input);
  const currentTarget = handler.target(input);
  if (validationError || !currentTarget || currentTarget !== row.run.target) {
    throw new Error("Response action target is no longer valid");
  }
  if (handler.requiresObservableTypes.length > 0) {
    const currentObservables = await caseObservables(row.run.caseId);
    const evidenceTarget = handler.evidenceTarget?.(input) ?? currentTarget;
    const targetIsEvidence = currentObservables.some(
      (observable) =>
        handler.requiresObservableTypes.includes(observable.type) &&
        observable.value === evidenceTarget,
    );
    if (!targetIsEvidence) {
      throw new Error("Response action target is no longer evidence on this case");
    }
  }
  const [claimed] = await db
    .update(responseActionRuns)
    .set({ status: "running", approvedBy: approverId, approvedAt: new Date() })
    .where(
      and(
        eq(responseActionRuns.id, runId),
        eq(responseActionRuns.organisationId, organisationId),
        eq(responseActionRuns.status, "awaiting_approval"),
        gt(responseActionRuns.expiresAt, new Date()),
      ),
    )
    .returning();
  if (!claimed) throw new Error("Response action is no longer awaiting approval");

  try {
    const result = await executeApprovedRun({
      runId: claimed.id,
      organisationId,
      actionId: claimed.actionId,
      caseId: claimed.caseId,
      actorId: approverId,
      input,
    });
    return { ok: result.ok, summary: result.summary };
  } catch {
    const summary = "Response action was not executed because its configuration changed";
    await db
      .update(responseActionRuns)
      .set({
        status: "failed",
        response: { ok: false, summary, error: "pre_execution_revalidation_failed" },
        completedAt: new Date(),
      })
      .where(eq(responseActionRuns.id, claimed.id));
    await writeTimelineEvent({
      caseId: claimed.caseId,
      actorId: approverId,
      eventType: "response_action",
      payload: {
        action: row.action.name,
        kind: row.action.kind,
        target: claimed.target,
        status: "failed",
        summary,
      },
    });
    return { ok: false, summary };
  }
}

export async function rejectResponseAction(
  organisationId: string,
  approverId: string,
  runId: string,
  reason?: string,
) {
  const [run] = await db
    .select()
    .from(responseActionRuns)
    .where(
      and(
        eq(responseActionRuns.id, runId),
        eq(responseActionRuns.organisationId, organisationId),
      ),
    )
    .limit(1);
  if (!run || run.status !== "awaiting_approval") {
    throw new Error("Response action is no longer awaiting approval");
  }
  if (run.requestedBy === approverId) {
    throw new Error("Requester cannot reject their own response action");
  }
  const [rejected] = await db
    .update(responseActionRuns)
    .set({
      status: "rejected",
      rejectedBy: approverId,
      rejectedAt: new Date(),
      rejectionReason: reason?.trim().slice(0, 500) || null,
      completedAt: new Date(),
    })
    .where(
      and(
        eq(responseActionRuns.id, runId),
        eq(responseActionRuns.status, "awaiting_approval"),
      ),
    )
    .returning();
  if (!rejected) throw new Error("Response action is no longer awaiting approval");
  await writeTimelineEvent({
    caseId: rejected.caseId,
    actorId: approverId,
    eventType: "response_action",
    payload: { status: "rejected", target: rejected.target, reason: rejected.rejectionReason },
  });
}

export async function cancelResponseAction(
  organisationId: string,
  requesterId: string,
  runId: string,
) {
  const [cancelled] = await db
    .update(responseActionRuns)
    .set({ status: "cancelled", completedAt: new Date() })
    .where(
      and(
        eq(responseActionRuns.id, runId),
        eq(responseActionRuns.organisationId, organisationId),
        eq(responseActionRuns.requestedBy, requesterId),
        eq(responseActionRuns.status, "awaiting_approval"),
      ),
    )
    .returning();
  if (!cancelled) throw new Error("Only requester can cancel an awaiting response action");
  await writeTimelineEvent({
    caseId: cancelled.caseId,
    actorId: requesterId,
    eventType: "response_action",
    payload: { status: "cancelled", target: cancelled.target },
  });
}
