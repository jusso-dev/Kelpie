import { db } from "@/db";
import { timelineEvents } from "@/db/schema";
import { newId } from "./utils";

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
  | "custom";

export async function writeTimelineEvent(opts: {
  caseId: string;
  actorId: string | null;
  eventType: TimelineEventType;
  payload?: Record<string, unknown>;
}) {
  await db.insert(timelineEvents).values({
    id: newId("tle"),
    caseId: opts.caseId,
    actorId: opts.actorId,
    eventType: opts.eventType,
    payload: opts.payload ?? {},
  });
}
