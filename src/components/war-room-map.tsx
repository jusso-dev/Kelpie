"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { geoEqualEarth, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { GeometryCollection, Topology } from "topojson-specification";
import countries from "world-atlas/countries-110m.json";
import isoCountries from "i18n-iso-countries";
import type {
  AttackPair,
  CountryActivity,
} from "@/lib/war-room";

type Mode = "target" | "origin";

function countryNumericId(alpha2: string): string | null {
  const value = isoCountries.alpha2ToNumeric(alpha2);
  return value || null;
}

function fillFor(value: number, maximum: number, mode: Mode): string {
  if (value <= 0 || maximum <= 0) return "#172033";
  const ratio = Math.min(1, Math.sqrt(value / maximum));
  const alpha = 0.22 + ratio * 0.78;
  return mode === "target"
    ? `oklch(0.63 0.20 28 / ${alpha})`
    : `oklch(0.72 0.13 70 / ${alpha})`;
}

export default function WarRoomMap({
  targets,
  origins,
  pairs,
}: {
  targets: CountryActivity[];
  origins: CountryActivity[];
  pairs: AttackPair[];
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("target");

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [router]);

  const mapFeatures = useMemo(() => {
    const topology = countries as unknown as Topology;
    const geometry = topology.objects.countries as GeometryCollection;
    return (
      feature(topology, geometry) as FeatureCollection<Geometry>
    ).features;
  }, []);
  const activity = mode === "target" ? targets : origins;
  const byId = new Map(
    activity.flatMap((country) => {
      const id = countryNumericId(country.code);
      return id ? [[id, country] as const] : [];
    }),
  );
  const maximum = Math.max(0, ...activity.map((country) => country.percentage));
  const projection = geoEqualEarth().fitExtent(
    [
      [12, 12],
      [948, 488],
    ],
    {
      type: "FeatureCollection",
      features: mapFeatures,
    },
  );
  const path = geoPath(projection);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <section className="kelpie-card overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-[color:var(--color-navy-700)] p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-medium text-slate-200">
              Application attack activity
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Auto-refreshes every 60 seconds while this tab is visible.
            </p>
          </div>
          <div className="inline-flex rounded-lg border border-[color:var(--color-navy-700)] p-1">
            {(["target", "origin"] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={
                  "rounded-md px-3 py-1.5 text-xs transition-colors " +
                  (mode === value
                    ? "bg-[color:var(--color-navy-700)] text-slate-100"
                    : "text-slate-400 hover:text-slate-200")
                }
                aria-pressed={mode === value}
                onClick={() => setMode(value)}
              >
                {value === "target" ? "Targets" : "Origins"}
              </button>
            ))}
          </div>
        </div>
        <div className="bg-[color:var(--color-navy-950)] p-2 sm:p-4">
          <svg
            viewBox="0 0 960 500"
            role="img"
            aria-label={`World heatmap of attack ${mode} locations`}
            className="h-auto w-full"
          >
            {mapFeatures.map((mapFeature: Feature<Geometry>) => {
              const id = String(mapFeature.id ?? "");
              const value = byId.get(id);
              return (
                <path
                  key={id}
                  d={path(mapFeature) ?? undefined}
                  fill={fillFor(value?.percentage ?? 0, maximum, mode)}
                  stroke="#344058"
                  strokeWidth={0.55}
                  vectorEffect="non-scaling-stroke"
                >
                  <title>
                    {value
                      ? `${value.name}: ${value.percentage.toFixed(2)}% of shown activity`
                      : "No activity in the current top results"}
                  </title>
                </path>
              );
            })}
          </svg>
          <div className="flex items-center justify-end gap-2 px-2 pb-2 text-[11px] text-slate-500">
            <span>Lower</span>
            <span className="h-2 w-24 rounded-full bg-gradient-to-r from-slate-800 via-amber-700 to-red-500" />
            <span>Higher</span>
          </div>
        </div>
      </section>

      <aside className="kelpie-card overflow-hidden">
        <div className="border-b border-[color:var(--color-navy-700)] p-4">
          <h2 className="text-sm font-medium text-slate-200">Top observed routes</h2>
          <p className="mt-1 text-xs text-slate-500">
            Share of Cloudflare-observed mitigated requests.
          </p>
        </div>
        <ol className="divide-y divide-[color:var(--color-navy-700)]">
          {pairs.slice(0, 12).map((pair, index) => (
            <li
              key={`${pair.originCode}-${pair.targetCode}-${index}`}
              className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-2 px-4 py-3"
            >
              <span className="text-xs tabular-nums text-slate-600">
                {index + 1}
              </span>
              <span className="min-w-0 text-xs text-slate-300">
                <span className="font-medium text-slate-100">{pair.originCode}</span>
                <span className="mx-2 text-slate-600">→</span>
                <span className="font-medium text-slate-100">{pair.targetCode}</span>
                <span className="mt-0.5 block truncate text-slate-500">
                  {pair.originName} to {pair.targetName}
                </span>
              </span>
              <span className="text-xs tabular-nums text-slate-300">
                {pair.percentage.toFixed(2)}%
              </span>
            </li>
          ))}
        </ol>
      </aside>
    </div>
  );
}
