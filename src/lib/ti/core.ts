import { db } from "@/db";
import {
  cases,
  observables,
  tiFeeds,
  tiIndicators,
} from "@/db/schema";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { newId } from "@/lib/utils";
import { getFeedHandler, retiredFeedKindReason } from "./registry";
import { TI_INDICATOR_TYPES, totalSkipped, type TiSkipCounts } from "./indicator-types";

export type TiMatch = {
  value?: string;
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
        // Defence in depth: legacy rows outside the supported contract must
        // never surface even if a migration hasn't retired them yet.
        inArray(tiIndicators.type, [...TI_INDICATOR_TYPES]),
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

export async function lookupIndicatorValues(
  organisationId: string,
  values: string[],
): Promise<Array<TiMatch & { value: string }>> {
  const unique = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  if (unique.length === 0) return [];
  const rows = await db
    .select({
      value: tiIndicators.value,
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
        inArray(tiIndicators.value, unique),
        inArray(tiIndicators.type, [...TI_INDICATOR_TYPES]),
      ),
    );
  return rows.map((row) => ({
    value: row.value,
    feedId: row.feedId,
    feedName: row.feedName,
    type: row.type,
    confidence: row.confidence,
    tags: Array.isArray(row.tags) ? (row.tags as string[]) : [],
    lastSeen: row.lastSeen?.toISOString() ?? null,
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
  skipped: number;
  skippedByType: TiSkipCounts;
  error: string | null;
}> {
  const [feed] = await db
    .select()
    .from(tiFeeds)
    .where(eq(tiFeeds.id, feedId))
    .limit(1);
  if (!feed) return { ingested: 0, skipped: 0, skippedByType: {}, error: "feed not found" };

  const retiredReason = retiredFeedKindReason(feed.kind);
  if (retiredReason) {
    await db
      .update(tiFeeds)
      .set({ lastError: retiredReason, lastPolledAt: new Date(), isActive: false })
      .where(eq(tiFeeds.id, feed.id));
    return { ingested: 0, skipped: 0, skippedByType: {}, error: retiredReason };
  }

  const handler = getFeedHandler(feed.kind);
  if (!handler) {
    await db
      .update(tiFeeds)
      .set({ lastError: `unknown feed kind: ${feed.kind}`, lastPolledAt: new Date() })
      .where(eq(tiFeeds.id, feed.id));
    return { ingested: 0, skipped: 0, skippedByType: {}, error: "unknown kind" };
  }

  try {
    const { indicators, skippedByType } = await handler.fetchIndicators({
      url: feed.url,
      config: (feed.config as Record<string, unknown>) ?? {},
    });
    const now = new Date();
    let ingested = 0;
    for (const ind of indicators) {
      // The handler's collector has already resolved `ind.type` against the
      // strict allowlist and trimmed `ind.value`; nothing left to validate.
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
    const skipped = totalSkipped(skippedByType);
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
        lastRunIngestedCount: ingested,
        lastRunSkippedCount: skipped,
        lastRunSkippedByType: skippedByType,
      })
      .where(eq(tiFeeds.id, feed.id));
    return { ingested, skipped, skippedByType, error: null };
  } catch (e) {
    const error = conciseError(e);
    await db
      .update(tiFeeds)
      .set({ lastPolledAt: new Date(), lastError: error })
      .where(eq(tiFeeds.id, feed.id));
    return { ingested: 0, skipped: 0, skippedByType: {}, error };
  }
}

function conciseError(error: unknown): string {
  let current = error;
  let message = "Threat-intelligence feed poll failed.";
  for (let depth = 0; depth < 5; depth++) {
    if (!(current instanceof Error)) break;
    if (current.message.trim()) message = current.message.trim();
    if (!current.cause) break;
    current = current.cause;
  }
  return message.slice(0, 500);
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
