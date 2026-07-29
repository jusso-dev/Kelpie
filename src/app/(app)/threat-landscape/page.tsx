import Link from "next/link";
import { Activity, Globe2, Radio } from "lucide-react";
import { requireUser } from "@/lib/session";
import { getThreatLandscapeData } from "@/lib/threat-landscape";
import ThreatLandscapeMap from "@/components/threat-landscape-map";
import ThreatLandscapeInsights from "@/components/threat-landscape-insights";
import LocalDateTime from "@/components/local-date-time";
import PageExplainer from "@/components/page-explainer";

export default async function ThreatLandscapePage() {
  const user = await requireUser();
  const data = await getThreatLandscapeData();

  return (
    <div className="kelpie-page max-w-[90rem]">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 text-xs text-green-400">
            <Radio size={14} aria-hidden="true" />
            Near-real-time view
          </div>
          <h1 className="text-2xl font-semibold text-slate-50">
            Global threat activity
          </h1>
          <PageExplainer page="threat-landscape" className="mt-1 max-w-3xl" />
        </div>
        {data.lastUpdated ? (
          <div className="text-right text-xs text-slate-500">
            <p>
              Data updated{" "}
              <LocalDateTime
                value={data.lastUpdated}
                timeZone={user.timezone}
              />
            </p>
            {data.confidenceLevel !== null ? (
              <p className="mt-1">Provider confidence {data.confidenceLevel}</p>
            ) : null}
          </div>
        ) : null}
      </header>

      {!data.configured ? (
        <div className="kelpie-empty">
          <Globe2 size={26} aria-hidden="true" />
          <h2>Connect the live data source</h2>
          <p className="max-w-xl">
            Set <code>CLOUDFLARE_RADAR_API_TOKEN</code> on the app container,
            then restart it. Use a token with Account Radar Read permission.
          </p>
          <Link href="/settings/integrations" className="kelpie-btn kelpie-btn-secondary">
            Integration settings
          </Link>
        </div>
      ) : data.error ? (
        <div className="kelpie-notice kelpie-notice-error" role="alert">
          <Activity size={18} aria-hidden="true" />
          <span>
            <strong>Live activity is unavailable.</strong> {data.error} Existing
            case data is unaffected.
          </span>
        </div>
      ) : (
        <>
          <ThreatLandscapeMap
            targets={data.targets}
            origins={data.origins}
            pairs={data.pairs}
          />
          {data.warnings.length > 0 ? (
            <div className="kelpie-notice kelpie-notice-warning" role="status">
              <Activity size={18} aria-hidden="true" />
              <span>
                <strong>Some Radar enrichment is unavailable.</strong>{" "}
                {data.warnings.join(" ")}
              </span>
            </div>
          ) : null}
          <ThreatLandscapeInsights breakdowns={data.breakdowns} />
          {data.annotations.length > 0 ? (
            <details className="kelpie-panel px-4 py-3 text-xs text-slate-400">
              <summary className="cursor-pointer font-medium text-slate-300">
                Cloudflare data notes ({data.annotations.length})
              </summary>
              <ul className="mt-3 space-y-3 border-t border-[color:var(--color-navy-700)] pt-3">
                {data.annotations.map((annotation, index) => (
                  <li key={`${annotation.startDate}-${index}`} className="leading-5">
                    <span className="kelpie-badge mr-2 text-slate-400">
                      {annotation.eventType}
                    </span>
                    {annotation.description}
                    {annotation.linkedUrl ? (
                      <>
                        {" "}
                        <a
                          href={annotation.linkedUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="kelpie-link"
                        >
                          Provider detail
                        </a>
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          <footer className="text-xs leading-5 text-slate-500">
            Source: Cloudflare Radar, rolling 24-hour application-layer attack
            data. Values represent percentages of mitigated requests, not attack
            counts or actor attribution. Refresh cadence does not imply
            second-by-second telemetry.
          </footer>
        </>
      )}
    </div>
  );
}
