import { db } from "@/db";
import {
  cases,
  observables,
  tiFeeds,
  tiIndicators,
} from "@/db/schema";
import { and, eq, isNull, sql } from "drizzle-orm";
import { newId } from "@/lib/utils";
import { getFeedHandler } from "./registry";

export type TiMatch = {
  feedId: string;
  feedName: string;
  type: string;
  confidence: number;
  tags: string[];
  lastSeen: string | null;
};

/**
 * Sub-second indexed lookup of an indicator value across the org TI store.
 */
export async function lookupIndicators(
  organisationId: string,
  value: string,
): Promise<TiMatch[]> {
  const rows = await db
    .select({
      feedId: tiIndicators.feedId,
      feedName: tiFeeds.name,
      type: tiIndicators.type,
      confidence: tiIndicators.confidence,
      tags: tiIndicators.tags,
      lastSeen: tiIndicators.lastSeen,
    })
    .from(tiIndicators)
    .innerJoin(tiFeeds, eq(tiFeeds.id, tiIndicators.feedId))
    .where(
      and(
        eq(tiIndicators.organisationId, organisationId),
        eq(tiIndicators.value, value),
      ),
    );
  return rows.map((r) => ({
    feedId: r.feedId,
    feedName: r.feedName,
    type: r.type,
    confidence: r.confidence,
    tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
    lastSeen: r.lastSeen ? r.lastSeen.toISOString() : null,
  }));
}

/** Count distinct cases where an observable with this value appears. */
export async function countCaseAppearances(
  organisationId: string,
  value: string,
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(distinct ${observables.caseId})::int` })
    .from(observables)
    .innerJoin(cases, eq(cases.id, observables.caseId))
    .where(
      and(eq(cases.organisationId, organisationId), eq(observables.value, value)),
    );
  return row?.count ?? 0;
}

export async function casesForValue(
  organisationId: string,
  value: string,
): Promise<Array<{ id: string; caseNumber: string; title: string }>> {
  const rows = await db
    .selectDistinct({
      id: cases.id,
      caseNumber: cases.caseNumber,
      title: cases.title,
    })
    .from(observables)
    .innerJoin(cases, eq(cases.id, observables.caseId))
    .where(
      and(eq(cases.organisationId, organisationId), eq(observables.value, value)),
    );
  return rows;
}

export async function pollFeed(feedId: string): Promise<{
  ingested: number;
  error: string | null;
}> {
  const [feed] = await db
    .select()
    .from(tiFeeds)
    .where(eq(tiFeeds.id, feedId))
    .limit(1);
  if (!feed) return { ingested: 0, error: "feed not found" };
  const handler = getFeedHandler(feed.kind);
  if (!handler) {
    await db
      .update(tiFeeds)
      .set({ lastError: `unknown feed kind: ${feed.kind}`, lastPolledAt: new Date() })
      .where(eq(tiFeeds.id, feed.id));
    return { ingested: 0, error: "unknown kind" };
  }

  try {
    const indicators = await handler.fetchIndicators({
      url: feed.url,
      config: (feed.config as Record<string, unknown>) ?? {},
    });
    const now = new Date();
    let ingested = 0;
    for (const ind of indicators) {
      if (!ind.value) continue;
      await db
        .insert(tiIndicators)
        .values({
          id: newId("tii"),
          organisationId: feed.organisationId,
          feedId: feed.id,
          value: ind.value,
          type: ind.type,
          confidence: ind.confidence ?? 50,
          firstSeen: now,
          lastSeen: now,
          tags: ind.tags ?? [],
          attributes: ind.attributes ?? {},
        })
        .onConflictDoUpdate({
          target: [tiIndicators.feedId, tiIndicators.value, tiIndicators.type],
          set: {
            lastSeen: now,
            confidence: ind.confidence ?? 50,
            tags: ind.tags ?? [],
            attributes: ind.attributes ?? {},
          },
        });
      ingested++;
    }
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(tiIndicators)
      .where(eq(tiIndicators.feedId, feed.id));
    await db
      .update(tiFeeds)
      .set({
        lastPolledAt: now,
        lastError: null,
        indicatorCount: count ?? 0,
      })
      .where(eq(tiFeeds.id, feed.id));
    return { ingested, error: null };
  } catch (e) {
    const error = (e as Error).message;
    await db
      .update(tiFeeds)
      .set({ lastPolledAt: new Date(), lastError: error })
      .where(eq(tiFeeds.id, feed.id));
    return { ingested: 0, error };
  }
}

/** Polls active feeds whose interval has elapsed and that are not halted. */
export async function pollDueFeeds(): Promise<{ polled: number }> {
  const now = Date.now();
  const candidates = await db
    .select()
    .from(tiFeeds)
    .where(and(eq(tiFeeds.isActive, true), isNull(tiFeeds.lastError)));
  let polled = 0;
  for (const f of candidates) {
    const due =
      !f.lastPolledAt ||
      now - f.lastPolledAt.getTime() >= f.pollIntervalMinutes * 60000;
    if (!due) continue;
    await pollFeed(f.id);
    polled++;
  }
  return { polled };
}
