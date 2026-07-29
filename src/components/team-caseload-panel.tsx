import Link from "next/link";
import type { WorkloadRow } from "@/lib/queues-core";
import { Users } from "lucide-react";

/**
 * Admin dashboard: per-analyst active caseload so overload is obvious at a glance.
 * Weights match queues page (low 1 · medium 2 · high 4 · critical 8).
 */
export default function TeamCaseloadPanel({
  workload,
  unassignedCount,
}: {
  workload: WorkloadRow[];
  unassignedCount: number;
}) {
  const withLoad = workload.filter((w) => w.activeCases > 0);
  const scores = withLoad.map((w) => w.weightedScore);
  const avg =
    scores.length === 0
      ? 0
      : scores.reduce((a, b) => a + b, 0) / scores.length;
  const maxWeighted = Math.max(1, ...scores, 1);
  /** Overloaded: clearly above team average (at least +50% and +4 weight). */
  const overloadFloor = Math.max(avg * 1.5, avg + 4, 8);
  const overloadedIds = new Set(
    withLoad
      .filter((w) => w.weightedScore >= overloadFloor && w.weightedScore > avg)
      .map((w) => w.userId),
  );

  return (
    <section className="kelpie-panel p-5" aria-labelledby="team-caseload-heading">
      <div className="mb-1 flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <Users
              size={16}
              className="text-[color:var(--color-tan-400)]"
              aria-hidden="true"
            />
            <h2
              id="team-caseload-heading"
              className="text-sm font-medium text-slate-200"
            >
              Team caseload
            </h2>
            <span className="rounded-full border border-[color:var(--color-navy-700)] px-2 py-0.5 text-[0.65rem] font-medium uppercase tracking-wider text-slate-500">
              Admin
            </span>
          </div>
          <p className="text-xs text-slate-500">
            Active cases only (not closed). Severity-weighted so critical work
            counts harder. Overload flags analysts well above the team average.
          </p>
        </div>
        <Link
          href="/queues"
          className="shrink-0 text-xs font-medium text-[color:var(--color-tan-300)] hover:underline"
        >
          Queues & full workload
        </Link>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-md border border-[color:var(--color-navy-700)] bg-[color:var(--color-navy-900)] p-4">
          <div className="text-xs uppercase tracking-wider text-slate-500">
            Analysts with load
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-100">
            {withLoad.length}
          </div>
        </div>
        <div className="rounded-md border border-[color:var(--color-navy-700)] bg-[color:var(--color-navy-900)] p-4">
          <div className="text-xs uppercase tracking-wider text-slate-500">
            Unassigned open
          </div>
          <div
            className={
              "mt-1 text-2xl font-semibold tabular-nums " +
              (unassignedCount > 0
                ? "text-[color:var(--color-tan-400)]"
                : "text-slate-100")
            }
          >
            {unassignedCount}
          </div>
        </div>
        <div className="rounded-md border border-[color:var(--color-navy-700)] bg-[color:var(--color-navy-900)] p-4">
          <div className="text-xs uppercase tracking-wider text-slate-500">
            Avg weighted load
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-100">
            {scores.length === 0 ? "0" : avg.toFixed(1)}
          </div>
        </div>
        <div className="rounded-md border border-[color:var(--color-navy-700)] bg-[color:var(--color-navy-900)] p-4">
          <div className="text-xs uppercase tracking-wider text-slate-500">
            Overloaded
          </div>
          <div
            className={
              "mt-1 text-2xl font-semibold tabular-nums " +
              (overloadedIds.size > 0
                ? "text-[color:var(--color-sev-critical)]"
                : "text-slate-100")
            }
          >
            {overloadedIds.size}
          </div>
        </div>
      </div>

      {withLoad.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">
          No open cases assigned to individuals yet. Check unassigned work on{" "}
          <Link href="/cases?view=unassigned" className="kelpie-link">
            Cases
          </Link>{" "}
          or{" "}
          <Link href="/queues" className="kelpie-link">
            Queues
          </Link>
          .
        </p>
      ) : (
        <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {withLoad.map((row) => {
            const hot = overloadedIds.has(row.userId);
            const pct = Math.round((row.weightedScore / maxWeighted) * 100);
            return (
              <li
                key={row.userId}
                className={
                  "rounded-md border p-4 " +
                  (hot
                    ? "border-[color:var(--color-sev-critical)]/40 bg-[color:var(--color-sev-critical)]/5"
                    : "border-[color:var(--color-navy-700)] bg-[color:var(--color-navy-900)]")
                }
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-100">
                      {row.userName}
                    </div>
                    {hot ? (
                      <div className="mt-0.5 text-xs font-medium text-[color:var(--color-sev-critical)]">
                        Overloaded vs team
                      </div>
                    ) : (
                      <div className="mt-0.5 text-xs text-slate-500">
                        Active caseload
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-semibold tabular-nums text-slate-50">
                      {row.activeCases}
                    </div>
                    <div className="text-[0.65rem] uppercase tracking-wider text-slate-500">
                      cases
                    </div>
                  </div>
                </div>
                <div className="mt-3">
                  <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
                    <span>Weighted load</span>
                    <span className="tabular-nums text-slate-300">
                      {row.weightedScore}
                    </span>
                  </div>
                  <div
                    className="h-2 overflow-hidden rounded-full bg-[color:var(--color-navy-800)]"
                    role="img"
                    aria-label={`Weighted load ${row.weightedScore}${hot ? ", overloaded" : ""}`}
                  >
                    <div
                      className={
                        "h-full rounded-full " +
                        (hot
                          ? "bg-[color:var(--color-sev-critical)]"
                          : "bg-[color:var(--color-tan-500)]")
                      }
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
                <div className="mt-3">
                  <Link
                    href={`/cases?assignee=${encodeURIComponent(row.userId)}`}
                    className="text-xs font-medium text-[color:var(--color-tan-300)] hover:underline"
                  >
                    View their cases
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-4 text-xs text-slate-500">
        Weight: low = 1, medium = 2, high = 4, critical = 8. Primary owner and
        additional assignees both count. Closed cases excluded.
      </p>
    </section>
  );
}
