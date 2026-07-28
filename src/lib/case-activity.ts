import { db } from "@/db";
import { timelineEvents } from "@/db/schema";
import { and, asc, eq, gt, or } from "drizzle-orm";
import type { CaseActivityEnvelope } from "./case-activity-client";

export type { CaseActivityEnvelope } from "./case-activity-client";

/** Cap on events returned per poll so a long silence never floods a client. */
export const CASE_ACTIVITY_PAGE_SIZE = 25;

/**
 * Position of the last event a connection has already delivered. Both parts
 * matter: a single transaction can write several timeline events sharing one
 * `occurredAt` (bulk edits do exactly this), so an `occurredAt`-only cursor
 * would skip every tied event once the page cap split the tie.
 */
export type CaseActivityCursor = {
  occurredAt: Date;
  id: string;
};

/**
 * Reads timeline events after `since` for one case, oldest first, ordered by
 * `(occurredAt, id)` — the same composite the cursor advances along.
 * `timeline_events` is the single append-only write path for every case,
 * task, comment, observable, and assignment change (see `writeTimelineEvent`
 * in `src/lib/timeline.ts`), so it is also the natural source of truth for
 * the realtime activity channel: this function never holds state beyond one
 * query, and the returned envelopes carry no payload beyond
 * `id`/`type`/`occurredAt`/`actorId` — enough for a client to know something
 * changed and refetch the authoritative record, never enough to use the
 * channel itself as durable storage.
 */
export async function getRecentActivity(
  caseId: string,
  since: CaseActivityCursor | null,
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
      since
        ? and(
            eq(timelineEvents.caseId, caseId),
            or(
              gt(timelineEvents.occurredAt, since.occurredAt),
              and(
                eq(timelineEvents.occurredAt, since.occurredAt),
                gt(timelineEvents.id, since.id),
              ),
            ),
          )
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
