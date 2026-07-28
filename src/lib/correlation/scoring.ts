/**
 * Pure alert-correlation scoring (issue #56). No DB access — callers load
 * candidate alert feature vectors and pass them through here so matching
 * stays unit-testable without Postgres.
 *
 * Signals (each optionally weighted via rule config):
 *   - shared canonical entity identifiers
 *   - shared observables (entity kinds that map to observables + raw values)
 *   - provider / source incident id (same externalId within a source)
 *   - detection product / family
 *   - time window between detections
 *   - tenant id
 *   - shared ATT&CK technique ids
 */

export const DEFAULT_SCORE_THRESHOLD = 40;

export type CorrelationSignalWeights = {
  sharedEntities: number;
  sharedObservables: number;
  providerIncidentId: number;
  detectionProduct: number;
  timeWindow: number;
  tenant: number;
  attackTechniques: number;
};

export type CorrelationRuleConfig = {
  weights: CorrelationSignalWeights;
  /** Maximum minutes between detectedAt for the time-window signal to fire. */
  timeWindowMinutes: number;
  /** If true, tenant ids must match (non-empty) for any score above zero. */
  requireSameTenant: boolean;
};

export const DEFAULT_CORRELATION_WEIGHTS: CorrelationSignalWeights = {
  sharedEntities: 30,
  sharedObservables: 20,
  providerIncidentId: 25,
  detectionProduct: 10,
  timeWindow: 10,
  tenant: 5,
  attackTechniques: 15,
};

export const DEFAULT_CORRELATION_CONFIG: CorrelationRuleConfig = {
  weights: DEFAULT_CORRELATION_WEIGHTS,
  timeWindowMinutes: 60 * 24,
  requireSameTenant: false,
};

export type AlertScoringInput = {
  id: string;
  title: string;
  tenantId: string;
  externalId: string;
  sourceId: string;
  detectionProduct: string | null;
  detectionSource: string | null;
  detectedAt: Date | null;
  entityIds: string[];
  /** Canonical entity keys / observable-like values already normalised. */
  observableValues: string[];
  attackTechniqueIds: string[];
  caseIds: string[];
};

export type CorrelationMatchedSignals = {
  sharedEntityIds: string[];
  sharedObservables: string[];
  sameProviderIncidentId: boolean;
  sameDetectionProduct: boolean;
  detectionProduct: string | null;
  withinTimeWindow: boolean;
  timeDeltaMinutes: number | null;
  sameTenant: boolean;
  tenantId: string | null;
  sharedAttackTechniques: string[];
};

export type AlertPairScore = {
  score: number;
  matchedSignals: CorrelationMatchedSignals;
  explanation: string;
};

