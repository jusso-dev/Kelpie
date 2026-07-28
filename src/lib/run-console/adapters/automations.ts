import { and, desc, eq, gte, lte, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { automationRules, automationRuns, cases } from "@/db/schema";
import { buildRunErrorSummary, buildRunSummary } from "../redact";
import { classifyErrorMessage } from "../error-category";
import { MUSTER_AUTOMATION_PROVIDER } from "../kill-switch";
import type { ErrorCategory, RunFilters, RunRecord, RunState } from "../types";

type Row = {
  run: typeof automationRuns.$inferSelect;
  rule: typeof automationRules.$inferSelect;
  caseNumber: string;
};

function toState(status: string): RunState {
  switch (status) {
    case "pending":
      return "queued";
    case "running":
      return "running";
    case "succeeded":
      return "succeeded";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    default:
      return "failed";
  }
}

function toRecord(row: Row): RunRecord {
  const { run, rule, caseNumber } = row;
  const response = (run.response as Record<string, unknown>) ?? {};
  const state = toState(run.status);
  const failed = state === "failed";
  return {
    id: run.id,
    runType: "automation",
    organisationId: run.organisationId,
    caseId: run.caseId,
    caseNumber,
    trigger: rule.name,
    ruleOrActionRef: rule.targetProfile,
    ruleOrActionVersion: rule.revision,
    actionId: rule.id,
    provider: MUSTER_AUTOMATION_PROVIDER,
    state,
    approval: {
      requiredApproval: false,
      requestedBy: null,
      approvedBy: null,
      approvedAt: null,
      expiresAt: null,
    },
    lineage: {
      attempt: run.lineageAttempt,
      parentRunId: run.parentRunId,
      rootRunId: run.rootRunId,
    },
    timestamps: {
      queuedAt: run.createdAt.toISOString(),
      startedAt: null,
      finishedAt: run.completedAt?.toISOString() ?? null,
    },
    providerRequestId: null,
    inputSummary: buildRunSummary({ event: run.triggerEvent, traceId: run.traceId }),
    outputSummary: buildRunSummary({ status: response.status }),
    errorCategory: failed
      ? ((run.errorCategory as ErrorCategory | null) ?? classifyErrorMessage(run.lastError))
      : null,
    errorSummary: failed ? buildRunErrorSummary(run.lastError) : null,
    cancel: {
      requested: Boolean(run.cancelRequestedAt),
      requestedAt: run.cancelRequestedAt?.toISOString() ?? null,
      requestedBy: run.cancelRequestedBy ? { id: run.cancelRequestedBy, label: null } : null,
    },
    killSwitch: { organisationActive: false, providerActive: false, actionActive: false },
    retryable: state === "failed" || state === "cancelled",
    cancellable: state === "queued" || state === "running",
  };
}

function filterClauses(organisationId: string, filters: RunFilters): SQL[] {
  const clauses: SQL[] = [eq(automationRuns.organisationId, organisationId)];
  if (filters.caseId) clauses.push(eq(automationRuns.caseId, filters.caseId));
  if (filters.from) clauses.push(gte(automationRuns.createdAt, filters.from));
  if (filters.to) clauses.push(lte(automationRuns.createdAt, filters.to));
  return clauses;
}

export async function listAutomationRuns(
  organisationId: string,
  filters: RunFilters,
  limit: number,
): Promise<RunRecord[]> {
  if (filters.provider && filters.provider !== MUSTER_AUTOMATION_PROVIDER) return [];
  if (filters.actorId) return []; // automation runs have no per-run human requester
  const clauses = filterClauses(organisationId, filters);
  const rows = await db
    .select({ run: automationRuns, rule: automationRules, caseNumber: cases.caseNumber })
    .from(automationRuns)
    .innerJoin(automationRules, eq(automationRuns.ruleId, automationRules.id))
    .innerJoin(cases, eq(automationRuns.caseId, cases.id))
    .where(and(...clauses))
    .orderBy(desc(automationRuns.createdAt))
    .limit(limit);
  return rows.map(toRecord).filter((record) => {
    if (filters.action && record.actionId !== filters.action) return false;
    if (filters.state && record.state !== filters.state) return false;
    if (filters.result === "success" && record.state !== "succeeded") return false;
    if (filters.result === "failure" && record.state !== "failed") return false;
    if (filters.result === "partial" && record.state !== "partially_succeeded") return false;
    return true;
  });
}

export async function getAutomationRun(
  organisationId: string,
  id: string,
): Promise<RunRecord | null> {
  const [row] = await db
    .select({ run: automationRuns, rule: automationRules, caseNumber: cases.caseNumber })
    .from(automationRuns)
    .innerJoin(automationRules, eq(automationRuns.ruleId, automationRules.id))
    .innerJoin(cases, eq(automationRuns.caseId, cases.id))
    .where(and(eq(automationRuns.id, id), eq(automationRuns.organisationId, organisationId)))
    .limit(1);
  return row ? toRecord(row) : null;
}

/** Full parent/child chain for a run, oldest attempt first. */
export async function automationRunLineage(
  organisationId: string,
  rootRunId: string,
): Promise<RunRecord[]> {
  const rows = await db
    .select({ run: automationRuns, rule: automationRules, caseNumber: cases.caseNumber })
    .from(automationRuns)
    .innerJoin(automationRules, eq(automationRuns.ruleId, automationRules.id))
    .innerJoin(cases, eq(automationRuns.caseId, cases.id))
    .where(
      and(
        eq(automationRuns.organisationId, organisationId),
        eq(automationRuns.rootRunId, rootRunId),
      ),
    )
    .orderBy(automationRuns.lineageAttempt);
  const records = rows.map(toRecord);
  const root = await getAutomationRun(organisationId, rootRunId);
  return root ? [root, ...records] : records;
}
