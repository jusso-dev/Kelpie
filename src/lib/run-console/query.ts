import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { annotateKillSwitchState } from "./kill-switch";
import {
  getResponseActionRun,
  listResponseActionRuns,
  responseActionRunLineage,
} from "./adapters/response-actions";
import { automationRunLineage, getAutomationRun, listAutomationRuns } from "./adapters/automations";
import { getEnrichmentRun, listEnrichmentRuns } from "./adapters/enrichment";
import { getCaseSourcePoll, listCaseSourcePolls } from "./adapters/case-source-polls";
import { getTiFeedPoll, listTiFeedPolls } from "./adapters/ti-feed-polls";
import { getNotificationRun, listNotificationRuns } from "./adapters/notifications";
import { getReportRun, listReportRuns } from "./adapters/reports";
import type { RunFilters, RunRecord, RunType } from "./types";

export const DEFAULT_RUN_PAGE_SIZE = 50;
export const MAX_RUN_PAGE_SIZE = 200;

export function clampRunLimit(requested: number | null | undefined): number {
  if (!requested || !Number.isFinite(requested) || requested <= 0) {
    return DEFAULT_RUN_PAGE_SIZE;
  }
  return Math.min(Math.floor(requested), MAX_RUN_PAGE_SIZE);
}

type Adapter = (
  organisationId: string,
  filters: RunFilters,
  limit: number,
) => Promise<RunRecord[]>;

const ADAPTERS: Record<RunType, Adapter> = {
  response_action: listResponseActionRuns,
  automation: listAutomationRuns,
  enrichment: listEnrichmentRuns,
  case_source_poll: (org, filters) => listCaseSourcePolls(org, filters),
  ti_feed_poll: (org, filters) => listTiFeedPolls(org, filters),
  notification: listNotificationRuns,
  report: listReportRuns,
};

function recordTimestamp(record: RunRecord): number {
  const value = record.timestamps.finishedAt ?? record.timestamps.startedAt ?? record.timestamps.queuedAt;
  return value ? new Date(value).getTime() : 0;
}

async function resolveActorLabels(records: RunRecord[]): Promise<RunRecord[]> {
  const ids = new Set<string>();
  for (const record of records) {
    if (record.approval.requestedBy?.id) ids.add(record.approval.requestedBy.id);
    if (record.approval.approvedBy?.id) ids.add(record.approval.approvedBy.id);
    if (record.cancel.requestedBy?.id) ids.add(record.cancel.requestedBy.id);
  }
  if (ids.size === 0) return records;
  const rows = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(inArray(users.id, [...ids]));
  const labelById = new Map(rows.map((r) => [r.id, r.name || r.email]));
  const withLabel = (actor: { id: string | null; label: string | null } | null) =>
    actor?.id ? { id: actor.id, label: labelById.get(actor.id) ?? actor.label } : actor;
  return records.map((record) => ({
    ...record,
    approval: {
      ...record.approval,
      requestedBy: withLabel(record.approval.requestedBy),
      approvedBy: withLabel(record.approval.approvedBy),
    },
    cancel: {
      ...record.cancel,
      requestedBy: withLabel(record.cancel.requestedBy),
    },
  }));
}

/**
 * Fans a filtered query out to every run-type adapter (or just one, if
 * `filters.runType` narrows it), merges by recency, and resolves actor
 * labels and kill-switch state in one shared pass. This is deliberately a
 * read-only aggregation layer: every mutation still goes through the owning
 * domain module (`response-actions/core.ts`, `automations/core.ts`, etc).
 */
export async function listRuns(
  organisationId: string,
  filters: RunFilters,
  limit?: number,
): Promise<{ runs: RunRecord[] }> {
  const pageSize = clampRunLimit(limit);
  const types = filters.runType ? [filters.runType] : (Object.keys(ADAPTERS) as RunType[]);
  const batches = await Promise.all(
    types.map((type) => ADAPTERS[type](organisationId, filters, pageSize)),
  );
  let merged = batches.flat().sort((a, b) => recordTimestamp(b) - recordTimestamp(a));
  merged = merged.slice(0, pageSize);
  merged = await resolveActorLabels(merged);
  merged = await annotateKillSwitchState(organisationId, merged);
  return { runs: merged as RunRecord[] };
}

const GETTERS: Record<RunType, (organisationId: string, id: string) => Promise<RunRecord | null>> = {
  response_action: getResponseActionRun,
  automation: getAutomationRun,
  enrichment: getEnrichmentRun,
  case_source_poll: getCaseSourcePoll,
  ti_feed_poll: getTiFeedPoll,
  notification: getNotificationRun,
  report: getReportRun,
};

export async function getRun(
  organisationId: string,
  runType: RunType,
  id: string,
): Promise<RunRecord | null> {
  return GETTERS[runType](organisationId, id);
}

/** Full retry lineage (parent chain) for run types that support it. */
export async function getRunLineage(
  organisationId: string,
  runType: RunType,
  rootRunId: string,
): Promise<RunRecord[]> {
  if (runType === "response_action") {
    return responseActionRunLineage(organisationId, rootRunId);
  }
  if (runType === "automation") {
    return automationRunLineage(organisationId, rootRunId);
  }
  const single = await getRun(organisationId, runType, rootRunId);
  return single ? [single] : [];
}
