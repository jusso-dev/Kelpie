import Link from "next/link";
import { Activity, Globe2, Radio } from "lucide-react";
import { format } from "date-fns";
import { requireUser } from "@/lib/session";
import { getWarRoomData } from "@/lib/war-room";
import WarRoomMap from "@/components/war-room-map";

export default async function WarRoomPage() {
  await requireUser();
  const data = await getWarRoomData();

  return (
    <div className="kelpie-page max-w-7xl">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 text-xs text-green-400">
            <Radio size={14} aria-hidden="true" />
            Near-real-time view
          </div>
          <h1 className="text-2xl font-semibold text-slate-50">
            Global threat activity
          </h1>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-400">
            A current view of application-layer attacks mitigated by Cloudflare.
            This is observed traffic—not attribution or proof of a hostile campaign.
          </p>
        </div>
        {data.lastUpdated ? (
          <div className="text-right text-xs text-slate-500">
            <p>Data updated {format(new Date(data.lastUpdated), "PP p")}</p>
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
            then restart it. Use a token with User Details Read permission.
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
          <WarRoomMap
            targets={data.targets}
            origins={data.origins}
            pairs={data.pairs}
          />
          <footer className="text-xs leading-5 text-slate-500">
            Source: Cloudflare Radar, rolling 24-hour application-layer attack
            data. Percentages are relative to the returned dataset. Refresh cadence
            does not imply second-by-second telemetry.
          </footer>
        </>
      )}
    </div>
  );
}
