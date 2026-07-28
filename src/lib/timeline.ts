import { db } from "@/db";
import { cases, timelineEvents } from "@/db/schema";
import { eq } from "drizzle-orm";
import { newId } from "./utils";
import { queueAutomationRunsForTimelineEvent } from "./automations/core";
import { fireWebhook } from "./webhooks";
import { recordAuditEvent } from "./audit/events";

export type TimelineEventType =
  | "case_created"
  | "status_change"
  | "severity_change"
  | "assignment_change"
  | "comment"
  | "task_created"
  | "task_completed"
  | "task_updated"
  | "observable_added"
  | "file_uploaded"
  | "playbook_started"
  | "sla_breach"
  | "response_action"
  | "automation_run"
  | "ti_enrichment"
  | "custom_field_changed"
  | "relationship_created"
  | "relationship_removed"
  | "relationship_suggestion_dismissed"
  | "queue_assignment_change"
  | "additional_assignee_added"
  | "additional_assignee_removed"
  | "watcher_added"
  | "watcher_removed"
  | "handoff_created"
  | "acknowledged"
  | "escalation_triggered"
  | "bulk_operation_applied"
  | "custom";

export async function writeTimelineEvent(opts: {
  caseId: string;
  actorId: string | null;
  eventType: TimelineEventType;
  payload?: Record<string, unknown>;
}) {
  const [created] = await db.insert(timelineEvents).values({
    id: newId("tle"),
    caseId: opts.caseId,
    actorId: opts.actorId,
    eventType: opts.eventType,
    payload: opts.payload ?? {},
  }).returning({
    id: timelineEvents.id,
    occurredAt: timelineEvents.occurredAt,
  });
  if (created) {
    await queueAutomationRunsForTimelineEvent({
      timelineEventId: created.id,
      timelineEventType: opts.eventType,
      caseId: opts.caseId,
      occurredAt: created.occurredAt,
    });
    const [caseRow] = await db
      .select({
        organisationId: cases.organisationId,
        caseNumber: cases.caseNumber,
        title: cases.title,
      })
      .from(cases)
      .where(eq(cases.id, opts.caseId))
      .limit(1);
    if (caseRow) {
      await recordAuditEvent({
        organisationId: caseRow.organisationId,
        actorId: opts.actorId,
        actorType: opts.actorId ? "user" : "system",
        action: `case.${opts.eventType}`,
        targetType: "case",
        targetId: opts.caseId,
        targetLabel: caseRow.caseNumber,
        metadata: opts.payload ?? null,
      });
      if (
        opts.eventType === "case_created" ||
        opts.eventType === "status_change"
      ) {
        const event =
          opts.eventType === "case_created"
            ? "case.created"
            : "case.status_changed";
        const payload = {
          case_id: opts.caseId,
          case_number: caseRow.caseNumber,
          title: caseRow.title,
          ...opts.payload,
        };
        await fireWebhook(caseRow.organisationId, event, payload);
        if (opts.eventType === "status_change" && opts.payload?.to === "closed") {
          await fireWebhook(caseRow.organisationId, "case.closed", payload);
        }
      }
    }
  }
}
