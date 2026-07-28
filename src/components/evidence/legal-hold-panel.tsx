"use client";

import { format } from "date-fns";
import {
  applyEvidenceLegalHold,
  releaseEvidenceLegalHold,
} from "@/actions/attachments";
import { ReasonedActionButton } from "@/components/evidence/reasoned-action-button";

export type LegalHoldRow = {
  id: string;
  caseId: string | null;
  evidenceId: string | null;
  reason: string;
  appliedByName: string | null;
  appliedAt: string;
  releasedByName: string | null;
  releasedAt: string | null;
  releaseReason: string | null;
};

export function LegalHoldPanel({
  caseId,
  evidenceId,
  holds,
  canManage,
  evidenceLabelById,
}: {
  caseId: string;
  evidenceId?: string;
  holds: LegalHoldRow[];
  canManage: boolean;
  evidenceLabelById?: Record<string, string>;
}) {
  const visible = evidenceId
    ? holds.filter(
        (h) => h.evidenceId === evidenceId || (Boolean(h.caseId) && !h.evidenceId),
      )
    : holds;
  const active = visible.filter((h) => !h.releasedAt);
  const released = visible.filter((h) => h.releasedAt);

  return (
    <div className="kelpie-card p-5 space-y-3">
      <div>
        <h2 className="text-sm font-medium text-slate-300">Legal holds</h2>
        <p className="mt-1 text-xs text-slate-500">
          {evidenceId
            ? "Holds on this evidence item, or on the whole case, block deletion."
            : "Case-wide and evidence-specific holds block deletion."}
        </p>
      </div>

      {active.length === 0 ? (
        <p className="text-xs text-slate-500">No active legal holds.</p>
      ) : (
        <ul className="space-y-2">
          {active.map((hold) => (
            <li
              key={hold.id}
              className="rounded border border-amber-800/60 bg-amber-950/20 p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-wide text-amber-300">
                    {hold.evidenceId
                      ? evidenceLabelById?.[hold.evidenceId]
                        ? `Evidence: ${evidenceLabelById[hold.evidenceId]}`
                        : "This evidence item"
                      : "Entire case"}
                  </p>
                  <p className="mt-1 text-sm text-slate-200">{hold.reason}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Applied by {hold.appliedByName ?? "unknown"} on{" "}
                    {format(new Date(hold.appliedAt), "PP p")}
                  </p>
                </div>
                {canManage ? (
                  <ReasonedActionButton
                    action={(reason) =>
                      releaseEvidenceLegalHold(
                        caseId,
                        hold.id,
                        reason,
                        hold.evidenceId,
                      )
                    }
                    title="Release this legal hold?"
                    description="Once released, this evidence can be deleted again once no other hold applies."
                    confirmLabel="Release hold"
                    triggerLabel="Release"
                    reasonLabel="Reason for release"
                    reasonPlaceholder="Why is this hold no longer needed?"
                    successTitle="Legal hold released"
                    className="kelpie-btn kelpie-btn-ghost kelpie-btn-sm shrink-0"
                    tone="warning"
                  />
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {released.length > 0 ? (
        <details className="text-xs text-slate-500">
          <summary className="cursor-pointer text-slate-400">
            {released.length} released hold{released.length === 1 ? "" : "s"}
          </summary>
          <ul className="mt-2 space-y-2">
            {released.map((hold) => (
              <li key={hold.id} className="rounded border border-[color:var(--color-navy-700)] p-2">
                <p className="text-slate-400 line-through">{hold.reason}</p>
                <p>
                  Released by {hold.releasedByName ?? "unknown"} on{" "}
                  {hold.releasedAt ? format(new Date(hold.releasedAt), "PP p") : ""}
                </p>
                {hold.releaseReason ? <p>Reason: {hold.releaseReason}</p> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {canManage ? (
        <div className="border-t border-[color:var(--color-navy-700)] pt-3">
          <ReasonedActionButton
            action={(reason) => applyEvidenceLegalHold(caseId, reason, evidenceId ?? null)}
            title={evidenceId ? "Apply a legal hold to this evidence?" : "Apply a case-wide legal hold?"}
            description={
              evidenceId
                ? "This evidence item cannot be deleted while the hold is active."
                : "No evidence on this case can be deleted while the hold is active."
            }
            confirmLabel="Apply hold"
            triggerLabel={evidenceId ? "Apply hold to this evidence" : "Apply case-wide hold"}
            reasonLabel="Reason for legal hold"
            reasonPlaceholder="e.g. litigation hold pending counsel review"
            successTitle="Legal hold applied"
            tone="warning"
            className="kelpie-btn kelpie-btn-secondary kelpie-btn-sm w-full justify-center"
          />
        </div>
      ) : null}
    </div>
  );
}
