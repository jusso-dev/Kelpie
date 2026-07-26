"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { closeCase } from "@/actions/cases";
import { ConfirmDialog, feedbackError } from "@/components/confirm-dialog";

export default function CaseCloseForm({
  caseId,
  caseNumber,
}: {
  caseId: string;
  caseNumber: string;
}) {
  const router = useRouter();
  const [pendingData, setPendingData] = useState<FormData | null>(null);
  const [pending, setPending] = useState(false);

  async function confirmClose() {
    if (!pendingData) return;
    setPending(true);
    try {
      await closeCase(pendingData);
      setPendingData(null);
      toast.success(`${caseNumber} closed`, {
        description: "The closure reason and summary were added to the permanent case record.",
      });
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
          setPendingData(new FormData(event.currentTarget));
        }}
      >
        <input type="hidden" name="caseId" value={caseId} />
        <div>
          <h2 className="text-sm font-medium text-slate-200">Close this case</h2>
          <p className="mt-1 text-xs text-slate-500">
            Record the outcome before moving the case out of active work.
          </p>
        </div>
        <div className="kelpie-field">
          <label htmlFor="closure-reason" className="kelpie-label">
            Closure reason
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
          <label htmlFor="closure-summary" className="kelpie-label">
            Summary for the record
          </label>
          <textarea
            id="closure-summary"
            name="summary"
            className="kelpie-input"
            rows={4}
            required
            placeholder="What happened, what was done, and what should the team watch for?"
          />
        </div>
        <div className="flex justify-end">
          <button className="kelpie-btn kelpie-btn-danger" disabled={pending}>
            Close case
          </button>
        </div>
      </form>
      <ConfirmDialog
        open={pendingData !== null}
        onOpenChange={(open) => {
          if (!open) setPendingData(null);
        }}
        title={`Close ${caseNumber}?`}
        description="Are you sure? This moves the case out of active work and records the selected reason and summary in its history. The case record is preserved."
        confirmLabel="Close case"
        pending={pending}
        tone="warning"
        onConfirm={() => void confirmClose()}
      />
    </>
  );
}
