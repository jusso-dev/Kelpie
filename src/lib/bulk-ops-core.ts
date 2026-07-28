/**
 * Bulk operations: apply the same mutation across many cases in one request,
 * producing exactly one `bulk_operations` audit row plus a lightweight
 * per-case timeline entry for every case that actually succeeded.
 *
 * Concurrency / idempotency contract (best-effort, not a hard lock):
 *   1. Before doing any work we SELECT an existing `bulk_operations` row by
 *      (organisationId, idempotencyKey). If found, we return it as-is and do
 *      NOT re-apply anything.
 *   2. This is a fast path only. A genuine concurrent double-submit with the
 *      same idempotency key can race past this check on both requests and
 *      both apply their per-case mutations. That is an accepted residual
 *      risk here, not a bug we try to close with advisory locks or a
 *      transaction spanning all cases, because every underlying per-case
 *      mutation this function calls is itself idempotent-or-a-no-op when
 *      reapplied with the same target value:
 *        - patchCaseCore / setCaseStatusCore no-op if nothing actually changes.
 *        - acknowledgeCaseCore is explicitly idempotent.
 *        - watcher add/remove use onConflictDoNothing / plain delete.
 *        - queue/analyst assign apply unconditionally (last-write-wins is
 *          acceptable for a fleet-wide sweep, not a careful single edit).
 *   3. We compute ALL per-case outcomes first, then insert exactly ONE
 *      `bulk_operations` summary row at the end via
 *      `.onConflictDoNothing().returning()`. If that insert loses a genuine
 *      race (another request with the same key won first), we re-select and
 *      return the winner's row instead of erroring — the table is
 *      DB-enforced append-only, so there is no way to "fix up" a row after
 *      the fact; the work for THIS request has already happened against the
 *      cases either way, but the row we hand back to the caller is whichever
 *      request's row won the unique index, so a client that retries with the
 *      same key always sees a single consistent summary.
 */

import { db } from "@/db";
import { bulkOperations, cases } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { newId } from "./utils";
import { writeTimelineEvent } from "./timeline";
import { normalizeTags } from "./tags";
import {
  CaseVersionConflictError,
  patchCaseCore,
  setCaseStatusCore,
  CASE_ENUMS,
} from "./cases-core";
import {
  assignCaseQueueCore,
  assignCaseAnalystCore,
  acknowledgeCaseCore,
  CaseOwnershipError,
} from "./case-ownership-core";
import { addWatcherCore, removeWatcherCore } from "./watchers-core";

export class BulkOperationError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "BulkOperationError";
    this.status = status;
  }
}

export const BULK_OPERATION_TYPES = [
  "queue_assign",
  "analyst_assign",
  "watcher_add",
  "watcher_remove",
  "tag_add",
  "tag_remove",
  "severity_change",
  "status_change",
  "acknowledge",
] as const;

export type BulkOperationType = (typeof BULK_OPERATION_TYPES)[number];

export type BulkOperationPayload = {
  queueId?: string | null;
  assigneeId?: string | null;
  userId?: string;
  tag?: string;
  severity?: string;
  status?: string;
};

export type BulkOperationOutcome = {
  caseId: string;
  ok: boolean;
  error?: string;
};

export type BulkOperationResult = {
  id: string;
  operationType: string;
  requestedCount: number;
  successCount: number;
  failureCount: number;
  outcomes: BulkOperationOutcome[];
};

export const MAX_BULK_CASE_IDS = 500;

const payloadSchemas: Record<BulkOperationType, z.ZodType<BulkOperationPayload>> = {
  queue_assign: z
    .object({ queueId: z.string().min(1).nullable() })
    .transform((v) => ({ queueId: v.queueId }) as BulkOperationPayload),
  analyst_assign: z
    .object({ assigneeId: z.string().min(1).nullable() })
    .transform((v) => ({ assigneeId: v.assigneeId }) as BulkOperationPayload),
  watcher_add: z
    .object({ userId: z.string().min(1) })
    .transform((v) => ({ userId: v.userId }) as BulkOperationPayload),
  watcher_remove: z
    .object({ userId: z.string().min(1) })
    .transform((v) => ({ userId: v.userId }) as BulkOperationPayload),
  tag_add: z
    .object({ tag: z.string().min(1) })
    .transform((v) => ({ tag: v.tag }) as BulkOperationPayload),
  tag_remove: z
    .object({ tag: z.string().min(1) })
    .transform((v) => ({ tag: v.tag }) as BulkOperationPayload),
  severity_change: z
    .object({ severity: z.enum(CASE_ENUMS.severity) })
    .transform((v) => ({ severity: v.severity }) as BulkOperationPayload),
  status_change: z
    .object({ status: z.enum(CASE_ENUMS.status) })
    .transform((v) => ({ status: v.status }) as BulkOperationPayload),
  acknowledge: z
    .object({})
    .transform(() => ({}) as BulkOperationPayload),
};

