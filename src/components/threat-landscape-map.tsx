"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { geoEqualEarth, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { GeometryCollection, Topology } from "topojson-specification";
import countries from "world-atlas/countries-110m.json";
import isoCountries from "i18n-iso-countries";
import type {
  AttackPair,
  CountryActivity,
} from "@/lib/threat-landscape";

type Mode = "target" | "origin";

function countryNumericId(alpha2: string): string | null {
  const value = isoCountries.alpha2ToNumeric(alpha2);
  const numeric = Number(value);
  return Number.isFinite(numeric) ? String(numeric) : null;
}

function fillFor(value: number, maximum: number, mode: Mode): string {
  if (value <= 0 || maximum <= 0) return "oklch(20% 0.035 260)";
  const ratio = Math.min(1, Math.sqrt(value / maximum));
  const alpha = 0.22 + ratio * 0.78;
  return mode === "target"
    ? `oklch(0.63 0.20 28 / ${alpha})`
    : `oklch(0.72 0.13 70 / ${alpha})`;
}

export default function ThreatLandscapeMap({
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
  const [selectedCode, setSelectedCode] = useState<string | null>(null);

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
  const alternateActivity = mode === "target" ? origins : targets;
  const byId = new Map(
    activity.flatMap((country) => {
      const id = countryNumericId(country.code);
      return id ? [[id, country] as const] : [];
    }),
  );
  const maximum = Math.max(0, ...activity.map((country) => country.percentage));
  const selected = activity.find((country) => country.code === selectedCode);
  const selectedAlternate = alternateActivity.find(
    (country) => country.code === selectedCode,
  );
  const selectedPairs = selected
    ? pairs
        .filter((pair) =>
          mode === "target"
            ? pair.targetCode === selected.code
            : pair.originCode === selected.code,
        )
        .sort((a, b) => b.percentage - a.percentage)
    : [];
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
                onClick={() => {
                  setMode(value);
                  setSelectedCode(null);
                }}
              >
                {value === "target" ? "Targets" : "Origins"}
              </button>
            ))}
          </div>
        </div>
        <div className="bg-[color:var(--color-navy-950)] p-2 sm:p-4">
          <svg
            viewBox="0 0 960 500"
            role="group"
            aria-label={`World heatmap of attack ${mode} locations`}
            className="h-auto w-full"
          >
            {mapFeatures.map((mapFeature: Feature<Geometry>) => {
              const id = String(Number(mapFeature.id ?? ""));
              const value = byId.get(id);
              const isSelected = value?.code === selectedCode;
              const label = value
                ? `${value.name}: ${value.percentage.toFixed(2)}% of observed ${mode} activity, rank ${value.rank}. Select for findings.`
                : "No activity in the current top results";
              return (
                <path
                  key={id}
                  d={path(mapFeature) ?? undefined}
                  fill={fillFor(value?.percentage ?? 0, maximum, mode)}
                  stroke={
                    isSelected
                      ? "oklch(79% 0.12 255)"
                      : "oklch(33% 0.032 260)"
                  }
                  strokeWidth={isSelected ? 1.8 : 0.55}
                  vectorEffect="non-scaling-stroke"
                  role={value ? "button" : undefined}
                  tabIndex={value ? 0 : undefined}
                  aria-label={value ? label : undefined}
                  aria-pressed={value ? isSelected : undefined}
                  className={
                    value
                      ? "cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-tan-400)]"
                      : undefined
                  }
                  onClick={() => value && setSelectedCode(value.code)}
                  onKeyDown={(event) => {
                    if (
                      value &&
                      (event.key === "Enter" || event.key === " ")
                    ) {
                      event.preventDefault();
                      setSelectedCode(value.code);
                    }
                  }}
                >
                  <title>{label}</title>
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

      <aside className="kelpie-card overflow-hidden" aria-live="polite">
        <div className="border-b border-[color:var(--color-navy-700)] p-4">
          {selected ? (
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-slate-500">
                  Map findings
                </p>
                <h2 className="mt-1 text-base font-semibold text-slate-100">
                  {selected.name}
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  Highlighted as an attack {mode}.
                </p>
              </div>
              <button
                type="button"
                className="kelpie-btn kelpie-btn-ghost h-9 w-9 shrink-0 p-0"
                aria-label="Clear selected location"
                onClick={() => setSelectedCode(null)}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
          ) : (
            <>
              <h2 className="text-sm font-medium text-slate-200">
                Top observed routes
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                Select a highlighted country to inspect its findings.
              </p>
            </>
          )}
        </div>
        {selected ? (
          <>
            <dl className="grid grid-cols-2 border-b border-[color:var(--color-navy-700)]">
              <div className="p-4">
                <dt className="text-xs text-slate-500">Observed share</dt>
                <dd className="mt-1 text-lg font-semibold tabular-nums text-slate-100">
                  {selected.percentage.toFixed(2)}%
                </dd>
              </div>
              <div className="border-l border-[color:var(--color-navy-700)] p-4">
                <dt className="text-xs text-slate-500">Radar rank</dt>
                <dd className="mt-1 text-lg font-semibold tabular-nums text-slate-100">
                  #{selected.rank}
                </dd>
              </div>
            </dl>
            {selectedAlternate ? (
              <p className="border-b border-[color:var(--color-navy-700)] px-4 py-3 text-xs leading-5 text-slate-400">
                Also ranks #{selectedAlternate.rank} as an attack{" "}
                {mode === "target" ? "origin" : "target"} at{" "}
                {selectedAlternate.percentage.toFixed(2)}%.
              </p>
            ) : null}
            {selectedPairs.length > 0 ? (
              <ol className="divide-y divide-[color:var(--color-navy-700)]">
                {selectedPairs.slice(0, 12).map((pair, index) => (
                  <RouteRow
                    key={`${pair.originCode}-${pair.targetCode}-${index}`}
                    pair={pair}
                    index={index}
                  />
                ))}
              </ol>
            ) : (
              <p className="p-4 text-xs leading-5 text-slate-500">
                Location appears in Radar&apos;s location dataset, but no route
                involving it appears in the current top route results.
              </p>
            )}
          </>
        ) : (
          <ol className="divide-y divide-[color:var(--color-navy-700)]">
            {pairs.slice(0, 12).map((pair, index) => (
              <RouteRow
                key={`${pair.originCode}-${pair.targetCode}-${index}`}
                pair={pair}
                index={index}
              />
            ))}
          </ol>
        )}
      </aside>
    </div>
  );
}

function RouteRow({ pair, index }: { pair: AttackPair; index: number }) {
  return (
    <li className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-2 px-4 py-3">
      <span className="text-xs tabular-nums text-slate-600">{index + 1}</span>
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
  );
}
