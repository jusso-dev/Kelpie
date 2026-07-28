/**
 * Immutable shift hand-off snapshots. A hand-off is written once and never
 * edited: migration 0021's `shift_handoffs_no_update` / `_no_delete`
 * triggers enforce this at the database layer even against the app's own DB
 * role, so this module deliberately has no `updateHandoff`. A correction is
 * always a new hand-off row.
 */
import { db } from "@/db";
import { cases, queues, shiftHandoffs, users } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { newId } from "./utils";
import { writeTimelineEvent } from "./timeline";

export type CreateHandoffInput = {
  toUserId?: string | null;
  toQueueId?: string | null;
  summary: string;
  keyActions?: string[];
  openItems?: string[];
};

async function loadCaseInOrg(caseId: string, organisationId: string) {
  const [c] = await db
    .select()
    .from(cases)
    .where(and(eq(cases.id, caseId), eq(cases.organisationId, organisationId)))
    .limit(1);
  return c ?? null;
}

export async function createHandoffCore(
  organisationId: string,
  actorId: string,
  caseId: string,
  input: CreateHandoffInput,
): Promise<{ id: string }> {
  const summary = input.summary.trim();
  if (!summary) throw new Error("Hand-off summary is required");
  const existing = await loadCaseInOrg(caseId, organisationId);
  if (!existing) throw new Error("Case not found");

  if (input.toUserId) {
    const [target] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, input.toUserId), eq(users.organisationId, organisationId)))
      .limit(1);
    if (!target) throw new Error("Hand-off recipient is not a member of this organisation");
  }
  if (input.toQueueId) {
    const [queue] = await db
      .select({ id: queues.id })
      .from(queues)
      .where(and(eq(queues.id, input.toQueueId), eq(queues.organisationId, organisationId)))
      .limit(1);
    if (!queue) throw new Error("Hand-off target queue not found");
  }

  const id = newId("handoff");
  await db.insert(shiftHandoffs).values({
    id,
    organisationId,
    caseId,
    fromUserId: actorId,
    toUserId: input.toUserId ?? null,
    fromQueueId: existing.queueId,
    toQueueId: input.toQueueId ?? existing.queueId ?? null,
    summary,
    keyActions: input.keyActions ?? [],
    openItems: input.openItems ?? [],
    createdBy: actorId,
  });
  await writeTimelineEvent({
    caseId,
    actorId,
    eventType: "handoff_recorded",
    payload: {
      handoff_id: id,
      to_user_id: input.toUserId ?? null,
      to_queue_id: input.toQueueId ?? existing.queueId ?? null,
    },
  });
  return { id };
}

export async function listHandoffsCore(organisationId: string, caseId: string) {
  return db
    .select({
      id: shiftHandoffs.id,
      summary: shiftHandoffs.summary,
      keyActions: shiftHandoffs.keyActions,
      openItems: shiftHandoffs.openItems,
      fromUserId: shiftHandoffs.fromUserId,
      toUserId: shiftHandoffs.toUserId,
      fromQueueId: shiftHandoffs.fromQueueId,
      toQueueId: shiftHandoffs.toQueueId,
      createdAt: shiftHandoffs.createdAt,
    })
    .from(shiftHandoffs)
    .where(
      and(
        eq(shiftHandoffs.organisationId, organisationId),
        eq(shiftHandoffs.caseId, caseId),
      ),
    )
    .orderBy(desc(shiftHandoffs.createdAt));
}
