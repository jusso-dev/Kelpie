import Link from "next/link";
import { requireUser } from "@/lib/session";
import {
  listContextsCore,
  serialiseContext,
} from "@/lib/asset-context/context-core";
import { getPriorityScoringSettings } from "@/lib/asset-context/settings";
import { effectiveContextFields } from "@/lib/asset-context/effective";
import PageExplainer from "@/components/page-explainer";

export default async function AssetContextListPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const criticalOnly = sp.critical === "1" || sp.critical === "true";
  const crownJewelOnly = sp.crownJewel === "1" || sp.crownJewel === "true";
  const settings = await getPriorityScoringSettings(user.organisationId);
  const rows = await listContextsCore(user.organisationId, {
    criticalOnly,
    crownJewelOnly,
    limit: 200,
  });

  return (
    <div className="kelpie-page max-w-6xl space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Asset & identity context</h1>
          <PageExplainer page="asset-context" className="mt-1" />
        </div>
        <Link
          href="/settings/asset-context"
          className="kelpie-btn kelpie-btn-secondary"
        >
          Import & settings
        </Link>
      </header>

      <div className="flex flex-wrap gap-2 text-sm">
        <Link
          href="/asset-context"
          className={!criticalOnly && !crownJewelOnly ? "kelpie-link" : "text-slate-400"}
        >
          All
        </Link>
        <Link
          href="/asset-context?critical=1"
          className={criticalOnly ? "kelpie-link" : "text-slate-400"}
        >
          Critical
        </Link>
        <Link
          href="/asset-context?crownJewel=1"
          className={crownJewelOnly ? "kelpie-link" : "text-slate-400"}
        >
          Crown jewels
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-slate-400">No context records match.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="kelpie-table w-full text-sm">
            <thead>
              <tr>
                <th className="text-left">Name</th>
                <th className="text-left">Kind</th>
                <th className="text-left">Identifier</th>
                <th className="text-left">Criticality</th>
                <th className="text-left">Privilege</th>
                <th className="text-left">Exposure</th>
                <th className="text-left">Sync</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const s = serialiseContext(row, {
                  staleAfterHours: settings.staleAfterHours,
                });
                const eff = effectiveContextFields(row);
                return (
                  <tr key={row.id}>
                    <td className="font-medium">
                      {row.displayName}
                      {eff.isCrownJewel ? (
                        <span className="ml-1 kelpie-badge text-red-300">
                          crown jewel
                        </span>
                      ) : null}
                    </td>
                    <td>{row.kind}</td>
                    <td className="font-mono text-xs">
                      {row.primaryIdentifierKind}={row.primaryIdentifierValue}
                    </td>
                    <td>
                      {eff.criticality}
                      {eff.criticalityIsOverride ? (
                        <span className="text-xs text-amber-300 ml-1">override</span>
                      ) : null}
                    </td>
                    <td>
                      {eff.privilegeLevel}
                      {eff.privilegeIsOverride ? (
                        <span className="text-xs text-amber-300 ml-1">override</span>
                      ) : null}
                    </td>
                    <td>{eff.exposure}</td>
                    <td>
                      <span
                        className={
                          s.isStale ? "text-amber-300" : "text-slate-400"
                        }
                      >
                        {row.lastSyncStatus}
                        {s.isStale ? " (stale)" : ""}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