function normalizeToken(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function jaccardShared<T>(a: Set<T>, b: Set<T>): T[] {
  if (a.size === 0 || b.size === 0) return [];
  return [...a].filter((v) => b.has(v));
}

function minutesBetween(a: Date | null, b: Date | null): number | null {
  if (!a || !b) return null;
  return Math.abs(a.getTime() - b.getTime()) / 60_000;
}

function weightContribution(
  weight: number,
  totalWeight: number,
  ratio: number,
): number {
  if (totalWeight <= 0 || weight <= 0) return 0;
  return (weight / totalWeight) * 100 * Math.max(0, Math.min(1, ratio));
}

export function mergeRuleConfig(
  partial?: Partial<CorrelationRuleConfig> | null,
): CorrelationRuleConfig {
  const weights = {
    ...DEFAULT_CORRELATION_WEIGHTS,
    ...(partial?.weights ?? {}),
  };
  return {
    weights,
    timeWindowMinutes:
      partial?.timeWindowMinutes ?? DEFAULT_CORRELATION_CONFIG.timeWindowMinutes,
    requireSameTenant:
      partial?.requireSameTenant ?? DEFAULT_CORRELATION_CONFIG.requireSameTenant,
  };
}

/**
 * Score a pair of alerts for correlation. Returns 0–100 plus the exact
 * signals that contributed so suggestions stay transparent.
 */
export function scoreAlertPair(
  a: AlertScoringInput,
  b: AlertScoringInput,
  configInput?: Partial<CorrelationRuleConfig> | null,
): AlertPairScore {
  const config = mergeRuleConfig(configInput);
  const w = config.weights;

  const entityShared = jaccardShared(new Set(a.entityIds), new Set(b.entityIds));
  const observableShared = jaccardShared(
    new Set(a.observableValues.map(normalizeToken).filter(Boolean)),
    new Set(b.observableValues.map(normalizeToken).filter(Boolean)),
  );
  const attackShared = jaccardShared(
    new Set(a.attackTechniqueIds.map(normalizeToken).filter(Boolean)),
    new Set(b.attackTechniqueIds.map(normalizeToken).filter(Boolean)),
  );

  const sameTenant =
    a.tenantId !== "" &&
    b.tenantId !== "" &&
    a.tenantId === b.tenantId;
  const sameProviderIncidentId =
    a.sourceId === b.sourceId &&
    a.externalId !== "" &&
    a.externalId === b.externalId;
  const productA = normalizeToken(a.detectionProduct);
  const productB = normalizeToken(b.detectionProduct);
  const sameDetectionProduct =
    productA !== "" && productA === productB;

  const delta = minutesBetween(a.detectedAt, b.detectedAt);
  const withinTimeWindow =
    delta !== null && delta <= config.timeWindowMinutes;

  if (config.requireSameTenant) {
    const tenantA = a.tenantId;
    const tenantB = b.tenantId;
    if (tenantA !== tenantB) {
      return {
        score: 0,
        matchedSignals: {
          sharedEntityIds: entityShared,
          sharedObservables: observableShared,
          sameProviderIncidentId,
          sameDetectionProduct,
          detectionProduct: sameDetectionProduct ? a.detectionProduct : null,
          withinTimeWindow,
          timeDeltaMinutes: delta === null ? null : Math.round(delta),
          sameTenant: false,
          tenantId: null,
          sharedAttackTechniques: attackShared,
        },
        explanation: "Different tenants; rule requires same tenant",
      };
    }
  }

  // Binary signals contribute full weight when true; set-overlap signals
  // contribute proportional to Jaccard of non-empty sides.
  const entityUniverse = new Set([...a.entityIds, ...b.entityIds]).size;
  const entityRatio =
    entityUniverse === 0 ? 0 : entityShared.length / entityUniverse;
  const obsUniverse = new Set([
    ...a.observableValues.map(normalizeToken),
    ...b.observableValues.map(normalizeToken),
  ]).size;
  const obsRatio =
    obsUniverse === 0 ? 0 : observableShared.length / obsUniverse;
  const attackUniverse = new Set([
    ...a.attackTechniqueIds.map(normalizeToken),
    ...b.attackTechniqueIds.map(normalizeToken),
  ]).size;
  const attackRatio =
    attackUniverse === 0 ? 0 : attackShared.length / attackUniverse;

  const totalWeight =
    w.sharedEntities +
    w.sharedObservables +
    w.providerIncidentId +
    w.detectionProduct +
    w.timeWindow +
    w.tenant +
    w.attackTechniques;

  let score = 0;
  score += weightContribution(w.sharedEntities, totalWeight, entityRatio);
  score += weightContribution(w.sharedObservables, totalWeight, obsRatio);
  score += weightContribution(
    w.providerIncidentId,
    totalWeight,
    sameProviderIncidentId ? 1 : 0,
  );
  score += weightContribution(
    w.detectionProduct,
    totalWeight,
    sameDetectionProduct ? 1 : 0,
  );
  score += weightContribution(
    w.timeWindow,
    totalWeight,
    withinTimeWindow ? 1 : 0,
  );
  score += weightContribution(w.tenant, totalWeight, sameTenant ? 1 : 0);
  score += weightContribution(w.attackTechniques, totalWeight, attackRatio);

  // Exact same provider incident is a near-certain correlate.
  if (sameProviderIncidentId) {
    score = Math.max(score, 95);
  }
  // At least one shared entity alone is a strong signal.
  if (entityShared.length > 0) {
    score = Math.max(score, Math.min(100, 50 + entityShared.length * 10));
  }

  const rounded = Math.max(0, Math.min(100, Math.round(score)));
  const matchedSignals: CorrelationMatchedSignals = {
    sharedEntityIds: entityShared,
    sharedObservables: observableShared,
    sameProviderIncidentId,
    sameDetectionProduct,
    detectionProduct: sameDetectionProduct ? a.detectionProduct : null,
    withinTimeWindow,
    timeDeltaMinutes: delta === null ? null : Math.round(delta),
    sameTenant,
    tenantId: sameTenant ? a.tenantId : null,
    sharedAttackTechniques: attackShared,
  };

  return {
    score: rounded,
    matchedSignals,
    explanation: explainSignals(matchedSignals, rounded),
  };
}

export function explainSignals(
  signals: CorrelationMatchedSignals,
  score: number,
): string {
  const parts: string[] = [];
  if (signals.sameProviderIncidentId) {
    parts.push("same provider incident id");
  }
  if (signals.sharedEntityIds.length > 0) {
    parts.push(
      `${signals.sharedEntityIds.length} shared entit${signals.sharedEntityIds.length === 1 ? "y" : "ies"}`,
    );
  }
  if (signals.sharedObservables.length > 0) {
    parts.push(
      `${signals.sharedObservables.length} shared observable${signals.sharedObservables.length === 1 ? "" : "s"}`,
    );
  }
  if (signals.sameDetectionProduct && signals.detectionProduct) {
    parts.push(`detection product ${signals.detectionProduct}`);
  }
  if (signals.sharedAttackTechniques.length > 0) {
    parts.push(
      `ATT&CK ${signals.sharedAttackTechniques.slice(0, 3).join(", ")}`,
    );
  }
  if (signals.withinTimeWindow && signals.timeDeltaMinutes !== null) {
    parts.push(`within ${signals.timeDeltaMinutes}m`);
  }
  if (signals.sameTenant && signals.tenantId) {
    parts.push(`tenant ${signals.tenantId}`);
  }
  if (parts.length === 0) return `Score ${score} with no strong shared signals`;
  return `Score ${score}: ${parts.join("; ")}`;
}

/**
 * Suggest an action kind from a scored pair and their current case membership.
 * - both unlinked → group_alerts
 * - one linked, one not → attach_to_case
 * - both linked to different cases → merge_cases
 * - same case → null (already co-located)
 */
export function suggestKindForPair(
  a: AlertScoringInput,
  b: AlertScoringInput,
): "group_alerts" | "attach_to_case" | "merge_cases" | null {
  const casesA = new Set(a.caseIds);
  const casesB = new Set(b.caseIds);
  if (casesA.size === 0 && casesB.size === 0) return "group_alerts";
  if (casesA.size === 0 || casesB.size === 0) return "attach_to_case";
  for (const id of casesA) {
    if (casesB.has(id)) return null;
  }
  return "merge_cases";
}

/** Stable fingerprint for a pending suggestion so re-eval is idempotent. */
export function suggestionFingerprint(
  kind: string,
  alertIds: string[],
  caseIds: string[],
  ruleKey: string,
): string {
  const alerts = [...alertIds].sort().join(",");
  const cases = [...caseIds].sort().join(",");
  return `${ruleKey}|${kind}|a:${alerts}|c:${cases}`;
}
