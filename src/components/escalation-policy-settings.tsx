"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  createEscalationPolicy,
  setEscalationPolicyActive,
  testEscalationPolicy,
  updateEscalationPolicy,
} from "@/actions/escalation-policies";
import { feedbackError } from "@/components/confirm-dialog";
import type { EscalationPolicyInput, NotifyTarget } from "@/lib/escalation-core";

const SEVERITIES = ["low", "medium", "high", "critical"] as const;
const NOTIFY_TARGETS: NotifyTarget[] = ["assignee", "queue_members", "watchers"];

type Policy = {
  id: string;
  name: string;
  description: string | null;
  revision: number;
  isActive: boolean;
  queueId: string | null;
  conditions: {
    minAgeMinutes?: number;
    minUnacknowledgedMinutes?: number;
    severities?: string[];
    waitingReason?: "third_party" | "approval";
  };
  notifyEnabled: boolean;
  notifyTargets: string[];
  reassignEnabled: boolean;
  reassignToQueueId: string | null;
  reassignToUserId: string | null;
  raiseSeverityEnabled: boolean;
  raiseSeverityTo: string | null;
};
type QueueOption = { id: string; name: string; teamName: string };
type UserOption = { id: string; name: string };

const EMPTY_FORM: EscalationPolicyInput = {
  name: "",
  description: "",
  queueId: null,
  conditions: {},
  notifyEnabled: false,
  notifyTargets: ["assignee"],
  reassignEnabled: false,
  reassignToQueueId: null,
  reassignToUserId: null,
  raiseSeverityEnabled: false,
  raiseSeverityTo: null,
};

