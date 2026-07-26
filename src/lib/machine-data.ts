import { and, desc, eq, gte, ilike, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  tiFeeds,
  tiIndicators,
  vendorWatchlist,
} from "@/db/schema";
import { getCyberNews } from "@/lib/cyber-news";
import {
  matchingVendors,
  type WatchedVendor,
} from "@/lib/vendor-news";

export type ThreatIntelQuery = {
  value?: string;
  exact?: boolean;
  type?: string;
  feedId?: string;
  tag?: string;
  minConfidence?: number;
  limit?: number;
  offset?: number;
};

export async function queryThreatIntelligence(
  organisationId: string,
  query: ThreatIntelQuery,
) {
  const filters = [eq(tiIndicators.organisationId, organisationId)];
  if (query.value) {
    filters.push(
      query.exact
        ? eq(tiIndicators.value, query.value)
        : ilike(tiIndicators.value, `%${query.value}%`),
    );
  }
  if (query.type) filters.push(eq(tiIndicators.type, query.type));
  if (query.feedId) filters.push(eq(tiIndicators.feedId, query.feedId));
  if (query.tag) filters.push(sql`${tiIndicators.tags} ? ${query.tag}`);
  if (
    Number.isInteger(query.minConfidence) &&
    query.minConfidence !== undefined &&
    query.minConfidence >= 0 &&
    query.minConfidence <= 100
  ) {
    filters.push(gte(tiIndicators.confidence, query.minConfidence));
  }
  const limit = Math.min(Math.max(query.limit ?? 100, 1), 500);
  const offset = Math.min(Math.max(query.offset ?? 0, 0), 1_000_000);
  const where = and(...filters);

  const [indicators, feeds, totalRows] = await Promise.all([
    db
      .select({
        id: tiIndicators.id,
        value: tiIndicators.value,
        type: tiIndicators.type,
        confidence: tiIndicators.confidence,
        firstSeen: tiIndicators.firstSeen,
        lastSeen: tiIndicators.lastSeen,
        tags: tiIndicators.tags,
        attributes: tiIndicators.attributes,
        feedId: tiFeeds.id,
        feedName: tiFeeds.name,
        feedKind: tiFeeds.kind,
      })
      .from(tiIndicators)
      .innerJoin(tiFeeds, eq(tiFeeds.id, tiIndicators.feedId))
      .where(where)
      .orderBy(desc(tiIndicators.lastSeen), desc(tiIndicators.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({
        id: tiFeeds.id,
        name: tiFeeds.name,
        kind: tiFeeds.kind,
        isActive: tiFeeds.isActive,
        indicatorCount: tiFeeds.indicatorCount,
        lastPolledAt: tiFeeds.lastPolledAt,
        lastError: tiFeeds.lastError,
      })
      .from(tiFeeds)
      .where(eq(tiFeeds.organisationId, organisationId))
      .orderBy(desc(tiFeeds.createdAt)),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(tiIndicators)
      .where(where),
  ]);
  const total = totalRows[0]?.total ?? 0;

  return {
    indicators: indicators.map((indicator) => ({
      ...indicator,
      firstSeen: indicator.firstSeen?.toISOString() ?? null,
      lastSeen: indicator.lastSeen?.toISOString() ?? null,
    })),
    feeds: feeds.map((feed) => ({
      ...feed,
      lastPolledAt: feed.lastPolledAt?.toISOString() ?? null,
    })),
    count: indicators.length,
    total,
    limit,
    offset,
    nextOffset:
      offset + indicators.length < total ? offset + indicators.length : null,
  };
}

export type CyberBriefingQuery = {
  query?: string;
  source?: string;
  vendor?: string;
  sort?: "newest" | "oldest" | "source";
  page?: number;
  pageSize?: number;
};

export async function listWatchedVendors(
  organisationId: string,
): Promise<WatchedVendor[]> {
  return db
    .select({
      id: vendorWatchlist.id,
      catalogSlug: vendorWatchlist.catalogSlug,
      displayName: vendorWatchlist.displayName,
      website: vendorWatchlist.website,
      category: vendorWatchlist.category,
      aliases: vendorWatchlist.aliases,
    })
    .from(vendorWatchlist)
    .where(eq(vendorWatchlist.organisationId, organisationId))
    .orderBy(vendorWatchlist.displayName);
}

function publishedTime(value: string | null): number {
  return value ? Date.parse(value) : 0;
}

export async function queryCyberBriefing(
  organisationId: string,
  query: CyberBriefingQuery,
) {
  const [result, watchedVendors] = await Promise.all([
    getCyberNews(),
    listWatchedVendors(organisationId),
  ]);
  const search = query.query?.trim().toLocaleLowerCase();
  const items = result.items
    .map((item) => ({
      ...item,
      matchedVendors: matchingVendors(item, watchedVendors).map((vendor) => ({
        id: vendor.id,
        slug: vendor.catalogSlug,
        name: vendor.displayName,
        website: vendor.website,
        category: vendor.category,
      })),
    }))
    .filter((item) => {
      if (query.source && item.source !== query.source) return false;
      if (
        query.vendor === "watched" &&
        item.matchedVendors.length === 0
      ) {
        return false;
      }
      if (
        query.vendor &&
        query.vendor !== "watched" &&
        !item.matchedVendors.some((vendor) => vendor.slug === query.vendor)
      ) {
        return false;
      }
      return (
        !search ||
        item.title.toLocaleLowerCase().includes(search) ||
        item.summary.toLocaleLowerCase().includes(search)
      );
    })
    .sort((a, b) => {
      if (query.sort === "oldest") {
        return (
          (publishedTime(a.publishedAt) || Number.POSITIVE_INFINITY) -
          (publishedTime(b.publishedAt) || Number.POSITIVE_INFINITY)
        );
      }
      if (query.sort === "source") {
        return (
          a.source.localeCompare(b.source) ||
          publishedTime(b.publishedAt) - publishedTime(a.publishedAt)
        );
      }
      return publishedTime(b.publishedAt) - publishedTime(a.publishedAt);
    });

  const pageSize = Math.min(Math.max(query.pageSize ?? 25, 1), 100);
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(query.page ?? 1, 1), totalPages);

  return {
    items: items.slice((page - 1) * pageSize, page * pageSize),
    sources: [...new Set(result.items.map((item) => item.source))].sort(),
    watchedVendors: watchedVendors.map((vendor) => ({
      id: vendor.id,
      slug: vendor.catalogSlug,
      name: vendor.displayName,
      website: vendor.website,
      category: vendor.category,
    })),
    failedSources: result.failedSources,
    refreshedAt: result.refreshedAt,
    pagination: { page, pageSize, total, totalPages },
  };
}
