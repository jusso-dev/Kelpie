"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  createAutomationRule,
  deleteAutomationRule,
  setAutomationRuleActive,
} from "@/actions/automations";
import {
  ConfirmActionButton,
  feedbackError,
} from "@/components/confirm-dialog";

type Rule = {
  id: string;
  name: string;
  triggerEvent: string;
  conditions: unknown;
  targetProfile: string;
  keyId: string;
  isActive: boolean;
  revision: number;
};

export default function AutomationRuleSettings({
  rules,
  isAdmin,
}: {
  rules: Rule[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [pending, setPending] = useState(false);

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    try {
      await createAutomationRule(new FormData(event.currentTarget));
      toast.success("Automation rule saved disabled", {
        description: "Review the receiver mapping before enabling the rule.",
      });
      setAdding(false);
      router.refresh();
    } catch (error) {
      toast.error("Automation rule could not be saved", {
        description: feedbackError(error, "No rule was created."),
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      {rules.length === 0 ? (
        <p className="text-sm text-slate-500">No agent handoff rules.</p>
      ) : (
        <div className="space-y-2">
          {rules.map((rule) => (
            <div key={rule.id} className="kelpie-card p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-medium text-slate-200">{rule.name}</h3>
                    <span className={`kelpie-badge ${rule.isActive ? "text-green-400" : "text-slate-500"}`}>
                      {rule.isActive ? "active" : "disabled"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {rule.triggerEvent} · target {rule.targetProfile} · key {rule.keyId} · revision {rule.revision}
                  </p>
                </div>
                {isAdmin ? (
                  <div className="flex gap-2">
                    <button
                      className="kelpie-btn kelpie-btn-secondary text-xs"
                      onClick={async () => {
                        await setAutomationRuleActive(rule.id, !rule.isActive);
                        router.refresh();
                      }}
                    >
                      {rule.isActive ? "Disable" : "Enable"}
                    </button>
                    <ConfirmActionButton
                      action={async () => {
                        await deleteAutomationRule(rule.id);
                        router.refresh();
                      }}
                      title={`Delete automation "${rule.name}"?`}
                      description="Queued runs and their audit history are also removed."
                      confirmLabel="Delete rule"
                      triggerLabel="Delete"
                      successTitle="Automation deleted"
                      errorTitle="Automation could not be deleted"
                      className="kelpie-btn kelpie-btn-ghost text-xs text-red-400"
                    />
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}

      {isAdmin && !adding ? (
        <button className="kelpie-btn kelpie-btn-secondary" onClick={() => setAdding(true)}>
          Add agent handoff rule
        </button>
      ) : null}
      {isAdmin && adding ? (
        <form onSubmit={create} className="kelpie-card p-5 space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Field name="name" label="Rule name" required />
            <label>
              <span className="kelpie-label">Trigger</span>
              <select name="trigger_event" className="kelpie-input">
                <option value="case.created">Case created</option>
                <option value="case.status_changed">Case status changed</option>
              </select>
            </label>
            <label>
              <span className="kelpie-label">Optional condition</span>
              <select name="condition_field" className="kelpie-input">
                <option value="">No condition</option>
                <option value="severity">Severity</option>
                <option value="classification">Classification</option>
                <option value="status">Status</option>
                <option value="tag">Tag</option>
                <option value="source_system">Source system</option>
              </select>
            </label>
            <label>
              <span className="kelpie-label">Condition operator</span>
              <select name="condition_operator" className="kelpie-input">
                <option value="equals">Equals</option>
                <option value="not_equals">Does not equal</option>
                <option value="contains">Contains</option>
              </select>
            </label>
            <Field name="condition_value" label="Condition value" />
            <Field name="target_profile" label="Muster target profile" required />
            <Field name="destination_url" label="Adapter URL" type="url" required />
            <Field name="key_id" label="Signing key ID" required />
            <Field name="secret" label="Signing secret" type="password" required />
          </div>
          <p className="text-xs text-amber-300">
            Rule starts disabled. Use only a Muster adapter implementing
            kelpie.agent-trigger.v1; never point this at Muster&apos;s internal agent gateway.
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" className="kelpie-btn kelpie-btn-ghost" onClick={() => setAdding(false)}>
              Cancel
            </button>
            <button className="kelpie-btn kelpie-btn-primary" disabled={pending}>
              {pending ? "Saving…" : "Save disabled rule"}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

function Field({
  name,
  label,
  type = "text",
  required,
}: {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <label>
      <span className="kelpie-label">{label}</span>
      <input name={name} type={type} required={required} className="kelpie-input" />
    </label>
  );
}
