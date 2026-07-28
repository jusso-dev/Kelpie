"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { AlertTriangle, X } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

export function feedbackError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  pending = false,
  tone = "danger",
  reasonLabel,
  reasonPlaceholder,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  pending?: boolean;
  tone?: "danger" | "warning";
  /** When set, renders a required reason textarea and passes its trimmed value to `onConfirm`. */
  reasonLabel?: string;
  reasonPlaceholder?: string;
  onConfirm: (reason?: string) => void;
}) {
  const reasonId = useId();
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!open) setReason("");
  }, [open]);

  const reasonRequired = Boolean(reasonLabel);
  const reasonValid = !reasonRequired || reason.trim().length > 0;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="kelpie-dialog-overlay" />
        <Dialog.Content
          className="kelpie-dialog-content"
          onPointerDownOutside={(event) => {
            if (pending) event.preventDefault();
          }}
          onEscapeKeyDown={(event) => {
            if (pending) event.preventDefault();
          }}
        >
          <div className={`kelpie-dialog-icon kelpie-dialog-icon-${tone}`}>
            <AlertTriangle size={20} aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <Dialog.Title className="kelpie-dialog-title">{title}</Dialog.Title>
            <Dialog.Description className="kelpie-dialog-description">
              {description}
            </Dialog.Description>
            {reasonLabel ? (
              <div className="kelpie-field mt-3">
                <label htmlFor={reasonId} className="kelpie-label">
                  {reasonLabel}
                </label>
                <textarea
                  id={reasonId}
                  className="kelpie-input"
                  rows={2}
                  required
                  disabled={pending}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder={reasonPlaceholder}
                />
              </div>
            ) : null}
          </div>
          <Dialog.Close
            className="kelpie-dialog-close"
            aria-label="Close confirmation"
            disabled={pending}
          >
            <X size={18} aria-hidden="true" />
          </Dialog.Close>
          <div className="kelpie-dialog-actions">
            <Dialog.Close
              className="kelpie-btn kelpie-btn-secondary"
              disabled={pending}
            >
              Cancel
            </Dialog.Close>
            <button
              type="button"
              className={
                tone === "danger"
                  ? "kelpie-btn kelpie-btn-danger"
                  : "kelpie-btn kelpie-btn-primary"
              }
              disabled={pending || !reasonValid}
              onClick={() => onConfirm(reasonRequired ? reason.trim() : undefined)}
            >
              {pending ? "Working…" : confirmLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function ConfirmActionButton({
  action,
  title,
  description,
  confirmLabel,
  triggerLabel,
  successTitle,
  successDescription,
  errorTitle = "Action failed",
  tone = "danger",
  className = "kelpie-btn kelpie-btn-ghost text-red-400",
  disabled = false,
  redirectTo,
}: {
  action: () => Promise<unknown>;
  title: string;
  description: string;
  confirmLabel: string;
  triggerLabel: string;
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

  async function confirm() {
    setPending(true);
    try {
      await action();
      setOpen(false);
      toast.success(successTitle, { description: successDescription });
      if (redirectTo) router.push(redirectTo);
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
        onConfirm={() => void confirm()}
      />
    </>
  );
}

export function ConfirmFormActionButton({
  action,
  values,
  ...props
}: Omit<React.ComponentProps<typeof ConfirmActionButton>, "action"> & {
  action: (formData: FormData) => Promise<unknown>;
  values: Record<string, string>;
}) {
  return (
    <ConfirmActionButton
      {...props}
      action={async () => {
        const formData = new FormData();
        for (const [key, value] of Object.entries(values)) {
          formData.set(key, value);
        }
        await action(formData);
      }}
    />
  );
}
