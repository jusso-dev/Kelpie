/**
 * Bulk case operations: queue/analyst assignment, watcher add/remove,
 * tagging, severity/status, acknowledgement.
 *
 * Every bulk run writes exactly one `bulk_operations` row (the batch audit
 * record) and one matching `recordAuditEvent` call, while each affected case
 * still gets its own concise timeline entry through the same core mutation
 * functions the single-case actions use (setCaseStatusCore,
 * patchCaseCore, assignCaseQueueCore, ...), so a case's own history reads
 * the same whether it was changed alone or as part of a batch. Case ids are
 * always intersected with the caller's organisation before anything runs,
 * so a batch can never reach into another tenant's cases.
 */
import { db } from "@/db";
import { bulkOperations, cases } from "@/db/schema";
import type { CaseSeverity, CaseStatus } from "./cases-core";
import { and, eq, inArray } from "drizzle-orm";
import { newId } from "./utils";
import { recordAuditEvent } from "./audit/events";
import { normalizeTags } from "./tags";
import {
  CaseVersionConflictError,
  patchCaseCore,
  setCaseStatusCore,
} from "./cases-core";
import {
  acknowledgeCaseCore,
  assignCaseAnalystCore,
  assignCaseQueueCore,
} from "./queues-core";
import { addWatcherCore, removeWatcherCore } from "./watchers-core";

export const BULK_OPERATION_TYPES = [
  "assign_queue",
  "assign_analyst",
  "add_watcher",
  "remove_watcher",
  "add_tag",
  "remove_tag",
  "set_severity",
  "set_status",
  "acknowledge",
] as const;
export type BulkOperationType = (typeof BULK_OPERATION_TYPES)[number];

export type BulkOperationParams = {
  queueId?: string | null;
  assigneeId?: string | null;
  userId?: string;
  tag?: string;
  severity?: CaseSeverity;
  status?: CaseStatus;
};

export type BulkOperationResult = {
  id: string;
  attempted: number;
  successCount: number;
  failureCount: number;
  errors: Array<{ caseId: string; error: string }>;
};

async function applyOne(
  organisationId: string,
  actorId: string,
  operationType: BulkOperationType,
  caseId: string,
  params: BulkOperationParams,
): Promise<void> {
  switch (operationType) {
    case "assign_queue":
      await assignCaseQueueCore(organisationId, actorId, caseId, params.queueId ?? null);
      return;
    case "assign_analyst":
      await assignCaseAnalystCore(organisationId, actorId, caseId, params.assigneeId ?? null);
      return;
    case "add_watcher": {
      if (!params.userId) throw new Error("userId is required");
      await addWatcherCore(organisationId, actorId, caseId, params.userId);
      return;
    }
    case "remove_watcher": {
      if (!params.userId) throw new Error("userId is required");
      await removeWatcherCore(organisationId, caseId, params.userId);
      return;
    }
    case "add_tag": {
      if (!params.tag) throw new Error("tag is required");
      const [existing] = await db
        .select({ tags: cases.tags })
        .from(cases)
        .where(and(eq(cases.id, caseId), eq(cases.organisationId, organisationId)))
        .limit(1);
      if (!existing) throw new Error("Case not found");
      const current = Array.isArray(existing.tags) ? (existing.tags as string[]) : [];
      const next = normalizeTags([...current, params.tag]);
      await patchCaseCore(organisationId, actorId, caseId, { tags: next });
      return;
    }
    case "remove_tag": {
      if (!params.tag) throw new Error("tag is required");
      const [existing] = await db
        .select({ tags: cases.tags })
        .from(cases)
        .where(and(eq(cases.id, caseId), eq(cases.organisationId, organisationId)))
        .limit(1);
      if (!existing) throw new Error("Case not found");
      const current = Array.isArray(existing.tags) ? (existing.tags as string[]) : [];
      const target = normalizeTags([params.tag])[0];
      const next = current.filter((tag) => tag !== target);
      await patchCaseCore(organisationId, actorId, caseId, { tags: next });
      return;
    }
    case "set_severity": {
      if (!params.severity) throw new Error("severity is required");
      await patchCaseCore(organisationId, actorId, caseId, { severity: params.severity });
      return;
    }
    case "set_status": {
      if (!params.status) throw new Error("status is required");
      // Closing requires the policy-aware close path (issue #57). Bulk status
      // cannot supply disposition / override, so refuse `closed` here.
      if (params.status === "closed") {
        throw new Error(
          "Bulk set_status cannot close cases; use the close case action with disposition",
        );
      }
      await setCaseStatusCore(organisationId, actorId, caseId, params.status);
      return;
    }
    case "acknowledge": {
      await acknowledgeCaseCore(organisationId, actorId, caseId);
      return;
    }
    default: {
      const exhaustive: never = operationType;
      throw new Error(`Unsupported bulk operation: ${exhaustive}`);
    }
  }
}

export async function runBulkOperationCore(
  organisationId: string,
  actorId: string,
  operationType: BulkOperationType,
  requestedCaseIds: string[],
  params: BulkOperationParams,
): Promise<BulkOperationResult> {
  const uniqueRequested = [...new Set(requestedCaseIds)];
  if (uniqueRequested.length === 0) throw new Error("No cases selected");
  if (uniqueRequested.length > 500) {
    throw new Error("Bulk operations are limited to 500 cases at a time");
  }
  // Tenant isolation: only ever act on case ids that already belong to the
  // caller's organisation. Anything else is recorded as a failure, never
  // silently dropped or acted on.
  const owned = await db
    .select({ id: cases.id })
    .from(cases)
    .where(
      and(
        eq(cases.organisationId, organisationId),
        inArray(cases.id, uniqueRequested),
      ),
    );
  const ownedIds = new Set(owned.map((row) => row.id));

  const errors: Array<{ caseId: string; error: string }> = [];
  let successCount = 0;
  for (const caseId of uniqueRequested) {
    if (!ownedIds.has(caseId)) {
      errors.push({ caseId, error: "Case not found in this organisation" });
      continue;
    }
    try {
      await applyOne(organisationId, actorId, operationType, caseId, params);
      successCount++;
    } catch (error) {
      if (error instanceof CaseVersionConflictError) {
        errors.push({ caseId, error: "Case changed elsewhere; skipped" });
      } else {
        errors.push({
          caseId,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }
  }

  const id = newId("bulkop");
  await db.insert(bulkOperations).values({
    id,
    organisationId,
    actorId,
    operationType,
    caseIds: uniqueRequested,
    params,
    successCount,
    failureCount: errors.length,
    errors,
  });
  await recordAuditEvent({
    organisationId,
    actorId,
    actorType: "user",
    action: `bulk.${operationType}`,
    targetType: "bulk_operation",
    targetId: id,
    metadata: {
      requested: uniqueRequested.length,
      succeeded: successCount,
      failed: errors.length,
      params,
    },
  });

  return {
    id,
    attempted: uniqueRequested.length,
    successCount,
    failureCount: errors.length,
    errors,
  };
}
