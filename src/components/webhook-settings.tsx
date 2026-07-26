"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ConfirmActionButton,
  feedbackError,
} from "@/components/confirm-dialog";
import {
  createWebhook,
  deleteWebhook,
  setWebhookActive,
} from "@/actions/webhooks";
import { WEBHOOK_EVENTS } from "@/lib/webhook-events";

type WebhookKind = "generic" | "slack" | "teams";
type Webhook = {
  id: string;
  name: string;
  kind: string;
  url: string;
  events: string[];
  isActive: boolean;
  createdAt: string;
};

const KIND_LABELS: Record<WebhookKind, string> = {
  generic: "Generic webhook",
  slack: "Slack",
  teams: "Microsoft Teams",
};

function displayDestination(value: string): string {
  try {
    return `${new URL(value).hostname}/••••`;
  } catch {
    return "Configured destination";
  }
}

export default function WebhookSettings({
  webhooks,
  isAdmin,
}: {
  webhooks: Webhook[];
  isAdmin: boolean;
}) {
  const [issuedSecret, setIssuedSecret] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<WebhookKind>("slack");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>(["case.created"]);
  const [pending, setPending] = useState(false);
  const [pendingChannelId, setPendingChannelId] = useState<string | null>(null);
  const router = useRouter();

  async function onCreate(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setIssuedSecret(null);
    try {
      const formData = new FormData();
      formData.set("kind", kind);
      formData.set("name", name);
      formData.set("url", url);
      formData.set("events", JSON.stringify(events));
      const result = await createWebhook(formData);
      setIssuedSecret(result.secret);
      setName("");
      setUrl("");
      setAdding(false);
      toast.success("Notification channel added", {
        description: `${name} will receive selected case events.`,
      });
      router.refresh();
    } catch (error) {
      toast.error("Notification channel could not be added", {
        description: feedbackError(
          error,
          "Nothing changed. Check the webhook URL and selected events.",
        ),
      });
    } finally {
      setPending(false);
    }
  }

  function toggleEvent(event: string) {
    setEvents((current) =>
      current.includes(event)
        ? current.filter((item) => item !== event)
        : [...current, event],
    );
  }

  async function toggleChannel(webhook: Webhook) {
    setPendingChannelId(webhook.id);
    try {
      await setWebhookActive(webhook.id, !webhook.isActive);
      toast.success(
        webhook.isActive
          ? "Notification channel disabled"
          : "Notification channel enabled",
        {
          description: webhook.isActive
            ? `${webhook.name} will not receive new case events.`
            : `${webhook.name} will receive its selected case events.`,
        },
      );
      router.refresh();
    } catch (error) {
      toast.error("Notification channel could not be updated", {
        description: feedbackError(
          error,
          "Nothing changed. Check the server logs and try again.",
        ),
      });
    } finally {
      setPendingChannelId(null);
    }
  }

  return (
    <div className="space-y-4">
      {webhooks.length === 0 ? (
        <p className="rounded border border-dashed border-[color:var(--color-navy-600)] p-5 text-center text-xs text-slate-500">
          No notification channels configured.
        </p>
      ) : (
        <div className="divide-y divide-[color:var(--color-navy-700)] overflow-hidden rounded-lg border border-[color:var(--color-navy-700)]">
          {webhooks.map((webhook) => {
            const webhookKind: WebhookKind =
              webhook.kind === "slack" || webhook.kind === "teams"
                ? webhook.kind
                : "generic";
            return (
              <article
                key={webhook.id}
                className="grid gap-3 p-4 md:grid-cols-[minmax(11rem,.8fr)_minmax(15rem,1.4fr)_auto] md:items-center"
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-medium text-slate-100">
                      {webhook.name}
                    </h3>
                    <span className={`kelpie-badge ${webhook.isActive ? "text-green-400" : "text-slate-500"}`}>
                      {webhook.isActive ? "on" : "off"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {KIND_LABELS[webhookKind]}
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="truncate font-mono text-xs text-slate-400">
                    {displayDestination(webhook.url)}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {webhook.events.join(", ")}
                  </p>
                </div>
                {isAdmin ? (
                  <div className="flex gap-1 md:justify-end">
                    <button
                      className="kelpie-btn kelpie-btn-ghost text-xs"
                      disabled={pendingChannelId === webhook.id}
                      onClick={() => void toggleChannel(webhook)}
                    >
                      {pendingChannelId === webhook.id
                        ? "Working…"
                        : webhook.isActive
                          ? "Disable"
                          : "Enable"}
                    </button>
                    <ConfirmActionButton
                      action={async () => {
                        await deleteWebhook(webhook.id);
                        router.refresh();
                      }}
                      title={`Delete channel "${webhook.name}"?`}
                      description="Are you sure? Kelpie stops sending notifications to this destination. Delivery history remains available for audit."
                      confirmLabel="Delete channel"
                      triggerLabel="Delete"
                      successTitle="Notification channel deleted"
                      successDescription={`${webhook.name} will no longer receive case events.`}
                      errorTitle="Notification channel could not be deleted"
                      className="kelpie-btn kelpie-btn-ghost text-xs text-red-400"
                    />
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}

      {issuedSecret ? (
        <div className="rounded border border-[color:var(--color-tan-500)] bg-[color:var(--color-navy-800)] p-3 text-sm">
          <p className="mb-1 text-slate-200">
            Webhook secret. Copy it now; it will not be shown again.
          </p>
          <code className="break-all font-mono text-[color:var(--color-tan-300)]">
            {issuedSecret}
          </code>
          <p className="mt-2 text-xs text-slate-500">
            Verify <code>HMAC-SHA256(secret, requestBody)</code> against{" "}
            <code>X-Kelpie-Signature</code>.
          </p>
        </div>
      ) : null}

      {isAdmin ? (
        adding ? (
          <form onSubmit={onCreate} className="kelpie-card space-y-4 p-5">
            <div className="grid gap-4 md:grid-cols-3">
              <Field label="Channel type">
                <select
                  className="kelpie-input"
                  value={kind}
                  onChange={(event) => setKind(event.target.value as WebhookKind)}
                >
                  {Object.entries(KIND_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Name">
                <input
                  className="kelpie-input"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={
                    kind === "slack"
                      ? "SOC Slack"
                      : kind === "teams"
                        ? "Incident response team"
                        : "Automation endpoint"
                  }
                  required
                />
              </Field>
              <Field label={kind === "generic" ? "Webhook URL" : "Incoming webhook URL"}>
                <input
                  className="kelpie-input"
                  type="url"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="https://…"
                  required
                />
              </Field>
            </div>
            <p className="text-xs text-slate-500">
              {kind === "slack"
                ? "Paste a Slack app Incoming Webhook URL."
                : kind === "teams"
                  ? "Paste an incoming webhook URL from a Microsoft Teams Workflow."
                  : "Kelpie signs the exact JSON request body with your generated secret."}
            </p>
            <fieldset>
              <legend className="mb-2 text-xs uppercase tracking-wider text-slate-400">
                Events
              </legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {WEBHOOK_EVENTS.map((event) => (
                  <label
                    key={event}
                    className="flex cursor-pointer items-center gap-2 rounded border border-[color:var(--color-navy-700)] px-3 py-2"
                  >
                    <input
                      type="checkbox"
                      className="kelpie-checkbox"
                      checked={events.includes(event)}
                      onChange={() => toggleEvent(event)}
                    />
                    <span className="font-mono text-xs text-slate-300">{event}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="kelpie-btn kelpie-btn-ghost"
                onClick={() => setAdding(false)}
              >
                Cancel
              </button>
              <button
                className="kelpie-btn kelpie-btn-primary"
                disabled={pending || events.length === 0}
              >
                {pending ? "Creating…" : "Add channel"}
              </button>
            </div>
          </form>
        ) : (
          <button
            className="kelpie-btn kelpie-btn-secondary"
            onClick={() => setAdding(true)}
          >
            Add notification channel
          </button>
        )
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
    <label className="block">
      <span className="mb-1 block text-xs uppercase tracking-wider text-slate-400">
        {label}
      </span>
      {children}
    </label>
  );
}
