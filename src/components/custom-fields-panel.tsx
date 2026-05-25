"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setCaseCustomField } from "@/actions/custom-fields";

type Field = {
  id: string;
  key: string;
  label: string;
  type: string;
  options: string[];
  required: boolean;
  value: unknown;
};

function toInputValue(field: Field): string {
  if (field.value == null) return "";
  if (Array.isArray(field.value)) return (field.value as unknown[]).join(", ");
  if (field.type === "bool") return field.value ? "true" : "false";
  return String(field.value);
}

export default function CustomFieldsPanel({
  caseId,
  fields,
  canEdit,
}: {
  caseId: string;
  fields: Field[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState<string | null>(null);

  if (fields.length === 0) return null;

  async function save(field: Field, value: string) {
    setSaving(field.id);
    try {
      await setCaseCustomField(caseId, field.id, value);
      router.refresh();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="kelpie-card p-5">
      <h2 className="text-sm font-medium text-slate-300 mb-3">Custom fields</h2>
      <div className="space-y-3">
        {fields.map((f) => (
          <div
            key={f.id}
            className="grid grid-cols-1 gap-1 sm:grid-cols-3 sm:items-center sm:gap-3"
          >
            <label className="text-xs uppercase tracking-wider text-slate-400">
              {f.label}
              {f.required ? " *" : ""}
            </label>
            <div className="sm:col-span-2">
              {!canEdit ? (
                <span className="text-sm text-slate-200">
                  {toInputValue(f) || <span className="text-slate-500">—</span>}
                </span>
              ) : f.type === "bool" ? (
                <select
                  className="kelpie-input"
                  defaultValue={toInputValue(f)}
                  disabled={saving === f.id}
                  onChange={(e) => save(f, e.target.value)}
                >
                  <option value="">—</option>
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              ) : f.type === "select" ? (
                <select
                  className="kelpie-input"
                  defaultValue={toInputValue(f)}
                  disabled={saving === f.id}
                  onChange={(e) => save(f, e.target.value)}
                >
                  <option value="">—</option>
                  {f.options.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              ) : (
                <EditableInput
                  field={f}
                  disabled={saving === f.id}
                  onSave={(v) => save(f, v)}
                />
              )}
              {f.type === "multi_select" ? (
                <p className="mt-1 text-xs text-slate-500">
                  Comma separated. Options: {f.options.join(", ")}
                </p>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function EditableInput({
  field,
  disabled,
  onSave,
}: {
  field: Field;
  disabled: boolean;
  onSave: (value: string) => void;
}) {
  const [value, setValue] = useState(
    field.value == null
      ? ""
      : Array.isArray(field.value)
        ? (field.value as unknown[]).join(", ")
        : String(field.value),
  );
  return (
    <input
      className="kelpie-input"
      type={field.type === "date" ? "date" : field.type === "number" ? "number" : "text"}
      value={value}
      disabled={disabled}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onSave(value)}
    />
  );
}
