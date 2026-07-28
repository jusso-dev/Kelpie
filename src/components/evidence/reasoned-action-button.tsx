"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConfirmDialog, feedbackError } from "@/components/confirm-dialog";

/**
 * Like `ConfirmActionButton`, but for evidence actions that require the
 * analyst to type a reason (override, delete, legal hold apply/release).
 * Uses `ConfirmDialog`'s `reasonLabel` prop rather than a separate inline
 * form so the reason can never be submitted empty.
 */
export function ReasonedActionButton({
  action,
  title,
  description,
  confirmLabel,
  triggerLabel,
  reasonLabel,
  reasonPlaceholder,
  successTitle,
  successDescription,
  errorTitle = "Action failed",
  tone = "danger",
  className = "kelpie-btn kelpie-btn-ghost text-red-400",
  disabled = false,
  redirectTo,
}: {
  action: (reason: string) => Promise<unknown>;
  title: string;
  description: string;
  confirmLabel: string;
  triggerLabel: string;
  reasonLabel: string;
  reasonPlaceholder?: string;
  successTitle: string;
  successDescription?: string;
  errorTitle?: string;
  tone?: "danger" | "warning";
  className?: string;
  disabled?: boolean;
  redirectTo?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  async function confirm(reason?: string) {
    const trimmed = reason?.trim();
    if (!trimmed) return;
    setPending(true);
    try {
      await action(trimmed);
      setOpen(false);
      toast.success(successTitle, { description: successDescription });
      if (redirectTo) {
        router.push(redirectTo);
      } else {
        router.refresh();
      }
    } catch (error) {
      toast.error(errorTitle, {
        description: feedbackError(
          error,
          "Nothing changed. Try again or check the server logs.",
        ),
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className={className}
        disabled={disabled || pending}
        onClick={() => setOpen(true)}
      >
        {triggerLabel}
      </button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={title}
        description={description}
        confirmLabel={confirmLabel}
        pending={pending}
        tone={tone}
        reasonLabel={reasonLabel}
        reasonPlaceholder={reasonPlaceholder}
        onConfirm={(reason) => void confirm(reason)}
      />
    </>
  );
}
