import { and, desc, eq, gte, lte, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { enrichmentRuns } from "@/db/schema";
import { buildRunErrorSummary } from "../redact";
import type { ErrorCategory, RunFilters, RunRecord, RunState } from "../types";

function toState(status: string): RunState {
  switch (status) {
    case "running":
      return "running";
    case "succeeded":
      return "succeeded";
    case "failed":
      return "failed";
    default:
      return "queued";
  }
}

function toRecord(run: typeof enrichmentRuns.$inferSelect): RunRecord {
  const state = toState(run.status);
  return {
    id: run.id,
    runType: "enrichment",
    organisationId: run.organisationId,
    caseId: null,
    caseNumber: null,
    trigger: "scheduled observable enrichment sweep",
    ruleOrActionRef: null,
    ruleOrActionVersion: null,
    actionId: null,
    provider: "enrichment",
    state,
    approval: {
      requiredApproval: false,
      requestedBy: null,
      approvedBy: null,
      approvedAt: null,
      expiresAt: null,
    },
    lineage: { attempt: 1, parentRunId: null, rootRunId: null },
    timestamps: {
      queuedAt: run.queuedAt.toISOString(),
      startedAt: run.startedAt?.toISOString() ?? null,
      finishedAt: run.finishedAt?.toISOString() ?? null,
    },
    providerRequestId: null,
    inputSummary: { limit: run.processedCount },
    outputSummary: { processed: run.processedCount },
    errorCategory: state === "failed" ? ((run.errorCategory as ErrorCategory | null) ?? "unknown") : null,
    errorSummary: buildRunErrorSummary(run.lastError),
    cancel: { requested: false, requestedAt: null, requestedBy: null },
    killSwitch: { organisationActive: false, providerActive: false, actionActive: false },
    // Enrichment is a rolling scheduled sweep, not a single governed action;
    // there is nothing meaningful to manually retry or cancel per row.
    retryable: false,
    cancellable: false,
  };
}

function filterClauses(organisationId: string, filters: RunFilters): SQL[] {
  const clauses: SQL[] = [eq(enrichmentRuns.organisationId, organisationId)];
  if (filters.from) clauses.push(gte(enrichmentRuns.queuedAt, filters.from));
  if (filters.to) clauses.push(lte(enrichmentRuns.queuedAt, filters.to));
  return clauses;
}

export async function listEnrichmentRuns(
  organisationId: string,
  filters: RunFilters,
  limit: number,
): Promise<RunRecord[]> {
  // Enrichment runs are neither case-scoped, actor-scoped, nor provider-scoped.
  if (filters.caseId || filters.actorId || filters.action) return [];
  if (filters.provider && filters.provider !== "enrichment") return [];
  const rows = await db
    .select()
    .from(enrichmentRuns)
    .where(and(...filterClauses(organisationId, filters)))
    .orderBy(desc(enrichmentRuns.queuedAt))
    .limit(limit);
  return rows.map(toRecord).filter((record) => {
    if (filters.state && record.state !== filters.state) return false;
    if (filters.result === "success" && record.state !== "succeeded") return false;
    if (filters.result === "failure" && record.state !== "failed") return false;
    return true;
  });
}

export async function getEnrichmentRun(
  organisationId: string,
  id: string,
): Promise<RunRecord | null> {
  const [row] = await db
    .select()
    .from(enrichmentRuns)
    .where(and(eq(enrichmentRuns.id, id), eq(enrichmentRuns.organisationId, organisationId)))
    .limit(1);
  return row ? toRecord(row) : null;
}
