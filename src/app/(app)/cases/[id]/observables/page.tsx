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
            const providerEntries = Object.entries(enrichment).filter(
              ([k, v]) => k !== "enriched_at" && typeof v === "object" && v !== null,
            ) as Array<[string, { ok?: boolean; data?: Record<string, unknown>; error?: string; latency_ms?: number; cached?: boolean; at?: string }]>;
            return (
              <div key={o.id} className="kelpie-card p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs uppercase tracking-wider text-slate-500">
                    {o.type.replace(/_/g, " ")}
                  </span>
                  <span className="break-all font-mono text-slate-100">{o.value}</span>
                  <TlpBadge value={o.tlp} />
                  {o.isIoc ? (
                    <span className="kelpie-badge text-amber-400">IOC</span>
                  ) : null}
                  <span className="text-xs text-slate-500 sm:ml-auto">
                    {format(o.createdAt, "PP p")}
                  </span>
                </div>
                {o.description ? (
                  <p className="text-sm text-slate-300 mt-2">{o.description}</p>
                ) : null}
                {providerEntries.length > 0 ? (
                  <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
                    {providerEntries.map(([provider, result]) => (
                      <details
                        key={provider}
                        className="border border-[color:var(--color-navy-700)] rounded p-2"
                      >
                        <summary className="text-xs cursor-pointer flex items-center justify-between gap-2">
                          <span className="font-medium text-slate-300">{provider}</span>
                          <span className="text-slate-500 text-[10px]">
                            {result.ok === false ? (
                              <span className="text-red-400">error</span>
                            ) : result.cached ? (
                              "cached"
                            ) : null}
                            {typeof result.latency_ms === "number"
                              ? ` ${result.latency_ms}ms`
                              : null}
                          </span>
                        </summary>
                        <pre className="text-xs bg-[color:var(--color-navy-800)] p-2 mt-1 rounded overflow-auto">
                          {JSON.stringify(result.data ?? result.error ?? result, null, 2)}
                        </pre>
                      </details>
                    ))}
                  </div>
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
            <label
              htmlFor="observable-type"
              className="block text-xs uppercase tracking-wider text-slate-400 mb-1"
            >
              Type
            </label>
            <select id="observable-type" name="type" className="kelpie-input" defaultValue="ip">
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
            <label
              htmlFor="observable-value"
              className="block text-xs uppercase tracking-wider text-slate-400 mb-1"
            >
              Value
            </label>
            <input id="observable-value" name="value" className="kelpie-input font-mono" required />
          </div>
          <div>
            <label
              htmlFor="observable-tlp"
              className="block text-xs uppercase tracking-wider text-slate-400 mb-1"
            >
              TLP
            </label>
            <select id="observable-tlp" name="tlp" className="kelpie-input" defaultValue="amber">
              {["clear", "green", "amber", "amber_strict", "red"].map((t) => (
                <option key={t} value={t}>
                  {t.replace("_", "+")}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              htmlFor="observable-description"
              className="block text-xs uppercase tracking-wider text-slate-400 mb-1"
            >
              Description
            </label>
            <textarea id="observable-description" name="description" className="kelpie-input" rows={2} />
          </div>
          <label className="text-xs text-slate-400 flex items-center gap-2">
            <input type="checkbox" name="isIoc" className="kelpie-checkbox" />
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
