"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { runCaseAction } from "@/actions/response-actions";

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
  inputFields: InputField[];
};

export default function CaseActionRunner({
  caseId,
  actions,
  canRun,
}: {
  caseId: string;
  actions: Action[];
  canRun: boolean;
}) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (actions.length === 0) {
    return (
      <div className="kelpie-card p-5">
        <h2 className="text-sm font-medium text-slate-300 mb-1">Response actions</h2>
        <p className="text-xs text-slate-500">
          No actions are available for the observables on this case. Configure
          actions under Settings → Integrations.
        </p>
      </div>
    );
  }

  async function run(action: Action, e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (
      !confirm(
        `Run "${action.label}" now? This performs a real action on the target system.`,
      )
    ) {
      return;
    }
    setPending(true);
    try {
      const fd = new FormData(e.currentTarget);
      fd.set("actionId", action.id);
      fd.set("caseId", caseId);
      const res = await runCaseAction(fd);
      alert(res.summary);
      setOpenId(null);
      router.refresh();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="kelpie-card p-5 space-y-3">
      <h2 className="text-sm font-medium text-slate-300">Response actions</h2>
      {!canRun ? (
        <p className="text-xs text-slate-500">
          Read-only users cannot run response actions.
        </p>
      ) : null}
      <ul className="space-y-2">
        {actions.map((a) => (
          <li key={a.id} className="rounded border border-[color:var(--color-navy-700)] p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-sm text-slate-200">{a.name}</div>
                <div className="text-xs text-slate-500">{a.description}</div>
              </div>
              {canRun ? (
                <button
                  className="kelpie-btn kelpie-btn-secondary text-xs"
                  onClick={() => setOpenId(openId === a.id ? null : a.id)}
                >
                  {openId === a.id ? "Cancel" : "Run"}
                </button>
              ) : null}
            </div>
            {openId === a.id ? (
              <form onSubmit={(e) => run(a, e)} className="mt-3 space-y-2">
                {a.inputFields.map((f) => (
                  <div key={f.key}>
                    <label className="block text-xs uppercase tracking-wider text-slate-400 mb-1">
                      {f.label}
                      {f.required ? " *" : ""}
                    </label>
                    {f.type === "select" ? (
                      <select
                        name={`input.${f.key}`}
                        className="kelpie-input"
                        required={f.required}
                      >
                        {(f.options ?? []).map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        name={`input.${f.key}`}
                        className="kelpie-input"
                        placeholder={f.placeholder}
                        required={f.required}
                      />
                    )}
                    {f.help ? (
                      <p className="text-xs text-slate-500 mt-1">{f.help}</p>
                    ) : null}
                  </div>
                ))}
                <div className="flex justify-end">
                  <button
                    className="kelpie-btn kelpie-btn-danger text-xs"
                    disabled={pending}
                  >
                    {pending ? "Running…" : "Confirm and run"}
                  </button>
                </div>
              </form>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
