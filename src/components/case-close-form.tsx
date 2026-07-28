"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { closeCase, type CloseCaseActionResult } from "@/actions/cases";
import { ConfirmDialog, feedbackError } from "@/components/confirm-dialog";

type RequirementResult = {
  type: string;
  label: string;
  passed: boolean;
  missing: string[];
  detail?: string;
};

type Evaluation = {
  ok: boolean;
  policyName: string | null;
  policyVersion: number | null;
  requireTwoPersonOverride: boolean;
  requirements: RequirementResult[];
  failed: RequirementResult[];
};

export default function CaseCloseForm({
  caseId,
  caseNumber,
  version,
  canOverride = false,
  orgUsers = [],
}: {
  caseId: string;
  caseNumber: string;
  version: number;
  canOverride?: boolean;
  orgUsers?: Array<{ id: string; name: string; role: string }>;
}) {
  const router = useRouter();
  const [pendingData, setPendingData] = useState<FormData | null>(null);
  const [pending, setPending] = useState(false);
  const [failedChecklist, setFailedChecklist] = useState<Evaluation | null>(null);
  const [overrideMode, setOverrideMode] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");

  async function confirmClose(withOverride: boolean) {
    if (!pendingData) return;
    setPending(true);
    try {
      const data = new FormData();
      for (const [k, v] of pendingData.entries()) data.set(k, v);
      if (withOverride) {
        data.set("override", "true");
        data.set("overrideReason", overrideReason);
      }
      const result: CloseCaseActionResult = await closeCase(data);
      if (!result.ok) {
        if (result.code === "requirements_not_met" && result.evaluation) {
          setFailedChecklist(result.evaluation as Evaluation);
          toast.error("Closure requirements not met", {
            description: "Review the checklist below, complete the gaps, or request an override.",
          });
          return;
        }
        if (result.code === "version_conflict") {
          toast.error("Case changed on another device", {
            description: "Reload the case, then try closing again.",
          });
          router.refresh();
          return;
        }
        toast.error("Case could not be closed", {
          description: result.error,
        });
        return;
      }
      setPendingData(null);
      setFailedChecklist(null);
      setOverrideMode(false);
      toast.success(
        result.wasOverride
          ? `${caseNumber} closed with override`
          : `${caseNumber} closed`,
        {
          description: result.wasOverride
            ? "The override reason and failed requirements were recorded on the permanent case record."
            : "The closure disposition and summary were added to the permanent case record.",
        },
      );
      router.refresh();
    } catch (error) {
      toast.error("Case could not be closed", {
        description: feedbackError(
          error,
          "The case remains open. Review the closure details and try again.",
        ),
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <form
        className="kelpie-card space-y-4 border-amber-700/50 p-5"
        onSubmit={(event) => {
          event.preventDefault();
          setFailedChecklist(null);
          setOverrideMode(false);
          setPendingData(new FormData(event.currentTarget));
        }}
      >
        <input type="hidden" name="caseId" value={caseId} />
        <input type="hidden" name="expectedVersion" value={version} />
        <div>
          <h2 className="text-sm font-medium text-slate-200">Close this case</h2>
          <p className="mt-1 text-xs text-slate-500">
            Record the outcome. Organisation closure policy is evaluated before
            the case leaves active work.
          </p>
        </div>
        <div className="kelpie-field">
          <label htmlFor="closure-reason" className="kelpie-label">
            Closure disposition
          </label>
          <select id="closure-reason" name="reason" className="kelpie-input" required>
            <option value="resolved">Resolved</option>
            <option value="false_positive">False positive</option>
            <option value="duplicate">Duplicate</option>
            <option value="benign">Benign</option>
            <option value="risk_accepted">Risk accepted</option>
          </select>
        </div>
        <div className="kelpie-field">
          <label htmlFor="closure-determination" className="kelpie-label">
            Determination
          </label>
          <select id="closure-determination" name="determination" className="kelpie-input">
            <option value="">— optional —</option>
            <option value="true_positive">True positive</option>
            <option value="false_positive">False positive</option>
            <option value="benign">Benign</option>
            <option value="inconclusive">Inconclusive</option>
            <option value="duplicate">Duplicate</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div className="kelpie-field">
          <label htmlFor="closure-summary" className="kelpie-label">
            Analyst conclusion
          </label>
          <textarea
            id="closure-summary"
            name="summary"
            className="kelpie-input"
            rows={3}
            required
            placeholder="What happened, what was done, and what should the team watch for?"
          />
        </div>
        <div className="kelpie-field">
          <label htmlFor="closure-root-cause" className="kelpie-label">
            Root cause
          </label>
          <textarea
            id="closure-root-cause"
            name="rootCause"
            className="kelpie-input"
            rows={2}
            placeholder="Initial access vector / underlying cause"
          />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="kelpie-field">
            <label htmlFor="closure-impact" className="kelpie-label">
              Business impact
            </label>
            <textarea
              id="closure-impact"
              name="businessImpact"
              className="kelpie-input"
              rows={2}
            />
          </div>
          <div className="kelpie-field">
            <label htmlFor="closure-lessons" className="kelpie-label">
              Lessons learned
            </label>
            <textarea
              id="closure-lessons"
              name="lessonsLearned"
              className="kelpie-input"
              rows={2}
            />
          </div>
        </div>
        {orgUsers.length > 0 ? (
          <div className="kelpie-field">
            <label htmlFor="closure-approver" className="kelpie-label">
              Approver (when policy requires)
            </label>
            <select id="closure-approver" name="approverId" className="kelpie-input">
              <option value="">— none —</option>
              {orgUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.role})
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div className="kelpie-field">
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              name="postIncidentReviewCompleted"
              value="true"
              className="rounded border-slate-600"
            />
            Post-incident review completed
          </label>
        </div>
        <div className="kelpie-field">
          <label htmlFor="reviewed-related" className="kelpie-label">
            Reviewed related case ids (comma-separated)
          </label>
          <input
            id="reviewed-related"
            name="reviewedRelatedCaseIds"
            className="kelpie-input"
            placeholder="case_…, case_…"
          />
        </div>

        {failedChecklist ? (
          <div
            className="rounded-lg border border-amber-700/60 bg-amber-950/40 p-3"
            role="status"
          >
            <p className="text-sm font-medium text-amber-100">
              Policy checklist
              {failedChecklist.policyName
                ? ` — ${failedChecklist.policyName}`
                : ""}
              {failedChecklist.policyVersion != null
                ? ` v${failedChecklist.policyVersion}`
                : ""}
            </p>
            <ul className="mt-2 space-y-1.5">
              {failedChecklist.requirements.map((r) => (
                <li
                  key={r.type}
                  className={`text-xs ${r.passed ? "text-emerald-400" : "text-amber-200"}`}
                >
                  <span className="font-medium">
                    {r.passed ? "✓" : "✗"} {r.label}
                  </span>
                  {!r.passed && r.detail ? (
                    <span className="block text-slate-400">{r.detail}</span>
                  ) : null}
                  {!r.passed && r.missing.length > 0 ? (
                    <span className="block text-slate-500">
                      Missing: {r.missing.join(", ")}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
            {canOverride ? (
              <div className="mt-3 space-y-2 border-t border-amber-800/50 pt-3">
                <label htmlFor="override-reason" className="kelpie-label">
                  Override reason (admin)
                </label>
                <textarea
                  id="override-reason"
                  className="kelpie-input"
                  rows={2}
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  placeholder="Why is this close allowed despite unmet requirements?"
                />
                {failedChecklist.requireTwoPersonOverride && orgUsers.length > 0 ? (
                  <p className="text-xs text-amber-200/80">
                    This policy requires a second admin approver for override.
                    Select them in Approver above.
                  </p>
                ) : null}
                <button
                  type="button"
                  className="kelpie-btn kelpie-btn-secondary text-xs"
                  disabled={pending}
                  onClick={() => {
                    setOverrideMode(true);
                    void confirmClose(true);
                  }}
                >
                  Close with privileged override
                </button>
              </div>
            ) : (
              <p className="mt-2 text-xs text-slate-500">
                Only an admin can override unmet requirements.
              </p>
            )}
          </div>
        ) : null}

        <div className="flex justify-end">
          <button className="kelpie-btn kelpie-btn-danger" disabled={pending}>
            Close case
          </button>
        </div>
      </form>
      <ConfirmDialog
        open={pendingData !== null && !failedChecklist && !overrideMode}
        onOpenChange={(open) => {
          if (!open) setPendingData(null);
        }}
        title={`Close ${caseNumber}?`}
        description="Are you sure? This evaluates the organisation closure policy, records disposition, and moves the case out of active work. The case record is preserved."
        confirmLabel="Close case"
        pending={pending}
        tone="warning"
        onConfirm={() => void confirmClose(false)}
      />
    </>
  );
}
