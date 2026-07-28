import type { CaseViewWidgetResult } from "@/lib/case-views/core";

export function CaseViewWidgets({ widgets }: { widgets: CaseViewWidgetResult[] }) {
  if (widgets.length === 0) return null;

  return (
    <div
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      aria-label="View summary widgets"
    >
      {widgets.map((widget) => {
        switch (widget.type) {
          case "severity_breakdown":
            return (
              <WidgetCard key={widget.type} title="Severity">
                {Object.entries(widget.counts).map(([key, value]) => (
                  <MetricRow key={key} label={key} value={value} />
                ))}
              </WidgetCard>
            );
          case "status_breakdown":
            return (
              <WidgetCard key={widget.type} title="Status">
                {Object.entries(widget.counts).map(([key, value]) => (
                  <MetricRow
                    key={key}
                    label={key.replace(/_/g, " ")}
                    value={value}
                  />
                ))}
              </WidgetCard>
            );
          case "sla_summary":
            return (
              <WidgetCard key={widget.type} title="SLA">
                <MetricRow label="At risk" value={widget.atRisk} hot />
                <MetricRow label="Warning" value={widget.warning} />
                <MetricRow label="Breached" value={widget.breached} hot />
                <MetricRow label="Clear" value={widget.clear} />
              </WidgetCard>
            );
          case "workload_summary":
            return (
              <WidgetCard key={widget.type} title="Workload">
                <MetricRow label="Unassigned" value={widget.unassigned} hot />
                <MetricRow label="Assigned" value={widget.assigned} />
                <MetricRow label="Total" value={widget.total} />
              </WidgetCard>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}

function WidgetCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="kelpie-panel space-y-2 p-3">
      <h3 className="text-xs font-medium uppercase tracking-wider text-slate-500">
        {title}
      </h3>
      <dl className="space-y-1">{children}</dl>
    </div>
  );
}

function MetricRow({
  label,
  value,
  hot,
}: {
  label: string;
  value: number;
  hot?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <dt className="capitalize text-slate-400">{label}</dt>
      <dd
        className={
          "font-semibold tabular-nums " +
          (hot ? "text-[color:var(--color-sev-critical)]" : "text-slate-100")
        }
      >
        {value}
      </dd>
    </div>
  );
}
