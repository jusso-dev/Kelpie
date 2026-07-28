"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  acceptSuggestionAction,
  evaluateCorrelationAction,
  mergeCasesAction,
  moveAlertsAction,
  rejectSuggestionAction,
  reverseMergeAction,
  splitAlertsAction,
} from "@/actions/correlation";

export type CorrelationSuggestionRow = {
  id: string;
  kind: string;
  status: string;
  score: number;
  explanation: string;
  alertIds: string[];
  caseIds: string[];
  targetCaseId: string | null;
  ruleKey: string;
  ruleVersion: number;
  contributingSignals: Record<string, unknown>;
  generatedAt: string;
};

export type CaseAlertRow = {
  id: string;
  title: string;
  severity: string;
  isPrimary: boolean;
};

type Props = {
  caseId: string;
  caseNumber: string;
  caseVersion: number;
  alerts: CaseAlertRow[];
  suggestions: CorrelationSuggestionRow[];
  activeMergeId?: string | null;
  canWrite: boolean;
};

export function CorrelationPanel({
  caseId,
  caseNumber,
  caseVersion,
  alerts,
  suggestions,
  activeMergeId,
  canWrite,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState("");
  const [targetCaseId, setTargetCaseId] = useState("");
  const [mergeSourceId, setMergeSourceId] = useState("");

  const selectedIds = useMemo(() => [...selected], [selected]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function requireReason(): string | null {
    const r = reason.trim();
    if (!r) {
      toast.error("Reason required for correlation actions");
      return null;
    }
    return r;
  }

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        toast.error(res.error ?? "Operation failed");
        return;
      }
      toast.success("Done");
      setReason("");
      setSelected(new Set());
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="kelpie-card p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-medium text-slate-100">Alert correlation</h2>
          <span className="text-xs text-slate-500">Case {caseNumber}</span>
          {canWrite ? (
            <button
              type="button"
              className="kelpie-btn kelpie-btn-secondary text-xs sm:ml-auto"
              disabled={pending}
              onClick={() =>
                run(async () => {
                  const res = await evaluateCorrelationAction({ forceDryRun: true });
                  return res.ok
                    ? { ok: true }
                    : { ok: false, error: res.error };
                })
              }
            >
              Run dry-run evaluation
            </button>
          ) : null}
        </div>
        <p className="text-xs text-slate-400">
          Suggestions explain score and signals. Moves, merges, splits, and rejections
          always require a reason. Automatic merge is off unless an admin enables org policy.
        </p>

        <label className="block">
          <span className="mb-1 block text-xs uppercase tracking-wider text-slate-400">
            Reason (required for actions)
          </span>
          <input
            className="kelpie-input"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why are you changing membership?"
            disabled={!canWrite || pending}
          />
        </label>

        {alerts.length === 0 ? (
          <p className="text-sm text-slate-500">No alerts on this case.</p>
        ) : (
          <ul className="divide-y divide-slate-800 rounded border border-slate-800">
            {alerts.map((alert) => (
              <li key={alert.id} className="flex items-start gap-3 p-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={selected.has(alert.id)}
                  onChange={() => toggle(alert.id)}
                  disabled={!canWrite || pending}
                  aria-label={`Select alert ${alert.title}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-slate-100">{alert.title}</div>
                  <div className="text-xs text-slate-500">
                    {alert.severity}
                    {alert.isPrimary ? " · primary" : ""}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        {canWrite ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="kelpie-btn kelpie-btn-secondary text-xs"
              disabled={pending || selectedIds.length === 0}
              onClick={() => {
                const r = requireReason();
                if (!r) return;
                run(async () => {
                  const res = await splitAlertsAction({
                    fromCaseId: caseId,
                    alertIds: selectedIds,
                    reason: r,
                    expectedVersions: { [caseId]: caseVersion },
                  });
                  return res.ok ? { ok: true } : { ok: false, error: res.error };
                });
              }}
            >
              Split selected into new case
            </button>
            <div className="flex flex-wrap items-center gap-2">
              <input
                className="kelpie-input w-48 text-xs"
                placeholder="Destination case id"
                value={targetCaseId}
                onChange={(e) => setTargetCaseId(e.target.value)}
                disabled={pending}
              />
              <button
                type="button"
                className="kelpie-btn kelpie-btn-secondary text-xs"
                disabled={pending || selectedIds.length === 0 || !targetCaseId.trim()}
                onClick={() => {
                  const r = requireReason();
                  if (!r) return;
                  run(async () => {
                    const res = await moveAlertsAction({
                      alertIds: selectedIds,
                      fromCaseId: caseId,
                      toCaseId: targetCaseId.trim(),
                      reason: r,
                      expectedVersions: { [caseId]: caseVersion },
                    });
                    return res.ok ? { ok: true } : { ok: false, error: res.error };
                  });
                }}
              >
                Move selected
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                className="kelpie-input w-48 text-xs"
                placeholder="Source case id to merge in"
                value={mergeSourceId}
                onChange={(e) => setMergeSourceId(e.target.value)}
                disabled={pending}
              />
              <button
                type="button"
                className="kelpie-btn kelpie-btn-secondary text-xs"
                disabled={pending || !mergeSourceId.trim()}
                onClick={() => {
                  const r = requireReason();
                  if (!r) return;
                  run(async () => {
                    const res = await mergeCasesAction({
                      canonicalCaseId: caseId,
                      sourceCaseIds: [mergeSourceId.trim()],
                      reason: r,
                      expectedVersions: { [caseId]: caseVersion },
                    });
                    return res.ok ? { ok: true } : { ok: false, error: res.error };
                  });
                }}
              >
                Merge source into this case
              </button>
            </div>
            {activeMergeId ? (
              <button
                type="button"
                className="kelpie-btn kelpie-btn-secondary text-xs"
                disabled={pending}
                onClick={() => {
                  const r = requireReason();
                  if (!r) return;
                  run(async () => {
                    const res = await reverseMergeAction({
                      mergeId: activeMergeId,
                      reason: r,
                    });
                    return res.ok ? { ok: true } : { ok: false, error: res.error };
                  });
                }}
              >
                Reverse recent merge
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="kelpie-card p-4 space-y-3">
        <h3 className="text-sm font-medium text-slate-100">Suggestions</h3>
        {suggestions.length === 0 ? (
          <p className="text-sm text-slate-500">
            No pending suggestions for this case. Run evaluation to generate some.
          </p>
        ) : (
          <ul className="space-y-3">
            {suggestions.map((s) => (
              <li
                key={s.id}
                className="rounded border border-slate-800 p-3 text-sm space-y-2"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="kelpie-badge">{s.kind}</span>
                  <span className="text-xs text-slate-400">score {s.score}</span>
                  <span className="text-xs text-slate-500">
                    {s.ruleKey}@v{s.ruleVersion}
                  </span>
                </div>
                <p className="text-slate-200">{s.explanation}</p>
                <p className="text-xs text-slate-500">
                  Alerts: {s.alertIds.join(", ")}
                  {s.caseIds.length > 0 ? ` · Cases: ${s.caseIds.join(", ")}` : ""}
                </p>
                {canWrite && s.status === "pending" ? (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="kelpie-btn text-xs"
                      disabled={pending}
                      onClick={() => {
                        const r = requireReason();
                        if (!r) return;
                        run(async () => {
                          const res = await acceptSuggestionAction({
                            suggestionId: s.id,
                            reason: r,
                          });
                          return res.ok
                            ? { ok: true }
                            : { ok: false, error: res.error };
                        });
                      }}
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      className="kelpie-btn kelpie-btn-secondary text-xs"
                      disabled={pending}
                      onClick={() => {
                        const r = requireReason();
                        if (!r) return;
                        run(async () => {
                          const res = await rejectSuggestionAction({
                            suggestionId: s.id,
                            reason: r,
                          });
                          return res.ok
                            ? { ok: true }
                            : { ok: false, error: res.error };
                        });
                      }}
                    >
                      Reject
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-slate-500">
          API equivalent under{" "}
          <Link href="/docs" className="underline">
            /api/v1/correlation/*
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
