/**
 * Shared constants and types for the asset/identity context layer and
 * explainable case priority scoring (issue #59).
 */

export const ASSET_CONTEXT_KINDS = [
  "asset",
  "identity",
  "application",
  "business_service",
] as const;
export type AssetContextKind = (typeof ASSET_CONTEXT_KINDS)[number];

export const CRITICALITY_LEVELS = [
  "low",
  "medium",
  "high",
  "critical",
] as const;
export type CriticalityLevel = (typeof CRITICALITY_LEVELS)[number];

export const PRIVILEGE_LEVELS = [
  "none",
  "standard",
  "elevated",
  "privileged",
  "admin",
  "domain_admin",
] as const;
export type PrivilegeLevel = (typeof PRIVILEGE_LEVELS)[number];

export const EXPOSURE_LEVELS = [
  "internal",
  "partner",
  "internet_facing",
  "public",
] as const;
export type ExposureLevel = (typeof EXPOSURE_LEVELS)[number];

export const ENVIRONMENT_KINDS = [
  "production",
  "staging",
  "development",
  "test",
  "sandbox",
  "unknown",
] as const;
export type EnvironmentKind = (typeof ENVIRONMENT_KINDS)[number];

export const RECOVERY_PRIORITIES = [
  "p1",
  "p2",
  "p3",
  "p4",
  "none",
] as const;
export type RecoveryPriority = (typeof RECOVERY_PRIORITIES)[number];

export const CONTEXT_IMPORT_SOURCES = [
  "csv",
  "rest",
  "entra",
  "defender",
  "cmdb",
  "manual",
] as const;
export type ContextImportSource = (typeof CONTEXT_IMPORT_SOURCES)[number];

export const STALE_CONTEXT_POLICIES = [
  "discount",
  "exclude",
  "include",
] as const;
export type StaleContextPolicy = (typeof STALE_CONTEXT_POLICIES)[number];

export const PRIORITY_SCORE_BANDS = [
  "low",
  "medium",
  "high",
  "critical",
] as const;
export type PriorityScoreBand = (typeof PRIORITY_SCORE_BANDS)[number];

/** Bump when factor set or normalisation changes. Exposed on every score. */
export const PRIORITY_CALCULATION_VERSION = "1.0.0";

/** Default org policy: discount stale context by half. */
export const DEFAULT_STALE_AFTER_HOURS = 168; // 7 days

export const PRIORITY_WEIGHT_KEYS = [
  "sourceSeverity",
  "assetCriticality",
  "identityPrivilege",
  "affectedEntityCount",
  "attackStage",
  "tiConfidence",
  "externalExposure",
  "relatedCases",
  "slaState",
] as const;
export type PriorityWeightKey = (typeof PRIORITY_WEIGHT_KEYS)[number];

export type PriorityWeights = Record<PriorityWeightKey, number>;

export const DEFAULT_PRIORITY_WEIGHTS: PriorityWeights = {
  sourceSeverity: 0.25,
  assetCriticality: 0.2,
  identityPrivilege: 0.15,
  affectedEntityCount: 0.05,
  attackStage: 0.1,
  tiConfidence: 0.1,
  externalExposure: 0.05,
  relatedCases: 0.05,
  slaState: 0.05,
};

/** Each weight must sit in [0, 1]; sum must sit in (0, 1.5] (bounded, not forced to 1). */
export const WEIGHT_MIN = 0;
export const WEIGHT_MAX = 1;
export const WEIGHT_SUM_MAX = 1.5;

export type PriorityScoringSettings = {
  enabled: boolean;
  weights: PriorityWeights;
  staleContextPolicy: StaleContextPolicy;
  staleAfterHours: number;
};

export const DEFAULT_PRIORITY_SCORING_SETTINGS: PriorityScoringSettings = {
  enabled: true,
  weights: { ...DEFAULT_PRIORITY_WEIGHTS },
  staleContextPolicy: "discount",
  staleAfterHours: DEFAULT_STALE_AFTER_HOURS,
};

export type PriorityFactor = {
  id: PriorityWeightKey;
  label: string;
  /** Raw input as shown to analysts (severity string, count, etc.). */
  inputValue: string | number | boolean | null;
  /** Normalised contribution base in [0, 100] before weight. */
  normalisedScore: number;
  weight: number;
  /** Weighted contribution (normalisedScore * weight), pre-round. */
  contribution: number;
  detail: string;
  staleDiscountApplied?: boolean;
};

export type PriorityScoreResult = {
  calculatedScore: number;
  scoreBand: PriorityScoreBand;
  calculationVersion: string;
  factors: PriorityFactor[];
  weightsUsed: PriorityWeights;
  hasCriticalContext: boolean;
  hasCrownJewelContext: boolean;
  hasStaleContext: boolean;
};

export type EffectiveContextFields = {
  criticality: CriticalityLevel;
  privilegeLevel: PrivilegeLevel;
  exposure: ExposureLevel;
  isCrownJewel: boolean;
  recoveryPriority: RecoveryPriority;
  criticalityIsOverride: boolean;
  privilegeIsOverride: boolean;
  exposureIsOverride: boolean;
  crownJewelIsOverride: boolean;
  recoveryIsOverride: boolean;
};

export type ContextScoringInput = {
  kind: AssetContextKind;
  criticality: CriticalityLevel;
  privilegeLevel: PrivilegeLevel;
  exposure: ExposureLevel;
  isCrownJewel: boolean;
  isStale: boolean;
};

export type CaseScoringInput = {
  sourceSeverity: "low" | "medium" | "high" | "critical";
  contexts: ContextScoringInput[];
  affectedEntityCount: number;
  /** Highest ATT&CK tactic stage rank 0–100, or null if none. */
  attackStageScore: number | null;
  /** Best TI confidence 0–100 across linked observables, or null. */
  tiConfidence: number | null;
  relatedOpenCaseCount: number;
  /** 0 none, 50 at risk, 100 breached. */
  slaPressureScore: number;
};

export class AssetContextError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "AssetContextError";
    this.status = status;
  }
}
