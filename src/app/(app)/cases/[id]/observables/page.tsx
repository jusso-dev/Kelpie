import { db } from "@/db";
import { observables } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import { addObservable } from "@/actions/observables";
import { TlpBadge } from "@/components/badges";
import { format } from "date-fns";

type Props = { params: Promise<{ id: string }> };

export default async function CaseObservablesPage({ params }: Props) {
  const { id } = await params;
  await requireUser();
  const rows = await db
    .select()
    .from(observables)
    .where(eq(observables.caseId, id))
    .orderBy(desc(observables.createdAt));

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div className="md:col-span-2 space-y-3">
        {rows.length === 0 ? (
          <div className="kelpie-card p-8 text-center text-sm text-slate-500">
            No observables yet.
          </div>
        ) : (
          rows.map((o) => {
            const enrichment = (o.enrichment as Record<string, unknown>) ?? {};
            const hasEnrichment = Object.keys(enrichment).length > 1;
            return (
              <div key={o.id} className="kelpie-card p-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs uppercase tracking-wider text-slate-500">
                    {o.type.replace(/_/g, " ")}
                  </span>
                  <span className="font-mono text-slate-100">{o.value}</span>
                  <TlpBadge value={o.tlp} />
                  {o.isIoc ? (
                    <span className="kelpie-badge text-amber-400">IOC</span>
                  ) : null}
                  <span className="text-xs text-slate-500 ml-auto">
                    {format(o.createdAt, "PP p")}
                  </span>
                </div>
                {o.description ? (
                  <p className="text-sm text-slate-300 mt-2">{o.description}</p>
                ) : null}
                {hasEnrichment ? (
                  <details className="mt-3">
                    <summary className="text-xs text-slate-400 cursor-pointer">
                      Enrichment
                    </summary>
                    <pre className="text-xs bg-[color:var(--color-navy-800)] p-2 mt-1 rounded overflow-auto">
                      {JSON.stringify(enrichment, null, 2)}
                    </pre>
                  </details>
                ) : null}
              </div>
            );
          })
        )}
      </div>
      <div>
        <form action={addObservable} className="kelpie-card p-5 space-y-3">
          <input type="hidden" name="caseId" value={id} />
          <h2 className="text-sm font-medium text-slate-300">Add observable</h2>
          <div>
            <label className="block text-xs uppercase tracking-wider text-slate-400 mb-1">
              Type
            </label>
            <select name="type" className="kelpie-input" defaultValue="ip">
              {[
                "ip",
                "domain",
                "url",
                "file_hash",
                "email",
                "hostname",
                "username",
                "registry_key",
                "other",
              ].map((t) => (
                <option key={t} value={t}>
                  {t.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wider text-slate-400 mb-1">
              Value
            </label>
            <input name="value" className="kelpie-input font-mono" required />
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wider text-slate-400 mb-1">
              TLP
            </label>
            <select name="tlp" className="kelpie-input" defaultValue="amber">
              {["clear", "green", "amber", "amber_strict", "red"].map((t) => (
                <option key={t} value={t}>
                  {t.replace("_", "+")}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wider text-slate-400 mb-1">
              Description
            </label>
            <textarea name="description" className="kelpie-input" rows={2} />
          </div>
          <label className="text-xs text-slate-400 flex items-center gap-2">
            <input type="checkbox" name="isIoc" />
            Mark as IOC
          </label>
          <button className="kelpie-btn kelpie-btn-primary w-full justify-center">
            Add
          </button>
        </form>
      </div>
    </div>
  );
}
