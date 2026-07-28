import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { caseSources } from "@/db/schema";
import { buildRunErrorSummary } from "../redact";
import type { RunFilters, RunRecord, RunState } from "../types";

/**
 * Case-source polling has no per-poll durable row (repeated polls are
 * idempotent and only update the source's aggregate status, per the
 * README). This adapter synthesises one `RunRecord` per configured source
 * representing its most recent poll, rather than a generic execution log.
 */
function toRecord(row: typeof caseSources.$inferSelect): RunRecord {
  const state: RunState = row.lastError ? "failed" : row.lastPolledAt ? "succeeded" : "queued";
  return {
    id: `${row.id}:latest`,
    runType: "case_source_poll",
    organisationId: row.organisationId,
    caseId: null,
    caseNumber: null,
    trigger: row.name,
    ruleOrActionRef: row.kind,
    ruleOrActionVersion: null,
    actionId: row.id,
    provider: row.kind,
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
      queuedAt: row.createdAt.toISOString(),
      startedAt: row.lastPolledAt?.toISOString() ?? null,
      finishedAt: row.lastPolledAt?.toISOString() ?? null,
    },
    providerRequestId: null,
    inputSummary: { pollIntervalMinutes: row.pollIntervalMinutes },
    outputSummary: { importedCaseCount: row.importedCaseCount, cursorSet: Boolean(row.cursor) },
    errorCategory: row.lastError ? "provider_error" : null,
    errorSummary: buildRunErrorSummary(row.lastError),
    cancel: { requested: false, requestedAt: null, requestedBy: null },
    killSwitch: { organisationActive: false, providerActive: false, actionActive: false },
    retryable: row.isActive,
    cancellable: false,
  };
}

export async function listCaseSourcePolls(
  organisationId: string,
  filters: RunFilters,
): Promise<RunRecord[]> {
  if (filters.caseId || filters.actorId) return [];
  const rows = await db
    .select()
    .from(caseSources)
    .where(eq(caseSources.organisationId, organisationId));
  return rows.map(toRecord).filter((record) => {
    if (filters.action && record.actionId !== filters.action) return false;
    if (filters.provider && record.provider !== filters.provider) return false;
    if (filters.state && record.state !== filters.state) return false;
    if (filters.result === "success" && record.state !== "succeeded") return false;
    if (filters.result === "failure" && record.state !== "failed") return false;
    return true;
  });
}

export async function getCaseSourcePoll(
  organisationId: string,
  syntheticId: string,
): Promise<RunRecord | null> {
  const sourceId = syntheticId.replace(/:latest$/, "");
  const [row] = await db
    .select()
    .from(caseSources)
    .where(and(eq(caseSources.id, sourceId), eq(caseSources.organisationId, organisationId)))
    .limit(1);
  return row ? toRecord(row) : null;
}
