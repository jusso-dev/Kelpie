"use client";

import { useEffect, useState } from "react";

type Entry = {
  userId: string;
  userName: string;
  editingField: string | null;
  typing: boolean;
  lastSeenAt: string;
};

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

const COLOURS = [
  "bg-sky-700",
  "bg-emerald-700",
  "bg-violet-700",
  "bg-rose-700",
  "bg-amber-700",
  "bg-cyan-700",
];

export default function CasePresence({ caseId }: { caseId: string }) {
  const [roster, setRoster] = useState<Entry[]>([]);

  useEffect(() => {
    let cancelled = false;

    const beat = (editingField: string | null = null) =>
      fetch(`/api/cases/${caseId}/presence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ editingField }),
        keepalive: true,
      }).catch(() => {});

    beat();
    const heartbeat = setInterval(() => beat(), 8000);

    const es = new EventSource(`/api/cases/${caseId}/presence`);
    es.onmessage = (e) => {
      if (cancelled) return;
      try {
        const data = JSON.parse(e.data) as { roster: Entry[] };
        setRoster(data.roster ?? []);
      } catch {
        // ignore malformed frame
      }
    };
    es.onerror = () => {
      // EventSource auto-reconnects; nothing to do.
    };

    const leave = () => {
      navigator.sendBeacon?.(
        `/api/cases/${caseId}/presence`,
        new Blob([JSON.stringify({ leave: true })], { type: "application/json" }),
      );
    };
    window.addEventListener("beforeunload", leave);

    return () => {
      cancelled = true;
      clearInterval(heartbeat);
      es.close();
      window.removeEventListener("beforeunload", leave);
      fetch(`/api/cases/${caseId}/presence`, { method: "DELETE", keepalive: true }).catch(
        () => {},
      );
    };
  }, [caseId]);

  if (roster.length === 0) return null;

  const editing = roster.filter((r) => r.editingField);
  const typing = roster.filter((r) => r.typing);

  return (
    <div className="kelpie-card p-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-xs uppercase tracking-wider text-slate-400">
          Also here
        </span>
        <div className="flex -space-x-2">
          {roster.map((r, i) => (
            <span
              key={r.userId}
              title={r.userName}
              className={`flex h-7 w-7 items-center justify-center rounded-full border border-[color:var(--color-navy-950)] text-[10px] font-semibold text-white ${COLOURS[i % COLOURS.length]}`}
            >
              {initials(r.userName)}
            </span>
          ))}
        </div>
      </div>
      {editing.map((r) => (
        <p key={`e-${r.userId}`} className="text-xs text-amber-300">
          {r.userName} is editing {r.editingField?.replace(/_/g, " ")}
        </p>
      ))}
      {typing.length > 0 ? (
        <p className="text-xs text-slate-400">
          {typing.map((r) => r.userName).join(", ")}{" "}
          {typing.length === 1 ? "is" : "are"} typing a comment…
        </p>
      ) : null}
    </div>
  );
}
