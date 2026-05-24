"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import {
  createWebhook,
  deleteWebhook,
  setWebhookActive,
} from "@/actions/webhooks";
import { WEBHOOK_EVENTS } from "@/lib/webhook-events";

type Webhook = {
  id: string;
  name: string;
  url: string;
  events: string[];
  isActive: boolean;
  createdAt: string;
};

export default function WebhookSettings({
  webhooks,
  isAdmin,
}: {
  webhooks: Webhook[];
  isAdmin: boolean;
}) {
  const [issuedSecret, setIssuedSecret] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>(["case.created"]);
  const [pending, setPending] = useState(false);
  const router = useRouter();

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    const fd = new FormData();
    fd.set("name", name);
    fd.set("url", url);
    fd.set("events", JSON.stringify(events));
    const res = await createWebhook(fd);
    setPending(false);
    setIssuedSecret(res.secret);
    setName("");
    setUrl("");
    setAdding(false);
    router.refresh();
  }

  function toggleEvent(e: string) {
    setEvents((prev) => (prev.includes(e) ? prev.filter((x) => x !== e) : [...prev, e]));
  }

  return (
    <div className="space-y-3">
      <table className="kelpie-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>URL</th>
            <th>Events</th>
            <th>Active</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {webhooks.length === 0 ? (
            <tr>
              <td colSpan={5} className="text-center text-slate-500 py-6">
                No webhooks.
              </td>
            </tr>
          ) : (
            webhooks.map((w) => (
              <tr key={w.id}>
                <td>{w.name}</td>
                <td className="text-xs font-mono text-slate-400 truncate max-w-xs">
                  {w.url}
                </td>
                <td className="text-xs text-slate-400">{w.events.join(", ")}</td>
                <td>
                  <span
                    className={
                      "kelpie-badge " +
                      (w.isActive ? "text-green-400" : "text-slate-500")
                    }
                  >
                    {w.isActive ? "on" : "off"}
                  </span>
                </td>
                <td className="text-right">
                  {isAdmin ? (
                    <div className="flex justify-end gap-1">
                      <button
                        className="kelpie-btn kelpie-btn-ghost text-xs"
                        onClick={async () => {
                          await setWebhookActive(w.id, !w.isActive);
                          router.refresh();
                        }}
                      >
                        {w.isActive ? "Disable" : "Enable"}
                      </button>
                      <button
                        className="kelpie-btn kelpie-btn-ghost text-red-400 text-xs"
                        onClick={async () => {
                          if (!confirm(`Delete webhook "${w.name}"?`)) return;
                          await deleteWebhook(w.id);
                          router.refresh();
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  ) : null}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      {issuedSecret ? (
        <div className="rounded border border-[color:var(--color-tan-500)] bg-[color:var(--color-navy-800)] p-3 text-sm">
          <p className="text-slate-200 mb-1">
            Webhook secret. Copy it now — it will not be shown again.
          </p>
          <code className="font-mono text-[color:var(--color-tan-300)] break-all">
            {issuedSecret}
          </code>
          <p className="text-xs text-slate-500 mt-2">
            Verify with: <code>HMAC-SHA256(secret, requestBody)</code> against{" "}
            <code>X-Kelpie-Signature</code> (format <code>sha256=...</code>).
          </p>
        </div>
      ) : null}
      {isAdmin ? (
        adding ? (
          <form onSubmit={onCreate} className="kelpie-card p-4 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <div>
                <label className="block text-xs uppercase tracking-wider text-slate-400 mb-1">
                  Name
                </label>
                <input
                  className="kelpie-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="block text-xs uppercase tracking-wider text-slate-400 mb-1">
                  URL
                </label>
                <input
                  className="kelpie-input"
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://example.com/kelpie"
                  required
                />
              </div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-slate-400 mb-1">
                Events
              </div>
              <div className="flex flex-wrap gap-3 text-xs">
                {WEBHOOK_EVENTS.map((e) => (
                  <label key={e} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={events.includes(e)}
                      onChange={() => toggleEvent(e)}
                    />
                    <span className="font-mono text-slate-300">{e}</span>
                  </label>
                ))}
              </div>
            </div>
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
                {pending ? "Creating..." : "Create webhook"}
              </button>
            </div>
          </form>
        ) : (
          <button
            className="kelpie-btn kelpie-btn-secondary"
            onClick={() => setAdding(true)}
          >
            Add webhook
          </button>
        )
      ) : null}
    </div>
  );
}
