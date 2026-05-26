"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  clearFeedError,
  createFeed,
  deleteFeed,
  pollFeedNow,
  setFeedActive,
} from "@/actions/ti";

type ConfigField = {
  key: string;
  label: string;
  type: "string" | "password";
  required: boolean;
  placeholder?: string;
  help?: string;
};

type Kind = {
  kind: string;
  label: string;
  description: string;
  configFields: ConfigField[];
};

type FeedRow = {
  id: string;
  name: string;
  kind: string;
  url: string | null;
  isActive: boolean;
  lastPolledAt: string | null;
  lastError: string | null;
  indicatorCount: number;
  pollIntervalMinutes: number;
};

export default function TiFeedSettings({
  feeds,
  kinds,
  isAdmin,
}: {
  feeds: FeedRow[];
  kinds: Kind[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState(kinds[0]?.kind ?? "");
  const [pending, setPending] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const selected = kinds.find((k) => k.kind === kind);

  async function onCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    try {
      const fd = new FormData(e.currentTarget);
      fd.set("kind", kind);
      await createFeed(fd);
      setAdding(false);
      router.refresh();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="kelpie-scroll-x" tabIndex={0}>
        <table className="kelpie-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Kind</th>
              <th>Indicators</th>
              <th>Last poll</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {feeds.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center text-slate-500 py-6">
                  No feeds configured.
                </td>
              </tr>
            ) : (
              feeds.map((f) => (
                <tr key={f.id}>
                  <td>{f.name}</td>
                  <td className="text-xs uppercase text-slate-400">{f.kind}</td>
                  <td>{f.indicatorCount}</td>
                  <td className="text-xs text-slate-400">
                    {f.lastPolledAt
                      ? new Date(f.lastPolledAt).toLocaleString()
                      : "never"}
                    {f.lastError ? (
                      <div className="text-red-400 mt-1 max-w-xs truncate">
                        {f.lastError}
                      </div>
                    ) : null}
                  </td>
                  <td>
                    <span
                      className={
                        "kelpie-badge " +
                        (f.lastError
                          ? "text-red-400"
                          : f.isActive
                            ? "text-green-400"
                            : "text-slate-500")
                      }
                    >
                      {f.lastError ? "halted" : f.isActive ? "active" : "off"}
                    </span>
                  </td>
                  <td className="text-right">
                    {isAdmin ? (
                      <div className="flex justify-end gap-1">
                        <button
                          className="kelpie-btn kelpie-btn-ghost text-xs"
                          disabled={busy === f.id}
                          onClick={async () => {
                            setBusy(f.id);
                            const r = await pollFeedNow(f.id);
                            setBusy(null);
                            router.refresh();
                            alert(
                              r.error
                                ? `Poll failed: ${r.error}`
                                : `Ingested ${r.ingested} indicator(s)`,
                            );
                          }}
                        >
                          Poll now
                        </button>
                        {f.lastError ? (
                          <button
                            className="kelpie-btn kelpie-btn-ghost text-xs"
                            onClick={async () => {
                              await clearFeedError(f.id);
                              router.refresh();
                            }}
                          >
                            Clear error
                          </button>
                        ) : null}
                        <button
                          className="kelpie-btn kelpie-btn-ghost text-xs"
                          onClick={async () => {
                            await setFeedActive(f.id, !f.isActive);
                            router.refresh();
                          }}
                        >
                          {f.isActive ? "Disable" : "Enable"}
                        </button>
                        <button
                          className="kelpie-btn kelpie-btn-ghost text-red-400 text-xs"
                          onClick={async () => {
                            if (!confirm(`Delete feed "${f.name}" and its indicators?`)) return;
                            await deleteFeed(f.id);
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
      </div>

      {isAdmin ? (
        adding ? (
          <form onSubmit={onCreate} className="kelpie-card p-4 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <div>
                <label className="block text-xs uppercase tracking-wider text-slate-400 mb-1">
                  Feed type
                </label>
                <select
                  className="kelpie-input"
                  value={kind}
                  onChange={(e) => setKind(e.target.value)}
                >
                  {kinds.map((k) => (
                    <option key={k.kind} value={k.kind}>
                      {k.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs uppercase tracking-wider text-slate-400 mb-1">
                  Name
                </label>
                <input name="name" className="kelpie-input" required />
              </div>
              <div>
                <label className="block text-xs uppercase tracking-wider text-slate-400 mb-1">
                  Poll interval (min)
                </label>
                <input
                  name="pollIntervalMinutes"
                  type="number"
                  className="kelpie-input"
                  defaultValue={60}
                  min={5}
                />
              </div>
            </div>
            {selected ? (
              <p className="text-xs text-slate-500">{selected.description}</p>
            ) : null}
            <div>
              <label className="block text-xs uppercase tracking-wider text-slate-400 mb-1">
                Feed URL
              </label>
              <input
                name="url"
                className="kelpie-input"
                placeholder="https://… (base URL for MISP, file URL for CSV)"
              />
            </div>
            {selected?.configFields.map((f) => (
              <div key={f.key}>
                <label className="block text-xs uppercase tracking-wider text-slate-400 mb-1">
                  {f.label}
                  {f.required ? " *" : ""}
                </label>
                <input
                  name={`config.${f.key}`}
                  type={f.type === "password" ? "password" : "text"}
                  className="kelpie-input"
                  placeholder={f.placeholder}
                  required={f.required}
                />
                {f.help ? (
                  <p className="text-xs text-slate-500 mt-1">{f.help}</p>
                ) : null}
              </div>
            ))}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="kelpie-btn kelpie-btn-ghost"
                onClick={() => setAdding(false)}
              >
                Cancel
              </button>
              <button className="kelpie-btn kelpie-btn-primary" disabled={pending}>
                {pending ? "Saving..." : "Add feed"}
              </button>
            </div>
          </form>
        ) : (
          <button
            className="kelpie-btn kelpie-btn-secondary"
            onClick={() => setAdding(true)}
          >
            Add feed
          </button>
        )
      ) : null}
    </div>
  );
}
