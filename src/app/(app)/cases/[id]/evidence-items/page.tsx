import { requireUser } from "@/lib/session";
import {
  createEvidenceItem,
  updateEvidenceItemRemediation,
  updateEvidenceItemVerdict,
} from "@/actions/evidence-items";
import { listEvidenceItemsForCase } from "@/lib/investigations/evidence-items-core";
import { RemediationBadge, VerdictBadge } from "@/components/badges";
import { format } from "date-fns";

type Props = { params: Promise<{ id: string }> };

const VERDICTS = ["unknown", "clean", "suspicious", "malicious"] as const;
const REMEDIATIONS = ["none", "pending", "remediated", "not_applicable"] as const;

export default async function CaseEvidenceItemsPage({ params }: Props) {
  const { id } = await params;
  const user = await requireUser();

  let evidenceItems: Awaited<ReturnType<typeof listEvidenceItemsForCase>>["items"] = [];
  let loadError: string | null = null;
  try {
    const page = await listEvidenceItemsForCase(user.organisationId, id, { limit: 100 });
    evidenceItems = page.items;
  } catch {
    loadError = "Evidence could not be loaded. Try reloading this page.";
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div className="md:col-span-2 space-y-3">
        {loadError ? (
          <div className="kelpie-card p-8 text-center text-sm text-red-400" role="alert">
            {loadError}
          </div>
        ) : evidenceItems.length === 0 ? (
          <div className="kelpie-card p-8 text-center text-sm text-slate-500">
            No evidence recorded for this investigation yet.
          </div>
        ) : (
          evidenceItems.map((item) => (
            <div key={item.id} className="kelpie-card p-4" aria-label={`Evidence item: ${item.type}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs uppercase tracking-wider text-slate-500">{item.type}</span>
                <VerdictBadge value={item.verdict} />
                <RemediationBadge value={item.remediationState} />
                {item.confidence !== null ? (
                  <span className="kelpie-badge text-slate-300">{item.confidence}% confidence</span>
                ) : null}
                <span className="text-xs text-slate-500 sm:ml-auto">
                  {format(item.createdAt, "PP p")}
                </span>
              </div>
              {item.value ? (
                <p className="mt-2 break-all font-mono text-sm text-slate-100">{item.value}</p>
              ) : null}
              {item.description ? (
                <p className="mt-1 text-sm text-slate-400">{item.description}</p>
              ) : null}

              <div className="mt-3 flex flex-wrap gap-2">
                <form action={updateEvidenceItemVerdict} className="flex items-end gap-2">
                  <input type="hidden" name="caseId" value={id} />
                  <input type="hidden" name="evidenceItemId" value={item.id} />
                  <div>
                    <label htmlFor={`verdict-${item.id}`} className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">
                      Verdict
                    </label>
                    <select id={`verdict-${item.id}`} name="verdict" className="kelpie-input" defaultValue={item.verdict}>
                      {VERDICTS.map((v) => (
                        <option key={v} value={v}>{v}</option>
                      ))}
                    </select>
                  </div>
                  <button className="kelpie-btn kelpie-btn-secondary">Save</button>
                </form>
                <form action={updateEvidenceItemRemediation} className="flex items-end gap-2">
                  <input type="hidden" name="caseId" value={id} />
                  <input type="hidden" name="evidenceItemId" value={item.id} />
                  <div>
                    <label htmlFor={`remediation-${item.id}`} className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">
                      Remediation
                    </label>
                    <select id={`remediation-${item.id}`} name="remediationState" className="kelpie-input" defaultValue={item.remediationState}>
                      {REMEDIATIONS.map((r) => (
                        <option key={r} value={r}>{r.replace(/_/g, " ")}</option>
                      ))}
                    </select>
                  </div>
                  <button className="kelpie-btn kelpie-btn-secondary">Save</button>
                </form>
              </div>
            </div>
          ))
        )}
      </div>

      <div>
        <form action={createEvidenceItem} className="kelpie-card p-5 space-y-3">
          <input type="hidden" name="caseId" value={id} />
          <h2 className="text-sm font-medium text-slate-300">Add evidence</h2>
          <div>
            <label htmlFor="evidence-type" className="block text-xs uppercase tracking-wider text-slate-400 mb-1">
              Type
            </label>
            <input id="evidence-type" name="type" className="kelpie-input" placeholder="e.g. log_excerpt, finding" required />
          </div>
          <div>
            <label htmlFor="evidence-value" className="block text-xs uppercase tracking-wider text-slate-400 mb-1">
              Value
            </label>
            <input id="evidence-value" name="value" className="kelpie-input font-mono" />
          </div>
          <div>
            <label htmlFor="evidence-description" className="block text-xs uppercase tracking-wider text-slate-400 mb-1">
              Description
            </label>
            <textarea id="evidence-description" name="description" className="kelpie-input" rows={3} />
          </div>
          <button className="kelpie-btn kelpie-btn-primary w-full justify-center">Add evidence</button>
        </form>
      </div>
    </div>
  );
}
