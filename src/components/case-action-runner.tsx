"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  approveCaseAction,
  cancelCaseAction,
  rejectCaseAction,
  runCaseAction,
} from "@/actions/response-actions";
import { ConfirmDialog, feedbackError } from "@/components/confirm-dialog";

type InputField = {
  key: string;
  label: string;
  type: "string" | "password" | "select" | "textarea";
  required: boolean;
  placeholder?: string;
  help?: string;
  options?: Array<{ value: string; label: string }>;
};

type Action = {
  id: string;
  name: string;
  label: string;
  description: string;
  approvalRequired?: boolean;
  inputFields: InputField[];
};

type ActionRun = {
  id: string;
  actionName: string;
  actionKind: string;
  status: string;
  target: string | null;
  requestedBy: string | null;
  approvedBy: string | null;
  requestedAt: string;
  approvedAt: string | null;
  expiresAt: string | null;
  completedAt: string | null;
  summary: string | null;
};

function runLabel(status: string) {
  return status.replaceAll("_", " ");
}

function targetFromForm(action: Action, formData: FormData) {
  const targetField = action.inputFields[0];
  const target = targetField
    ? String(formData.get(`input.${targetField.key}`) ?? "")
    : "";
  const machineId = String(formData.get("input.machine_id") ?? "");
  return machineId ? `${target} (${machineId})` : target;
}

