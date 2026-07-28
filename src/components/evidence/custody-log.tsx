import { format } from "date-fns";

export type CustodyEventRow = {
  id: string;
  eventType: string;
  reason: string | null;
  payload: unknown;
  occurredAt: Date;
  actorName: string | null;
};

function summarisePayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const entries = Object.entries(payload as Record<string, unknown>).filter(
    ([, v]) => v !== null && v !== undefined && v !== "",
  );
  if (entries.length === 0) return null;
  return entries
    .map(([key, value]) => `${key.replace(/_/g, " ")}: ${Array.isArray(value) ? value.join(", ") : String(value)}`)
    .join(" · ");
}

export function CustodyLog({ events }: { events: CustodyEventRow[] }) {
  if (events.length === 0) {
    return <p className="text-xs text-slate-500">No custody events recorded yet.</p>;
  }
  return (
    <ol className="space-y-3" aria-label="Chain of custody">
      {events.map((event) => {
        const summary = summarisePayload(event.payload);
        return (
          <li key={event.id} className="border-l-2 border-[color:var(--color-navy-700)] pl-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm font-medium text-slate-200">
                {event.eventType.replace(/_/g, " ")}
              </span>
              <span className="text-xs text-slate-500">
                {format(event.occurredAt, "PP p")}
              </span>
            </div>
            <p className="text-xs text-slate-500">
              {event.actorName ?? "System"}
            </p>
            {event.reason ? (
              <p className="mt-1 text-sm text-slate-300">Reason: {event.reason}</p>
            ) : null}
            {summary ? (
              <p className="mt-1 text-xs text-slate-500 break-words">{summary}</p>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
