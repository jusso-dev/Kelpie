import Link from "next/link";

export type SourceStalenessBannerProps = {
  stale: boolean;
  reason: string | null;
  lastSuccessAt: string | null;
  sourceSystem: string | null;
  freshnessThresholdMinutes: number;
};

/**
 * Analyst-facing banner when a case's inbound source has not succeeded within
 * the configured freshness window.
 */
export default function SourceStalenessBanner({
  stale,
  reason,
  lastSuccessAt,
  sourceSystem,
  freshnessThresholdMinutes,
}: SourceStalenessBannerProps) {
  if (!stale || !sourceSystem) return null;

  return (
    <div
      role="status"
      className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100"
    >
      <p className="font-medium">Source data may be stale</p>
      <p className="mt-1 text-xs text-amber-100/80">
        {reason ??
          `No successful sync from ${sourceSystem} within ${freshnessThresholdMinutes} minutes.`}
        {lastSuccessAt
          ? ` Last success ${new Date(lastSuccessAt).toLocaleString()}.`
          : " No successful sync has been recorded yet."}{" "}
        <Link
          href="/settings/integrations"
          className="underline decoration-amber-300/60 underline-offset-2 hover:text-amber-50"
        >
          View integration health
        </Link>
      </p>
    </div>
  );
}
