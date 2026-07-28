"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ConfirmActionButton,
  feedbackError,
} from "@/components/confirm-dialog";
import {
  approveMailboxMessageAction,
  dismissMailboxMessageAction,
  retryMailboxMessageAction,
} from "@/actions/mailbox";

export type MailboxMessageRow = {
  id: string;
  connectionId: string;
  connectionName: string;
  providerMessageId: string;
  subject: string | null;
  fromAddress: string | null;
  receivedAt: string | null;
  status: string;
  failureReason: string | null;
  dismissReason: string | null;
  caseId: string | null;
  retryCount: number;
  createdAt: string;
  bodyTextPreview: string;
  bodyHtmlSanitized: string | null;
  attachmentCount: number;
};

export default function MailboxIntakeHistory({
  messages,
  canMutate,
}: {
  messages: MailboxMessageRow[];
  canMutate: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [dismissReasons, setDismissReasons] = useState<Record<string, string>>(
    {},
  );

  async function run(work: () => Promise<unknown>) {
    setPending(true);
    setError(null);
    try {
      await work();
      router.refresh();
    } catch (caught) {
      const message = feedbackError(
        caught,
        "Mailbox intake action failed.",
      );
      setError(message);
      toast.error("Intake action failed", { description: message });
    } finally {
      setPending(false);
    }
  }

  if (messages.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-700 p-8 text-center">
        <p className="text-sm text-slate-300">No mailbox intake history yet.</p>
        <p className="mt-1 text-xs text-slate-500">
          Messages appear here after a poll or manual fetch.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error ? (
        <div className="kelpie-notice kelpie-notice-error" role="alert">
          <span aria-hidden="true">!</span>
          {error}
        </div>
      ) : null}

      {messages.map((msg) => {
        const open = expanded === msg.id;
        return (
          <article
            key={msg.id}
            className="rounded-lg border border-slate-800 bg-slate-950/30 p-4"
          >
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-medium text-slate-100 truncate">
                    {msg.subject || "(no subject)"}
                  </h3>
                  <StatusBadge status={msg.status} />
                </div>
                <p className="text-xs text-slate-500">
                  {msg.fromAddress ?? "unknown sender"} · {msg.connectionName} ·{" "}
                  {msg.receivedAt
                    ? new Date(msg.receivedAt).toLocaleString()
                    : new Date(msg.createdAt).toLocaleString()}
                  {msg.attachmentCount > 0
                    ? ` · ${msg.attachmentCount} attachment(s)`
                    : ""}
                </p>
                {msg.failureReason ? (
                  <p className="text-xs text-rose-400">
                    Failure: {msg.failureReason}
                  </p>
                ) : null}
                {msg.dismissReason ? (
                  <p className="text-xs text-slate-400">
                    Dismissed: {msg.dismissReason}
                  </p>
                ) : null}
                {msg.caseId ? (
                  <p className="text-xs">
                    <Link
                      href={`/cases/${msg.caseId}`}
                      className="text-sky-400 hover:text-sky-300"
                    >
                      Open case →
                    </Link>
                  </p>
                ) : null}
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="kelpie-btn kelpie-btn-secondary"
                  onClick={() => setExpanded(open ? null : msg.id)}
                >
                  {open ? "Hide" : "Details"}
                </button>
                {canMutate &&
                (msg.status === "pending_review" || msg.status === "failed") ? (
                  <>
                    <button
                      type="button"
                      className="kelpie-btn kelpie-btn-primary"
                      disabled={pending}
                      onClick={() =>
                        run(async () => {
                          if (msg.status === "failed") {
                            await retryMailboxMessageAction(msg.id);
                            toast.success("Message retried and case created");
                          } else {
                            const result = await approveMailboxMessageAction(
                              msg.id,
                            );
                            toast.success("Case created from mailbox message", {
                              description: result.caseNumber
                                ? `Case ${result.caseNumber}`
                                : undefined,
                            });
                          }
                        })
                      }
                    >
                      {msg.status === "failed" ? "Retry" : "Create case"}
                    </button>
                    <div className="flex items-center gap-2">
                      <input
                        className="kelpie-input w-40"
                        placeholder="Dismiss reason"
                        value={dismissReasons[msg.id] ?? ""}
                        onChange={(e) =>
                          setDismissReasons((prev) => ({
                            ...prev,
                            [msg.id]: e.target.value,
                          }))
                        }
                        aria-label="Dismiss reason"
                      />
                      <ConfirmActionButton
                        title="Dismiss this message?"
                        description="It will not create a case. Provide a reason for the audit trail."
                        confirmLabel="Dismiss"
                        triggerLabel="Dismiss"
                        successTitle="Message dismissed"
                        disabled={pending}
                        action={async () => {
                          const reason = (dismissReasons[msg.id] ?? "").trim();
                          if (!reason) {
                            throw new Error("A dismiss reason is required");
                          }
                          await dismissMailboxMessageAction(msg.id, reason);
                          router.refresh();
                        }}
                      />
                    </div>
                  </>
                ) : null}
              </div>
            </div>

            {open ? (
              <div className="mt-4 space-y-3 border-t border-slate-800 pt-3">
                <p className="text-xs text-slate-500">
                  Provider message id:{" "}
                  <code className="text-slate-400">{msg.providerMessageId}</code>
                </p>
                <div>
                  <h4 className="text-xs uppercase tracking-wider text-slate-400 mb-1">
                    Plain text
                  </h4>
                  <pre className="whitespace-pre-wrap break-words rounded bg-slate-900/60 p-3 text-xs text-slate-300 max-h-64 overflow-auto">
                    {msg.bodyTextPreview || "(empty)"}
                  </pre>
                </div>
                {msg.bodyHtmlSanitized ? (
                  <div>
                    <h4 className="text-xs uppercase tracking-wider text-slate-400 mb-1">
                      Sanitised HTML
                    </h4>
                    <div
                      className="prose prose-invert prose-sm max-w-none rounded bg-slate-900/60 p-3 max-h-64 overflow-auto text-slate-300"
                      // Sanitised server-side before storage; never raw provider HTML.
                      dangerouslySetInnerHTML={{
                        __html: msg.bodyHtmlSanitized,
                      }}
                    />
                  </div>
                ) : null}
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colour =
    status === "imported"
      ? "text-green-400"
      : status === "failed"
        ? "text-rose-400"
        : status === "dismissed"
          ? "text-slate-500"
          : status === "duplicate"
            ? "text-amber-400"
            : "text-sky-400";
  return <span className={`kelpie-badge ${colour}`}>{status}</span>;
}
