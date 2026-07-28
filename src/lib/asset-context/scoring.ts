/**
 * Pure explainable case priority scoring (issue #59).
 * No DB access — unit-testable without Postgres.
 */

import {
  applyStalePolicy,
  criticalityScore,
  exposureScore,
  privilegeScore,
  scoreBandFromScore,
  severityScore,
} from "./effective";
import {
  DEFAULT_PRIORITY_WEIGHTS,
  PRIORITY_CALCULATION_VERSION,
  type CaseScoringInput,
  type PriorityFactor,
  type PriorityScoreResult,
  type PriorityWeightKey,
  type PriorityWeights,
  type StaleContextPolicy,
  WEIGHT_MAX,
  WEIGHT_MIN,
  WEIGHT_SUM_MAX,
} from "./types";

const FACTOR_LABELS: Record<PriorityWeightKey, string> = {
  sourceSeverity: "Source severity",
  assetCriticality: "Asset criticality",
  identityPrivilege: "Identity privilege",
  affectedEntityCount: "Affected entity count",
  attackStage: "ATT&CK stage / techniques",
  tiConfidence: "Threat intelligence confidence",
  externalExposure: "External exposure",
  relatedCases: "Related open cases",
  slaState: "SLA pressure",
};

export function clampWeight(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(WEIGHT_MAX, Math.max(WEIGHT_MIN, value));
}

/**
 * Validates and normalises org weights. Unknown keys dropped; missing keys
 * filled from defaults. Rejects sums above WEIGHT_SUM_MAX.
 */
export function normaliseWeights(
  input?: Partial<PriorityWeights> | null,
): { ok: true; weights: PriorityWeights } | { ok: false; error: string } {
  const weights: PriorityWeights = { ...DEFAULT_PRIORITY_WEIGHTS };
  if (input) {
    for (const key of Object.keys(DEFAULT_PRIORITY_WEIGHTS) as PriorityWeightKey[]) {
      if (input[key] !== undefined && input[key] !== null) {
        weights[key] = clampWeight(Number(input[key]));
      }
    }
  }
  const sum = Object.values(weights).reduce((a, b) => a + b, 0);
  if (sum <= 0) {
    return { ok: false, error: "At least one priority weight must be greater than zero" };
  }
  if (sum > WEIGHT_SUM_MAX) {
    return {
      ok: false,
      error: `Priority weight sum ${sum.toFixed(2)} exceeds maximum ${WEIGHT_SUM_MAX}`,
    };
  }
  return { ok: true, weights };
}

function entityCountScore(count: number): number {
  if (count <= 0) return 0;
  if (count === 1) return 20;
  if (count <= 3) return 45;
  if (count <= 8) return 70;
  return 100;
}

function relatedCasesScore(count: number): number {
  if (count <= 0) return 0;
  if (count === 1) return 30;
  if (count <= 3) return 60;
  return 100;
}

