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
  createMailboxConnection,
  deleteMailboxConnection,
  pollMailboxNow,
  setMailboxConnectionActive,
} from "@/actions/mailbox";

export type MailboxConnectionRow = {
  id: string;
  name: string;
  provider: string;
  folder: string;
  pollIntervalMinutes: number;
  intakeMode: string;
  isActive: boolean;
  lastPolledAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  importedMessageCount: number;
  connectionMeta: Record<string, unknown>;
  hasCredentials: boolean;
};

export default function MailboxSettings({
  connections,
  isAdmin,
}: {
  connections: MailboxConnectionRow[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [provider, setProvider] = useState("imap");

  async function run(work: () => Promise<unknown>) {
    setPending(true);
    setError(null);
    try {
      await work();
      router.refresh();
    } catch (caught) {
      const message = feedbackError(
        caught,
        "Nothing changed. Check mailbox settings and try again.",
      );
      setError(message);
      toast.error("Mailbox action failed", { description: message });
    } finally {
      setPending(false);
    }
  }

  async function onCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    await run(async () => {
      await createMailboxConnection(new FormData(form));
      toast.success("Mailbox connection added", {
        description:
          "Credentials are encrypted at rest and will never be shown again.",
      });
      setAdding(false);
      form.reset();
      setProvider("imap");
    });
  }

  return (
    <div className="space-y-4">
      {error ? (
        <div className="kelpie-notice kelpie-notice-error" role="alert">
          <span aria-hidden="true">!</span>
          {error}
        </div>
      ) : null}

      {connections.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-700 p-6 text-center">
          <p className="text-sm text-slate-300">No inbound mailboxes configured.</p>
          <p className="mt-1 text-xs text-slate-500">
            Connect IMAP (TLS) or Microsoft Graph to turn selected messages into
            cases.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {connections.map((conn) => (
            <div
              key={conn.id}
              className="rounded-lg border border-slate-800 bg-slate-950/30 p-4"
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-medium text-slate-100">{conn.name}</h3>
                    <span
                      className={`kelpie-badge ${
                        conn.isActive ? "text-green-400" : "text-slate-500"
                      }`}
                    >
                      {conn.isActive ? "active" : "off"}
                    </span>
                    <span className="kelpie-badge text-slate-400">
                      {conn.intakeMode === "auto_create"
                        ? "auto-create"
                        : "review first"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {conn.provider === "microsoft_graph"
                      ? "Microsoft Graph"
                      : "IMAP TLS"}{" "}
                    · {conn.folder} · every {conn.pollIntervalMinutes} min ·{" "}
                    {conn.importedMessageCount} cases imported
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Last polled:{" "}
                    {conn.lastPolledAt
                      ? new Date(conn.lastPolledAt).toLocaleString()
                      : "never"}
                    {conn.lastSuccessAt
                      ? ` · last success ${new Date(conn.lastSuccessAt).toLocaleString()}`
                      : ""}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Credentials:{" "}
                    {conn.hasCredentials
                      ? "encrypted at rest (not displayed)"
                      : "missing"}
                  </p>
                  {conn.lastError ? (
                    <p className="mt-2 text-xs text-rose-400" role="status">
                      Last error: {conn.lastError}
                    </p>
                  ) : null}
                </div>
                {isAdmin ? (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="kelpie-btn kelpie-btn-secondary"
                      disabled={pending}
                      onClick={() =>
                        run(async () => {
                          const result = await pollMailboxNow(conn.id);
                          toast.success("Manual fetch complete", {
                            description: `${result.fetched} fetched · ${result.created} created · ${result.pendingReview} pending review`,
                          });
                        })
                      }
                    >
                      Fetch now
                    </button>
                    <button
                      type="button"
                      className="kelpie-btn kelpie-btn-secondary"
                      disabled={pending}
                      onClick={() =>
                        run(async () => {
                          await setMailboxConnectionActive(
                            conn.id,
                            !conn.isActive,
                          );
                          toast.success(
                            conn.isActive
                              ? "Mailbox paused"
                              : "Mailbox activated",
                          );
                        })
                      }
                    >
                      {conn.isActive ? "Pause" : "Activate"}
                    </button>
                    <ConfirmActionButton
                      title="Delete mailbox connection?"
                      description="Stored credentials and intake history for this connection will be removed."
                      confirmLabel="Delete connection"
                      triggerLabel="Delete"
                      successTitle="Mailbox connection deleted"
                      disabled={pending}
                      action={async () => {
                        await deleteMailboxConnection(conn.id);
                        router.refresh();
                      }}
                    />
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/settings/mailbox"
          className="text-sm text-sky-400 hover:text-sky-300"
        >
          Open intake history →
        </Link>
        {isAdmin ? (
          <button
            type="button"
            className="kelpie-btn kelpie-btn-secondary"
            disabled={pending}
            onClick={() => setAdding((v) => !v)}
          >
            {adding ? "Cancel" : "Add mailbox"}
          </button>
        ) : null}
      </div>

      {isAdmin && adding ? (
        <form
          onSubmit={onCreate}
          className="space-y-3 rounded-lg border border-slate-800 bg-slate-950/40 p-4"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name">
              <input name="name" className="kelpie-input" required />
            </Field>
            <Field label="Provider">
              <select
                name="provider"
                className="kelpie-input"
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
              >
                <option value="imap">IMAP (TLS)</option>
                <option value="microsoft_graph">Microsoft Graph</option>
              </select>
            </Field>
            <Field label="Folder">
              <input
                name="folder"
                className="kelpie-input"
                defaultValue="INBOX"
              />
            </Field>
            <Field label="Poll interval (minutes)">
              <input
                name="poll_interval_minutes"
                type="number"
                min={1}
                max={10080}
                defaultValue={5}
                className="kelpie-input"
              />
            </Field>
            <Field label="Intake mode">
              <select name="intake_mode" className="kelpie-input" defaultValue="review">
                <option value="review">Review before create</option>
                <option value="auto_create">Automatic case creation</option>
              </select>
            </Field>
            <Field label="Default severity">
              <select
                name="default_severity"
                className="kelpie-input"
                defaultValue="medium"
              >
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
                <option value="critical">critical</option>
              </select>
            </Field>
            <Field label="Default classification">
              <select
                name="default_classification"
                className="kelpie-input"
                defaultValue="other"
              >
                <option value="phishing">phishing</option>
                <option value="malware">malware</option>
                <option value="unauthorised_access">unauthorised_access</option>
                <option value="data_breach">data_breach</option>
                <option value="dos">dos</option>
                <option value="policy_violation">policy_violation</option>
                <option value="other">other</option>
              </select>
            </Field>
            <Field label="Default tags">
              <input
                name="default_tags"
                className="kelpie-input"
                placeholder="mailbox, phishing"
              />
            </Field>
          </div>

          {provider === "imap" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="IMAP host">
                <input name="host" className="kelpie-input" required />
              </Field>
              <Field label="Port">
                <input
                  name="port"
                  type="number"
                  className="kelpie-input"
                  defaultValue={993}
                />
              </Field>
              <Field label="Username">
                <input name="username" className="kelpie-input" required />
              </Field>
              <Field label="Password">
                <input
                  name="password"
                  type="password"
                  className="kelpie-input"
                  required
                  autoComplete="new-password"
                />
              </Field>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Tenant ID">
                <input name="tenant_id" className="kelpie-input" required />
              </Field>
              <Field label="Client ID">
                <input name="client_id" className="kelpie-input" required />
              </Field>
              <Field label="Mailbox (UPN)">
                <input name="mailbox" className="kelpie-input" required />
              </Field>
              <Field label="Client secret">
                <input
                  name="client_secret"
                  type="password"
                  className="kelpie-input"
                  required
                  autoComplete="new-password"
                />
              </Field>
            </div>
          )}

          <p className="text-xs text-slate-500">
            Credentials are encrypted at rest with{" "}
            <code className="text-slate-400">CREDENTIALS_ENCRYPTION_KEY</code>{" "}
            and are never returned after save. Polling never logs message bodies
            or secrets.
          </p>

          <div className="flex justify-end">
            <button
              type="submit"
              className="kelpie-btn kelpie-btn-primary"
              disabled={pending}
            >
              Save mailbox
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="block text-xs uppercase tracking-wider text-slate-400">
        {label}
      </span>
      {children}
    </label>
  );
}