export default function CaseActionRunner({
  caseId,
  actions,
  canRun,
  runs = [],
  currentUserId,
  canApprove = false,
}: {
  caseId: string;
  actions: Action[];
  canRun: boolean;
  runs?: ActionRun[];
  currentUserId?: string;
  canApprove?: boolean;
}) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [workingRunId, setWorkingRunId] = useState<string | null>(null);
  const [requested, setRequested] = useState<{
    action: Action;
    formData: FormData;
  } | null>(null);

  function requestRun(action: Action, event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    formData.set("actionId", action.id);
    formData.set("caseId", caseId);
    setRequested({ action, formData });
  }

  async function run() {
    if (!requested) return;
    setPending(true);
    try {
      const result = await runCaseAction(requested.formData);
      toast.success("Approval requested", { description: result.summary });
      setRequested(null);
      setOpenId(null);
      router.refresh();
    } catch (error) {
      toast.error("Response action was not requested", {
        description: feedbackError(
          error,
          "The target system was not changed. Check the request and try again.",
        ),
      });
    } finally {
      setPending(false);
    }
  }

  async function manageRun(run: ActionRun, operation: "approve" | "reject" | "cancel") {
    setWorkingRunId(run.id);
    try {
      if (operation === "approve") {
        const result = await approveCaseAction(run.id);
        toast[result.ok ? "success" : "error"](
          result.ok ? "Response action completed" : "Response action failed",
          { description: result.summary },
        );
      } else if (operation === "reject") {
        await rejectCaseAction(run.id);
        toast.success("Response action rejected");
      } else {
        await cancelCaseAction(run.id);
        toast.success("Response action cancelled");
      }
      router.refresh();
    } catch (error) {
      toast.error(`Could not ${operation} response action`, {
        description: feedbackError(error, "No provider action was performed."),
      });
    } finally {
      setWorkingRunId(null);
    }
  }

  const awaiting = runs.filter((run) => run.status === "awaiting_approval");

  return (
    <div className="kelpie-card p-5 space-y-3">
      <div>
        <h2 className="text-sm font-medium text-slate-300">Response actions</h2>
        <p className="text-xs text-slate-500 mt-1">
          Destructive actions require approval from a different administrator before Kelpie contacts a provider.
        </p>
      </div>
      {!canRun ? (
        <p className="text-xs text-slate-500">Read-only users cannot request response actions.</p>
      ) : null}
      {actions.length === 0 ? (
        <p className="text-xs text-slate-500">
          No actions are available for case observables. Configure actions under Settings → Integrations.
        </p>
      ) : (
        <ul className="space-y-2">
          {actions.map((action) => (
            <li key={action.id} className="rounded border border-[color:var(--color-navy-700)] p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm text-slate-200">{action.name}</div>
                  <div className="text-xs text-slate-500">{action.description}</div>
                </div>
                {canRun ? (
                  <button
                    className="kelpie-btn kelpie-btn-secondary text-xs"
                    onClick={() => setOpenId(openId === action.id ? null : action.id)}
                  >
                    {openId === action.id ? "Cancel" : "Request"}
                  </button>
                ) : null}
              </div>
              {openId === action.id ? (
                <form onSubmit={(event) => requestRun(action, event)} className="mt-3 space-y-2">
                  {action.inputFields.map((field) => (
                    <div key={field.key}>
                      <label className="block text-xs uppercase tracking-wider text-slate-400 mb-1">
                        {field.label}{field.required ? " *" : ""}
                      </label>
                      {field.type === "select" ? (
                        <select name={`input.${field.key}`} className="kelpie-input" required={field.required}>
                          {(field.options ?? []).map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      ) : (
                        <input name={`input.${field.key}`} className="kelpie-input" placeholder={field.placeholder} required={field.required} />
                      )}
                      {field.help ? <p className="text-xs text-slate-500 mt-1">{field.help}</p> : null}
                    </div>
                  ))}
                  <div className="flex justify-end">
                    <button className="kelpie-btn kelpie-btn-danger text-xs" disabled={pending}>
                      {pending ? "Requesting…" : "Request approval"}
                    </button>
                  </div>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {awaiting.length > 0 ? (
        <div className="border-t border-[color:var(--color-navy-700)] pt-3 space-y-2">
          <h3 className="text-xs uppercase tracking-wider text-slate-400">Awaiting approval</h3>
          {awaiting.map((run) => {
            const selfRequested = run.requestedBy === currentUserId;
            const disabled = workingRunId === run.id;
            return (
              <div key={run.id} className="rounded border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
                <div className="text-slate-200">{run.actionName} — target: <span className="font-medium">{run.target ?? "unknown"}</span></div>
                <div className="text-slate-500 mt-1">
                  Expires {run.expiresAt ? new Date(run.expiresAt).toLocaleString() : "soon"}.
                </div>
                <div className="mt-2 flex gap-2">
                  {canApprove && !selfRequested ? (
                    <>
                      <button className="kelpie-btn kelpie-btn-danger text-xs" disabled={disabled} onClick={() => void manageRun(run, "approve")}>Approve and execute</button>
                      <button className="kelpie-btn kelpie-btn-ghost text-xs" disabled={disabled} onClick={() => void manageRun(run, "reject")}>Reject</button>
                    </>
                  ) : null}
                  {selfRequested ? (
                    <button className="kelpie-btn kelpie-btn-ghost text-xs" disabled={disabled} onClick={() => void manageRun(run, "cancel")}>Cancel request</button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {runs.length > 0 ? (
        <div className="border-t border-[color:var(--color-navy-700)] pt-3">
          <h3 className="text-xs uppercase tracking-wider text-slate-400 mb-2">Action history</h3>
          <ul className="space-y-1 text-xs text-slate-400">
            {runs.map((run) => (
              <li key={run.id}>
                {run.actionName} on <span className="text-slate-200">{run.target ?? "unknown"}</span>: {runLabel(run.status)}{run.summary ? ` — ${run.summary}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <ConfirmDialog
        open={Boolean(requested)}
        onOpenChange={(open) => { if (!open) setRequested(null); }}
        title={requested ? `Request approval for "${requested.action.label}"?` : "Request response action?"}
        description={requested ? `Target: ${targetFromForm(requested.action, requested.formData)}. A different administrator must approve before this changes the external system.` : ""}
        confirmLabel="Request approval"
        pending={pending}
        onConfirm={() => void run()}
      />
    </div>
  );
}