function maxContextScores(
  contexts: CaseScoringInput["contexts"],
  policy: StaleContextPolicy,
): {
  asset: { score: number; detail: string; stale: boolean; discounted: boolean };
  privilege: { score: number; detail: string; stale: boolean; discounted: boolean };
  exposure: { score: number; detail: string; stale: boolean; discounted: boolean };
  hasCritical: boolean;
  hasCrownJewel: boolean;
  hasStale: boolean;
} {
  let bestAsset = 0;
  let bestAssetDetail = "No linked asset/application context";
  let assetStale = false;
  let assetDiscounted = false;

  let bestPriv = 0;
  let bestPrivDetail = "No linked identity context";
  let privStale = false;
  let privDiscounted = false;

  let bestExposure = 0;
  let bestExposureDetail = "No linked context exposure";
  let expStale = false;
  let expDiscounted = false;

  let hasCritical = false;
  let hasCrownJewel = false;
  let hasStale = false;

  for (const ctx of contexts) {
    if (ctx.isStale) hasStale = true;
    if (ctx.isCrownJewel) hasCrownJewel = true;
    if (ctx.criticality === "critical" || ctx.isCrownJewel) hasCritical = true;

    const rawAsset = criticalityScore(ctx.criticality, ctx.isCrownJewel);
    const assetApplied = applyStalePolicy(rawAsset, ctx.isStale, policy);
    if (!assetApplied.excluded && assetApplied.score >= bestAsset) {
      bestAsset = assetApplied.score;
      bestAssetDetail = `${ctx.kind} criticality=${ctx.criticality}${ctx.isCrownJewel ? " (crown jewel)" : ""}${assetApplied.discounted ? " [stale discounted]" : ""}`;
      assetStale = ctx.isStale;
      assetDiscounted = assetApplied.discounted;
    }

    if (ctx.kind === "identity") {
      const rawPriv = privilegeScore(ctx.privilegeLevel);
      const privApplied = applyStalePolicy(rawPriv, ctx.isStale, policy);
      if (!privApplied.excluded && privApplied.score >= bestPriv) {
        bestPriv = privApplied.score;
        bestPrivDetail = `privilege=${ctx.privilegeLevel}${privApplied.discounted ? " [stale discounted]" : ""}`;
        privStale = ctx.isStale;
        privDiscounted = privApplied.discounted;
      }
    }

    const rawExp = exposureScore(ctx.exposure);
    const expApplied = applyStalePolicy(rawExp, ctx.isStale, policy);
    if (!expApplied.excluded && expApplied.score >= bestExposure) {
      bestExposure = expApplied.score;
      bestExposureDetail = `exposure=${ctx.exposure}${expApplied.discounted ? " [stale discounted]" : ""}`;
      expStale = ctx.isStale;
      expDiscounted = expApplied.discounted;
    }
  }

  return {
    asset: {
      score: bestAsset,
      detail: bestAssetDetail,
      stale: assetStale,
      discounted: assetDiscounted,
    },
    privilege: {
      score: bestPriv,
      detail: bestPrivDetail,
      stale: privStale,
      discounted: privDiscounted,
    },
    exposure: {
      score: bestExposure,
      detail: bestExposureDetail,
      stale: expStale,
      discounted: expDiscounted,
    },
    hasCritical,
    hasCrownJewel,
    hasStale,
  };
}

function factor(
  id: PriorityWeightKey,
  normalisedScore: number,
  weight: number,
  inputValue: string | number | boolean | null,
  detail: string,
  staleDiscountApplied = false,
): PriorityFactor {
  const clamped = Math.max(0, Math.min(100, normalisedScore));
  return {
    id,
    label: FACTOR_LABELS[id],
    inputValue,
    normalisedScore: clamped,
    weight,
    contribution: Math.round(clamped * weight * 1000) / 1000,
    detail,
    staleDiscountApplied: staleDiscountApplied || undefined,
  };
}

/**
 * Compute an explainable priority score in [0, 100]. Score is independent of
 * whether an analyst later overrides the effective value used for queues.
 */
