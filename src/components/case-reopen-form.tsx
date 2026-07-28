"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { reopenCase } from "@/actions/cases";
import { ConfirmDialog, feedbackError } from "@/components/confirm-dialog";

export default function CaseReopenForm({
  caseId,
  caseNumber,
  version,
}: {
  caseId: string;
  caseNumber: string;
  version: number;
}) {
  const router = useRouter();
  const [pendingData, setPendingData] = useState<FormData | null>(null);
  const [pending, setPending] = useState(false);

  async function confirmReopen() {
    if (!pendingData) return;
    setPending(true);
    try {
      const result = await reopenCase(pendingData);
      if (!result.ok) {
        toast.error("Case could not be reopened", {
          description: result.error,
        });
        return;
      }
      setPendingData(null);
      toast.success(`${caseNumber} reopened`, {
        description: "Prior closure snapshots were retained for the permanent record.",
      });
      router.refresh();
    } catch (error) {
      toast.error("Case could not be reopened", {
        description: feedbackError(error, "Try again with a reopen reason."),
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <form
        className="mt-4 space-y-3 border-t border-slate-800 pt-4"
        onSubmit={(event) => {
          event.preventDefault();
          setPendingData(new FormData(event.currentTarget));
        }}
      >
        <input type="hidden" name="caseId" value={caseId} />
        <input type="hidden" name="expectedVersion" value={version} />
        <div className="kelpie-field">
          <label htmlFor="reopen-reason" className="kelpie-label">
            Reopen reason
          </label>
          <textarea
            id="reopen-reason"
            name="reason"
            className="kelpie-input"
            rows={2}
            required
            minLength={3}
            placeholder="Why is this case returning to active work?"
          />
        </div>
        <button type="submit" className="kelpie-btn kelpie-btn-secondary text-xs" disabled={pending}>
          Reopen case
        </button>
      </form>
      <ConfirmDialog
        open={pendingData !== null}
        onOpenChange={(open) => {
          if (!open) setPendingData(null);
        }}
        title={`Reopen ${caseNumber}?`}
        description="Prior closure snapshots stay on the record. The case returns to active investigation."
        confirmLabel="Reopen case"
        pending={pending}
        tone="warning"
        onConfirm={() => void confirmReopen()}
      />
    </>
  );
}
