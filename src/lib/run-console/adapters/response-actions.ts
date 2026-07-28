import { and, desc, eq, gte, lte, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { cases, responseActions, responseActionRuns } from "@/db/schema";
import { buildRunSummary } from "../redact";
import { providerForActionKind } from "../kill-switch";
import type { ErrorCategory, RunFilters, RunRecord, RunState } from "../types";

type Row = {
  run: typeof responseActionRuns.$inferSelect;
  action: typeof responseActions.$inferSelect;
  caseNumber: string;
};

function toState(status: string): RunState {
  switch (status) {
    case "awaiting_approval":
      return "waiting_approval";
    case "running":
      return "running";
    case "succeeded":
      return "succeeded";
    case "failed":
      return "failed";
    case "cancelled":
    case "rejected":
      return "cancelled";
    default:
      return "failed";
  }
}

function toRecord(row: Row): RunRecord {
  const { run, action, caseNumber } = row;
  const request = (run.request as Record<string, unknown>) ?? {};
  const response = (run.response as Record<string, unknown>) ?? {};
  const state = toState(run.status);
  const failed = state === "failed";
  return {
    id: run.id,
    runType: "response_action",
    organisationId: run.organisationId,
    caseId: run.caseId,
    caseNumber,
    trigger: action.name,
    ruleOrActionRef: action.kind,
    ruleOrActionVersion: null,
    actionId: action.id,
    provider: providerForActionKind(action.kind),
    state,
    approval: {
      requiredApproval: true,
      requestedBy: { id: run.requestedBy, label: null },
      approvedBy: run.approvedBy ? { id: run.approvedBy, label: null } : null,
      approvedAt: run.approvedAt?.toISOString() ?? null,
      expiresAt: run.expiresAt?.toISOString() ?? null,
    },
    lineage: {
      attempt: run.attempt,
      parentRunId: run.parentRunId,
      rootRunId: run.rootRunId,
    },
    timestamps: {
      queuedAt: run.startedAt.toISOString(),
      startedAt: run.approvedAt?.toISOString() ?? null,
      finishedAt: run.completedAt?.toISOString() ?? null,
    },
    providerRequestId:
      typeof response.providerExternalId === "string" ? response.providerExternalId : null,
    inputSummary: buildRunSummary({ target: run.target, input: request.input }),
    outputSummary: buildRunSummary({
      summary: response.summary,
      data: response.data,
    }),
    errorCategory: failed ? ((run.errorCategory as ErrorCategory | null) ?? "unknown") : null,
    errorSummary: failed
      ? typeof response.error === "string"
        ? response.error
        : typeof response.summary === "string"
          ? response.summary
          : "Response action failed"
      : run.rejectionReason,
    cancel: {
      requested: Boolean(run.cancelRequestedAt),
      requestedAt: run.cancelRequestedAt?.toISOString() ?? null,
      requestedBy: run.cancelRequestedBy ? { id: run.cancelRequestedBy, label: null } : null,
    },
    killSwitch: { organisationActive: false, providerActive: false, actionActive: false },
    retryable: state === "failed" || state === "cancelled",
    cancellable: state === "waiting_approval" || state === "running",
  };
}

function filterClauses(organisationId: string, filters: RunFilters): SQL[] {
  const clauses: SQL[] = [eq(responseActionRuns.organisationId, organisationId)];
  if (filters.caseId) clauses.push(eq(responseActionRuns.caseId, filters.caseId));
  if (filters.actorId) clauses.push(eq(responseActionRuns.requestedBy, filters.actorId));
  if (filters.from) clauses.push(gte(responseActionRuns.startedAt, filters.from));
  if (filters.to) clauses.push(lte(responseActionRuns.startedAt, filters.to));
  return clauses;
}

export async function listResponseActionRuns(
  organisationId: string,
  filters: RunFilters,
  limit: number,
): Promise<RunRecord[]> {
  if (filters.provider) {
    // Only response actions with a matching provider are eligible; short-circuit
    // when the requested provider maps to no known handler kind.
    const known = ["cloudflare", "microsoft_entra", "microsoft_defender", "crowdstrike"];
    if (!known.includes(filters.provider)) return [];
  }
  const clauses = filterClauses(organisationId, filters);
  const rows = await db
    .select({ run: responseActionRuns, action: responseActions, caseNumber: cases.caseNumber })
    .from(responseActionRuns)
    .innerJoin(responseActions, eq(responseActionRuns.actionId, responseActions.id))
    .innerJoin(cases, eq(responseActionRuns.caseId, cases.id))
    .where(and(...clauses))
    .orderBy(desc(responseActionRuns.startedAt))
    .limit(limit);
  return rows.map(toRecord).filter((record) => {
    if (filters.action && record.actionId !== filters.action) return false;
    if (filters.provider && record.provider !== filters.provider) return false;
    if (filters.state && record.state !== filters.state) return false;
    if (filters.result === "success" && record.state !== "succeeded") return false;
    if (filters.result === "failure" && record.state !== "failed") return false;
    if (filters.result === "partial" && record.state !== "partially_succeeded") return false;
    return true;
  });
}

export async function getResponseActionRun(
  organisationId: string,
  id: string,
): Promise<RunRecord | null> {
  const [row] = await db
    .select({ run: responseActionRuns, action: responseActions, caseNumber: cases.caseNumber })
    .from(responseActionRuns)
    .innerJoin(responseActions, eq(responseActionRuns.actionId, responseActions.id))
    .innerJoin(cases, eq(responseActionRuns.caseId, cases.id))
    .where(and(eq(responseActionRuns.id, id), eq(responseActionRuns.organisationId, organisationId)))
    .limit(1);
  return row ? toRecord(row) : null;
}

/** Full parent/child chain for a run, oldest attempt first. */
export async function responseActionRunLineage(
  organisationId: string,
  rootRunId: string,
): Promise<RunRecord[]> {
  const rows = await db
    .select({ run: responseActionRuns, action: responseActions, caseNumber: cases.caseNumber })
    .from(responseActionRuns)
    .innerJoin(responseActions, eq(responseActionRuns.actionId, responseActions.id))
    .innerJoin(cases, eq(responseActionRuns.caseId, cases.id))
    .where(
      and(
        eq(responseActionRuns.organisationId, organisationId),
        eq(responseActionRuns.rootRunId, rootRunId),
      ),
    )
    .orderBy(responseActionRuns.attempt);
  const records = rows.map(toRecord);
  // The root row itself has rootRunId = null, so fetch it separately and prepend.
  const root = await getResponseActionRun(organisationId, rootRunId);
  return root ? [root, ...records] : records;
}
