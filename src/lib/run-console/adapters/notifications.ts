import { and, desc, eq, gte, lte, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { mobileNotificationDeliveries, webhookDeliveries, webhooks } from "@/db/schema";
import { buildRunErrorSummary, buildRunSummary } from "../redact";
import { classifyErrorMessage } from "../error-category";
import type { RunFilters, RunRecord, RunState } from "../types";

function webhookState(status: string): RunState {
  switch (status) {
    case "pending":
      return "queued";
    case "delivered":
      return "succeeded";
    case "cancelled":
      return "cancelled";
    case "failed":
      return "failed";
    default:
      return "failed";
  }
}

function mobileState(status: string): RunState {
  switch (status) {
    case "pending":
      return "queued";
    case "sent":
      return "succeeded";
    case "cancelled":
      return "cancelled";
    case "failed":
      return "failed";
    default:
      return "failed";
  }
}

function webhookToRecord(
  row: typeof webhookDeliveries.$inferSelect,
  webhook: typeof webhooks.$inferSelect,
): RunRecord {
  const state = webhookState(row.status);
  const payload = (row.payload as Record<string, unknown>) ?? {};
  return {
    id: row.id,
    runType: "notification",
    organisationId: webhook.organisationId,
    caseId: typeof payload.case_id === "string" ? payload.case_id : null,
    caseNumber: typeof payload.case_number === "string" ? payload.case_number : null,
    trigger: webhook.name,
    ruleOrActionRef: row.event,
    ruleOrActionVersion: null,
    actionId: webhook.id,
    provider: webhook.kind,
    state,
    approval: {
      requiredApproval: false,
      requestedBy: null,
      approvedBy: null,
      approvedAt: null,
      expiresAt: null,
    },
    lineage: { attempt: row.attemptCount + 1, parentRunId: null, rootRunId: null },
    timestamps: {
      queuedAt: row.createdAt.toISOString(),
      startedAt: null,
      finishedAt: row.completedAt?.toISOString() ?? null,
    },
    providerRequestId: row.lastResponseCode !== null ? String(row.lastResponseCode) : null,
    inputSummary: buildRunSummary({ event: row.event }),
    outputSummary: buildRunSummary({ latencyMs: row.latencyMs }),
    errorCategory: state === "failed" ? classifyErrorMessage(row.lastError) : null,
    errorSummary: buildRunErrorSummary(row.lastError),
    cancel: { requested: false, requestedAt: null, requestedBy: null },
    killSwitch: { organisationActive: false, providerActive: false, actionActive: false },
    // Deliveries already exhaust their own backoff schedule automatically;
    // "retryable" here only means "still queued, can be run now" rather than
    // a lineage retry of a terminal failure (replaying a failed delivery
    // would create a new send of a past event with no safe dedupe against
    // whatever the far end already did with earlier attempts).
    retryable: state === "queued",
    cancellable: state === "queued",
  };
}

function mobileToRecord(row: typeof mobileNotificationDeliveries.$inferSelect): RunRecord {
  const state = mobileState(row.status);
  return {
    id: row.id,
    runType: "notification",
    organisationId: row.organisationId,
    caseId: row.destinationType === "case" ? row.destinationId : null,
    caseNumber: null,
    trigger: `Mobile push: ${row.event}`,
    ruleOrActionRef: row.event,
    ruleOrActionVersion: null,
    actionId: null,
    provider: "mobile_push_apns",
    state,
    approval: {
      requiredApproval: false,
      requestedBy: null,
      approvedBy: null,
      approvedAt: null,
      expiresAt: null,
    },
    lineage: { attempt: row.attemptCount + 1, parentRunId: null, rootRunId: null },
    timestamps: {
      queuedAt: row.createdAt.toISOString(),
      startedAt: null,
      finishedAt: row.sentAt?.toISOString() ?? null,
    },
    providerRequestId: row.apnsId,
    inputSummary: buildRunSummary({ event: row.event, title: row.title }),
    outputSummary: null,
    errorCategory: state === "failed" ? classifyErrorMessage(row.lastError) : null,
    errorSummary: buildRunErrorSummary(row.lastError),
    cancel: { requested: false, requestedAt: null, requestedBy: null },
    killSwitch: { organisationActive: false, providerActive: false, actionActive: false },
    // Deliveries already exhaust their own backoff schedule automatically;
    // "retryable" here only means "still queued, can be run now" rather than
    // a lineage retry of a terminal failure (replaying a failed delivery
    // would create a new send of a past event with no safe dedupe against
    // whatever the far end already did with earlier attempts).
    retryable: state === "queued",
    cancellable: state === "queued",
  };
}

export async function listNotificationRuns(
  organisationId: string,
  filters: RunFilters,
  limit: number,
): Promise<RunRecord[]> {
  if (filters.actorId) return []; // deliveries have no human requester
  const half = Math.max(1, Math.floor(limit / 2));

  const webhookClauses: SQL[] = [eq(webhooks.organisationId, organisationId)];
  if (filters.from) webhookClauses.push(gte(webhookDeliveries.createdAt, filters.from));
  if (filters.to) webhookClauses.push(lte(webhookDeliveries.createdAt, filters.to));
  const webhookRows =
    filters.provider && filters.provider === "mobile_push_apns"
      ? []
      : await db
          .select({ delivery: webhookDeliveries, webhook: webhooks })
          .from(webhookDeliveries)
          .innerJoin(webhooks, eq(webhookDeliveries.webhookId, webhooks.id))
          .where(and(...webhookClauses))
          .orderBy(desc(webhookDeliveries.createdAt))
          .limit(half);

  const mobileClauses: SQL[] = [eq(mobileNotificationDeliveries.organisationId, organisationId)];
  if (filters.from) mobileClauses.push(gte(mobileNotificationDeliveries.createdAt, filters.from));
  if (filters.to) mobileClauses.push(lte(mobileNotificationDeliveries.createdAt, filters.to));
  const mobileRows =
    filters.provider && filters.provider !== "mobile_push_apns"
      ? []
      : await db
          .select()
          .from(mobileNotificationDeliveries)
          .where(and(...mobileClauses))
          .orderBy(desc(mobileNotificationDeliveries.createdAt))
          .limit(half);

  const records = [
    ...webhookRows.map((r) => webhookToRecord(r.delivery, r.webhook)),
    ...mobileRows.map(mobileToRecord),
  ];
  return records.filter((record) => {
    if (filters.caseId && record.caseId !== filters.caseId) return false;
    if (filters.action && record.actionId !== filters.action) return false;
    if (filters.provider && record.provider !== filters.provider) return false;
    if (filters.state && record.state !== filters.state) return false;
    if (filters.result === "success" && record.state !== "succeeded") return false;
    if (filters.result === "failure" && record.state !== "failed") return false;
    return true;
  });
}

export async function getNotificationRun(
  organisationId: string,
  id: string,
): Promise<RunRecord | null> {
  const [webhookRow] = await db
    .select({ delivery: webhookDeliveries, webhook: webhooks })
    .from(webhookDeliveries)
    .innerJoin(webhooks, eq(webhookDeliveries.webhookId, webhooks.id))
    .where(and(eq(webhookDeliveries.id, id), eq(webhooks.organisationId, organisationId)))
    .limit(1);
  if (webhookRow) return webhookToRecord(webhookRow.delivery, webhookRow.webhook);
  const [mobileRow] = await db
    .select()
    .from(mobileNotificationDeliveries)
    .where(
      and(
        eq(mobileNotificationDeliveries.id, id),
        eq(mobileNotificationDeliveries.organisationId, organisationId),
      ),
    )
    .limit(1);
  return mobileRow ? mobileToRecord(mobileRow) : null;
}

/** Manual "retry now" for a still-queued delivery: brings its next attempt forward. */
export async function retryNotificationRun(
  organisationId: string,
  runId: string,
): Promise<void> {
  const [webhookRow] = await db
    .select({ delivery: webhookDeliveries, webhook: webhooks })
    .from(webhookDeliveries)
    .innerJoin(webhooks, eq(webhookDeliveries.webhookId, webhooks.id))
    .where(and(eq(webhookDeliveries.id, runId), eq(webhooks.organisationId, organisationId)))
    .limit(1);
  if (webhookRow) {
    if (webhookRow.delivery.status !== "pending") {
      throw new Error("Only a still-queued delivery can be retried now");
    }
    await db
      .update(webhookDeliveries)
      .set({ nextAttemptAt: new Date() })
      .where(eq(webhookDeliveries.id, runId));
    return;
  }
  const [mobileRow] = await db
    .select()
    .from(mobileNotificationDeliveries)
    .where(
      and(
        eq(mobileNotificationDeliveries.id, runId),
        eq(mobileNotificationDeliveries.organisationId, organisationId),
      ),
    )
    .limit(1);
  if (mobileRow) {
    if (mobileRow.status !== "pending") {
      throw new Error("Only a still-queued delivery can be retried now");
    }
    await db
      .update(mobileNotificationDeliveries)
      .set({ nextAttemptAt: new Date() })
      .where(eq(mobileNotificationDeliveries.id, runId));
    return;
  }
  throw new Error("Notification delivery not found");
}

/** Best-effort cancel: only meaningful while still queued for a future attempt. */
export async function cancelNotificationRun(organisationId: string, runId: string): Promise<void> {
  const [webhookRow] = await db
    .select({ delivery: webhookDeliveries, webhook: webhooks })
    .from(webhookDeliveries)
    .innerJoin(webhooks, eq(webhookDeliveries.webhookId, webhooks.id))
    .where(and(eq(webhookDeliveries.id, runId), eq(webhooks.organisationId, organisationId)))
    .limit(1);
  if (webhookRow) {
    const [cancelled] = await db
      .update(webhookDeliveries)
      .set({ status: "cancelled", lastError: "cancelled by operator", completedAt: new Date() })
      .where(and(eq(webhookDeliveries.id, runId), eq(webhookDeliveries.status, "pending")))
      .returning();
    if (!cancelled) throw new Error("Delivery is no longer queued");
    return;
  }
  const [mobileRow] = await db
    .select()
    .from(mobileNotificationDeliveries)
    .where(
      and(
        eq(mobileNotificationDeliveries.id, runId),
        eq(mobileNotificationDeliveries.organisationId, organisationId),
      ),
    )
    .limit(1);
  if (mobileRow) {
    const [cancelled] = await db
      .update(mobileNotificationDeliveries)
      .set({ status: "cancelled", lastError: "cancelled by operator" })
      .where(
        and(
          eq(mobileNotificationDeliveries.id, runId),
          eq(mobileNotificationDeliveries.status, "pending"),
        ),
      )
      .returning();
    if (!cancelled) throw new Error("Delivery is no longer queued");
    return;
  }
  throw new Error("Notification delivery not found");
}