export function calculatePriorityScore(
  input: CaseScoringInput,
  weightsInput?: Partial<PriorityWeights> | null,
  stalePolicy: StaleContextPolicy = "discount",
): PriorityScoreResult {
  const normalised = normaliseWeights(weightsInput);
  if (!normalised.ok) {
    // Fall back to defaults rather than throw from pure scorer; callers that
    // need validation should call normaliseWeights themselves first.
    return calculatePriorityScore(input, DEFAULT_PRIORITY_WEIGHTS, stalePolicy);
  }
  const weights = normalised.weights;
  const ctx = maxContextScores(input.contexts, stalePolicy);

  const factors: PriorityFactor[] = [
    factor(
      "sourceSeverity",
      severityScore(input.sourceSeverity),
      weights.sourceSeverity,
      input.sourceSeverity,
      `Case source severity ${input.sourceSeverity}`,
    ),
    factor(
      "assetCriticality",
      ctx.asset.score,
      weights.assetCriticality,
      ctx.asset.score,
      ctx.asset.detail,
      ctx.asset.discounted,
    ),
    factor(
      "identityPrivilege",
      ctx.privilege.score,
      weights.identityPrivilege,
      ctx.privilege.score,
      ctx.privilege.detail,
      ctx.privilege.discounted,
    ),
    factor(
      "affectedEntityCount",
      entityCountScore(input.affectedEntityCount),
      weights.affectedEntityCount,
      input.affectedEntityCount,
      `${input.affectedEntityCount} distinct linked entities`,
    ),
    factor(
      "attackStage",
      input.attackStageScore ?? 0,
      weights.attackStage,
      input.attackStageScore,
      input.attackStageScore == null
        ? "No ATT&CK techniques mapped"
        : `ATT&CK stage score ${input.attackStageScore}`,
    ),
    factor(
      "tiConfidence",
      input.tiConfidence ?? 0,
      weights.tiConfidence,
      input.tiConfidence,
      input.tiConfidence == null
        ? "No TI matches on case observables"
        : `Best TI confidence ${input.tiConfidence}`,
    ),
    factor(
      "externalExposure",
      ctx.exposure.score,
      weights.externalExposure,
      ctx.exposure.score,
      ctx.exposure.detail,
      ctx.exposure.discounted,
    ),
    factor(
      "relatedCases",
      relatedCasesScore(input.relatedOpenCaseCount),
      weights.relatedCases,
      input.relatedOpenCaseCount,
      `${input.relatedOpenCaseCount} related open cases`,
    ),
    factor(
      "slaState",
      Math.max(0, Math.min(100, input.slaPressureScore)),
      weights.slaState,
      input.slaPressureScore,
      input.slaPressureScore >= 100
        ? "SLA breached"
        : input.slaPressureScore >= 50
          ? "SLA at risk"
          : "SLA on track",
    ),
  ];

  const rawSum = factors.reduce((acc, f) => acc + f.contribution, 0);
  // Weights do not necessarily sum to 1; scale by weight sum so a partial
  // weight set still yields a 0–100 score.
  const weightSum = factors.reduce((acc, f) => acc + f.weight, 0) || 1;
  const calculatedScore = Math.max(
    0,
    Math.min(100, Math.round(rawSum / weightSum)),
  );

  return {
    calculatedScore,
    scoreBand: scoreBandFromScore(calculatedScore),
    calculationVersion: PRIORITY_CALCULATION_VERSION,
    factors,
    weightsUsed: weights,
    hasCriticalContext: ctx.hasCritical,
    hasCrownJewelContext: ctx.hasCrownJewel,
    hasStaleContext: ctx.hasStale,
  };
}

/**
 * Map ATT&CK tactic ids to a rough kill-chain progress score (0–100).
 * Later-stage tactics rank higher so cases further into the kill chain
 * surface sooner. Unknown tactics contribute a modest baseline.
 */
const TACTIC_STAGE_SCORE: Record<string, number> = {
  reconnaissance: 15,
  "resource-development": 20,
  "initial-access": 35,
  execution: 45,
  persistence: 55,
  "privilege-escalation": 65,
  "defense-evasion": 60,
  "credential-access": 70,
  discovery: 50,
  "lateral-movement": 75,
  collection: 80,
  "command-and-control": 85,
  exfiltration: 95,
  impact: 100,
};

export function attackStageScoreFromTactics(tacticIds: string[]): number | null {
  if (tacticIds.length === 0) return null;
  let best = 25; // mapped technique with unknown tactic still counts
  for (const id of tacticIds) {
    const score = TACTIC_STAGE_SCORE[id.toLowerCase()];
    if (score != null && score > best) best = score;
  }
  return best;
}
