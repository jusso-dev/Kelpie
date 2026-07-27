"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { tiFeeds } from "@/db/schema";
import { and, eq, gte, inArray } from "drizzle-orm";
import { tiIndicators } from "@/db/schema";
import { ilike, sql } from "drizzle-orm";
import { requireRole, requireUser } from "@/lib/session";
import { newId } from "@/lib/utils";
import { getFeedHandler, listFeedHandlers } from "@/lib/ti/registry";
import { assertSafeOutboundUrl } from "@/lib/outbound-request";
import {
  casesForValue,
  countCaseAppearances,
  lookupIndicators,
  pollFeed,
} from "@/lib/ti/core";
import { seedStarterThreatFeeds } from "@/lib/ti/starter-feeds";
import {
  TI_INDICATOR_TYPES,
  parseTiIndicatorType,
  type TiSkipCounts,
} from "@/lib/ti/indicator-types";

const FEED_MANAGER_ROLES = ["admin", "analyst"] as const;

function feedPollInterval(value: FormDataEntryValue | null): number {
  const interval = Number(value ?? 60);
  if (!Number.isInteger(interval) || interval < 5 || interval > 10080) {
    throw new Error("Poll interval must be between 5 minutes and 7 days.");
  }
  return interval;
}

function collectConfig(
  kind: string,
  formData: FormData,
  existing: Record<string, unknown> = {},
): Record<string, unknown> {
  const handler = getFeedHandler(kind);
  if (!handler) throw new Error("Unknown feed kind");
  const config: Record<string, unknown> = { ...existing };
  for (const field of handler.configFields) {
    const raw = formData.get(`config.${field.key}`);
    const value = typeof raw === "string" ? raw.trim() : "";
    if (field.required && !value && !config[field.key]) {
      throw new Error(`${field.label} is required`);
    }
    if (value) config[field.key] = value;
  }
  return config;
}

export async function createFeed(formData: FormData) {
  const user = await requireRole([...FEED_MANAGER_ROLES]);
  const name = String(formData.get("name") ?? "").trim();
  const kind = String(formData.get("kind") ?? "").trim();
  const url = String(formData.get("url") ?? "").trim() || null;
  const interval = feedPollInterval(formData.get("pollIntervalMinutes"));
  if (!name) throw new Error("Name is required");
  if (!getFeedHandler(kind)) throw new Error("Unknown feed kind");
  if (url) await assertSafeOutboundUrl(url);
  const config = collectConfig(kind, formData);
  await db.insert(tiFeeds).values({
    id: newId("tif"),
    organisationId: user.organisationId,
    name,
    kind,
    url,
    config,
    pollIntervalMinutes: interval,
    isActive: true,
    createdBy: user.id,
  });
  revalidatePath("/ti");
  revalidatePath("/settings/integrations");
}

export async function updateFeed(id: string, formData: FormData) {
  const user = await requireRole([...FEED_MANAGER_ROLES]);
  const [existing] = await db
    .select({ config: tiFeeds.config })
    .from(tiFeeds)
    .where(
      and(eq(tiFeeds.id, id), eq(tiFeeds.organisationId, user.organisationId)),
    )
    .limit(1);
  if (!existing) throw new Error("Feed not found");

  const name = String(formData.get("name") ?? "").trim();
  const kind = String(formData.get("kind") ?? "").trim();
  const url = String(formData.get("url") ?? "").trim() || null;
  const interval = feedPollInterval(formData.get("pollIntervalMinutes"));
  if (!name) throw new Error("Name is required");
  if (!getFeedHandler(kind)) throw new Error("Unknown feed kind");
  if (url) await assertSafeOutboundUrl(url);

  await db
    .update(tiFeeds)
    .set({
      name,
      kind,
      url,
      config: collectConfig(
        kind,
        formData,
        (existing.config as Record<string, unknown>) ?? {},
      ),
      pollIntervalMinutes: interval,
      lastError: null,
    })
    .where(
      and(eq(tiFeeds.id, id), eq(tiFeeds.organisationId, user.organisationId)),
    );
  revalidatePath("/ti");
}

export async function importStarterFeeds(): Promise<{ imported: number }> {
  const user = await requireRole([...FEED_MANAGER_ROLES]);
  const imported = await seedStarterThreatFeeds(
    user.organisationId,
    user.id,
  );
  revalidatePath("/ti");
  return { imported };
}

export async function setFeedActive(id: string, active: boolean) {
  const user = await requireRole([...FEED_MANAGER_ROLES]);
  await db
    .update(tiFeeds)
    .set({ isActive: active })
    .where(
      and(eq(tiFeeds.id, id), eq(tiFeeds.organisationId, user.organisationId)),
    );
  revalidatePath("/ti");
}

export async function updateFeedSchedule(
  id: string,
  intervalMinutes: number,
  active: boolean,
) {
  const user = await requireRole(["admin"]);
  if (
    !Number.isInteger(intervalMinutes) ||
    intervalMinutes < 5 ||
    intervalMinutes > 10080
  ) {
    throw new Error("Choose an interval between 5 minutes and 7 days.");
  }
  await db
    .update(tiFeeds)
    .set({
      pollIntervalMinutes: intervalMinutes,
      isActive: active,
      lastError: active ? null : undefined,
    })
    .where(
      and(eq(tiFeeds.id, id), eq(tiFeeds.organisationId, user.organisationId)),
    );
  revalidatePath("/ti");
  revalidatePath("/settings/integrations");
}

