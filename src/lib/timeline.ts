import { db } from "@/db";
import { cases, timelineEvents } from "@/db/schema";
import { eq } from "drizzle-orm";
import { newId } from "./utils";
import { queueAutomationRunsForTimelineEvent } from "./automations/core";
import { fireWebhook } from "./webhooks";

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
    if (
      opts.eventType === "case_created" ||
      opts.eventType === "status_change"
    ) {
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
