"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  createCaseSource,
  deleteCaseSource,
  pollCaseSourceNow,
  setCaseSourceActive,
} from "@/actions/case-sources";

type SourceRow = {
  id: string;
  name: string;
  isActive: boolean;
  pollIntervalMinutes: number;
  lastPolledAt: string | null;
  lastError: string | null;
  importedCaseCount: number;
};

export default function CaseSourceSettings({
  sources,
  isAdmin,
}: {
  sources: SourceRow[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(work: () => Promise<unknown>) {
    setPending(true);
    setError(null);
    try {
      await work();
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Request failed");
    } finally {
      setPending(false);
    }
  }

  async function onCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    await run(async () => {
      await createCaseSource(new FormData(form));
      setAdding(false);
      form.reset();
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

      {sources.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-700 p-6 text-center">
          <p className="text-sm text-slate-300">No case sources configured.</p>
          <p className="mt-1 text-xs text-slate-500">
            Add Microsoft Sentinel to import incidents as Kelpie cases.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {sources.map((source) => (
            <div
              key={source.id}
              className="rounded-lg border border-slate-800 bg-slate-950/30 p-4"
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-medium text-slate-100">{source.name}</h3>
                    <span
                      className={`kelpie-badge ${
                        source.isActive ? "text-green-400" : "text-slate-500"
                      }`}
                    >
                      {source.isActive ? "active" : "off"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    Microsoft Sentinel · every {source.pollIntervalMinutes} min ·{" "}
                    {source.importedCaseCount} cases imported
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Last checked:{" "}
                    {source.lastPolledAt
                      ? new Date(source.lastPolledAt).toLocaleString()
                      : "never"}
                  </p>
                  {source.lastError ? (
                    <p className="mt-2 break-words text-xs text-red-300">
                      {source.lastError}
                    </p>
                  ) : null}
                </div>
                {isAdmin ? (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="kelpie-btn kelpie-btn-secondary text-xs"
                      disabled={pending}
                      onClick={() => run(() => pollCaseSourceNow(source.id))}
                    >
                      Import now
                    </button>
                    <button
                      type="button"
                      className="kelpie-btn kelpie-btn-ghost text-xs"
                      disabled={pending}
                      onClick={() =>
                        run(() =>
                          setCaseSourceActive(source.id, !source.isActive),
                        )
                      }
                    >
                      {source.isActive ? "Disable" : "Enable"}
                    </button>
                    <button
                      type="button"
                      className="kelpie-btn kelpie-btn-ghost text-xs text-red-400"
                      disabled={pending}
                      onClick={() => {
                        if (!confirm(`Delete case source "${source.name}"?`)) return;
                        void run(() => deleteCaseSource(source.id));
                      }}
                    >
                      Delete
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}

      {isAdmin ? (
        adding ? (
          <form
            onSubmit={onCreate}
            className="space-y-6 rounded-lg border border-[color:var(--color-navy-800)] bg-[color:var(--color-navy-950)] p-5"
          >
            <div>
              <h3 className="font-medium text-slate-100">Add Microsoft Sentinel</h3>
              <p className="kelpie-help mt-1">
                Uses an Entra service principal with access to the selected
                Log Analytics workspace. Credentials stay server-side.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field name="name" label="Display name" required />
              <Field
                name="poll_interval_minutes"
                label="Poll interval (minutes)"
                type="number"
                defaultValue="5"
                required
              />
              <Field name="tenant_id" label="Tenant ID" required />
              <Field name="client_id" label="Client ID" required />
              <Field
                name="client_secret"
                label="Client secret"
                type="password"
                required
              />
              <Field name="subscription_id" label="Subscription ID" required />
              <Field name="resource_group" label="Resource group" required />
              <Field name="workspace_name" label="Workspace name" required />
            </div>
            <label className="flex items-start gap-3 text-sm text-slate-300">
              <input
                type="checkbox"
                name="include_closed"
                className="mt-0.5 h-4 w-4 rounded border-slate-600"
              />
              <span>
                Import closed incidents
                <span className="block text-xs text-slate-500">
                  Leave off to import active work only.
                </span>
              </span>
            </label>
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
                disabled={pending}
              >
                {pending ? "Saving..." : "Add case source"}
              </button>
            </div>
          </form>
        ) : (
          <button
            className="kelpie-btn kelpie-btn-secondary"
            onClick={() => setAdding(true)}
          >
            Add Microsoft Sentinel
          </button>
        )
      ) : null}
    </div>
  );
}

function Field({
  name,
  label,
  type = "text",
  defaultValue,
  required,
}: {
  name: string;
  label: string;
  type?: string;
  defaultValue?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="kelpie-label">
        {label}
      </span>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        required={required}
        className="kelpie-input"
      />
    </label>
  );
}
