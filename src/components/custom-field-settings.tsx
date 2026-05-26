"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  createFieldDefinition,
  deleteFieldDefinition,
  reorderField,
  setFieldActive,
} from "@/actions/custom-fields";

type FieldDef = {
  id: string;
  key: string;
  label: string;
  type: string;
  options: string[];
  required: boolean;
  isActive: boolean;
};

const TYPES = [
  { value: "string", label: "Text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "select", label: "Select (one)" },
  { value: "multi_select", label: "Select (many)" },
  { value: "bool", label: "Yes / No" },
];

export default function CustomFieldSettings({
  fields,
  isAdmin,
}: {
  fields: FieldDef[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [type, setType] = useState("string");
  const [pending, setPending] = useState(false);
  const needsOptions = type === "select" || type === "multi_select";

  async function onCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    try {
      const fd = new FormData(e.currentTarget);
      fd.set("type", type);
      await createFieldDefinition(fd);
      setAdding(false);
      setType("string");
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
              <th>Label</th>
              <th>Key</th>
              <th>Type</th>
              <th>Required</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {fields.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center text-slate-500 py-6">
                  No custom fields defined.
                </td>
              </tr>
            ) : (
              fields.map((f, i) => (
                <tr key={f.id}>
                  <td>{f.label}</td>
                  <td className="font-mono text-xs text-slate-400">{f.key}</td>
                  <td className="text-xs text-slate-400">
                    {TYPES.find((t) => t.value === f.type)?.label ?? f.type}
                    {f.options.length > 0 ? (
                      <span className="text-slate-500"> ({f.options.join(", ")})</span>
                    ) : null}
                  </td>
                  <td>{f.required ? "yes" : "no"}</td>
                  <td>
                    <span
                      className={
                        "kelpie-badge " +
                        (f.isActive ? "text-green-400" : "text-slate-500")
                      }
                    >
                      {f.isActive ? "active" : "off"}
                    </span>
                  </td>
                  <td className="text-right">
                    {isAdmin ? (
                      <div className="flex justify-end gap-1">
                        <button
                          className="kelpie-btn kelpie-btn-ghost text-xs"
                          disabled={i === 0}
                          onClick={async () => {
                            await reorderField(f.id, "up");
                            router.refresh();
                          }}
                        >
                          ↑
                        </button>
                        <button
                          className="kelpie-btn kelpie-btn-ghost text-xs"
                          disabled={i === fields.length - 1}
                          onClick={async () => {
                            await reorderField(f.id, "down");
                            router.refresh();
                          }}
                        >
                          ↓
                        </button>
                        <button
                          className="kelpie-btn kelpie-btn-ghost text-xs"
                          onClick={async () => {
                            await setFieldActive(f.id, !f.isActive);
                            router.refresh();
                          }}
                        >
                          {f.isActive ? "Deactivate" : "Activate"}
                        </button>
                        <button
                          className="kelpie-btn kelpie-btn-ghost text-red-400 text-xs"
                          onClick={async () => {
                            if (!confirm(`Delete field "${f.label}" and all its values?`)) return;
                            await deleteFieldDefinition(f.id);
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
                  Label
                </label>
                <input name="label" className="kelpie-input" required />
              </div>
              <div>
                <label className="block text-xs uppercase tracking-wider text-slate-400 mb-1">
                  Key (optional)
                </label>
                <input
                  name="key"
                  className="kelpie-input"
                  placeholder="auto from label"
                />
              </div>
              <div>
                <label className="block text-xs uppercase tracking-wider text-slate-400 mb-1">
                  Type
                </label>
                <select
                  className="kelpie-input"
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                >
                  {TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {needsOptions ? (
              <div>
                <label className="block text-xs uppercase tracking-wider text-slate-400 mb-1">
                  Options (one per line or comma separated)
                </label>
                <textarea name="options" className="kelpie-input" rows={3} />
              </div>
            ) : null}
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" name="required" className="kelpie-checkbox" />
              Required
            </label>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="kelpie-btn kelpie-btn-ghost"
                onClick={() => setAdding(false)}
              >
                Cancel
              </button>
              <button className="kelpie-btn kelpie-btn-primary" disabled={pending}>
                {pending ? "Saving..." : "Add field"}
              </button>
            </div>
          </form>
        ) : (
          <button
            className="kelpie-btn kelpie-btn-secondary"
            onClick={() => setAdding(true)}
          >
            Add custom field
          </button>
        )
      ) : null}
    </div>
  );
}
