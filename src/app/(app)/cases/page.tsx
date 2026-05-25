import { db } from "@/db";
import { cases, users } from "@/db/schema";
import { and, eq, desc, sql, gte, lte } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import Link from "next/link";
import { SeverityBadge, StatusBadge, TagBadge, TlpBadge } from "@/components/badges";
import { formatDistanceToNow } from "date-fns";
import { ArrowUpRight, Filter, Search, ShieldAlert } from "lucide-react";

type SearchParams = Promise<{
  status?: string;
  severity?: string;
  classification?: string;
  tlp?: string;
  assignee?: string;
  tag?: string;
  dataTag?: string;
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
  if (params.tag) filters.push(sql`${cases.tags} ? ${params.tag}`);
  if (params.dataTag)
    filters.push(sql`${cases.dataClassificationTags} ? ${params.dataTag}`);

  const rows = await db
    .select({
      id: cases.id,
      caseNumber: cases.caseNumber,
      title: cases.title,
      status: cases.status,
      severity: cases.severity,
      tlp: cases.tlp,
      classification: cases.classification,
      tags: cases.tags,
      dataClassificationTags: cases.dataClassificationTags,
      assigneeId: cases.assigneeId,
      openedAt: cases.openedAt,
      assigneeName: users.name,
    })
    .from(cases)
    .leftJoin(users, eq(users.id, cases.assigneeId))
    .where(and(...filters))
    .orderBy(desc(cases.openedAt))
    .limit(200);

  const activeCount = rows.filter((c) => c.status !== "closed").length;
  const criticalCount = rows.filter((c) => c.severity === "critical").length;
  const highCount = rows.filter((c) => c.severity === "high").length;

  return (
    <div className="space-y-5">
      <header className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div>
          <div className="mb-2 inline-flex items-center rounded-full border border-[color:var(--color-navy-700)] bg-[color:var(--color-navy-900)] px-3 py-1 text-xs font-medium text-[color:var(--color-tan-300)]">
            Case queue
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-50">
            Security incidents, evidence, and response status.
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
            Filter the queue by status, severity, classification, ownership,
            case tags, and data classification tags.
          </p>
        </div>
        <div className="kelpie-panel grid grid-cols-3 gap-3 p-4">
          <QueueMetric label="Active" value={activeCount} />
          <QueueMetric label="Critical" value={criticalCount} hot />
          <QueueMetric label="High" value={highCount} />
          <Link href="/cases/new" className="kelpie-btn kelpie-btn-primary col-span-3">
            New case
            <ArrowUpRight size={16} aria-hidden="true" />
          </Link>
        </div>
      </header>

      <FilterBar current={params} />

      <div className="kelpie-panel kelpie-scroll-x" tabIndex={0} aria-label="Cases table">
        <table className="kelpie-table">
          <thead>
            <tr>
              <th>Number</th>
              <th>Title</th>
              <th>Status</th>
              <th>Severity</th>
              <th>TLP</th>
              <th>Classification</th>
              <th>Tags</th>
              <th>Assignee</th>
              <th>Opened</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="text-center text-slate-500 py-8">
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
                  <td>
                    <div className="flex max-w-64 flex-wrap gap-1">
                      {(Array.isArray(c.dataClassificationTags)
                        ? (c.dataClassificationTags as string[])
                        : []
                      ).map((tag) => (
                        <TagBadge key={`data-${tag}`} value={tag} tone="classification" />
                      ))}
                      {(Array.isArray(c.tags) ? (c.tags as string[]) : []).map(
                        (tag) => (
                          <TagBadge key={tag} value={tag} />
                        ),
                      )}
                    </div>
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
    <div className="kelpie-panel space-y-3 p-3" aria-label="Case filters">
      <div className="flex items-center gap-2 text-sm font-medium text-slate-200">
        <Filter size={16} aria-hidden="true" />
        Filters
      </div>
      <div className="flex flex-wrap gap-2 text-xs items-center">
        <span className="mr-1 inline-flex items-center gap-1 text-slate-500">
          <Search size={14} aria-hidden="true" />
          Status
        </span>
        <Chip label="any" href={`/cases${build({ status: undefined })}`} active={!current.status} />
        {statuses.map((s) => (
          <Chip
            key={s}
            label={s.replace(/_/g, " ")}
            href={`/cases${build({ status: s })}`}
            active={current.status === s}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-2 text-xs items-center">
        <span className="mr-1 inline-flex items-center gap-1 text-slate-500">
          <ShieldAlert size={14} aria-hidden="true" />
          Severity
        </span>
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
    </div>
  );
}

function QueueMetric({
  label,
  value,
  hot,
}: {
  label: string;
  value: number;
  hot?: boolean;
}) {
  return (
    <div className="rounded-md border border-[color:var(--color-navy-700)] bg-[color:var(--color-navy-900)] p-3">
      <div className="text-xs uppercase tracking-wider text-slate-500">{label}</div>
      <div
        className={
          "mt-1 text-2xl font-semibold tabular-nums " +
          (hot ? "text-[color:var(--color-sev-critical)]" : "text-slate-50")
        }
      >
        {value}
      </div>
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
