"use server";

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { webhooks, webhookDeliveries } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { requireRole } from "@/lib/session";
import { newId } from "@/lib/utils";
import { WEBHOOK_EVENTS, type WebhookEvent } from "@/lib/webhook-events";
import { assertSafeOutboundUrl } from "@/lib/outbound-request";

function parseEvents(raw: FormDataEntryValue | null): WebhookEvent[] {
  if (typeof raw !== "string") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((v): v is WebhookEvent =>
    typeof v === "string" && (WEBHOOK_EVENTS as readonly string[]).includes(v),
  );
}

export async function createWebhook(formData: FormData): Promise<{ secret: string }> {
  const user = await requireRole(["admin"]);
  const name = String(formData.get("name") ?? "").trim();
  const url = String(formData.get("url") ?? "").trim();
  const events = parseEvents(formData.get("events"));
  if (!name) throw new Error("Name required");
  if (!url) throw new Error("URL required");
  await assertSafeOutboundUrl(url);
  if (events.length === 0) throw new Error("Pick at least one event");
  const secret = "whk_" + crypto.randomBytes(24).toString("base64url");
  await db.insert(webhooks).values({
    id: newId("wh"),
    organisationId: user.organisationId,
    name,
    url,
    secret,
    events,
    isActive: true,
    createdBy: user.id,
  });
  revalidatePath("/settings");
  return { secret };
}

export async function setWebhookActive(id: string, active: boolean) {
  const user = await requireRole(["admin"]);
  await db
    .update(webhooks)
    .set({ isActive: active })
    .where(and(eq(webhooks.id, id), eq(webhooks.organisationId, user.organisationId)));
  revalidatePath("/settings");
}

export async function deleteWebhook(id: string) {
  const user = await requireRole(["admin"]);
  await db
    .delete(webhooks)
    .where(and(eq(webhooks.id, id), eq(webhooks.organisationId, user.organisationId)));
  revalidatePath("/settings");
}

export async function listRecentDeliveries(webhookId: string) {
  const user = await requireRole(["admin"]);
  const [sub] = await db
    .select()
    .from(webhooks)
    .where(
      and(eq(webhooks.id, webhookId), eq(webhooks.organisationId, user.organisationId)),
    )
    .limit(1);
  if (!sub) throw new Error("Not found");
  return db
    .select()
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.webhookId, webhookId))
    .orderBy(desc(webhookDeliveries.createdAt))
    .limit(50);
}