function validatePayload(
  operationType: BulkOperationType,
  payload: BulkOperationPayload,
): BulkOperationPayload {
  const schema = payloadSchemas[operationType];
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new BulkOperationError(
      `Invalid payload for operation "${operationType}": ${parsed.error.issues
        .map((i) => i.message)
        .join(", ")}`,
      400,
    );
  }
  return parsed.data;
}

async function loadCaseIdsInOrg(
  organisationId: string,
  caseIds: string[],
): Promise<Set<string>> {
  if (caseIds.length === 0) return new Set();
  const rows = await db
    .select({ id: cases.id })
    .from(cases)
    .where(and(eq(cases.organisationId, organisationId), inArray(cases.id, caseIds)));
  return new Set(rows.map((r) => r.id));
}

/** Applies one case's mutation for the given operation type. Throws on failure. */
async function applyOne(
  organisationId: string,
  actorId: string | null,
  operationType: BulkOperationType,
  caseId: string,
  payload: BulkOperationPayload,
): Promise<void> {
  switch (operationType) {
    case "queue_assign":
      await assignCaseQueueCore(organisationId, actorId, caseId, payload.queueId ?? null);
      return;
    case "analyst_assign":
      await assignCaseAnalystCore(
        organisationId,
        actorId,
        caseId,
        payload.assigneeId ?? null,
      );
      return;
    case "acknowledge":
      await acknowledgeCaseCore(organisationId, actorId, caseId);
      return;
    case "watcher_add":
      await addWatcherCore(organisationId, actorId, caseId, payload.userId as string);
      return;
    case "watcher_remove":
      await removeWatcherCore(organisationId, caseId, payload.userId as string);
      return;
    case "tag_add": {
      const [current] = await db
        .select({ tags: cases.tags })
        .from(cases)
        .where(and(eq(cases.id, caseId), eq(cases.organisationId, organisationId)))
        .limit(1);
      const existingTags = Array.isArray(current?.tags) ? (current!.tags as string[]) : [];
      const nextTags = normalizeTags([...existingTags, payload.tag as string]);
      await patchCaseCore(organisationId, actorId, caseId, { tags: nextTags });
      return;
    }
    case "tag_remove": {
      const [current] = await db
        .select({ tags: cases.tags })
        .from(cases)
        .where(and(eq(cases.id, caseId), eq(cases.organisationId, organisationId)))
        .limit(1);
      const existingTags = Array.isArray(current?.tags) ? (current!.tags as string[]) : [];
      const target = normalizeTags([payload.tag as string])[0];
      const nextTags = normalizeTags(existingTags.filter((t) => t !== target));
      await patchCaseCore(organisationId, actorId, caseId, { tags: nextTags });
      return;
    }
    case "severity_change":
      await patchCaseCore(organisationId, actorId, caseId, {
        severity: payload.severity as (typeof CASE_ENUMS.severity)[number],
      });
      return;
    case "status_change":
      await setCaseStatusCore(
        organisationId,
        actorId,
        caseId,
        payload.status as (typeof CASE_ENUMS.status)[number],
      );
      return;
  }
}

