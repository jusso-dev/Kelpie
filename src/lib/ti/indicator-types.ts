/**
 * Canonical threat-intelligence indicator contract.
 *
 * Kelpie threat intelligence stores actionable network and file indicators
 * only. Vulnerability catalogues (CVE), network ranges (CIDR), mailbox
 * identifiers and free-form values are deliberately out of scope and are
 * rejected rather than coerced into one of the supported types.
 *
 * This module is dependency-free on purpose: database validation, feed
 * ingestion, server actions, REST, MCP and the browser UI all import the same
 * allowlist so the four values can never drift apart.
 */

export const TI_INDICATOR_TYPES = ["ip", "url", "file_hash", "domain"] as const;

export type TiIndicatorType = (typeof TI_INDICATOR_TYPES)[number];

const ALLOWED_TYPES: ReadonlySet<string> = new Set(TI_INDICATOR_TYPES);

export function isTiIndicatorType(value: unknown): value is TiIndicatorType {
  return typeof value === "string" && ALLOWED_TYPES.has(value);
}

/** Returns the value when it is an allowed indicator type, otherwise null. */
export function parseTiIndicatorType(
  value: string | null | undefined,
): TiIndicatorType | null {
  const candidate = value?.trim().toLowerCase() ?? "";
  return isTiIndicatorType(candidate) ? candidate : null;
}

/**
 * Types Kelpie can still recognise in feed data but refuses to store. Kept
 * explicit so ingestion can report *why* a record was skipped instead of
 * lumping everything into an opaque counter.
 */
export const REJECTED_TI_INDICATOR_TYPES = ["cidr", "cve", "email"] as const;

export type RejectedTiIndicatorType =
  (typeof REJECTED_TI_INDICATOR_TYPES)[number];

/** Skip reason used when no known type could be derived from a record. */
export const UNRECOGNISED_INDICATOR_TYPE = "unrecognised";

/** Skip reason used when the value itself was empty or oversized. */
export const INVALID_INDICATOR_VALUE = "invalid_value";

/** Per-poll skip tally keyed by rejected type or skip reason. */
export type TiSkipCounts = Record<string, number>;

export function countSkip(counts: TiSkipCounts, reason: string): void {
  counts[reason] = (counts[reason] ?? 0) + 1;
}

export function mergeSkipCounts(
  target: TiSkipCounts,
  source: TiSkipCounts,
): TiSkipCounts {
  for (const [reason, count] of Object.entries(source)) {
    target[reason] = (target[reason] ?? 0) + count;
  }
  return target;
}

export function totalSkipped(counts: TiSkipCounts): number {
  return Object.values(counts).reduce((sum, count) => sum + count, 0);
}

/** Stable, human-readable breakdown such as `cve 1,200 · cidr 30`. */
export function formatSkipCounts(counts: TiSkipCounts): string {
  return Object.entries(counts)
    .filter(([, count]) => count > 0)
    .sort(([a, countA], [b, countB]) => countB - countA || a.localeCompare(b))
    .map(([reason, count]) => `${reason} ${count.toLocaleString()}`)
    .join(" · ");
}

/**
 * Narrows arbitrary JSON (a `jsonb` column, an API payload) to a skip tally.
 * Non-numeric and negative entries are dropped rather than trusted.
 */
export function toSkipCounts(value: unknown): TiSkipCounts {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const counts: TiSkipCounts = {};
  for (const [reason, count] of Object.entries(value as Record<string, unknown>)) {
    if (typeof count === "number" && Number.isFinite(count) && count > 0) {
      counts[reason] = Math.trunc(count);
    }
  }
  return counts;
}