export function EscalationPolicySettings({
  policies,
  queues,
  users,
}: {
  policies: Policy[];
  queues: QueueOption[];
  users: UserOption[];
}) {
  const [pending, start] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<EscalationPolicyInput>(EMPTY_FORM);
  const [testCaseId, setTestCaseId] = useState<Record<string, string>>({});
  const [testResult, setTestResult] = useState<Record<string, string>>({});
  const router = useRouter();

  function loadForEdit(policy: Policy) {
    setEditingId(policy.id);
    setForm({
      name: policy.name,
      description: policy.description ?? "",
      queueId: policy.queueId,
      conditions: policy.conditions as EscalationPolicyInput["conditions"],
      notifyEnabled: policy.notifyEnabled,
      notifyTargets: (policy.notifyTargets as NotifyTarget[]) ?? [],
      reassignEnabled: policy.reassignEnabled,
      reassignToQueueId: policy.reassignToQueueId,
      reassignToUserId: policy.reassignToUserId,
      raiseSeverityEnabled: policy.raiseSeverityEnabled,
      raiseSeverityTo: (policy.raiseSeverityTo as EscalationPolicyInput["raiseSeverityTo"]) ?? null,
    });
  }

  function resetForm() {
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  function handleSubmit() {
    start(async () => {
      const result = editingId
        ? await updateEscalationPolicy(editingId, form)
        : await createEscalationPolicy(form);
      if (!result.ok) {
        toast.error("Could not save policy", { description: feedbackError(result.error, "") });
        return;
      }
      toast.success(editingId ? "Policy updated (new revision)" : "Policy created (disabled)");
      resetForm();
      router.refresh();
    });
  }

  function handleToggleActive(policyId: string, isActive: boolean) {
    start(async () => {
      await setEscalationPolicyActive(policyId, isActive);
      router.refresh();
    });
  }

  function handleTest(policyId: string) {
    const caseId = testCaseId[policyId]?.trim();
    if (!caseId) return;
    start(async () => {
      try {
        const result = await testEscalationPolicy(policyId, caseId);
        setTestResult((s) => ({
          ...s,
          [policyId]: result.matches
            ? `Would trigger: ${result.reasons.join("; ")}`
            : `Would not trigger: ${result.reasons.join("; ")}`,
        }));
      } catch (error) {
        setTestResult((s) => ({ ...s, [policyId]: feedbackError(error, "Test failed") }));
      }
    });
  }

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        {policies.length === 0 ? (
          <p className="text-sm text-slate-500">No escalation policies yet.</p>
        ) : (
          policies.map((policy) => (
            <div key={policy.id} className="kelpie-card space-y-2 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-medium text-slate-200">{policy.name}</h3>
                  <p className="text-xs text-slate-500">
                    Revision {policy.revision} ·{" "}
                    {policy.isActive ? (
                      <span className="text-green-400">active</span>
                    ) : (
                      <span className="text-slate-500">disabled</span>
                    )}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="kelpie-btn kelpie-btn-secondary text-xs"
                    disabled={pending}
                    onClick={() => loadForEdit(policy)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="kelpie-btn kelpie-btn-secondary text-xs"
                    disabled={pending}
                    onClick={() => handleToggleActive(policy.id, !policy.isActive)}
                  >
                    {policy.isActive ? "Disable" : "Enable"}
                  </button>
                </div>
              </div>
              <p className="text-xs text-slate-400">
                {[
                  policy.notifyEnabled ? `Notify: ${policy.notifyTargets.join(", ")}` : null,
                  policy.reassignEnabled ? "Reassign" : null,
                  policy.raiseSeverityEnabled ? `Raise severity to ${policy.raiseSeverityTo}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <div className="flex flex-wrap items-center gap-2 border-t border-[color:var(--color-navy-700)] pt-2">
                <input
                  className="kelpie-input"
                  placeholder="Case id to test"
                  value={testCaseId[policy.id] ?? ""}
                  onChange={(event) =>
                    setTestCaseId((s) => ({ ...s, [policy.id]: event.target.value }))
                  }
                />
                <button
                  type="button"
                  className="kelpie-btn kelpie-btn-ghost text-xs"
                  disabled={pending}
                  onClick={() => handleTest(policy.id)}
                >
                  Test (dry run, no changes applied)
                </button>
              </div>
              {testResult[policy.id] ? (
                <p className="text-xs text-[color:var(--color-tan-300)]">{testResult[policy.id]}</p>
              ) : null}
            </div>
          ))
        )}
      </div>

      <div className="kelpie-panel space-y-3 p-5">
        <h2 className="text-sm font-medium text-slate-300">
          {editingId ? "Edit policy (saving creates a new revision)" : "New escalation policy"}
        </h2>
        <label className="block text-xs font-medium text-slate-300">
          Name
          <input
            className="kelpie-input mt-1"
            value={form.name}
            onChange={(event) => setForm((f) => ({ ...f, name: event.target.value }))}
          />
        </label>
        <label className="block text-xs font-medium text-slate-300">
          Description
          <input
            className="kelpie-input mt-1"
            value={form.description ?? ""}
            onChange={(event) => setForm((f) => ({ ...f, description: event.target.value }))}
          />
        </label>
        <label className="block text-xs font-medium text-slate-300">
          Scope to queue
          <select
            className="kelpie-input mt-1"
            value={form.queueId ?? ""}
            onChange={(event) => setForm((f) => ({ ...f, queueId: event.target.value || null }))}
          >
            <option value="">Organisation-wide</option>
            {queues.map((q) => (
              <option key={q.id} value={q.id}>{q.teamName} / {q.name}</option>
            ))}
          </select>
        </label>

        <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <legend className="text-xs uppercase tracking-wider text-slate-400">Conditions</legend>
          <label className="text-xs font-medium text-slate-300">
            Minimum age (minutes)
            <input
              type="number"
              min={0}
              className="kelpie-input mt-1"
              value={form.conditions.minAgeMinutes ?? ""}
              onChange={(event) =>
                setForm((f) => ({
                  ...f,
                  conditions: {
                    ...f.conditions,
                    minAgeMinutes: event.target.value ? Number(event.target.value) : undefined,
                  },
                }))
              }
            />
          </label>
          <label className="text-xs font-medium text-slate-300">
            Minimum unacknowledged (minutes)
            <input
              type="number"
              min={0}
              className="kelpie-input mt-1"
              value={form.conditions.minUnacknowledgedMinutes ?? ""}
              onChange={(event) =>
                setForm((f) => ({
                  ...f,
                  conditions: {
                    ...f.conditions,
                    minUnacknowledgedMinutes: event.target.value
                      ? Number(event.target.value)
                      : undefined,
                  },
                }))
              }
            />
          </label>
          <label className="text-xs font-medium text-slate-300 sm:col-span-2">
            Severities (leave none selected for any severity)
            <select
              multiple
              className="kelpie-input mt-1"
              value={form.conditions.severities ?? []}
              onChange={(event) =>
                setForm((f) => ({
                  ...f,
                  conditions: {
                    ...f.conditions,
                    severities: Array.from(event.target.selectedOptions).map((o) => o.value) as never,
                  },
                }))
              }
            >
              {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="text-xs font-medium text-slate-300">
            Waiting on
            <select
              className="kelpie-input mt-1"
              value={form.conditions.waitingReason ?? ""}
              onChange={(event) =>
                setForm((f) => ({
                  ...f,
                  conditions: {
                    ...f.conditions,
                    waitingReason: (event.target.value || undefined) as never,
                  },
                }))
              }
            >
              <option value="">Any</option>
              <option value="third_party">Third party</option>
              <option value="approval">Approval</option>
            </select>
          </label>
        </fieldset>

        <fieldset className="space-y-2 border-t border-[color:var(--color-navy-700)] pt-3">
          <legend className="text-xs uppercase tracking-wider text-slate-400">Actions</legend>
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={form.notifyEnabled}
              onChange={(event) => setForm((f) => ({ ...f, notifyEnabled: event.target.checked }))}
            />
            Notify
          </label>
          {form.notifyEnabled ? (
            <div className="ml-6 flex flex-wrap gap-3">
              {NOTIFY_TARGETS.map((target) => (
                <label key={target} className="flex items-center gap-2 text-xs text-slate-300">
                  <input
                    type="checkbox"
                    checked={form.notifyTargets.includes(target)}
                    onChange={(event) =>
                      setForm((f) => ({
                        ...f,
                        notifyTargets: event.target.checked
                          ? [...f.notifyTargets, target]
                          : f.notifyTargets.filter((t) => t !== target),
                      }))
                    }
                  />
                  {target.replace("_", " ")}
                </label>
              ))}
            </div>
          ) : null}

          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={form.reassignEnabled}
              onChange={(event) => setForm((f) => ({ ...f, reassignEnabled: event.target.checked }))}
            />
            Reassign
          </label>
          {form.reassignEnabled ? (
            <div className="ml-6 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <select
                className="kelpie-input"
                value={form.reassignToQueueId ?? ""}
                onChange={(event) =>
                  setForm((f) => ({ ...f, reassignToQueueId: event.target.value || null }))
                }
              >
                <option value="">No queue reassignment</option>
                {queues.map((q) => (
                  <option key={q.id} value={q.id}>{q.teamName} / {q.name}</option>
                ))}
              </select>
              <select
                className="kelpie-input"
                value={form.reassignToUserId ?? ""}
                onChange={(event) =>
                  setForm((f) => ({ ...f, reassignToUserId: event.target.value || null }))
                }
              >
                <option value="">No analyst reassignment</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </div>
          ) : null}

          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={form.raiseSeverityEnabled}
              onChange={(event) =>
                setForm((f) => ({ ...f, raiseSeverityEnabled: event.target.checked }))
              }
            />
            Raise severity
          </label>
          {form.raiseSeverityEnabled ? (
            <select
              className="ml-6 kelpie-input w-40"
              value={form.raiseSeverityTo ?? ""}
              onChange={(event) =>
                setForm((f) => ({
                  ...f,
                  raiseSeverityTo: (event.target.value || null) as EscalationPolicyInput["raiseSeverityTo"],
                }))
              }
            >
              <option value="">Select severity</option>
              {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          ) : null}
        </fieldset>

        <div className="flex gap-2">
          <button
            type="button"
            className="kelpie-btn kelpie-btn-primary"
            disabled={pending}
            onClick={handleSubmit}
          >
            {editingId ? "Save new revision" : "Create policy (disabled)"}
          </button>
          {editingId ? (
            <button
              type="button"
              className="kelpie-btn kelpie-btn-ghost"
              disabled={pending}
              onClick={resetForm}
            >
              Cancel edit
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
