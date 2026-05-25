import { db } from "@/db";
import { cases, users } from "@/db/schema";
import { and, eq, desc, sql, gte, lte } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import Link from "next/link";
import { SeverityBadge, StatusBadge, TlpBadge } from "@/components/badges";
import { formatDistanceToNow } from "date-fns";

type SearchParams = Promise<{
  status?: string;
  severity?: string;
  classification?: string;
  tlp?: string;
  assignee?: string;
}>;

export default async function CasesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const filters = [eq(cases.organisationId, user.organisationId)];
  if (params.status) filters.push(sql`${cases.status} = ${params.status}`);
  if (params.severity)
    filters.push(sql`${cases.severity} = ${params.severity}`);
  if (params.classification)
    filters.push(sql`${cases.classification} = ${params.classification}`);
  if (params.tlp) filters.push(sql`${cases.tlp} = ${params.tlp}`);
  if (params.assignee) filters.push(eq(cases.assigneeId, params.assignee));

  const rows = await db
    .select({
      id: cases.id,
      caseNumber: cases.caseNumber,
      title: cases.title,
      status: cases.status,
      severity: cases.severity,
      tlp: cases.tlp,
      classification: cases.classification,
      assigneeId: cases.assigneeId,
      openedAt: cases.openedAt,
      assigneeName: users.name,
    })
    .from(cases)
    .leftJoin(users, eq(users.id, cases.assigneeId))
    .where(and(...filters))
    .orderBy(desc(cases.openedAt))
    .limit(200);

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Cases</h1>
          <p className="text-sm text-slate-400">
            Every case the dog is currently herding.
          </p>
        </div>
        <Link href="/cases/new" className="kelpie-btn kelpie-btn-primary">
          New case
        </Link>
      </header>

      <FilterBar current={params} />

      <div className="kelpie-card kelpie-scroll-x" tabIndex={0} aria-label="Cases table">
        <table className="kelpie-table">
          <thead>
            <tr>
              <th>Number</th>
              <th>Title</th>
              <th>Status</th>
              <th>Severity</th>
              <th>TLP</th>
              <th>Classification</th>
              <th>Assignee</th>
              <th>Opened</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center text-slate-500 py-8">
                  No cases match. Open one from the New case button or promote an alert.
                </td>
              </tr>
            ) : (
              rows.map((c) => (
                <tr key={c.id}>
                  <td className="font-mono text-xs text-slate-400">
                    {c.caseNumber}
                  </td>
                  <td>
                    <Link href={`/cases/${c.id}`} className="kelpie-link font-medium">
                      {c.title}
                    </Link>
                  </td>
                  <td>
                    <StatusBadge value={c.status} />
                  </td>
                  <td>
                    <SeverityBadge value={c.severity} />
                  </td>
                  <td>
                    <TlpBadge value={c.tlp} />
                  </td>
                  <td className="text-slate-300 text-xs capitalize">
                    {c.classification.replace(/_/g, " ")}
                  </td>
                  <td className="text-slate-300 text-xs">
                    {c.assigneeName ?? <span className="text-slate-500">Unassigned</span>}
                  </td>
                  <td className="text-slate-400 text-xs">
                    {formatDistanceToNow(c.openedAt, { addSuffix: true })}
                  </td>
                </tr>
              ))
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
  current: SearchParams extends Promise<infer T> ? T : never;
}) {
  function build(updates: Record<string, string | undefined>) {
    const merged: Record<string, string | undefined> = { ...current, ...updates };
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
    const qs = params.toString();
    return qs ? `?${qs}` : "";
  }
  const statuses = ["open", "in_progress", "contained", "eradicated", "recovered", "closed"];
  const severities = ["low", "medium", "high", "critical"];
  return (
    <div className="flex flex-wrap gap-2 text-xs items-center" aria-label="Case filters">
      <span className="mr-1 text-slate-500">Status:</span>
      <Chip label="any" href={`/cases${build({ status: undefined })}`} active={!current.status} />
      {statuses.map((s) => (
        <Chip
          key={s}
          label={s.replace(/_/g, " ")}
          href={`/cases${build({ status: s })}`}
          active={current.status === s}
        />
      ))}
      <span className="ml-3 mr-1 text-slate-500">Severity:</span>
      <Chip label="any" href={`/cases${build({ severity: undefined })}`} active={!current.severity} />
      {severities.map((s) => (
        <Chip
          key={s}
          label={s}
          href={`/cases${build({ severity: s })}`}
          active={current.severity === s}
        />
      ))}
    </div>
  );
}

function Chip({ label, href, active }: { label: string; href: string; active: boolean }) {
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
