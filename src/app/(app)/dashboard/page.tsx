import { db } from "@/db";
import { cases, alerts, observables, slaPolicies } from "@/db/schema";
import { and, count, eq, sql, gte } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import { StatusBadge, SeverityBadge } from "@/components/badges";
import { evaluateSla } from "@/lib/sla";
import Link from "next/link";

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
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="text-sm text-slate-400">
            What the dog is herding, right now.
          </p>
        </div>
        <Link href="/cases/new" className="kelpie-btn kelpie-btn-primary">
          New case
        </Link>
      </header>

      <section className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Stat label="Open cases" value={openCases[0]?.count ?? 0} />
        <Stat label="New alerts" value={openAlertsRow[0]?.count ?? 0} accent />
        <Stat label="Opened (30d)" value={recentOpened.length} />
        <Stat label="Closed (30d)" value={recentlyClosed.length} />
        <Stat
          label="SLA breaches (30d)"
          value={recentBreaches}
          accent={recentBreaches > 0}
        />
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="kelpie-card p-5">
          <h2 className="text-sm font-medium text-slate-300 mb-3">
            Open cases by severity
          </h2>
          <div className="space-y-2">
            {(["critical", "high", "medium", "low"] as const).map((s) => (
              <div key={s} className="flex items-center justify-between text-sm">
                <SeverityBadge value={s} />
                <span className="tabular-nums text-slate-200">
                  {severityCounts[s]}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="kelpie-card p-5">
          <h2 className="text-sm font-medium text-slate-300 mb-3">
            Response timeliness (30 days, closed cases)
          </h2>
          <div className="grid grid-cols-3 gap-3 text-center">
            <Metric label="MTTA" value={formatMinutes(mean(ackTimes))} />
            <Metric label="MTTC" value={formatMinutes(mean(containTimes))} />
            <Metric label="MTTR" value={formatMinutes(mean(resolveTimes))} />
          </div>
          <p className="text-xs text-slate-500 mt-3">
            Acknowledge, contain, resolve — measured from case open.
          </p>
        </div>
      </section>

      <section className="kelpie-card p-5">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-sm font-medium text-slate-300">SLA breaches (live)</h2>
          <span className="text-xs text-slate-500">
            {breachCount} breached · {warningCount} within {15} min
          </span>
        </div>
        {topBreaches.length === 0 ? (
          <p className="text-sm text-slate-500">No breaches. Stay on top.</p>
        ) : (
          <ul className="divide-y divide-[color:var(--color-navy-800)]">
            {topBreaches.map((b) => (
              <li key={`${b.id}-${b.gate}`} className="py-2 flex items-center justify-between gap-3 text-sm">
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

      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="kelpie-card p-5">
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
        <div className="kelpie-card p-5">
          <h2 className="text-sm font-medium text-slate-300 mb-3">
            Recently opened
          </h2>
          {recentCases.length === 0 ? (
            <p className="text-sm text-slate-500">No cases yet.</p>
          ) : (
            <ul className="divide-y divide-[color:var(--color-navy-800)]">
              {recentCases.map((c) => (
                <li key={c.id} className="py-2 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      href={`/cases/${c.id}`}
                      className="kelpie-link text-sm font-medium truncate block"
                    >
                      {c.caseNumber} {c.title}
                    </Link>
                  </div>
                  <div className="flex items-center gap-2">
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
}: {
  label: string;
  value: number | string;
  accent?: boolean;
}) {
  return (
    <div className="kelpie-card p-5">
      <div className="text-xs uppercase tracking-wider text-slate-400">
        {label}
      </div>
      <div
        className={
          "mt-1 text-3xl font-semibold tabular-nums " +
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
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-xl font-semibold tabular-nums text-slate-100">
        {value}
      </div>
    </div>
  );
}
