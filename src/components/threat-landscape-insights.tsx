import type {
  ThreatBreakdownItem,
  ThreatLandscapeData,
} from "@/lib/threat-landscape";

function BreakdownRows({
  items,
  emptyLabel,
}: {
  items: ThreatBreakdownItem[];
  emptyLabel: string;
}) {
  if (items.length === 0) {
    return <p className="text-xs leading-5 text-slate-500">{emptyLabel}</p>;
  }

  return (
    <ol className="space-y-3">
      {items.map((item) => (
        <li key={item.key}>
          <div className="flex items-baseline justify-between gap-3 text-xs">
            <span className="truncate text-slate-300">{item.label}</span>
            <span className="shrink-0 tabular-nums text-slate-400">
              {item.percentage.toFixed(2)}%
            </span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[color:var(--color-navy-800)]">
            <div
              className="h-full rounded-full bg-[color:var(--color-tan-500)]"
              style={{ width: `${Math.min(100, item.percentage)}%` }}
            />
          </div>
        </li>
      ))}
    </ol>
  );
}

function CompactBreakdown({
  title,
  items,
}: {
  title: string;
  items: ThreatBreakdownItem[];
}) {
  return (
    <div>
      <h3 className="text-xs font-medium text-slate-400">{title}</h3>
      <div className="mt-2 flex flex-wrap gap-2">
        {items.length > 0 ? (
          items.map((item) => (
            <span
              key={item.key}
              className="inline-flex min-h-8 items-center gap-2 rounded-md border border-[color:var(--color-navy-700)] px-2.5 text-xs text-slate-300"
            >
              {item.label}
              <span className="tabular-nums text-slate-500">
                {item.percentage.toFixed(1)}%
              </span>
            </span>
          ))
        ) : (
          <span className="text-xs text-slate-600">Unavailable</span>
        )}
      </div>
    </div>
  );
}

export default function ThreatLandscapeInsights({
  breakdowns,
}: {
  breakdowns: ThreatLandscapeData["breakdowns"];
}) {
  return (
    <div className="space-y-4">
      <section className="kelpie-card overflow-hidden" aria-labelledby="attack-composition">
        <header className="border-b border-[color:var(--color-navy-700)] px-5 py-4">
          <h2 id="attack-composition" className="text-sm font-medium text-slate-200">
            Attack composition
          </h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Share of Cloudflare-observed mitigated requests in this 24-hour window.
          </p>
        </header>
        <div className="grid lg:grid-cols-[minmax(18rem,0.8fr)_minmax(0,1.2fr)]">
          <div className="border-b border-[color:var(--color-navy-700)] p-5 lg:border-b-0 lg:border-r">
            <h3 className="mb-4 text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">
              Mitigation products
            </h3>
            <BreakdownRows
              items={breakdowns.mitigationProducts}
              emptyLabel="Mitigation product data is unavailable."
            />
          </div>
          <div className="space-y-6 p-5">
            <h3 className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">
              Request profile
            </h3>
            <CompactBreakdown title="HTTP methods" items={breakdowns.httpMethods} />
            <CompactBreakdown title="HTTP versions" items={breakdowns.httpVersions} />
            <CompactBreakdown title="IP versions" items={breakdowns.ipVersions} />
          </div>
        </div>
      </section>

      <section className="kelpie-card overflow-hidden" aria-labelledby="attack-context">
        <header className="border-b border-[color:var(--color-navy-700)] px-5 py-4">
          <h2 id="attack-context" className="text-sm font-medium text-slate-200">
            Target and detection context
          </h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Targeted sectors and managed-rule categories observed by Radar.
          </p>
        </header>
        <div className="grid lg:grid-cols-2">
          <div className="border-b border-[color:var(--color-navy-700)] p-5 lg:border-b-0 lg:border-r">
            <h3 className="mb-4 text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">
              Targeted sectors
            </h3>
            <BreakdownRows
              items={breakdowns.verticals}
              emptyLabel="Targeted sector data is unavailable."
            />
          </div>
          <div className="p-5">
            <h3 className="mb-4 text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">
              Managed-rule signals
            </h3>
            <BreakdownRows
              items={breakdowns.managedRules}
              emptyLabel="Managed-rule signal data is unavailable."
            />
          </div>
        </div>
      </section>
    </div>
  );
}
