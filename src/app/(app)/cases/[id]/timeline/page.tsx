import { db } from "@/db";
import { timelineEvents, users } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { format } from "date-fns";
import { requireUser } from "@/lib/session";

type Props = { params: Promise<{ id: string }> };

const EVENT_LABELS: Record<string, string> = {
  case_created: "Case opened",
  status_change: "Status changed",
  severity_change: "Severity changed",
  assignment_change: "Assignment changed",
  comment: "Comment posted",
  task_created: "Task created",
  task_completed: "Task completed",
  task_updated: "Task updated",
  observable_added: "Observable added",
  file_uploaded: "File uploaded",
  playbook_started: "Playbook started",
  sla_breach: "SLA breach",
  custom: "Update",
};

export default async function CaseTimelinePage({ params }: Props) {
  const { id } = await params;
  await requireUser();
  const events = await db
    .select({
      id: timelineEvents.id,
      eventType: timelineEvents.eventType,
      payload: timelineEvents.payload,
      occurredAt: timelineEvents.occurredAt,
      actorName: users.name,
    })
    .from(timelineEvents)
    .leftJoin(users, eq(users.id, timelineEvents.actorId))
    .where(eq(timelineEvents.caseId, id))
    .orderBy(desc(timelineEvents.occurredAt))
    .limit(500);

  return (
    <div className="kelpie-card p-5">
      <h2 className="text-sm font-medium text-slate-300 mb-3">
        Activity timeline
      </h2>
      <p className="text-xs text-slate-500 mb-4">
        Append only. The record of what happened on this case.
      </p>
      {events.length === 0 ? (
        <p className="text-sm text-slate-500">No events yet.</p>
      ) : (
        <ol className="space-y-3">
          {events.map((e) => (
            <li
              key={e.id}
              className="flex gap-3 border-b border-[color:var(--color-navy-800)] pb-3 last:border-b-0 last:pb-0"
            >
              <span className="text-[10px] uppercase tracking-wider text-[color:var(--color-tan-400)] font-medium w-32 shrink-0 pt-0.5">
                {EVENT_LABELS[e.eventType] ?? e.eventType}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-slate-200">
                  {summarisePayload(e.eventType, e.payload as Record<string, unknown>)}
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                  {format(e.occurredAt, "PP p")} ·{" "}
                  {e.actorName ?? "system"}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function summarisePayload(
  type: string,
  payload: Record<string, unknown>,
): React.ReactNode {
  if (!payload) return null;
  switch (type) {
    case "status_change":
      return (
        <>
          From <code>{String(payload.from ?? "?")}</code> to{" "}
          <code>{String(payload.to ?? "?")}</code>
          {payload.reason ? ` — ${String(payload.reason)}` : ""}
        </>
      );
    case "severity_change":
      return (
        <>
          From <code>{String(payload.from ?? "?")}</code> to{" "}
          <code>{String(payload.to ?? "?")}</code>
        </>
      );
    case "assignment_change":
      return (
        <>
          Assignee {payload.to ? "set" : "cleared"}
        </>
      );
    case "task_created":
    case "task_completed":
    case "task_updated":
      return <>{String(payload.title ?? "")}</>;
    case "observable_added":
      return (
        <>
          <code>{String(payload.type ?? "")}</code>:{" "}
          <span className="font-mono">{String(payload.value ?? "")}</span>
        </>
      );
    case "playbook_started":
      return <>{String(payload.playbook_name ?? "")} — {String(payload.steps ?? 0)} steps</>;
    case "comment":
      return <>{String(payload.preview ?? "")}</>;
    case "case_created":
      return <>{payload.from_alert ? "From alert " + String(payload.from_alert) : "Manually opened"}</>;
    default:
      return (
        <code className="text-xs text-slate-400">
          {JSON.stringify(payload)}
        </code>
      );
  }
}
