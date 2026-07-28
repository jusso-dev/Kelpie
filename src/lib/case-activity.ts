import { db } from "@/db";
import { timelineEvents } from "@/db/schema";
import { and, asc, eq, gt } from "drizzle-orm";
import type { CaseActivityEnvelope } from "./case-activity-client";

export type { CaseActivityEnvelope } from "./case-activity-client";

/** Cap on events returned per poll so a long silence never floods a client. */
export const CASE_ACTIVITY_PAGE_SIZE = 25;

/**
 * Reads timeline events newer than `sinceOccurredAt` for one case, oldest
 * first. `timeline_events` is the single append-only write path for every
 * case, task, comment, observable, and assignment change (see
 * `writeTimelineEvent` in `src/lib/timeline.ts`), so it is also the natural
 * source of truth for the realtime activity channel: this function never
 * holds state beyond one query, and the returned envelopes carry no payload
 * beyond `id`/`type`/`occurredAt`/`actorId` — enough for a client to know
 * something changed and refetch the authoritative record, never enough to
 * use the channel itself as durable storage.
 */
export async function getRecentActivity(
  caseId: string,
  sinceOccurredAt: Date | null,
): Promise<CaseActivityEnvelope[]> {
  const rows = await db
    .select({
      id: timelineEvents.id,
      eventType: timelineEvents.eventType,
      occurredAt: timelineEvents.occurredAt,
      actorId: timelineEvents.actorId,
    })
    .from(timelineEvents)
    .where(
      sinceOccurredAt
        ? and(eq(timelineEvents.caseId, caseId), gt(timelineEvents.occurredAt, sinceOccurredAt))
        : eq(timelineEvents.caseId, caseId),
    )
    .orderBy(asc(timelineEvents.occurredAt), asc(timelineEvents.id))
    .limit(CASE_ACTIVITY_PAGE_SIZE);

  return rows.map((r) => ({
    id: r.id,
    type: r.eventType,
    occurredAt: r.occurredAt.toISOString(),
    actorId: r.actorId,
  }));
}
