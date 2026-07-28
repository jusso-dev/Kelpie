import Link from "next/link";
import { requireRole } from "@/lib/session";
import { listPoliciesCore, ESCALATION_TRIGGER_TYPES } from "@/lib/escalation-core";
import type { EscalationPolicy } from "@/db/schema";
import { CASE_ENUMS } from "@/lib/cases-core";
import {
  createPolicy,
  disablePolicy,
  enablePolicy,
} from "@/actions/escalation-policies";

function triggerSummary(policy: EscalationPolicy): string {
  const config = (policy.triggerConfig as Record<string, unknown>) ?? {};
  if (policy.triggerType === "age_minutes") {
    return `Open ≥ ${config.ageMinutes ?? "?"} min, not yet acknowledged`;
  }
  if (policy.triggerType === "sla_warning" || policy.triggerType === "sla_breached") {
    const label = policy.triggerType === "sla_warning" ? "SLA warning" : "SLA breach";
    return config.gate ? `${label} on ${config.gate}` : `${label} on any gate`;
  }
  return `Status "${config.status ?? "?"}" for ≥ ${config.staleAfterMinutes ?? "?"} min`;
}

function actionsSummary(policy: EscalationPolicy): string {
  const actions = Array.isArray(policy.actions) ? policy.actions : [];
  return actions
    .map((action) => {
      const a = action as Record<string, unknown>;
      if (a.type === "notify") return `Notify (${a.channel ?? "both"})`;
      if (a.type === "reassign") return `Reassign to ${a.assigneeId ?? "?"}`;
      if (a.type === "raise_severity") return "Raise severity";
      return String(a.type ?? "unknown");
    })
    .join(", ");
}

