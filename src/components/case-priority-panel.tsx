"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  recalculateCasePriorityAction,
  setCasePriorityOverrideAction,
} from "@/actions/asset-context";

type Factor = {
  id: string;
  label: string;
  inputValue: string | number | boolean | null;
  normalisedScore: number;
  weight: number;
  contribution: number;
  detail: string;
  staleDiscountApplied?: boolean;
};

type PriorityRow = {
  calculatedScore: number;
  effectiveScore: number;
  scoreBand: string;
  calculationVersion: string;
  factors: Factor[];
  scoringEnabled: boolean;
  hasCriticalContext: boolean;
  hasCrownJewelContext: boolean;
  hasStaleContext: boolean;
  analystOverrideScore: number | null;
  analystOverrideReason: string | null;
};

type CriticalContext = {
  id: string;
  displayName: string;
  kind: string;
  isStale?: boolean;
  effective: {
    criticality: string;
    privilegeLevel: string;
    isCrownJewel: boolean;
  };
};

const bandClass: Record<string, string> = {
  low: "text-[color:var(--color-sev-low)]",
  medium: "text-[color:var(--color-sev-medium)]",
  high: "text-[color:var(--color-sev-high)]",
  critical: "text-[color:var(--color-sev-critical)]",
};

export default function CasePriorityPanel({
  caseId,
  priority,
  criticalContexts,
  canEdit,
}: {
  caseId: string;
  priority: PriorityRow | null;
  criticalContexts: CriticalContext[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [overrideScore, setOverrideScore] = useState(
    priority?.analystOverrideScore?.toString() ?? "",
  );
  const [reason, setReason] = useState(priority?.analystOverrideReason ?? "");

  if (!priority) {
    return (
      <section className="kelpie-section">
        <div className="kelpie-section-header">
          <h2>Priority score</h2>
          <p>No score calculated yet.</p>
        </div>
        {canEdit ? (
          <button
            type="button"
            className="kelpie-btn kelpie-btn-secondary"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const res = await recalculateCasePriorityAction(caseId);
                if (!res.ok) toast.error(res.error);
                else {
                  toast.success("Priority recalculated");
                  router.refresh();
                }
              })
            }
          >
            Calculate priority
          </button>
        ) : null}
      </section>
    );
  }

  const factors = Array.isArray(priority.factors) ? priority.factors : [];

  return (
    <section className="kelpie-section">
      <div className="kelpie-section-header">
        <h2>Priority score</h2>
        <p>
          Explainable organisational priority, separate from source severity.
          {!priority.scoringEnabled ? " Scoring is disabled for this organisation." : null}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-3">
        <span
          className={`text-2xl font-semibold tabular-nums ${bandClass[priority.scoreBand] ?? ""}`}
          title="Effective priority score"
        >
          {priority.effectiveScore}
        </span>
        <span className={`kelpie-badge ${bandClass[priority.scoreBand] ?? ""}`}>
          {priority.scoreBand}
        </span>
        {priority.analystOverrideScore != null ? (
          <span className="kelpie-badge text-amber-300">
            override (calculated {priority.calculatedScore})
          </span>
        ) : (
          <span className="text-xs text-slate-400">
            calculated {priority.calculatedScore}
          </span>
        )}
        <span className="text-xs text-slate-500 font-mono">
          v{priority.calculationVersion}
        </span>
        {priority.hasCrownJewelContext ? (
          <span className="kelpie-badge text-red-300">crown jewel</span>
        ) : null}
        {priority.hasCriticalContext ? (
          <span className="kelpie-badge text-amber-300">critical context</span>
        ) : null}
        {priority.hasStaleContext ? (
          <span className="kelpie-badge text-slate-400">stale context</span>
        ) : null}
      </div>

      {criticalContexts.length > 0 ? (
        <div className="mb-3">
          <h3 className="text-sm font-medium text-slate-300 mb-1">
            Critical assets / identities
          </h3>
          <ul className="space-y-1">
            {criticalContexts.map((c) => (
              <li key={c.id} className="text-sm text-slate-300 flex flex-wrap gap-2">
                <span className="font-medium">{c.displayName}</span>
                <span className="text-slate-500">{c.kind}</span>
                <span className="kelpie-badge">{c.effective.criticality}</span>
                {c.effective.isCrownJewel ? (
                  <span className="kelpie-badge text-red-300">crown jewel</span>
                ) : null}
                {c.isStale ? (
                  <span className="kelpie-badge text-slate-400">stale</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="kelpie-table w-full text-sm">
          <thead>
            <tr>
              <th className="text-left">Factor</th>
              <th className="text-right">Input</th>
              <th className="text-right">Score</th>
              <th className="text-right">Weight</th>
              <th className="text-right">Contribution</th>
            </tr>
          </thead>
          <tbody>
            {factors.map((f) => (
              <tr key={f.id} title={f.detail}>
                <td>
                  {f.label}
                  {f.staleDiscountApplied ? (
                    <span className="ml-1 text-xs text-slate-500">stale×0.5</span>
                  ) : null}
                </td>
                <td className="text-right font-mono text-slate-400">
                  {f.inputValue === null || f.inputValue === undefined
                    ? "—"
                    : String(f.inputValue)}
                </td>
                <td className="text-right tabular-nums">{f.normalisedScore}</td>
                <td className="text-right tabular-nums">{f.weight}</td>
                <td className="text-right tabular-nums">{f.contribution}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canEdit ? (
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <label className="text-xs text-slate-400">
            Analyst override (0–100)
            <input
              className="kelpie-input mt-1 block w-28"
              type="number"
              min={0}
              max={100}
              value={overrideScore}
              onChange={(e) => setOverrideScore(e.target.value)}
              placeholder="clear"
            />
          </label>
          <label className="text-xs text-slate-400 flex-1 min-w-[12rem]">
            Reason
            <input
              className="kelpie-input mt-1 block w-full"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="kelpie-btn kelpie-btn-secondary"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const score =
                  overrideScore.trim() === ""
                    ? null
                    : Number(overrideScore);
                const res = await setCasePriorityOverrideAction(
                  caseId,
                  score,
                  reason || null,
                );
                if (!res.ok) toast.error(res.error);
                else {
                  toast.success(
                    score === null ? "Override cleared" : "Override saved",
                  );
                  router.refresh();
                }
              })
            }
          >
            Save override
          </button>
          <button
            type="button"
            className="kelpie-btn kelpie-btn-ghost"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const res = await recalculateCasePriorityAction(caseId);
                if (!res.ok) toast.error(res.error);
                else {
                  toast.success("Recalculated (override preserved)");
                  router.refresh();
                }
              })
            }
          >
            Recalculate
          </button>
        </div>
      ) : null}
    </section>
  );
}
