import { db } from "@/db";
import { observables } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import { addObservable } from "@/actions/observables";
import { TlpBadge } from "@/components/badges";
import { format } from "date-fns";
import { ExternalLink } from "lucide-react";

type Props = { params: Promise<{ id: string }> };
type ProviderResult = {
  ok?: boolean;
  data?: Record<string, unknown>;
  error?: string;
  latency_ms?: number;
  cached?: boolean;
  at?: string;
};

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
            ) as Array<[string, ProviderResult]>;
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
                        {provider === "virustotal" ? (
                          <VirusTotalResult result={result} />
                        ) : (
                          <pre className="mt-1 overflow-auto rounded bg-[color:var(--color-navy-800)] p-2 text-xs">
                            {JSON.stringify(
                              result.data ?? result.error ?? result,
                              null,
                              2,
                            )}
                          </pre>
                        )}
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

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function VirusTotalResult({ result }: { result: ProviderResult }) {
  if (result.ok === false) {
    return (
      <p className="mt-2 text-xs leading-5 text-red-400">
        VirusTotal lookup failed: {result.error || "Unknown provider error"}
      </p>
    );
  }

  const data = result.data ?? {};
  const status = typeof data.status === "string" ? data.status : "unknown";
  if (status !== "ok") {
    const message =
      status === "not_found"
        ? "VirusTotal has no report for this observable."
        : status === "unconfigured"
          ? "VirusTotal is not configured. An administrator can connect it under Settings → Integrations."
          : `VirusTotal returned: ${status.replace(/_/g, " ")}.`;
    return <p className="mt-2 text-xs leading-5 text-slate-400">{message}</p>;
  }

  const malicious = count(data.malicious);
  const suspicious = count(data.suspicious);
  const harmless = count(data.harmless);
  const undetected = count(data.undetected);
  const reputation =
    typeof data.reputation === "number" ? data.reputation : null;
  const link =
    typeof data.link === "string" &&
    data.link.startsWith("https://www.virustotal.com/")
      ? data.link
      : null;
  const verdict =
    malicious > 0
      ? { label: "Malicious detections", className: "text-red-400" }
      : suspicious > 0
        ? { label: "Suspicious detections", className: "text-amber-400" }
        : { label: "No detections", className: "text-green-400" };

  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={`kelpie-badge ${verdict.className}`}>
          {verdict.label}
        </span>
        {link ? (
          <a
            href={link}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-[color:var(--color-blue-400)] hover:text-[color:var(--color-blue-300)]"
          >
            Open VirusTotal
            <ExternalLink size={12} aria-hidden="true" />
          </a>
        ) : null}
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-px overflow-hidden rounded bg-[color:var(--color-navy-700)] sm:grid-cols-4">
        {[
          ["Malicious", malicious],
          ["Suspicious", suspicious],
          ["Harmless", harmless],
          ["Undetected", undetected],
        ].map(([label, value]) => (
          <div
            key={String(label)}
            className="bg-[color:var(--color-navy-800)] px-3 py-2"
          >
            <dt className="text-[0.6875rem] text-slate-500">{label}</dt>
            <dd className="mt-0.5 font-mono text-sm text-slate-200">{value}</dd>
          </div>
        ))}
      </dl>
      {reputation !== null ? (
        <p className="mt-2 text-xs text-slate-500">
          Community reputation:{" "}
          <span className="font-mono text-slate-300">{reputation}</span>
        </p>
      ) : null}
    </div>
  );
}
