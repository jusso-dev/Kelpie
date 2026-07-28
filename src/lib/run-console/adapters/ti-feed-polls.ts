import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { tiFeeds } from "@/db/schema";
import { buildRunErrorSummary } from "../redact";
import type { RunFilters, RunRecord, RunState } from "../types";

/** Same synthetic-latest-poll approach as `case-source-polls.ts`. */
function toRecord(row: typeof tiFeeds.$inferSelect): RunRecord {
  let state: RunState = "queued";
  if (row.lastError) state = "failed";
  else if (row.lastPolledAt) {
    state =
      row.lastRunSkippedCount > 0 && row.lastRunIngestedCount > 0
        ? "partially_succeeded"
        : "succeeded";
  }
  return {
    id: `${row.id}:latest`,
    runType: "ti_feed_poll",
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
    outputSummary: {
      ingested: row.lastRunIngestedCount,
      skipped: row.lastRunSkippedCount,
      skippedByType: row.lastRunSkippedByType,
      indicatorCount: row.indicatorCount,
    },
    errorCategory: row.lastError ? "provider_error" : null,
    errorSummary: buildRunErrorSummary(row.lastError),
    cancel: { requested: false, requestedAt: null, requestedBy: null },
    killSwitch: { organisationActive: false, providerActive: false, actionActive: false },
    retryable: row.isActive,
    cancellable: false,
  };
}

export async function listTiFeedPolls(
  organisationId: string,
  filters: RunFilters,
): Promise<RunRecord[]> {
  if (filters.caseId || filters.actorId) return [];
  const rows = await db.select().from(tiFeeds).where(eq(tiFeeds.organisationId, organisationId));
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

export async function getTiFeedPoll(
  organisationId: string,
  syntheticId: string,
): Promise<RunRecord | null> {
  const feedId = syntheticId.replace(/:latest$/, "");
  const [row] = await db
    .select()
    .from(tiFeeds)
    .where(and(eq(tiFeeds.id, feedId), eq(tiFeeds.organisationId, organisationId)))
    .limit(1);
  return row ? toRecord(row) : null;
}
