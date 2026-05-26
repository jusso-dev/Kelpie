"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  createResponseAction,
  deleteResponseAction,
  setResponseActionActive,
} from "@/actions/response-actions";

type ConfigField = {
  key: string;
  label: string;
  type: "string" | "password" | "select" | "textarea";
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

type ActionRow = {
  id: string;
  kind: string;
  name: string;
  isActive: boolean;
};

export default function ResponseActionSettings({
  actions,
  kinds,
  isAdmin,
}: {
  actions: ActionRow[];
  kinds: Kind[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState(kinds[0]?.kind ?? "");
  const [pending, setPending] = useState(false);
  const selected = kinds.find((k) => k.kind === kind);

  async function onCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    try {
      const fd = new FormData(e.currentTarget);
      fd.set("kind", kind);
      await createResponseAction(fd);
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
              <th>Action</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {actions.length === 0 ? (
              <tr>
                <td colSpan={4} className="text-center text-slate-500 py-6">
                  No response actions configured.
                </td>
              </tr>
            ) : (
              actions.map((a) => (
                <tr key={a.id}>
                  <td>{a.name}</td>
                  <td className="text-xs text-slate-400">
                    {kinds.find((k) => k.kind === a.kind)?.label ?? a.kind}
                  </td>
                  <td>
                    <span
                      className={
                        "kelpie-badge " +
                        (a.isActive ? "text-green-400" : "text-slate-500")
                      }
                    >
                      {a.isActive ? "active" : "off"}
                    </span>
                  </td>
                  <td className="text-right">
                    {isAdmin ? (
                      <div className="flex justify-end gap-1">
                        <button
                          className="kelpie-btn kelpie-btn-ghost text-xs"
                          onClick={async () => {
                            await setResponseActionActive(a.id, !a.isActive);
                            router.refresh();
                          }}
                        >
                          {a.isActive ? "Disable" : "Enable"}
                        </button>
                        <button
                          className="kelpie-btn kelpie-btn-ghost text-red-400 text-xs"
                          onClick={async () => {
                            if (!confirm(`Delete action "${a.name}"?`)) return;
                            await deleteResponseAction(a.id);
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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <div>
                <label className="block text-xs uppercase tracking-wider text-slate-400 mb-1">
                  Action type
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
            </div>
            {selected ? (
              <p className="text-xs text-slate-500">{selected.description}</p>
            ) : null}
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
                {pending ? "Saving..." : "Add action"}
              </button>
            </div>
          </form>
        ) : (
          <button
            className="kelpie-btn kelpie-btn-secondary"
            onClick={() => setAdding(true)}
          >
            Add response action
          </button>
        )
      ) : null}
    </div>
  );
}
