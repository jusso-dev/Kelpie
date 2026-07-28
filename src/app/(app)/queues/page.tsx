import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { teamMembers, users } from "@/db/schema";
import { requireUser } from "@/lib/session";
import {
  analystWorkloadCore,
  listTeamsCore,
  queueHealthCore,
  listQueuesCore,
} from "@/lib/queues-core";
import { TeamQueueAdmin } from "@/components/team-queue-admin";

export default async function QueuesPage() {
  const user = await requireUser();
  const [teams, queues, health, workload, orgUsers, memberships] = await Promise.all([
    listTeamsCore(user.organisationId),
    listQueuesCore(user.organisationId),
    queueHealthCore(user.organisationId),
    analystWorkloadCore(user.organisationId),
    db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(eq(users.organisationId, user.organisationId))
      .orderBy(asc(users.name)),
    db
      .select({ teamId: teamMembers.teamId, userId: teamMembers.userId })
      .from(teamMembers)
      .where(eq(teamMembers.organisationId, user.organisationId)),
  ]);
  const isAdmin = user.role === "admin";
  const maxWeighted = Math.max(1, ...workload.map((w) => w.weightedScore));

  return (
    <div className="space-y-6">
      <header>
        <div className="mb-2 inline-flex items-center rounded-full border border-[color:var(--color-navy-700)] bg-[color:var(--color-navy-900)] px-3 py-1 text-xs font-medium text-[color:var(--color-tan-300)]">
          Team queues
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-50">
          Team queues, workload, and queue health.
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
          Work can sit with a team before an analyst picks it up. Workload
          excludes closed cases and weights by severity; queue health tracks
          aging and SLA risk per queue.
        </p>
      </header>

      <section className="kelpie-panel p-5">
        <h2 className="mb-3 text-sm font-medium text-slate-300">
          Per-analyst active workload
        </h2>
        {workload.length === 0 ? (
          <p className="text-xs text-slate-500">No open cases assigned yet.</p>
        ) : (
          <div className="kelpie-scroll-x" tabIndex={0} aria-label="Analyst workload">
            <table className="kelpie-table">
              <thead>
                <tr>
                  <th>Analyst</th>
                  <th>Active cases</th>
                  <th>Weighted score</th>
                  <th><span className="sr-only">Relative load</span></th>
                </tr>
              </thead>
              <tbody>
                {workload.map((row) => (
                  <tr key={row.userId}>
                    <td className="text-sm text-slate-200">{row.userName}</td>
                    <td className="text-xs text-slate-300">{row.activeCases}</td>
                    <td className="text-xs text-slate-300">{row.weightedScore}</td>
                    <td>
                      <div
                        className="h-2 rounded bg-[color:var(--color-tan-500)]"
                        style={{ width: `${Math.round((row.weightedScore / maxWeighted) * 100)}%` }}
                        role="img"
                        aria-label={`Weighted load ${row.weightedScore}`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-slate-500">
          Weight: low = 1, medium = 2, high = 4, critical = 8. Closed cases are excluded.
        </p>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {health.map((h) => (
          <div key={h.queueId} className="kelpie-card p-5">
            <h3 className="text-sm font-medium text-slate-200">
              {h.teamName} / {h.queueName}
            </h3>
            <div className="mt-3 grid grid-cols-3 gap-3 text-center">
              <Metric label="Open" value={h.openCount} />
              <Metric label="Unassigned" value={h.unassignedCount} />
              <Metric label="SLA at risk" value={h.slaAtRiskCount} hot={h.slaAtRiskCount > 0} />
            </div>
            <div className="mt-4">
              <p className="mb-1 text-xs uppercase tracking-wider text-slate-500">Aging</p>
              <dl className="grid grid-cols-4 gap-2 text-center text-xs text-slate-300">
                <AgingCell label="< 4h" value={h.aging.under4h} />
                <AgingCell label="4-24h" value={h.aging.from4hTo24h} />
                <AgingCell label="1-3d" value={h.aging.from1dTo3d} />
                <AgingCell label="> 3d" value={h.aging.over3d} hot={h.aging.over3d > 0} />
              </dl>
            </div>
          </div>
        ))}
        {health.length === 0 ? (
          <p className="text-sm text-slate-500">
            No queues yet.{" "}
            {isAdmin ? "Create a team and queue below." : "Ask an administrator to create one."}
          </p>
        ) : null}
      </section>

      <TeamQueueAdmin
        isAdmin={isAdmin}
        teams={teams.map((t) => ({ id: t.id, name: t.name, isActive: t.isActive }))}
        queues={queues.map((q) => ({
          id: q.id,
          name: q.name,
          teamId: q.teamId,
          teamName: q.teamName,
          isActive: q.isActive,
        }))}
        members={orgUsers}
        memberships={memberships}
      />
    </div>
  );
}

function Metric({ label, value, hot }: { label: string; value: number; hot?: boolean }) {
  return (
    <div>
      <div
        className={
          "text-xl font-semibold tabular-nums " +
          (hot ? "text-[color:var(--color-sev-critical)]" : "text-slate-50")
        }
      >
        {value}
      </div>
      <div className="text-[0.6875rem] uppercase tracking-wider text-slate-500">{label}</div>
    </div>
  );
}

function AgingCell({ label, value, hot }: { label: string; value: number; hot?: boolean }) {
  return (
    <div>
      <dt className="text-slate-500">{label}</dt>
      <dd className={hot ? "text-amber-300" : "text-slate-200"}>{value}</dd>
    </div>
  );
}
