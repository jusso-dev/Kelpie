import { Users } from "lucide-react";
import { requireUser } from "@/lib/session";
import {
  getAnalystWorkloadCore,
  getOrgUnassignedQueueCount,
  getTeamQueueHealthCore,
} from "@/lib/workload-core";

export default async function WorkloadPage() {
  const user = await requireUser();
  const [analysts, teamQueues, unassignedCount] = await Promise.all([
    getAnalystWorkloadCore(user.organisationId),
    getTeamQueueHealthCore(user.organisationId),
    getOrgUnassignedQueueCount(user.organisationId),
  ]);

  const totalOpen = analysts.reduce((sum, a) => sum + a.openCount, 0);
  const totalWeighted = analysts.reduce((sum, a) => sum + a.weightedScore, 0);
  const totalSlaAtRisk = teamQueues.reduce((sum, t) => sum + t.slaAtRisk, 0);

  return (
    <div className="space-y-5">
      <header>
        <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-[color:var(--color-navy-700)] bg-[color:var(--color-navy-900)] px-3 py-1 text-xs font-medium text-[color:var(--color-tan-300)]">
          <Users size={14} aria-hidden="true" />
          Workload &amp; queue health
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-50">
          Analyst load and team queue health
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
          Operational visibility into who is carrying open work and how each
          team&apos;s queue is aging. Counts are computed across the full
          case table, not just the current page.
        </p>
      </header>

      <section
        className="kelpie-panel grid grid-cols-2 gap-3 p-4 sm:grid-cols-4"
        aria-label="Top-line workload stats"
      >
        <Stat label="Open cases (assigned)" value={totalOpen} />
        <Stat label="Weighted score (assigned)" value={totalWeighted} />
        <Stat label="Untriaged (no queue, no assignee)" value={unassignedCount} hot={unassignedCount > 0} />
        <Stat label="SLA at risk across teams" value={totalSlaAtRisk} hot={totalSlaAtRisk > 0} />
      </section>

      <section aria-labelledby="analyst-workload-heading" className="space-y-3">
        <h2 id="analyst-workload-heading" className="text-lg font-semibold text-slate-100">
          Analyst workload
        </h2>
        <p className="text-sm text-slate-400">
          Analysts with at least one open case as primary assignee, ordered by
          severity-weighted load. Closed cases are excluded.
        </p>
        <div className="kelpie-panel kelpie-scroll-x" tabIndex={0} aria-label="Analyst workload table">
          <table className="kelpie-table">
            <thead>
              <tr>
                <th scope="col">Analyst</th>
                <th scope="col">Open cases</th>
                <th scope="col">Weighted score</th>
                <th scope="col">Unacknowledged</th>
                <th scope="col">By severity</th>
              </tr>
            </thead>
            <tbody>
              {analysts.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-10 text-center text-slate-400">
                    No analyst currently holds an open case.
                  </td>
                </tr>
              ) : (
                analysts.map((a) => (
                  <tr key={a.userId}>
                    <td>
                      <div className="font-medium text-slate-100">{a.name}</div>
                      <div className="text-xs text-slate-500">{a.email}</div>
                    </td>
                    <td className="tabular-nums text-slate-200">{a.openCount}</td>
                    <td className="tabular-nums text-slate-200">{a.weightedScore}</td>
                    <td className="tabular-nums text-slate-200">
                      {a.unacknowledgedCount}
                      {a.unacknowledgedCount > 0 ? (
                        <span className="ml-2 text-xs text-amber-300">pending ack</span>
                      ) : null}
                    </td>
                    <td className="text-xs text-slate-300">
                      <span className="mr-3">
                        <span className="text-[color:var(--color-sev-critical)]">Critical</span>{" "}
                        {a.bySeverity.critical}
                      </span>
                      <span className="mr-3">
                        <span className="text-[color:var(--color-sev-high)]">High</span>{" "}
                        {a.bySeverity.high}
                      </span>
                      <span className="mr-3">
                        <span className="text-[color:var(--color-sev-medium)]">Medium</span>{" "}
                        {a.bySeverity.medium}
                      </span>
                      <span>
                        <span className="text-[color:var(--color-sev-low)]">Low</span>{" "}
                        {a.bySeverity.low}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="team-queue-health-heading" className="space-y-3">
        <h2 id="team-queue-health-heading" className="text-lg font-semibold text-slate-100">
          Team queue health
        </h2>
        <p className="text-sm text-slate-400">
          Every active team, including teams with an empty queue right now.
          Aging buckets are measured from case open time for currently open
          cases.
        </p>
        <div className="kelpie-panel kelpie-scroll-x" tabIndex={0} aria-label="Team queue health table">
          <table className="kelpie-table">
            <thead>
              <tr>
                <th scope="col">Team</th>
                <th scope="col">Open cases</th>
                <th scope="col">Unassigned</th>
                <th scope="col">Weighted score</th>
                <th scope="col">0-24h</th>
                <th scope="col">1-3d</th>
                <th scope="col">3-7d</th>
                <th scope="col">7d+</th>
                <th scope="col">SLA at risk</th>
              </tr>
            </thead>
            <tbody>
              {teamQueues.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-10 text-center text-slate-400">
                    No active teams in this organisation yet.
                  </td>
                </tr>
              ) : (
                teamQueues.map((t) => (
                  <tr key={t.teamId}>
                    <td className="font-medium text-slate-100">{t.teamName}</td>
                    <td className="tabular-nums text-slate-200">{t.openCount}</td>
                    <td className="tabular-nums text-slate-200">{t.unassignedCount}</td>
                    <td className="tabular-nums text-slate-200">{t.weightedScore}</td>
                    <td className="tabular-nums text-slate-200">{t.agingBuckets["0-24h"]}</td>
                    <td className="tabular-nums text-slate-200">{t.agingBuckets["1-3d"]}</td>
                    <td className="tabular-nums text-slate-200">{t.agingBuckets["3-7d"]}</td>
                    <td className="tabular-nums text-slate-200">
                      {t.agingBuckets["7d+"]}
                      {t.agingBuckets["7d+"] > 0 ? (
                        <span className="ml-2 text-xs text-red-300">aging</span>
                      ) : null}
                    </td>
                    <td className="tabular-nums text-slate-200">
                      {t.slaAtRisk}
                      {t.slaAtRisk > 0 ? (
                        <span className="ml-2 text-xs text-amber-300">at risk</span>
                      ) : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Stat({
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
