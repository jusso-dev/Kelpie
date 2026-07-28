import { db } from "@/db";
import { cases, timelineEvents } from "@/db/schema";
import { eq } from "drizzle-orm";
import { newId } from "./utils";
import { queueAutomationRunsForTimelineEvent } from "./automations/core";
import { fireWebhook } from "./webhooks";
import { recordAuditEvent } from "./audit/events";
import { notifyWatchersForEvent } from "./watchers-core";

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
  | "alert_linked_to_case"
  | "alert_unlinked_from_case"
  | "alert_status_changed"
  | "alert_verdict_changed"
  | "alert_assigned"
  | "alert_entity_linked"
  | "evidence_item_created"
  | "evidence_item_verdict_changed"
  | "evidence_item_remediation_changed"
  | "evidence_relationship_created"
  | "investigation_graph_edge_created"
  | "investigation_graph_edge_removed"
  | "queue_assignment_change"
  | "acknowledged"
  | "handoff_recorded"
  | "watcher_added"
  | "watcher_removed"
  | "escalation_triggered"
  | "bulk_operation"
  | "attack_mapping_changed"
  | "attack_story_changed"
  | "content_block_changed"
  | "case_merged"
  | "case_merge_reversed"
  | "correlation_suggestion_accepted"
  | "correlation_suggestion_rejected"
  | "source_sync"
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
    // Bump the case's activity stamp so the "stale investigation" built-in
    // view (#54) and per-queue aging buckets stay accurate without scanning
    // the timeline table on every read.
    await db
      .update(cases)
      .set({ lastActivityAt: created.occurredAt })
      .where(eq(cases.id, opts.caseId));
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
      // Watchers are a notification preference only, never an access grant:
      // this only ever reads who is watching and their own preference flags,
      // it does not change who can view or edit the case.
      await notifyWatchersForEvent({
        caseId: opts.caseId,
        organisationId: caseRow.organisationId,
        caseNumber: caseRow.caseNumber,
        caseTitle: caseRow.title,
        actorId: opts.actorId,
        eventType: opts.eventType,
        payload: opts.payload ?? {},
      }).catch(() => {
        // Watcher notification is best-effort; it must never block the
        // timeline write it is reacting to.
      });
    }
  }
}
