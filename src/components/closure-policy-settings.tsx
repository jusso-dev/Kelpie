"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  createClosurePolicy,
  setClosurePolicyActive,
  updateClosurePolicy,
} from "@/actions/closure-policies";
import { CLOSURE_REQUIREMENT_TYPES } from "@/lib/closure/types";
import { feedbackError } from "@/components/confirm-dialog";

type Policy = {
  id: string;
  name: string;
  description: string | null;
  templateId: string | null;
  isDefault: boolean;
  isActive: boolean;
  currentVersion: number;
  requirements: Array<{ type: string }>;
  requireTwoPersonOverride: boolean;
};

const LABELS: Record<string, string> = {
  required_tasks_complete: "Required tasks complete",
  required_custom_fields: "Required custom fields",
  alerts_dispositioned: "Alerts dispositioned",
  evidence_verdicts: "Evidence verdicts",
  containment_recorded: "Containment recorded",
  eradication_recorded: "Eradication recorded",
  recovery_recorded: "Recovery recorded",
  disposition: "Disposition + conclusion",
  root_cause_and_conclusion: "Root cause + conclusion",
  business_impact_and_lessons: "Business impact + lessons",
  required_approver: "Required approver",
  response_actions_resolved: "Response actions resolved",
  related_high_severity_reviewed: "Related high-severity reviewed",
  post_incident_review: "Post-incident review",
};

export default function ClosurePolicySettings({
  policies,
  templates,
}: {
  policies: Policy[];
  templates: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [isDefault, setIsDefault] = useState(true);
  const [twoPerson, setTwoPerson] = useState(false);
  const [selected, setSelected] = useState<string[]>(["disposition"]);
  const [editingId, setEditingId] = useState<string | null>(null);

  function toggleType(type: string) {
    setSelected((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
    );
  }

  function loadForEdit(policy: Policy) {
    setEditingId(policy.id);
    setName(policy.name);
    setDescription(policy.description ?? "");
    setTemplateId(policy.templateId ?? "");
    setIsDefault(policy.isDefault);
    setTwoPerson(policy.requireTwoPersonOverride);
    setSelected(policy.requirements.map((r) => r.type));
  }

  function resetForm() {
    setEditingId(null);
    setName("");
    setDescription("");
    setTemplateId("");
    setIsDefault(true);
    setTwoPerson(false);
    setSelected(["disposition"]);
  }

  function submit() {
    start(async () => {
      try {
        const fd = new FormData();
        if (editingId) fd.set("policyId", editingId);
        fd.set("name", name);
        fd.set("description", description);
        if (templateId) fd.set("templateId", templateId);
        if (isDefault && !templateId) fd.set("isDefault", "true");
        if (twoPerson) fd.set("requireTwoPersonOverride", "true");
        fd.set(
          "requirements",
          JSON.stringify(selected.map((type) => ({ type }))),
        );
        if (editingId) {
          await updateClosurePolicy(fd);
          toast.success("Closure policy versioned", {
            description: "A new immutable version was created. Historical closes keep their prior version.",
          });
        } else {
          await createClosurePolicy(fd);
          toast.success("Closure policy created");
        }
        resetForm();
        router.refresh();
      } catch (error) {
        toast.error("Policy could not be saved", {
          description: feedbackError(error, "Check the form and try again."),
        });
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="kelpie-card space-y-4 p-5">
        <div>
          <h2 className="text-sm font-medium text-slate-200">
            {editingId ? "Edit policy (new version)" : "New closure policy"}
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Edits always create a new version. Closed cases keep the version
            they were evaluated against.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="kelpie-field">
            <label className="kelpie-label" htmlFor="ccp-name">
              Name
            </label>
            <input
              id="ccp-name"
              className="kelpie-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="kelpie-field">
            <label className="kelpie-label" htmlFor="ccp-template">
              Template scope
            </label>
            <select
              id="ccp-template"
              className="kelpie-input"
              value={templateId}
              disabled={Boolean(editingId)}
              onChange={(e) => {
                setTemplateId(e.target.value);
                if (e.target.value) setIsDefault(false);
              }}
            >
              <option value="">Organisation default</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="kelpie-field">
          <label className="kelpie-label" htmlFor="ccp-desc">
            Description
          </label>
          <textarea
            id="ccp-desc"
            className="kelpie-input"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <fieldset>
          <legend className="kelpie-label mb-2">Requirements</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {CLOSURE_REQUIREMENT_TYPES.map((type) => (
              <label
                key={type}
                className="flex items-center gap-2 text-sm text-slate-300"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(type)}
                  onChange={() => toggleType(type)}
                />
                {LABELS[type] ?? type}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex flex-wrap gap-4 text-sm text-slate-300">
          {!templateId ? (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={isDefault}
                onChange={(e) => setIsDefault(e.target.checked)}
              />
              Organisation default
            </label>
          ) : null}
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={twoPerson}
              onChange={(e) => setTwoPerson(e.target.checked)}
            />
            Two-person override approval
          </label>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="kelpie-btn kelpie-btn-primary"
            disabled={pending || !name.trim()}
            onClick={() => submit()}
          >
            {editingId ? "Save new version" : "Create policy"}
          </button>
          {editingId ? (
            <button
              type="button"
              className="kelpie-btn kelpie-btn-ghost"
              onClick={() => resetForm()}
            >
              Cancel
            </button>
          ) : null}
        </div>
      </div>

      <div className="kelpie-card overflow-x-auto p-0">
        <table className="kelpie-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Scope</th>
              <th>Version</th>
              <th>Requirements</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {policies.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-sm text-slate-500">
                  No policies yet. Built-in default requires disposition +
                  conclusion only.
                </td>
              </tr>
            ) : (
              policies.map((p) => (
                <tr key={p.id}>
                  <td>
                    <div className="font-medium text-slate-200">{p.name}</div>
                    {p.description ? (
                      <div className="text-xs text-slate-500">{p.description}</div>
                    ) : null}
                  </td>
                  <td className="text-xs text-slate-400">
                    {p.templateId
                      ? templates.find((t) => t.id === p.templateId)?.name ??
                        "Template"
                      : p.isDefault
                        ? "Org default"
                        : "Org"}
                  </td>
                  <td className="text-xs">v{p.currentVersion}</td>
                  <td className="text-xs text-slate-400">
                    {p.requirements.map((r) => LABELS[r.type] ?? r.type).join(", ") ||
                      "—"}
                    {p.requireTwoPersonOverride ? (
                      <span className="ml-1 text-amber-400">· 2-person override</span>
                    ) : null}
                  </td>
                  <td className="text-xs">
                    {p.isActive ? (
                      <span className="text-emerald-400">active</span>
                    ) : (
                      <span className="text-slate-500">inactive</span>
                    )}
                  </td>
                  <td className="space-x-2 text-right">
                    <button
                      type="button"
                      className="kelpie-btn kelpie-btn-ghost text-xs"
                      onClick={() => loadForEdit(p)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="kelpie-btn kelpie-btn-ghost text-xs"
                      disabled={pending}
                      onClick={() =>
                        start(async () => {
                          const fd = new FormData();
                          fd.set("policyId", p.id);
                          fd.set("isActive", p.isActive ? "false" : "true");
                          await setClosurePolicyActive(fd);
                          router.refresh();
                        })
                      }
                    >
                      {p.isActive ? "Disable" : "Enable"}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
