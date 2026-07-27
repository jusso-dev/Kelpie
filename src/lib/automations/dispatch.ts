import { and, eq, lte } from "drizzle-orm";
import { db } from "@/db";
import { automationRules, automationRuns } from "@/db/schema";
import { safeFetch } from "@/lib/outbound-request";
import { writeTimelineEvent } from "@/lib/timeline";
import { signAutomationEnvelope } from "./envelope";

const RETRY_MINUTES = [1, 5, 30];

export async function processPendingAutomationRuns(limit = 25): Promise<{
  delivered: number;
  failed: number;
  retried: number;
}> {
  const due = await db
    .select()
    .from(automationRuns)
    .where(
      and(
        eq(automationRuns.status, "pending"),
        lte(automationRuns.nextAttemptAt, new Date()),
      ),
    )
    .limit(limit);
  let delivered = 0;
  let failed = 0;
  let retried = 0;
  for (const pending of due) {
    const [claimed] = await db
      .update(automationRuns)
      .set({
        status: "running",
        attemptCount: pending.attemptCount + 1,
      })
      .where(
        and(
          eq(automationRuns.id, pending.id),
          eq(automationRuns.status, "pending"),
        ),
      )
      .returning();
    if (!claimed) continue;
    const [rule] = await db
      .select()
      .from(automationRules)
      .where(
        and(
          eq(automationRules.id, claimed.ruleId),
          eq(automationRules.organisationId, claimed.organisationId),
        ),
      )
      .limit(1);
    if (!rule?.isActive) {
      await db
        .update(automationRuns)
        .set({
          status: "cancelled",
          lastError: "automation rule disabled",
          completedAt: new Date(),
        })
        .where(eq(automationRuns.id, claimed.id));
      continue;
    }

    const body = JSON.stringify(claimed.request);
    let responseCode: number | null = null;
    let responseBody = "";
    let error: string | null = null;
    try {
      const response = await safeFetch(rule.destinationUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-kelpie-event": claimed.triggerEvent,
          "x-kelpie-delivery": claimed.id,
          "x-kelpie-key-id": rule.keyId,
          "x-kelpie-signature": signAutomationEnvelope(body, rule.secret),
          "x-trace-id": claimed.traceId,
        },
        body,
        signal: AbortSignal.timeout(15_000),
      });
      responseCode = response.status;
      responseBody = (await response.text().catch(() => "")).slice(0, 2048);
      if (!response.ok) error = `HTTP ${response.status}`;
    } catch (caught) {
      error = caught instanceof Error ? caught.message : "delivery failed";
    }
    if (!error) {
      delivered++;
      await db
        .update(automationRuns)
        .set({
          status: "succeeded",
          response: { status: responseCode, body: responseBody },
          lastError: null,
          completedAt: new Date(),
        })
        .where(eq(automationRuns.id, claimed.id));
      await writeTimelineEvent({
        caseId: claimed.caseId,
        actorId: null,
        eventType: "automation_run",
        payload: {
          ruleId: rule.id,
          runId: claimed.id,
          targetProfile: rule.targetProfile,
          status: "succeeded",
        },
      });
      continue;
    }

    const retryDelay = RETRY_MINUTES[claimed.attemptCount - 1];
    if (retryDelay !== undefined) {
      retried++;
      await db
        .update(automationRuns)
        .set({
          status: "pending",
          nextAttemptAt: new Date(Date.now() + retryDelay * 60_000),
          response: { status: responseCode, body: responseBody },
          lastError: error,
        })
        .where(eq(automationRuns.id, claimed.id));
    } else {
      failed++;
      await db
        .update(automationRuns)
        .set({
          status: "failed",
          response: { status: responseCode, body: responseBody },
          lastError: error,
          completedAt: new Date(),
        })
        .where(eq(automationRuns.id, claimed.id));
      await writeTimelineEvent({
        caseId: claimed.caseId,
        actorId: null,
        eventType: "automation_run",
        payload: {
          ruleId: rule.id,
          runId: claimed.id,
          targetProfile: rule.targetProfile,
          status: "failed",
          error,
        },
      });
    }
  }
  return { delivered, failed, retried };
}
