import Link from "next/link";
import { Activity, Database, Network, ShieldAlert } from "lucide-react";
import type { BrolgaStatsSnapshot } from "@/lib/brolga/client";

function formatCount(n: number): string {
  return n.toLocaleString();
}

function statusBadge(status: BrolgaStatsSnapshot["status"]): {
  label: string;
  className: string;
} {
  switch (status) {
    case "ok":
      return { label: "receiving", className: "text-green-400" };
    case "disabled":
      return { label: "disabled", className: "text-amber-400" };
    case "unconfigured":
      return { label: "not configured", className: "text-slate-500" };
    case "unavailable":
      return { label: "unreachable", className: "text-amber-400" };
    case "error":
      return { label: "error", className: "text-red-400" };
  }
}

export default function BrolgaStatsPanel({
  snapshot,
}: {
  snapshot: BrolgaStatsSnapshot;
}) {
  const badge = statusBadge(snapshot.status);
  const stats = snapshot.stats;

  return (
    <section className="kelpie-card p-5 space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="mt-0.5 text-[color:var(--color-tan-400)]">
            <Network size={20} aria-hidden="true" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-medium text-slate-100">
                Brolga threat intelligence
              </h2>
              <span className={`kelpie-badge ${badge.className}`}>
                {badge.label}
              </span>
            </div>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">
              Live store counts from Brolga. OpenCTI and other upstreams feed
              Brolga; Kelpie enriches cases from context packs — it does not
              poll external TI lists.
            </p>
            {snapshot.baseUrl ? (
              <p className="mt-1 text-xs text-slate-600 font-mono truncate">
                {snapshot.baseUrl}
                {snapshot.health?.version
                  ? ` · v${snapshot.health.version}`
                  : ""}
              </p>
            ) : null}
          </div>
        </div>
        <Link
          href="/settings/integrations"
          className="text-xs text-slate-400 hover:text-slate-200 shrink-0"
        >
          Settings → Integrations
        </Link>
      </div>

      {snapshot.status !== "ok" ? (
        <div className="flex items-start gap-2 rounded-md border border-[color:var(--color-navy-700)] bg-[color:var(--color-navy-900)]/40 px-3 py-2 text-xs text-slate-400">
          <ShieldAlert
            size={14}
            className="mt-0.5 shrink-0 text-amber-400"
            aria-hidden="true"
          />
          <p>
            {snapshot.message ?? "Brolga stats unavailable."}{" "}
            {snapshot.status === "unconfigured" || snapshot.status === "disabled"
              ? "Enable Brolga under Integrations to see live TI volume."
              : null}
          </p>
        </div>
      ) : null}

      {stats ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {(
              [
                { key: "entities", label: "Entities", value: stats.entities },
                { key: "claims", label: "Claims", value: stats.claims },
                {
                  key: "relationships",
                  label: "Relationships",
                  value: stats.relationships,
                },
                {
                  key: "sources",
                  label: "Sources",
                  value: stats.sources,
                },
                {
                  key: "sightings",
                  label: "Sightings",
                  value: stats.sightings,
                },
                {
                  key: "quarantined",
                  label: "Quarantined",
                  value: stats.quarantined,
                },
              ] as const
            ).map((item) => (
              <div
                key={item.key}
                className="rounded-md border border-[color:var(--color-navy-700)] px-3 py-2"
              >
                <p className="text-[10px] uppercase tracking-wider text-slate-500">
                  {item.label}
                </p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-slate-100">
                  {formatCount(item.value)}
                </p>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1.5">
              <Database size={12} aria-hidden="true" />
              schema v{stats.schema_version}
            </span>
            {snapshot.ready ? (
              <span className="inline-flex items-center gap-1.5">
                <Activity size={12} aria-hidden="true" />
                ready: {snapshot.ready.status}
              </span>
            ) : null}
            <span>
              fetched{" "}
              <time dateTime={snapshot.fetchedAt}>
                {new Date(snapshot.fetchedAt).toLocaleString()}
              </time>
            </span>
          </div>
        </>
      ) : null}
    </section>
  );
}
