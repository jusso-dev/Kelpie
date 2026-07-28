import { and, desc, eq, gte, lte, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { auditExportJobs } from "@/db/schema";
import { buildRunSummary } from "../redact";
import type { RunFilters, RunRecord, RunState } from "../types";

function toState(status: string): RunState {
  switch (status) {
    case "pending":
      return "queued";
    case "processing":
      return "running";
    case "completed":
      return "succeeded";
    case "failed":
      return "failed";
    default:
      return "failed";
  }
}

function toRecord(row: typeof auditExportJobs.$inferSelect): RunRecord {
  const state = toState(row.status);
  return {
    id: row.id,
    runType: "report",
    organisationId: row.organisationId,
    caseId: null,
    caseNumber: null,
    trigger: `Audit export (${row.format})`,
    ruleOrActionRef: row.format,
    ruleOrActionVersion: null,
    actionId: null,
    provider: "audit_export",
    state,
    approval: {
      requiredApproval: false,
      requestedBy: row.requestedBy ? { id: row.requestedBy, label: null } : null,
      approvedBy: null,
      approvedAt: null,
      expiresAt: null,
    },
    lineage: { attempt: 1, parentRunId: null, rootRunId: null },
    timestamps: {
      queuedAt: row.createdAt.toISOString(),
      startedAt: null,
      finishedAt: row.completedAt?.toISOString() ?? null,
    },
    providerRequestId: null,
    inputSummary: buildRunSummary({ filters: row.filters }),
    outputSummary: buildRunSummary({ rowCount: row.rowCount }),
    errorCategory: state === "failed" ? "provider_error" : null,
    errorSummary: row.error,
    cancel: { requested: false, requestedAt: null, requestedBy: null },
    killSwitch: { organisationActive: false, providerActive: false, actionActive: false },
    // Regeneration happens by requesting a fresh export from the audit page
    // with the same filters, not by mutating a past job's row.
    retryable: false,
    cancellable: false,
  };
}

function filterClauses(organisationId: string, filters: RunFilters): SQL[] {
  const clauses: SQL[] = [eq(auditExportJobs.organisationId, organisationId)];
  if (filters.actorId) clauses.push(eq(auditExportJobs.requestedBy, filters.actorId));
  if (filters.from) clauses.push(gte(auditExportJobs.createdAt, filters.from));
  if (filters.to) clauses.push(lte(auditExportJobs.createdAt, filters.to));
  return clauses;
}

export async function listReportRuns(
  organisationId: string,
  filters: RunFilters,
  limit: number,
): Promise<RunRecord[]> {
  if (filters.caseId || filters.action) return [];
  if (filters.provider && filters.provider !== "audit_export") return [];
  const rows = await db
    .select()
    .from(auditExportJobs)
    .where(and(...filterClauses(organisationId, filters)))
    .orderBy(desc(auditExportJobs.createdAt))
    .limit(limit);
  return rows.map(toRecord).filter((record) => {
    if (filters.state && record.state !== filters.state) return false;
    if (filters.result === "success" && record.state !== "succeeded") return false;
    if (filters.result === "failure" && record.state !== "failed") return false;
    return true;
  });
}

export async function getReportRun(
  organisationId: string,
  id: string,
): Promise<RunRecord | null> {
  const [row] = await db
    .select()
    .from(auditExportJobs)
    .where(and(eq(auditExportJobs.id, id), eq(auditExportJobs.organisationId, organisationId)))
    .limit(1);
  return row ? toRecord(row) : null;
}
