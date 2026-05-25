import { db } from "@/db";
import { cases, alerts, observables, slaPolicies } from "@/db/schema";
import { and, count, eq, sql, gte } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import { StatusBadge, SeverityBadge } from "@/components/badges";
import { evaluateSla } from "@/lib/sla";
import Link from "next/link";
import { ArrowUpRight, Bot, Clock3, ListChecks, ShieldAlert, Workflow } from "lucide-react";
import type { ComponentType } from "react";

function minutesBetween(a: Date, b: Date): number {
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 60000));
}

function formatMinutes(m: number | null): string {
  if (m === null) return "n/a";
  if (m < 60) return `${m}m`;
  if (m < 24 * 60) return `${(m / 60).toFixed(1)}h`;
  return `${(m / 1440).toFixed(1)}d`;
}

export default async function DashboardPage() {
  const user = await requireUser();

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [
    openCases,
    casesBySeverity,
    recentlyClosed,
    recentOpened,
    openAlertsRow,
    recentCases,
    openCasesForSla,
    slaRows,
  ] = await Promise.all([
      db
        .select({ count: count() })
        .from(cases)
        .where(
          and(
            eq(cases.organisationId, user.organisationId),
            sql`${cases.status} <> 'closed'`,
          ),
        ),
      db
        .select({
          severity: cases.severity,
          count: count(),
        })
        .from(cases)
        .where(
          and(
            eq(cases.organisationId, user.organisationId),
            sql`${cases.status} <> 'closed'`,
          ),
        )
        .groupBy(cases.severity),
      db
        .select()
        .from(cases)
        .where(
          and(
            eq(cases.organisationId, user.organisationId),
            eq(cases.status, "closed"),
            gte(cases.closedAt, thirtyDaysAgo),
          ),
        ),
      db
        .select()
        .from(cases)
        .where(
          and(
            eq(cases.organisationId, user.organisationId),
            gte(cases.openedAt, thirtyDaysAgo),
          ),
        ),
      db
        .select({ count: count() })
        .from(alerts)
        .where(
          and(
            eq(alerts.organisationId, user.organisationId),
            eq(alerts.status, "new"),
          ),
        ),
      db
        .select()
        .from(cases)
        .where(eq(cases.organisationId, user.organisationId))
        .orderBy(sql`${cases.openedAt} desc`)
        .limit(8),
      db
        .select()
        .from(cases)
        .where(
          and(
            eq(cases.organisationId, user.organisationId),
            sql`${cases.status} <> 'closed'`,
          ),
        ),
      db
        .select()
        .from(slaPolicies)
        .where(eq(slaPolicies.organisationId, user.organisationId)),
    ]);

  const policyBySeverity = new Map(slaRows.map((p) => [p.severity, p]));
  type SlaState = { breached?: Partial<Record<"acknowledge" | "contain" | "resolve", string>> };
  const breaching: Array<{
    id: string;
    caseNumber: string;
    title: string;
    severity: string;
    gate: "acknowledge" | "contain" | "resolve";
    minutesOver: number;
  }> = [];
  let breachCount = 0;
  let warningCount = 0;
  const recentBreachThreshold = thirtyDaysAgo.getTime();
  let recentBreaches = 0;
  for (const c of openCasesForSla) {
    const policy = policyBySeverity.get(c.severity);
    if (!policy) continue;
    const evalResult = evaluateSla(c, policy);
    const state = (c.slaState as SlaState) ?? {};
    for (const t of evalResult.targets) {
      if (t.achievedAt) continue;
      if (t.isBreached) {
        breachCount++;
        breaching.push({
          id: c.id,
          caseNumber: c.caseNumber,
          title: c.title,
          severity: c.severity,
          gate: t.gate,
          minutesOver: t.minutesOver,
        });
        const breachedAtIso = state.breached?.[t.gate];
        if (
          breachedAtIso &&
          Date.parse(breachedAtIso) >= recentBreachThreshold
        ) {
          recentBreaches++;
        }
      } else if (t.isWarning) {
        warningCount++;
      }
    }
  }
  breaching.sort((a, b) => b.minutesOver - a.minutesOver);
  const topBreaches = breaching.slice(0, 5);

  const ackTimes: number[] = [];
  const containTimes: number[] = [];
  const resolveTimes: number[] = [];
  for (const c of recentlyClosed) {
    if (c.acknowledgedAt) ackTimes.push(minutesBetween(c.openedAt, c.acknowledgedAt));
    if (c.containedAt) containTimes.push(minutesBetween(c.openedAt, c.containedAt));
    if (c.resolvedAt) resolveTimes.push(minutesBetween(c.openedAt, c.resolvedAt));
  }
  const mean = (xs: number[]) =>
    xs.length === 0 ? null : Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);

  const severityCounts: Record<string, number> = {
    low: 0,
    medium: 0,
    high: 0,
    critical: 0,
  };
  for (const row of casesBySeverity) {
    severityCounts[row.severity] = Number(row.count);
  }

  const topClassifications: Record<string, number> = {};
  for (const c of recentOpened) {
    topClassifications[c.classification] = (topClassifications[c.classification] ?? 0) + 1;
  }
  const classificationList = Object.entries(topClassifications)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  return (
    <div className="space-y-6">
      <header className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div>
          <div className="mb-2 inline-flex items-center rounded-full border border-[color:var(--color-navy-700)] bg-[color:var(--color-navy-900)] px-3 py-1 text-xs font-medium text-[color:var(--color-tan-300)]">
            SOC case management
          </div>
          <h1 className="max-w-3xl text-3xl font-semibold tracking-tight text-slate-50 sm:text-4xl">
            Prioritise, automate, and close security cases from one workbench.
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">
            Track active incidents, attach response workflows, measure SLA pressure,
            and keep every investigation artefact connected to the case.
          </p>
        </div>
        <div className="kelpie-panel p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs uppercase tracking-wider text-slate-500">
                Automation impact
              </div>
              <div className="mt-1 text-2xl font-semibold text-slate-50">
                {formatMinutes(mean(resolveTimes))}
              </div>
              <div className="text-xs text-slate-500">Mean time to resolution</div>
            </div>
            <Workflow className="text-[color:var(--color-tan-400)]" size={30} aria-hidden="true" />
          </div>
          <Link href="/cases/new" className="kelpie-btn kelpie-btn-primary mt-4 w-full">
            New case
            <ArrowUpRight size={16} aria-hidden="true" />
          </Link>
        </div>
      </header>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Active cases" value={openCases[0]?.count ?? 0} icon={ShieldAlert} />
        <Stat label="New alerts" value={openAlertsRow[0]?.count ?? 0} accent icon={Bot} />
        <Stat label="Opened 30d" value={recentOpened.length} icon={ListChecks} />
        <Stat label="Closed 30d" value={recentlyClosed.length} icon={ListChecks} />
        <Stat
          label="SLA breaches"
          value={recentBreaches}
          accent={recentBreaches > 0}
          icon={Clock3}
        />
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1.35fr]">
        <div className="kelpie-panel p-5">
          <h2 className="mb-1 text-sm font-medium text-slate-200">
            Threat prioritisation
          </h2>
          <p className="mb-4 text-xs text-slate-500">
            Active cases grouped by severity for triage handoff.
          </p>
          <div className="space-y-3">
            {(["critical", "high", "medium", "low"] as const).map((s) => (
              <div key={s} className="grid grid-cols-[6.5rem_1fr_2rem] items-center gap-3 text-sm">
                <SeverityBadge value={s} />
                <div className="h-2 overflow-hidden rounded-full bg-[color:var(--color-navy-800)]">
                  <div
                    className="h-full rounded-full bg-current text-[color:var(--color-tan-500)]"
                    style={{
                      width: `${Math.min(100, severityCounts[s] * 16)}%`,
                    }}
                    aria-hidden="true"
                  />
                </div>
                <span className="text-right tabular-nums text-slate-200">{severityCounts[s]}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="kelpie-panel p-5">
          <h2 className="mb-1 text-sm font-medium text-slate-200">
            Response metrics
          </h2>
          <p className="mb-4 text-xs text-slate-500">
            Closed cases over the last 30 days.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Metric label="MTTA" value={formatMinutes(mean(ackTimes))} />
            <Metric label="MTTC" value={formatMinutes(mean(containTimes))} />
            <Metric label="MTTR" value={formatMinutes(mean(resolveTimes))} />
          </div>
        </div>
      </section>

      <section className="kelpie-panel p-5">
        <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
          <h2 className="text-sm font-medium text-slate-200">Live SLA pressure</h2>
          <span className="text-xs text-slate-500">
            {breachCount} breached, {warningCount} within {15} min
          </span>
        </div>
        {topBreaches.length === 0 ? (
          <p className="text-sm text-slate-500">No active SLA breaches.</p>
        ) : (
          <ul className="divide-y divide-[color:var(--color-navy-800)]">
            {topBreaches.map((b) => (
              <li key={`${b.id}-${b.gate}`} className="flex flex-col gap-1 py-2 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                <div className="min-w-0 flex items-center gap-2">
                  <SeverityBadge value={b.severity} />
                  <Link href={`/cases/${b.id}`} className="kelpie-link truncate">
                    {b.caseNumber} {b.title}
                  </Link>
                </div>
                <div className="text-xs text-red-400 tabular-nums">
                  {b.gate} +{b.minutesOver}m
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="kelpie-panel p-5">
          <h2 className="text-sm font-medium text-slate-300 mb-3">
            Top classifications (30 days)
          </h2>
          {classificationList.length === 0 ? (
            <p className="text-sm text-slate-500">No cases yet.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {classificationList.map(([key, n]) => (
                <li key={key} className="flex items-center justify-between">
                  <span className="text-slate-200 capitalize">
                    {key.replace(/_/g, " ")}
                  </span>
                  <span className="tabular-nums text-slate-400">{n}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="kelpie-panel p-5">
          <h2 className="text-sm font-medium text-slate-300 mb-3">
            Recently opened
          </h2>
          {recentCases.length === 0 ? (
            <p className="text-sm text-slate-500">No cases yet.</p>
          ) : (
            <ul className="divide-y divide-[color:var(--color-navy-800)]">
              {recentCases.map((c) => (
                <li key={c.id} className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                  <div className="min-w-0">
                    <Link
                      href={`/cases/${c.id}`}
                      className="kelpie-link text-sm font-medium truncate block"
                    >
                      {c.caseNumber} {c.title}
                    </Link>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <SeverityBadge value={c.severity} />
                    <StatusBadge value={c.status} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
  icon: Icon,
}: {
  label: string;
  value: number | string;
  accent?: boolean;
  icon: ComponentType<{ size?: number; className?: string; "aria-hidden"?: boolean }>;
}) {
  return (
    <div className="kelpie-panel p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs uppercase tracking-wider text-slate-500">
          {label}
        </div>
        <Icon
          size={18}
          className={accent ? "text-[color:var(--color-tan-400)]" : "text-slate-500"}
          aria-hidden={true}
        />
      </div>
      <div
        className={
          "mt-2 text-3xl font-semibold tabular-nums " +
          (accent ? "text-[color:var(--color-tan-400)]" : "text-slate-100")
        }
      >
        {value}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[color:var(--color-navy-700)] bg-[color:var(--color-navy-900)] p-4">
      <div className="text-xs uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-2 text-2xl font-semibold tabular-nums text-slate-100">
        {value}
      </div>
    </div>
  );
}
