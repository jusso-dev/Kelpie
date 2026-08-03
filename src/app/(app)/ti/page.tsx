import { requireUser } from "@/lib/session";
import { fetchBrolgaStats } from "@/lib/brolga/client";
import BrolgaStatsPanel from "@/components/brolga-stats-panel";
import PageExplainer from "@/components/page-explainer";
import Link from "next/link";

export default async function ThreatIntelPage() {
  const user = await requireUser();
  const brolga = await fetchBrolgaStats(user.organisationId);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Threat intelligence</h1>
        <PageExplainer page="ti" />
        <p className="mt-2 max-w-3xl text-sm text-slate-400">
          Active TI is held in{" "}
          <span className="text-slate-300">Brolga</span> (fed by OpenCTI and
          other upstreams). Case observables pull context packs during
          enrichment. Local feed polling has been retired.
        </p>
      </header>

      <BrolgaStatsPanel snapshot={brolga} />

      <section className="kelpie-card p-5 space-y-2">
        <h2 className="text-sm font-medium text-slate-300">How to use it</h2>
        <ul className="list-disc space-y-1.5 pl-5 text-xs leading-5 text-slate-500">
          <li>
            Counts above are live from Brolga{" "}
            <code className="text-slate-400">/api/v1/stats</code>.
          </li>
          <li>
            Open a case and add observables — enrichment requests a context
            pack when Brolga is enabled.
          </li>
          <li>
            Connection and token live under{" "}
            <Link
              href="/settings/integrations"
              className="text-slate-300 hover:text-slate-100 underline-offset-2 hover:underline"
            >
              Settings → Integrations → Brolga
            </Link>
            .
          </li>
        </ul>
      </section>
    </div>
  );
}