export async function applyBulkOperationCore(
  organisationId: string,
  actorId: string | null,
  input: {
    operationType: BulkOperationType;
    caseIds: string[];
    idempotencyKey: string;
    payload: BulkOperationPayload;
  },
): Promise<BulkOperationResult> {
  if (!BULK_OPERATION_TYPES.includes(input.operationType)) {
    throw new BulkOperationError("Unknown operation type", 400);
  }
  if (!input.idempotencyKey?.trim()) {
    throw new BulkOperationError("idempotencyKey is required", 400);
  }
  if (!Array.isArray(input.caseIds) || input.caseIds.length === 0) {
    throw new BulkOperationError("At least one case id is required", 400);
  }
  if (input.caseIds.length > MAX_BULK_CASE_IDS) {
    throw new BulkOperationError(
      `A bulk operation can target at most ${MAX_BULK_CASE_IDS} cases per request; ${input.caseIds.length} were supplied`,
      400,
    );
  }

  // Idempotency fast path: if this key was already used for this org, return
  // that request's row unchanged. See module-level comment for the residual
  // race risk this does not close.
  const [existing] = await db
    .select()
    .from(bulkOperations)
    .where(
      and(
        eq(bulkOperations.organisationId, organisationId),
        eq(bulkOperations.idempotencyKey, input.idempotencyKey),
      ),
    )
    .limit(1);
  if (existing) {
    return {
      id: existing.id,
      operationType: existing.operationType,
      requestedCount: existing.requestedCount,
      successCount: existing.successCount,
      failureCount: existing.failureCount,
      outcomes: (existing.outcomes as BulkOperationOutcome[]) ?? [],
    };
  }

  const payload = validatePayload(input.operationType, input.payload ?? {});

  // De-dup requested ids while preserving first-seen order, so a caller that
  // accidentally repeats an id still gets exactly one outcome entry for it.
  const seen = new Set<string>();
  const dedupedCaseIds: string[] = [];
  for (const id of input.caseIds) {
    if (typeof id !== "string" || !id) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    dedupedCaseIds.push(id);
  }

  const inOrgIds = await loadCaseIdsInOrg(organisationId, dedupedCaseIds);

  const outcomes: BulkOperationOutcome[] = [];
  const bulkOperationId = newId("bulkop");

  for (const caseId of dedupedCaseIds) {
    if (!inOrgIds.has(caseId)) {
      outcomes.push({ caseId, ok: false, error: "not_found" });
      continue;
    }
    try {
      await applyOne(organisationId, actorId, input.operationType, caseId, payload);
      outcomes.push({ caseId, ok: true });
    } catch (err) {
      const message =
        err instanceof CaseVersionConflictError
          ? "version_conflict"
          : err instanceof CaseOwnershipError
            ? err.message
            : err instanceof Error
              ? err.message
              : "unknown_error";
      outcomes.push({ caseId, ok: false, error: message });
    }
  }

  for (const outcome of outcomes) {
    if (!outcome.ok) continue;
    await writeTimelineEvent({
      caseId: outcome.caseId,
      actorId,
      eventType: "bulk_operation_applied",
      payload: { bulkOperationId, operationType: input.operationType },
    });
  }

  const successCount = outcomes.filter((o) => o.ok).length;
  const failureCount = outcomes.length - successCount;

  const [inserted] = await db
    .insert(bulkOperations)
    .values({
      id: bulkOperationId,
      organisationId,
      actorId,
      operationType: input.operationType,
      idempotencyKey: input.idempotencyKey,
      requestedCount: dedupedCaseIds.length,
      successCount,
      failureCount,
      outcomes,
    })
    .onConflictDoNothing()
    .returning();

  if (inserted) {
    return {
      id: inserted.id,
      operationType: inserted.operationType,
      requestedCount: inserted.requestedCount,
      successCount: inserted.successCount,
      failureCount: inserted.failureCount,
      outcomes: (inserted.outcomes as BulkOperationOutcome[]) ?? [],
    };
  }

  // Lost a genuine race against another request with the same idempotency
  // key: the work above already happened (each per-case mutation is
  // idempotent-or-a-no-op, per the module comment), but the summary row we
  // hand back must be the one that actually won the unique index.
  const [winner] = await db
    .select()
    .from(bulkOperations)
    .where(
      and(
        eq(bulkOperations.organisationId, organisationId),
        eq(bulkOperations.idempotencyKey, input.idempotencyKey),
      ),
    )
    .limit(1);
  if (!winner) {
    throw new BulkOperationError("Bulk operation could not be recorded", 500);
  }
  return {
    id: winner.id,
    operationType: winner.operationType,
    requestedCount: winner.requestedCount,
    successCount: winner.successCount,
    failureCount: winner.failureCount,
    outcomes: (winner.outcomes as BulkOperationOutcome[]) ?? [],
  };
}
