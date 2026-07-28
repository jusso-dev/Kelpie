/**
 * Effective field resolution and staleness helpers for asset/identity context.
 * Provider updates must never touch override columns; effective values always
 * prefer an analyst override when present.
 */

import type { AssetIdentityContext } from "@/db/schema";
import {
  type CriticalityLevel,
  type EffectiveContextFields,
  type ExposureLevel,
  type PrivilegeLevel,
  type RecoveryPriority,
  type StaleContextPolicy,
  DEFAULT_STALE_AFTER_HOURS,
} from "./types";

export function effectiveContextFields(
  row: Pick<
    AssetIdentityContext,
    | "criticality"
    | "criticalityOverride"
    | "privilegeLevel"
    | "privilegeLevelOverride"
    | "exposure"
    | "exposureOverride"
    | "isCrownJewel"
    | "isCrownJewelOverride"
    | "recoveryPriority"
    | "recoveryPriorityOverride"
  >,
): EffectiveContextFields {
  return {
    criticality: (row.criticalityOverride ??
      row.criticality) as CriticalityLevel,
    privilegeLevel: (row.privilegeLevelOverride ??
      row.privilegeLevel) as PrivilegeLevel,
    exposure: (row.exposureOverride ?? row.exposure) as ExposureLevel,
    isCrownJewel:
      row.isCrownJewelOverride !== null && row.isCrownJewelOverride !== undefined
        ? row.isCrownJewelOverride
        : row.isCrownJewel,
    recoveryPriority: (row.recoveryPriorityOverride ??
      row.recoveryPriority) as RecoveryPriority,
    criticalityIsOverride: row.criticalityOverride != null,
    privilegeIsOverride: row.privilegeLevelOverride != null,
    exposureIsOverride: row.exposureOverride != null,
    crownJewelIsOverride:
      row.isCrownJewelOverride !== null && row.isCrownJewelOverride !== undefined,
    recoveryIsOverride: row.recoveryPriorityOverride != null,
  };
}

export function isContextStale(
  row: Pick<
    AssetIdentityContext,
    "lastSyncAt" | "lastSyncStatus"
  >,
  now: Date,
  staleAfterHours: number = DEFAULT_STALE_AFTER_HOURS,
): boolean {
  if (row.lastSyncStatus === "failed" || row.lastSyncStatus === "stale") {
    return true;
  }
  if (row.lastSyncStatus === "never_synced") return true;
  if (!row.lastSyncAt) return true;
  const ageMs = now.getTime() - row.lastSyncAt.getTime();
  return ageMs > staleAfterHours * 60 * 60 * 1000;
}

/**
 * Apply org stale-context policy to a normalised factor score in [0, 100].
 * Returns null when policy is `exclude` and the input is stale.
 */
export function applyStalePolicy(
  normalisedScore: number,
  isStale: boolean,
  policy: StaleContextPolicy,
): { score: number; discounted: boolean; excluded: boolean } {
  if (!isStale || policy === "include") {
    return { score: normalisedScore, discounted: false, excluded: false };
  }
  if (policy === "exclude") {
    return { score: 0, discounted: false, excluded: true };
  }
  // discount
  return {
    score: Math.round(normalisedScore * 0.5),
    discounted: true,
    excluded: false,
  };
}

export function criticalityScore(level: CriticalityLevel, isCrownJewel: boolean): number {
  const base: Record<CriticalityLevel, number> = {
    low: 15,
    medium: 40,
    high: 70,
    critical: 90,
  };
  const score = base[level] ?? 40;
  return isCrownJewel ? Math.min(100, score + 10) : score;
}

export function privilegeScore(level: PrivilegeLevel): number {
  const map: Record<PrivilegeLevel, number> = {
    none: 0,
    standard: 15,
    elevated: 40,
    privileged: 65,
    admin: 85,
    domain_admin: 100,
  };
  return map[level] ?? 0;
}

export function exposureScore(level: ExposureLevel): number {
  const map: Record<ExposureLevel, number> = {
    internal: 10,
    partner: 40,
    internet_facing: 75,
    public: 100,
  };
  return map[level] ?? 10;
}

export function severityScore(
  severity: "low" | "medium" | "high" | "critical",
): number {
  const map = { low: 20, medium: 45, high: 75, critical: 100 } as const;
  return map[severity] ?? 45;
}

export function scoreBandFromScore(score: number): "low" | "medium" | "high" | "critical" {
  if (score >= 80) return "critical";
  if (score >= 55) return "high";
  if (score >= 30) return "medium";
  return "low";
}
