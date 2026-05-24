import crypto from "node:crypto";
import { db } from "@/db";
import { webhooks, webhookDeliveries } from "@/db/schema";
import { and, eq, lte, sql } from "drizzle-orm";
import { newId } from "./utils";
import type { WebhookEvent } from "./webhook-events";

export { WEBHOOK_EVENTS, type WebhookEvent } from "./webhook-events";

export function signPayload(body: string, secret: string): string {
  return (
    "sha256=" +
    crypto.createHmac("sha256", secret).update(body).digest("hex")
  );
}

/** Enqueue a delivery for every active subscription that includes the event. */
export async function fireWebhook(
  organisationId: string,
  event: WebhookEvent,
  payload: Record<string, unknown>,
): Promise<void> {
  const subs = await db
    .select()
    .from(webhooks)
    .where(
      and(eq(webhooks.organisationId, organisationId), eq(webhooks.isActive, true)),
    );
  for (const sub of subs) {
    const events = (sub.events as string[]) ?? [];
    if (!events.includes(event)) continue;
    await db.insert(webhookDeliveries).values({
      id: newId("wd"),
      webhookId: sub.id,
      event,
      payload,
      status: "pending",
      nextAttemptAt: new Date(),
    });
  }
}

/** Backoff schedule in minutes: 1, 5, 30, 120. */
const RETRY_MINUTES = [1, 5, 30, 120];

export async function processPendingDeliveries(limit = 25): Promise<{
  delivered: number;
  failed: number;
  retried: number;
}> {
  const now = new Date();
  const due = await db
    .select()
    .from(webhookDeliveries)
    .where(
      and(
        eq(webhookDeliveries.status, "pending"),
        lte(webhookDeliveries.nextAttemptAt, now),
      ),
    )
    .limit(limit);

  if (due.length === 0) {
    await pruneOldDeliveries();
    return { delivered: 0, failed: 0, retried: 0 };
  }

  let delivered = 0;
  let failed = 0;
  let retried = 0;

  for (const d of due) {
    const [sub] = await db
      .select()
      .from(webhooks)
      .where(eq(webhooks.id, d.webhookId))
      .limit(1);
    if (!sub) {
      await db
        .update(webhookDeliveries)
        .set({
          status: "failed",
          lastError: "webhook removed",
          completedAt: new Date(),
        })
        .where(eq(webhookDeliveries.id, d.id));
      failed++;
      continue;
    }
    const body = JSON.stringify({ event: d.event, payload: d.payload });
    const signature = signPayload(body, sub.secret);
    const attempt = d.attemptCount + 1;
    const started = Date.now();
    let responseCode: number | null = null;
    let responseBody = "";
    let error: string | null = null;
    try {
      const res = await fetch(sub.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Kelpie-Event": d.event,
          "X-Kelpie-Signature": signature,
          "X-Kelpie-Delivery": d.id,
        },
        body,
        signal: AbortSignal.timeout(10000),
      });
      responseCode = res.status;
      responseBody = (await res.text().catch(() => "")).slice(0, 2048);
    } catch (e) {
      error = (e as Error).message;
    }
    const latency = Date.now() - started;
    const ok = responseCode !== null && responseCode >= 200 && responseCode < 300;
    if (ok) {
      delivered++;
      await db
        .update(webhookDeliveries)
        .set({
          status: "delivered",
          attemptCount: attempt,
          lastResponseCode: responseCode,
          lastResponseBody: responseBody,
          latencyMs: latency,
          completedAt: new Date(),
        })
        .where(eq(webhookDeliveries.id, d.id));
    } else if (attempt >= RETRY_MINUTES.length + 1) {
      failed++;
      await db
        .update(webhookDeliveries)
        .set({
          status: "failed",
          attemptCount: attempt,
          lastResponseCode: responseCode,
          lastResponseBody: responseBody,
          lastError: error,
          latencyMs: latency,
          completedAt: new Date(),
        })
        .where(eq(webhookDeliveries.id, d.id));
    } else {
      retried++;
      const minutes = RETRY_MINUTES[attempt - 1] ?? 120;
      await db
        .update(webhookDeliveries)
        .set({
          status: "pending",
          attemptCount: attempt,
          lastResponseCode: responseCode,
          lastResponseBody: responseBody,
          lastError: error,
          latencyMs: latency,
          nextAttemptAt: new Date(Date.now() + minutes * 60000),
        })
        .where(eq(webhookDeliveries.id, d.id));
    }
  }
  await pruneOldDeliveries();
  return { delivered, failed, retried };
}

async function pruneOldDeliveries() {
  // Keep the last 50 deliveries per webhook.
  await db.execute(sql`
    DELETE FROM webhook_deliveries d
    USING (
      SELECT id,
             row_number() OVER (PARTITION BY webhook_id ORDER BY created_at DESC) AS rn
      FROM webhook_deliveries
    ) ranked
    WHERE d.id = ranked.id AND ranked.rn > 50
  `);
}
