import { db } from "@/db";
import { alerts } from "@/db/schema";
import { and, eq, desc, sql } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import Link from "next/link";
import { SeverityBadge, AlertStatusBadge } from "@/components/badges";
import { formatDistanceToNow } from "date-fns";

type SearchParams = Promise<{
  status?: string;
  severity?: string;
  source?: string;
}>;

export default async function AlertsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const filters = [eq(alerts.organisationId, user.organisationId)];
  if (params.status) filters.push(sql`${alerts.status} = ${params.status}`);
  if (params.severity)
    filters.push(sql`${alerts.severity} = ${params.severity}`);
  if (params.source) filters.push(sql`${alerts.source} = ${params.source}`);

  const rows = await db
    .select()
    .from(alerts)
    .where(and(...filters))
    .orderBy(desc(alerts.createdAt))
    .limit(200);

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Alerts</h1>
          <p className="text-sm text-slate-400">
            Triage the inbound mob. Promote to a case or dismiss the noise.
          </p>
        </div>
        <div className="text-xs text-slate-500">
          Showing latest {rows.length} alerts
        </div>
      </header>

      <FilterBar current={params} />

      <div className="kelpie-card kelpie-scroll-x" tabIndex={0} aria-label="Alerts table">
        <table className="kelpie-table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Source</th>
              <th>Severity</th>
              <th>Status</th>
              <th>Observables</th>
              <th>Received</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center text-slate-500 py-8">
                  No alerts. Send some through the API or seed the database.
                </td>
              </tr>
            ) : (
              rows.map((a) => {
                const obs = Array.isArray(a.observables)
                  ? (a.observables as unknown[])
                  : [];
                return (
                  <tr key={a.id}>
                    <td className="max-w-md">
                      <Link
                        href={`/alerts/${a.id}`}
                        className="kelpie-link font-medium"
                      >
                        {a.title}
                      </Link>
                      {a.externalRef ? (
                        <div className="text-xs text-slate-500 mt-0.5">
                          {a.externalRef}
                        </div>
                      ) : null}
                    </td>
                    <td className="text-slate-300">{a.source}</td>
                    <td>
                      <SeverityBadge value={a.severity} />
                    </td>
                    <td>
                      <AlertStatusBadge value={a.status} />
                    </td>
                    <td className="text-slate-400 tabular-nums">{obs.length}</td>
                    <td className="text-slate-400 text-xs">
                      {formatDistanceToNow(a.createdAt, { addSuffix: true })}
                    </td>
                    <td className="text-right">
                      <Link
                        href={`/alerts/${a.id}`}
                        className="kelpie-link text-sm"
                      >
                        Open →
                      </Link>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FilterBar({
  current,
}: {
  current: { status?: string; severity?: string; source?: string };
}) {
  const statuses = ["new", "triaged", "dismissed", "promoted"];
  const severities = ["low", "medium", "high", "critical"];
  function buildQuery(updates: Record<string, string | undefined>) {
    const merged: Record<string, string | undefined> = { ...current, ...updates };
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(merged)) {
      if (v) params.set(k, v);
    }
    const qs = params.toString();
    return qs ? `?${qs}` : "";
  }
  return (
    <div className="flex flex-wrap gap-2 text-xs items-center" aria-label="Alert filters">
      <span className="text-slate-500 mr-1">Status:</span>
      <FilterChip label="any" href={`/alerts${buildQuery({ status: undefined })}`} active={!current.status} />
      {statuses.map((s) => (
        <FilterChip
          key={s}
          label={s}
          href={`/alerts${buildQuery({ status: s })}`}
          active={current.status === s}
        />
      ))}
      <span className="text-slate-500 ml-3 mr-1">Severity:</span>
      <FilterChip label="any" href={`/alerts${buildQuery({ severity: undefined })}`} active={!current.severity} />
      {severities.map((s) => (
        <FilterChip
          key={s}
          label={s}
          href={`/alerts${buildQuery({ severity: s })}`}
          active={current.severity === s}
        />
      ))}
    </div>
  );
}

function FilterChip({
  label,
  href,
  active,
}: {
  label: string;
  href: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={
        "kelpie-chip " +
        (active
          ? "border-[color:var(--color-tan-500)] text-[color:var(--color-tan-300)] bg-[color:var(--color-navy-800)]"
          : "border-[color:var(--color-navy-700)] text-slate-400 hover:text-slate-200")
      }
    >
      {label}
    </Link>
  );
}