export async function clearFeedError(id: string) {
  const user = await requireRole([...FEED_MANAGER_ROLES]);
  await db
    .update(tiFeeds)
    .set({ lastError: null })
    .where(
      and(eq(tiFeeds.id, id), eq(tiFeeds.organisationId, user.organisationId)),
    );
  revalidatePath("/ti");
}

export async function deleteFeed(id: string) {
  const user = await requireRole([...FEED_MANAGER_ROLES]);
  await db
    .delete(tiFeeds)
    .where(
      and(eq(tiFeeds.id, id), eq(tiFeeds.organisationId, user.organisationId)),
    );
  revalidatePath("/ti");
}

export async function pollFeedNow(id: string): Promise<{
  ingested: number;
  skipped: number;
  skippedByType: TiSkipCounts;
  error: string | null;
}> {
  const user = await requireRole([...FEED_MANAGER_ROLES]);
  const [feed] = await db
    .select({ id: tiFeeds.id })
    .from(tiFeeds)
    .where(
      and(eq(tiFeeds.id, id), eq(tiFeeds.organisationId, user.organisationId)),
    )
    .limit(1);
  if (!feed) throw new Error("Feed not found");
  const result = await pollFeed(id);
  revalidatePath("/ti");
  return result;
}

export async function feedKinds() {
  return listFeedHandlers().map((f) => ({
    kind: f.kind,
    label: f.label,
    description: f.description,
    configFields: f.configFields,
  }));
}

export type IndicatorSearchRow = {
  value: string;
  type: string;
  feedId: string;
  feedName: string;
  confidence: number;
  tags: string[];
  lastSeen: string | null;
};

export type IndicatorSearchResult = {
  rows: IndicatorSearchRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export async function searchIndicators(opts: {
  q?: string;
  type?: string;
  feedId?: string;
  tag?: string;
  minConfidence?: number;
  page?: number;
}): Promise<IndicatorSearchResult> {
  const user = await requireUser();
  const pageSize = 50;
  const filters = [
    eq(tiIndicators.organisationId, user.organisationId),
    // Defence in depth: legacy rows outside the supported contract must
    // never surface even if a migration hasn't retired them yet.
    inArray(tiIndicators.type, [...TI_INDICATOR_TYPES]),
  ];
  if (opts.q?.trim()) filters.push(ilike(tiIndicators.value, `%${opts.q.trim()}%`));
  const requestedType = parseTiIndicatorType(opts.type);
  if (requestedType) filters.push(eq(tiIndicators.type, requestedType));
  if (opts.feedId?.trim()) filters.push(eq(tiIndicators.feedId, opts.feedId.trim()));
  if (opts.tag?.trim()) {
    filters.push(sql`${tiIndicators.tags} ? ${opts.tag.trim()}`);
  }
  if (
    Number.isInteger(opts.minConfidence) &&
    opts.minConfidence !== undefined &&
    opts.minConfidence >= 0 &&
    opts.minConfidence <= 100
  ) {
    filters.push(gte(tiIndicators.confidence, opts.minConfidence));
  }
  const where = and(...filters);
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(tiIndicators)
    .where(where);
  const totalPages = Math.max(1, Math.ceil((total ?? 0) / pageSize));
  const requestedPage =
    Number.isInteger(opts.page) && (opts.page ?? 0) > 0 ? opts.page! : 1;
  const page = Math.min(requestedPage, totalPages);
  const rows = await db
    .select({
      value: tiIndicators.value,
      type: tiIndicators.type,
      feedId: tiIndicators.feedId,
      feedName: tiFeeds.name,
      confidence: tiIndicators.confidence,
      tags: tiIndicators.tags,
      lastSeen: tiIndicators.lastSeen,
    })
    .from(tiIndicators)
    .innerJoin(tiFeeds, eq(tiFeeds.id, tiIndicators.feedId))
    .where(where)
    .orderBy(
      sql`${tiIndicators.lastSeen} desc nulls last`,
      sql`${tiIndicators.id} desc`,
    )
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  return {
    rows: rows.map((r) => ({
      value: r.value,
      type: r.type,
      feedId: r.feedId,
      feedName: r.feedName,
      confidence: r.confidence,
      tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
      lastSeen: r.lastSeen ? r.lastSeen.toISOString() : null,
    })),
    total: total ?? 0,
    page,
    pageSize,
    totalPages,
  };
}

export async function indicatorDetail(value: string): Promise<{
  matches: Awaited<ReturnType<typeof lookupIndicators>>;
  appearances: number;
  cases: Awaited<ReturnType<typeof casesForValue>>;
}> {
  const user = await requireUser();
  const [matches, appearances, cases] = await Promise.all([
    lookupIndicators(user.organisationId, value),
    countCaseAppearances(user.organisationId, value),
    casesForValue(user.organisationId, value),
  ]);
  return { matches, appearances, cases };
}
