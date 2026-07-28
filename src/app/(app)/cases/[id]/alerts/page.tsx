import { requireUser } from "@/lib/session";
import { createManualAlert, updateAlertDisposition } from "@/actions/alerts";
import { listAlertsForCaseCore } from "@/lib/investigations/alerts-core";
import {
  AlertStatusBadge,
  DeterminationBadge,
  SeverityBadge,
} from "@/components/badges";
import { format } from "date-fns";

type Props = { params: Promise<{ id: string }> };

const SEVERITIES = ["informational", "low", "medium", "high", "critical"] as const;
const STATUSES = ["new", "in_progress", "closed", "dismissed"] as const;
const DETERMINATIONS = [
  "unknown",
  "true_positive",
  "false_positive",
  "benign_positive",
] as const;

export default async function CaseAlertsPage({ params }: Props) {
  const { id } = await params;
  const user = await requireUser();

  let alerts: Awaited<ReturnType<typeof listAlertsForCaseCore>>["items"] = [];
  let loadError: string | null = null;
  try {
    const page = await listAlertsForCaseCore(user.organisationId, id, { limit: 50 });
    alerts = page.items;
  } catch {
    loadError = "Alerts could not be loaded. Try reloading this page.";
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div className="md:col-span-2 space-y-3">
        {loadError ? (
          <div className="kelpie-card p-8 text-center text-sm text-red-400" role="alert">
            {loadError}
          </div>
        ) : alerts.length === 0 ? (
          <div className="kelpie-card p-8 text-center text-sm text-slate-500">
            No alerts linked to this case yet.
          </div>
        ) : (
          alerts.map((alert) => (
            <div key={alert.id} className="kelpie-card p-4" aria-label={`Alert: ${alert.title}`}>
              <div className="flex flex-wrap items-center gap-2">
                <SeverityBadge value={alert.severity} />
                <AlertStatusBadge value={alert.status} />
                <DeterminationBadge value={alert.determination} />
                {alert.isPrimary ? (
                  <span className="kelpie-badge text-[color:var(--color-tan-300)]">primary</span>
                ) : null}
                <span className="text-xs text-slate-500 sm:ml-auto">
                  {format(alert.createdAt, "PP p")}
                </span>
              </div>
              <h3 className="mt-2 text-sm font-medium text-slate-100">{alert.title}</h3>
              {alert.description ? (
                <p className="mt-1 text-sm text-slate-400">{alert.description}</p>
              ) : null}
              <dl className="mt-2 grid grid-cols-2 gap-1 text-xs text-slate-500 sm:grid-cols-4">
                {alert.detectionSource ? (
                  <div>
                    <dt className="uppercase tracking-wider">Source</dt>
                    <dd className="text-slate-300">{alert.detectionSource}</dd>
                  </div>
                ) : null}
                {alert.classification ? (
                  <div>
                    <dt className="uppercase tracking-wider">Classification</dt>
                    <dd className="text-slate-300">{alert.classification}</dd>
                  </div>
                ) : null}
                {alert.sourceUrl ? (
                  <div>
                    <dt className="uppercase tracking-wider">Link</dt>
                    <dd>
                      <a
                        href={alert.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[color:var(--color-blue-400)] hover:text-[color:var(--color-blue-300)]"
                      >
                        Open in source
                      </a>
                    </dd>
                  </div>
                ) : null}
              </dl>

              <form action={updateAlertDisposition} className="mt-3 flex flex-wrap items-end gap-2">
                <input type="hidden" name="caseId" value={id} />
                <input type="hidden" name="alertId" value={alert.id} />
                <div>
                  <label htmlFor={`status-${alert.id}`} className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">
                    Status
                  </label>
                  <select id={`status-${alert.id}`} name="status" className="kelpie-input" defaultValue={alert.status}>
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor={`determination-${alert.id}`} className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">
                    Determination
                  </label>
                  <select id={`determination-${alert.id}`} name="determination" className="kelpie-input" defaultValue={alert.determination}>
                    {DETERMINATIONS.map((d) => (
                      <option key={d} value={d}>{d.replace(/_/g, " ")}</option>
                    ))}
                  </select>
                </div>
                <button className="kelpie-btn kelpie-btn-secondary">Save disposition</button>
              </form>
            </div>
          ))
        )}
      </div>

      <div>
        <form action={createManualAlert} className="kelpie-card p-5 space-y-3">
          <input type="hidden" name="caseId" value={id} />
          <h2 className="text-sm font-medium text-slate-300">Add alert</h2>
          <div>
            <label htmlFor="alert-title" className="block text-xs uppercase tracking-wider text-slate-400 mb-1">
              Title
            </label>
            <input id="alert-title" name="title" className="kelpie-input" required />
          </div>
          <div>
            <label htmlFor="alert-severity" className="block text-xs uppercase tracking-wider text-slate-400 mb-1">
              Severity
            </label>
            <select id="alert-severity" name="severity" className="kelpie-input" defaultValue="medium">
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="alert-description" className="block text-xs uppercase tracking-wider text-slate-400 mb-1">
              Description
            </label>
            <textarea id="alert-description" name="description" className="kelpie-input" rows={3} />
          </div>
          <button className="kelpie-btn kelpie-btn-primary w-full justify-center">Add alert</button>
        </form>
      </div>
    </div>
  );
}
