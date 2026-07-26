"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  clearFeedError,
  createFeed,
  deleteFeed,
  importStarterFeeds,
  pollFeedNow,
  setFeedActive,
  updateFeed,
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
  config: Record<string, string>;
};

export default function TiFeedSettings({
  feeds,
  kinds,
  canManage,
}: {
  feeds: FeedRow[];
  kinds: Kind[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [kind, setKind] = useState(kinds[0]?.kind ?? "");
  const [pending, setPending] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const selected = kinds.find((item) => item.kind === kind);
  const editingFeed = feeds.find((feed) => feed.id === editingId) ?? null;

  function startAdding() {
    setEditingId(null);
    setKind(kinds[0]?.kind ?? "");
    setAdding(true);
  }

  function startEditing(feed: FeedRow) {
    setAdding(false);
    setEditingId(feed.id);
    setKind(feed.kind);
  }

  function cancelForm() {
    setAdding(false);
    setEditingId(null);
  }

  async function onSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    try {
      const formData = new FormData(event.currentTarget);
      formData.set("kind", kind);
      if (editingFeed) await updateFeed(editingFeed.id, formData);
      else await createFeed(formData);
      cancelForm();
      router.refresh();
    } catch (error) {
      alert((error as Error).message);
    } finally {
      setPending(false);
    }
  }

  async function run(feedId: string, action: () => Promise<void>) {
    setBusy(feedId);
    try {
      await action();
      router.refresh();
    } catch (error) {
      alert((error as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      {feeds.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[color:var(--color-navy-600)] p-6 text-center">
          <h3 className="text-sm font-medium text-slate-200">
            No feeds configured
          </h3>
          <p className="mx-auto mt-1 max-w-xl text-xs leading-5 text-slate-500">
            Start empty, add one manually, or import the seven public OSINT
            sources used by Tawny SOC. Imported feeds remain fully editable.
          </p>
          {canManage ? (
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <button
                className="kelpie-btn kelpie-btn-primary"
                disabled={busy === "starter"}
                onClick={() =>
                  run("starter", async () => {
                    const result = await importStarterFeeds();
                    alert(`Imported ${result.imported} starter feed(s).`);
                  })
                }
              >
                {busy === "starter" ? "Importing…" : "Load starter feeds"}
              </button>
              <button
                className="kelpie-btn kelpie-btn-secondary"
                onClick={startAdding}
              >
                Add manually
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="divide-y divide-[color:var(--color-navy-700)] rounded-lg border border-[color:var(--color-navy-700)]">
          {feeds.map((feed) => (
            <article
              key={feed.id}
              className="grid gap-4 p-4 lg:grid-cols-[minmax(14rem,1.5fr)_minmax(8rem,.65fr)_minmax(9rem,.75fr)_auto] lg:items-center"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="truncate text-sm font-medium text-slate-100">
                    {feed.name}
                  </h3>
                  <span
                    className={
                      "kelpie-badge " +
                      (feed.lastError
                        ? "text-red-400"
                        : feed.isActive
                          ? "text-green-400"
                          : "text-slate-500")
                    }
                  >
                    {feed.lastError
                      ? "halted"
                      : feed.isActive
                        ? "active"
                        : "off"}
                  </span>
                </div>
                <p className="mt-1 truncate text-xs text-slate-500">
                  {feed.url ?? "No URL"}
                </p>
                {feed.lastError ? (
                  <p className="mt-1 text-xs text-red-400">{feed.lastError}</p>
                ) : null}
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-slate-500">
                  Type
                </p>
                <p className="mt-1 text-xs uppercase text-slate-300">
                  {feed.kind.replaceAll("_", " ")}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-slate-500">
                  Indicators · last poll
                </p>
                <p className="mt-1 text-xs text-slate-300">
                  {feed.indicatorCount.toLocaleString()} ·{" "}
                  {feed.lastPolledAt
                    ? new Date(feed.lastPolledAt).toLocaleString()
                    : "never"}
                </p>
              </div>
              {canManage ? (
                <details className="relative justify-self-start lg:justify-self-end">
                  <summary className="kelpie-btn kelpie-btn-secondary cursor-pointer list-none text-xs">
                    Manage
                  </summary>
                  <div className="z-20 mt-2 grid min-w-44 gap-1 rounded border border-[color:var(--color-navy-600)] bg-[color:var(--color-navy-800)] p-2 shadow-xl lg:absolute lg:right-0">
                    <button
                      className="kelpie-btn kelpie-btn-ghost justify-start text-xs"
                      onClick={() => startEditing(feed)}
                    >
                      Edit feed
                    </button>
                    <button
                      className="kelpie-btn kelpie-btn-ghost justify-start text-xs"
                      disabled={busy === feed.id}
                      onClick={() =>
                        run(feed.id, async () => {
                          const result = await pollFeedNow(feed.id);
                          alert(
                            result.error
                              ? `Poll failed: ${result.error}`
                              : `Ingested ${result.ingested} indicator(s)`,
                          );
                        })
                      }
                    >
                      Poll now
                    </button>
                    {feed.lastError ? (
                      <button
                        className="kelpie-btn kelpie-btn-ghost justify-start text-xs"
                        onClick={() =>
                          run(feed.id, () => clearFeedError(feed.id))
                        }
                      >
                        Clear error
                      </button>
                    ) : null}
                    <button
                      className="kelpie-btn kelpie-btn-ghost justify-start text-xs"
                      onClick={() =>
                        run(feed.id, () =>
                          setFeedActive(feed.id, !feed.isActive),
                        )
                      }
                    >
                      {feed.isActive ? "Disable" : "Enable"}
                    </button>
                    <button
                      className="kelpie-btn kelpie-btn-ghost justify-start text-xs text-red-400"
                      onClick={() => {
                        if (
                          confirm(
                            `Delete feed "${feed.name}" and its indicators?`,
                          )
                        ) {
                          void run(feed.id, () => deleteFeed(feed.id));
                        }
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </details>
              ) : null}
            </article>
          ))}
        </div>
      )}

      {canManage && feeds.length > 0 && !adding && !editingFeed ? (
        <div className="flex flex-wrap gap-2">
          <button
            className="kelpie-btn kelpie-btn-secondary"
            onClick={startAdding}
          >
            Add feed
          </button>
          <button
            className="kelpie-btn kelpie-btn-ghost"
            disabled={busy === "starter"}
            onClick={() =>
              run("starter", async () => {
                const result = await importStarterFeeds();
                alert(
                  result.imported
                    ? `Imported ${result.imported} missing starter feed(s).`
                    : "All starter feeds are already configured.",
                );
              })
            }
          >
            Add missing starter feeds
          </button>
        </div>
      ) : null}

      {canManage && (adding || editingFeed) ? (
        <form
          key={editingFeed?.id ?? "new"}
          onSubmit={onSave}
          className="kelpie-card space-y-4 p-5"
        >
          <div>
            <h3 className="text-sm font-medium text-slate-200">
              {editingFeed ? `Edit ${editingFeed.name}` : "Add feed"}
            </h3>
            {selected ? (
              <p className="mt-1 text-xs text-slate-500">
                {selected.description}
              </p>
            ) : null}
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <Field label="Feed type">
              <select
                className="kelpie-input"
                value={kind}
                onChange={(event) => setKind(event.target.value)}
              >
                {kinds.map((item) => (
                  <option key={item.kind} value={item.kind}>
                    {item.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Name">
              <input
                name="name"
                className="kelpie-input"
                defaultValue={editingFeed?.name}
                required
              />
            </Field>
            <Field label="Poll interval (minutes)">
              <input
                name="pollIntervalMinutes"
                type="number"
                className="kelpie-input"
                defaultValue={editingFeed?.pollIntervalMinutes ?? 60}
                min={5}
              />
            </Field>
          </div>
          <Field label="Feed URL">
            <input
              name="url"
              type="url"
              className="kelpie-input"
              defaultValue={editingFeed?.url ?? ""}
              placeholder="https://…"
            />
          </Field>
          {selected?.configFields.map((field) => (
            <Field key={field.key} label={`${field.label}${field.required ? " *" : ""}`}>
              <input
                name={`config.${field.key}`}
                type={field.type === "password" ? "password" : "text"}
                className="kelpie-input"
                placeholder={
                  editingFeed && field.type === "password"
                    ? "Leave blank to keep the current value"
                    : field.placeholder
                }
                defaultValue={
                  field.type === "password"
                    ? ""
                    : editingFeed?.config[field.key] ?? ""
                }
                required={field.required && !editingFeed}
              />
              {field.help ? (
                <p className="mt-1 text-xs text-slate-500">{field.help}</p>
              ) : null}
            </Field>
          ))}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="kelpie-btn kelpie-btn-ghost"
              onClick={cancelForm}
            >
              Cancel
            </button>
            <button
              className="kelpie-btn kelpie-btn-primary"
              disabled={pending}
            >
              {pending
                ? "Saving…"
                : editingFeed
                  ? "Save changes"
                  : "Add feed"}
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
    <label className="block">
      <span className="mb-1 block text-xs uppercase tracking-wider text-slate-400">
        {label}
      </span>
      {children}
    </label>
  );
}
