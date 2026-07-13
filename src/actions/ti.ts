"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { tiFeeds } from "@/db/schema";
import { and, eq } from "drizzle-orm";
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

function collectConfig(kind: string, formData: FormData): Record<string, string> {
  const handler = getFeedHandler(kind);
  if (!handler) throw new Error("Unknown feed kind");
  const config: Record<string, string> = {};
  for (const field of handler.configFields) {
    const raw = formData.get(`config.${field.key}`);
    const value = typeof raw === "string" ? raw.trim() : "";
    if (field.required && !value) throw new Error(`${field.label} is required`);
    if (value) config[field.key] = value;
  }
  return config;
}

export async function createFeed(formData: FormData) {
  const user = await requireRole(["admin"]);
  const name = String(formData.get("name") ?? "").trim();
  const kind = String(formData.get("kind") ?? "").trim();
  const url = String(formData.get("url") ?? "").trim() || null;
  const interval = Number(formData.get("pollIntervalMinutes") ?? 60);
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
    pollIntervalMinutes: Number.isFinite(interval) && interval > 0 ? interval : 60,
    isActive: true,
    createdBy: user.id,
  });
  revalidatePath("/ti");
  revalidatePath("/settings/integrations");
}

export async function setFeedActive(id: string, active: boolean) {
  const user = await requireRole(["admin"]);
  await db
    .update(tiFeeds)
    .set({ isActive: active })
    .where(
      and(eq(tiFeeds.id, id), eq(tiFeeds.organisationId, user.organisationId)),
    );
  revalidatePath("/ti");
}

export async function clearFeedError(id: string) {
  const user = await requireRole(["admin"]);
  await db
    .update(tiFeeds)
    .set({ lastError: null })
    .where(
      and(eq(tiFeeds.id, id), eq(tiFeeds.organisationId, user.organisationId)),
    );
  revalidatePath("/ti");
}

export async function deleteFeed(id: string) {
  const user = await requireRole(["admin"]);
  await db
    .delete(tiFeeds)
    .where(
      and(eq(tiFeeds.id, id), eq(tiFeeds.organisationId, user.organisationId)),
    );
  revalidatePath("/ti");
}

export async function pollFeedNow(id: string): Promise<{
  ingested: number;
  error: string | null;
}> {
  const user = await requireRole(["admin"]);
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

export async function searchIndicators(opts: {
  q?: string;
  type?: string;
  feedId?: string;
  tag?: string;
}): Promise<IndicatorSearchRow[]> {
  const user = await requireUser();
  const filters = [eq(tiIndicators.organisationId, user.organisationId)];
  if (opts.q?.trim()) filters.push(ilike(tiIndicators.value, `%${opts.q.trim()}%`));
  if (opts.type?.trim()) filters.push(eq(tiIndicators.type, opts.type.trim()));
  if (opts.feedId?.trim()) filters.push(eq(tiIndicators.feedId, opts.feedId.trim()));
  if (opts.tag?.trim()) {
    filters.push(sql`${tiIndicators.tags} ? ${opts.tag.trim()}`);
  }
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
    .where(and(...filters))
    .orderBy(sql`${tiIndicators.lastSeen} desc nulls last`)
    .limit(100);
  return rows.map((r) => ({
    value: r.value,
    type: r.type,
    feedId: r.feedId,
    feedName: r.feedName,
    confidence: r.confidence,
    tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
    lastSeen: r.lastSeen ? r.lastSeen.toISOString() : null,
  }));
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