export default async function EscalationPoliciesSettingsPage() {
  const user = await requireRole(["admin"]);
  const policies = await listPoliciesCore(user.organisationId, {
    includeDisabled: true,
  });

  return (
    <div className="kelpie-page max-w-6xl">
      <header>
        <Link href="/settings" className="text-xs text-slate-400 hover:text-slate-200">
          ← Settings
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Escalation policies</h1>
        <p>
          Configurable, versioned rules that notify, reassign, or raise the
          severity of cases automatically. Escalation policies can never
          trigger a destructive response action.
        </p>
      </header>

      <section className="kelpie-section">
        <div className="kelpie-section-header">
          <h2>Policies</h2>
          <p>Disabling takes effect immediately and can be reversed at any time.</p>
        </div>
        {policies.length === 0 ? (
          <p className="text-sm text-slate-400">No escalation policies configured yet.</p>
        ) : (
          <div className="kelpie-scroll-x" tabIndex={0} aria-label="Escalation policies table">
            <table className="kelpie-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Trigger</th>
                  <th>Actions</th>
                  <th>Status</th>
                  <th>Version</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {policies.map((policy) => (
                  <tr key={policy.id}>
                    <td className="text-sm text-slate-200">
                      {policy.name}
                      {policy.description ? (
                        <p className="text-xs text-slate-500">{policy.description}</p>
                      ) : null}
                    </td>
                    <td className="text-xs text-slate-300">{triggerSummary(policy)}</td>
                    <td className="text-xs text-slate-300">{actionsSummary(policy)}</td>
                    <td className="text-xs">
                      {policy.isActive ? (
                        <span className="kelpie-badge text-emerald-300">active</span>
                      ) : (
                        <span className="kelpie-badge text-slate-400">disabled</span>
                      )}
                    </td>
                    <td className="text-xs text-slate-400">{policy.version}</td>
                    <td className="text-right">
                      {policy.isActive ? (
                        <form action={disablePolicy}>
                          <input type="hidden" name="id" value={policy.id} />
                          <input type="hidden" name="version" value={policy.version} />
                          <button type="submit" className="kelpie-btn kelpie-btn-ghost text-xs">
                            Disable
                          </button>
                        </form>
                      ) : (
                        <form action={enablePolicy}>
                          <input type="hidden" name="id" value={policy.id} />
                          <input type="hidden" name="version" value={policy.version} />
                          <button type="submit" className="kelpie-btn kelpie-btn-secondary text-xs">
                            Enable
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="kelpie-section">
        <div className="kelpie-section-header">
          <h2>Create a policy</h2>
          <p>
            Choose a trigger and exactly one action. Age-based triggers are the
            simplest starting point; the other trigger types are supported but
            need the fields below that apply to them filled in.
          </p>
        </div>
        <form action={createPolicy} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="kelpie-field lg:col-span-2">
            <label htmlFor="escpol-name" className="kelpie-label">
              Name
            </label>
            <input id="escpol-name" name="name" className="kelpie-input" required />
          </div>
          <div className="kelpie-field">
            <label htmlFor="escpol-trigger-type" className="kelpie-label">
              Trigger type
            </label>
            <select
              id="escpol-trigger-type"
              name="triggerType"
              className="kelpie-input"
              defaultValue="age_minutes"
            >
              {ESCALATION_TRIGGER_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>
          <div className="kelpie-field lg:col-span-3">
            <label htmlFor="escpol-description" className="kelpie-label">
              Description (optional)
            </label>
            <textarea
              id="escpol-description"
              name="description"
              className="kelpie-input"
              rows={2}
            />
          </div>

          <div className="kelpie-field">
            <label htmlFor="escpol-age-minutes" className="kelpie-label">
              Age (minutes)
            </label>
            <input
              id="escpol-age-minutes"
              name="ageMinutes"
              type="number"
              min={1}
              className="kelpie-input"
              defaultValue={60}
            />
            <p className="kelpie-help">
              Used when trigger type is &quot;age minutes&quot;: fires once a case has
              been open, unacknowledged, for at least this long.
            </p>
          </div>
          <div className="kelpie-field">
            <label htmlFor="escpol-gate" className="kelpie-label">
              SLA gate (optional)
            </label>
            <select id="escpol-gate" name="gate" className="kelpie-input" defaultValue="">
              <option value="">Any gate</option>
              <option value="acknowledge">Acknowledge</option>
              <option value="contain">Contain</option>
              <option value="resolve">Resolve</option>
            </select>
            <p className="kelpie-help">
              Used when trigger type is &quot;sla warning&quot; or &quot;sla breached&quot;.
            </p>
          </div>
          <div className="kelpie-field">
            <label htmlFor="escpol-cooldown" className="kelpie-label">
              Cooldown (minutes)
            </label>
            <input
              id="escpol-cooldown"
              name="cooldownMinutes"
              type="number"
              min={1}
              className="kelpie-input"
              defaultValue={60}
            />
            <p className="kelpie-help">
              Minimum time before this policy can re-fire on the same case.
            </p>
          </div>
          <div className="kelpie-field">
            <label htmlFor="escpol-status" className="kelpie-label">
              Status (optional)
            </label>
            <select id="escpol-status" name="status" className="kelpie-input" defaultValue="">
              <option value="">(none)</option>
              {CASE_ENUMS.status.map((status) => (
                <option key={status} value={status}>
                  {status.replace(/_/g, " ")}
                </option>
              ))}
            </select>
            <p className="kelpie-help">Used when trigger type is &quot;stale status&quot;.</p>
          </div>
          <div className="kelpie-field">
            <label htmlFor="escpol-stale-after" className="kelpie-label">
              Stale after (minutes)
            </label>
            <input
              id="escpol-stale-after"
              name="staleAfterMinutes"
              type="number"
              min={1}
              className="kelpie-input"
            />
            <p className="kelpie-help">Used when trigger type is &quot;stale status&quot;.</p>
          </div>

          <div className="kelpie-field">
            <label htmlFor="escpol-action-type" className="kelpie-label">
              Action
            </label>
            <select
              id="escpol-action-type"
              name="actionType"
              className="kelpie-input"
              defaultValue="notify"
            >
              <option value="notify">Notify assignee</option>
              <option value="reassign">Reassign case</option>
              <option value="raise_severity">Raise severity</option>
            </select>
          </div>
          <div className="kelpie-field">
            <label htmlFor="escpol-channel" className="kelpie-label">
              Notify channel
            </label>
            <select id="escpol-channel" name="channel" className="kelpie-input" defaultValue="both">
              <option value="email">Email</option>
              <option value="push">Push</option>
              <option value="both">Email + push</option>
            </select>
            <p className="kelpie-help">Used when action is &quot;notify assignee&quot;.</p>
          </div>
          <div className="kelpie-field">
            <label htmlFor="escpol-assignee-id" className="kelpie-label">
              Reassign to (user ID)
            </label>
            <input id="escpol-assignee-id" name="assigneeId" className="kelpie-input" />
            <p className="kelpie-help">Used when action is &quot;reassign case&quot;.</p>
          </div>

          <div className="flex items-end justify-end lg:col-span-3">
            <button type="submit" className="kelpie-btn kelpie-btn-primary">
              Create policy
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
