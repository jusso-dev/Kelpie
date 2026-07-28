"use server";

import crypto from "node:crypto";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { webhooks, webhookDeliveries } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { requireRole } from "@/lib/session";
import { newId } from "@/lib/utils";
import { WEBHOOK_EVENTS, type WebhookEvent } from "@/lib/webhook-events";
import { assertSafeOutboundUrl } from "@/lib/outbound-request";
import { recordAuditEvent } from "@/lib/audit/events";
import { auditContextFromHeaders } from "@/lib/audit/request-context";

const WEBHOOK_KINDS = ["generic", "slack", "teams"] as const;
type WebhookKind = (typeof WEBHOOK_KINDS)[number];

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

export async function createWebhook(
  formData: FormData,
): Promise<{ secret: string | null }> {
  const user = await requireRole(["admin"]);
  const name = String(formData.get("name") ?? "").trim();
  const url = String(formData.get("url") ?? "").trim();
  const rawKind = String(formData.get("kind") ?? "generic");
  const kind: WebhookKind = WEBHOOK_KINDS.includes(rawKind as WebhookKind)
    ? (rawKind as WebhookKind)
    : "generic";
  const events = parseEvents(formData.get("events"));
  if (!name) throw new Error("Name required");
  if (!url) throw new Error("URL required");
  await assertSafeOutboundUrl(url);
  if (events.length === 0) throw new Error("Pick at least one event");
  const secret = "whk_" + crypto.randomBytes(24).toString("base64url");
  const webhookId = newId("wh");
  await db.insert(webhooks).values({
    id: webhookId,
    organisationId: user.organisationId,
    name,
    kind,
    url,
    secret,
    events,
    isActive: true,
    createdBy: user.id,
  });
  await recordAuditEvent({
    organisationId: user.organisationId,
    actorId: user.id,
    actorType: "user",
    actorLabel: user.email,
    action: "webhook.created",
    targetType: "webhook",
    targetId: webhookId,
    targetLabel: name,
    before: null,
    after: { name, kind, url, events, isActive: true },
    ...auditContextFromHeaders(await headers()),
  });
  revalidatePath("/settings");
  revalidatePath("/settings/integrations");
  return { secret: kind === "generic" ? secret : null };
}

export async function setWebhookActive(id: string, active: boolean) {
  const user = await requireRole(["admin"]);
  const [existing] = await db
    .select()
    .from(webhooks)
    .where(and(eq(webhooks.id, id), eq(webhooks.organisationId, user.organisationId)))
    .limit(1);
  await db
    .update(webhooks)
    .set({ isActive: active })
    .where(and(eq(webhooks.id, id), eq(webhooks.organisationId, user.organisationId)));
  if (existing) {
    await recordAuditEvent({
      organisationId: user.organisationId,
      actorId: user.id,
      actorType: "user",
      actorLabel: user.email,
      action: "webhook.updated",
      targetType: "webhook",
      targetId: id,
      targetLabel: existing.name,
      before: { isActive: existing.isActive },
      after: { isActive: active },
      ...auditContextFromHeaders(await headers()),
    });
  }
  revalidatePath("/settings");
  revalidatePath("/settings/integrations");
}

export async function deleteWebhook(id: string) {
  const user = await requireRole(["admin"]);
  const [existing] = await db
    .select()
    .from(webhooks)
    .where(and(eq(webhooks.id, id), eq(webhooks.organisationId, user.organisationId)))
    .limit(1);
  await db
    .delete(webhooks)
    .where(and(eq(webhooks.id, id), eq(webhooks.organisationId, user.organisationId)));
  if (existing) {
    await recordAuditEvent({
      organisationId: user.organisationId,
      actorId: user.id,
      actorType: "user",
      actorLabel: user.email,
      action: "webhook.deleted",
      targetType: "webhook",
      targetId: id,
      targetLabel: existing.name,
      before: {
        name: existing.name,
        kind: existing.kind,
        url: existing.url,
        events: existing.events,
        isActive: existing.isActive,
      },
      after: null,
      ...auditContextFromHeaders(await headers()),
    });
  }
  revalidatePath("/settings");
  revalidatePath("/settings/integrations");
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
