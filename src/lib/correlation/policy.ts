/**
 * Organisation correlation policy (issue #56). Stored under
 * `organisations.settings.correlation`. Auto-merge is always off unless an
 * admin explicitly enables it — suggestions never silently mutate cases.
 */

export type CorrelationPolicy = {
  /** When false (default), no automatic merge/group ever runs. */
  autoMergeEnabled: boolean;
  /**
   * Minimum suggestion score required for auto-apply when autoMergeEnabled.
   * Null means auto-apply is not bound to a score (still requires policy on
   * and a non-dry-run rule).
   */
  autoAcceptThreshold: number | null;
  /** Hours after a merge during which reverse is allowed. Default 24. */
  mergeSafetyWindowHours: number;
};

export const DEFAULT_CORRELATION_POLICY: CorrelationPolicy = {
  autoMergeEnabled: false,
  autoAcceptThreshold: null,
  mergeSafetyWindowHours: 24,
};

export function parseCorrelationPolicy(
  settings: unknown,
): CorrelationPolicy {
  const root =
    settings && typeof settings === "object" && !Array.isArray(settings)
      ? (settings as Record<string, unknown>)
      : {};
  const raw =
    root.correlation && typeof root.correlation === "object"
      ? (root.correlation as Record<string, unknown>)
      : {};

  const autoMergeEnabled = raw.autoMergeEnabled === true;
  let autoAcceptThreshold: number | null = null;
  if (
    typeof raw.autoAcceptThreshold === "number" &&
    Number.isFinite(raw.autoAcceptThreshold)
  ) {
    autoAcceptThreshold = Math.max(
      0,
      Math.min(100, Math.round(raw.autoAcceptThreshold)),
    );
  }
  let mergeSafetyWindowHours = DEFAULT_CORRELATION_POLICY.mergeSafetyWindowHours;
  if (
    typeof raw.mergeSafetyWindowHours === "number" &&
    Number.isFinite(raw.mergeSafetyWindowHours) &&
    raw.mergeSafetyWindowHours > 0
  ) {
    mergeSafetyWindowHours = Math.min(
      24 * 30,
      Math.round(raw.mergeSafetyWindowHours),
    );
  }

  return {
    autoMergeEnabled,
    autoAcceptThreshold,
    mergeSafetyWindowHours,
  };
}

export function correlationPolicyPatch(
  currentSettings: Record<string, unknown>,
  patch: Partial<CorrelationPolicy>,
): Record<string, unknown> {
  const existing = parseCorrelationPolicy(currentSettings);
  const next: CorrelationPolicy = {
    autoMergeEnabled:
      patch.autoMergeEnabled !== undefined
        ? patch.autoMergeEnabled === true
        : existing.autoMergeEnabled,
    autoAcceptThreshold:
      patch.autoAcceptThreshold !== undefined
        ? patch.autoAcceptThreshold
        : existing.autoAcceptThreshold,
    mergeSafetyWindowHours:
      patch.mergeSafetyWindowHours !== undefined
        ? patch.mergeSafetyWindowHours
        : existing.mergeSafetyWindowHours,
  };
  return {
    ...currentSettings,
    correlation: next,
  };
}
