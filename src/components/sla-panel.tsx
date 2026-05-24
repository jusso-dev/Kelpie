import { format, formatDistanceToNowStrict } from "date-fns";
import type { SlaEvaluation, SlaGate } from "@/lib/sla";

const GATE_LABELS: Record<SlaGate, string> = {
  acknowledge: "Acknowledge",
  contain: "Contain",
  resolve: "Resolve",
};

export default function SlaPanel({ evaluation }: { evaluation: SlaEvaluation | null }) {
  if (!evaluation) {
    return (
      <div className="kelpie-card p-5">
        <h2 className="text-sm font-medium text-slate-300 mb-2">SLA</h2>
        <p className="text-xs text-slate-500">
          No policy matches this severity. Configure under Settings.
        </p>
      </div>
    );
  }
  return (
    <div className="kelpie-card p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-slate-300">SLA — {evaluation.policy.name}</h2>
      </div>
      <ul className="space-y-2">
        {evaluation.targets.map((t) => {
          const colour = t.achievedAt
            ? "text-green-400"
            : t.isBreached
              ? "text-red-400"
              : t.isWarning
                ? "text-amber-400"
                : "text-slate-300";
          return (
            <li key={t.gate} className="text-sm">
              <div className="flex items-center justify-between">
                <span className={colour}>{GATE_LABELS[t.gate]}</span>
                <span className={"text-xs " + colour}>
                  {t.achievedAt
                    ? `met ${format(t.achievedAt, "p")}`
                    : t.isBreached
                      ? `overdue ${formatDistanceToNowStrict(t.deadline)}`
                      : `${formatDistanceToNowStrict(t.deadline)} left`}
                </span>
              </div>
              <div className="text-[10px] text-slate-500">
                deadline {format(t.deadline, "PP p")}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
