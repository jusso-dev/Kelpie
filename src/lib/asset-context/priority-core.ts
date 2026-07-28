/**
 * DB-backed case priority calculation and analyst override (issue #59).
 * Recalculation never clears analystOverrideScore.
 */

import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  alertEntities,
  attackTechniqueMappings,
  caseAlerts,
  casePriorityScores,
  caseRelationships,
  cases,
  observables,
  tiIndicators,
  type Case,
  type CasePriorityScore,
} from "@/db/schema";
import { getTechniquesByIds } from "@/lib/attack/catalog-core";
import { newId } from "@/lib/utils";
import {
  effectiveContextFields,
  isContextStale,
  scoreBandFromScore,
} from "./effective";
import { listContextsForEntityIds } from "./context-core";
import {
  attackStageScoreFromTactics,
  calculatePriorityScore,
} from "./scoring";
import { getPriorityScoringSettings } from "./settings";
import {
  AssetContextError,
  type CaseScoringInput,
  type ContextScoringInput,
  PRIORITY_CALCULATION_VERSION,
} from "./types";

async function loadCaseInOrg(
  caseId: string,
  organisationId: string,
): Promise<Case | null> {
  const [row] = await db
    .select()
    .from(cases)
    .where(and(eq(cases.id, caseId), eq(cases.organisationId, organisationId)))
    .limit(1);
  return row ?? null;
}

async function entityIdsForCase(
  organisationId: string,
  caseId: string,
): Promise<string[]> {
  const alertIdRows = await db
    .select({ alertId: caseAlerts.alertId })
    .from(caseAlerts)
    .where(
      and(
        eq(caseAlerts.caseId, caseId),
        eq(caseAlerts.organisationId, organisationId),
      ),
    );
  const alertIds = alertIdRows.map((r) => r.alertId);
  if (alertIds.length === 0) return [];

  const linkRows = await db
    .select({ entityId: alertEntities.entityId })
    .from(alertEntities)
    .where(
      and(
        inArray(alertEntities.alertId, alertIds),
        eq(alertEntities.organisationId, organisationId),
      ),
    );
  return [...new Set(linkRows.map((r) => r.entityId))];
}

async function attackStageForCase(
  organisationId: string,
  caseId: string,
): Promise<number | null> {
  const mappings = await db
    .select({ techniqueId: attackTechniqueMappings.techniqueId })
    .from(attackTechniqueMappings)
    .where(
      and(
        eq(attackTechniqueMappings.organisationId, organisationId),
        eq(attackTechniqueMappings.caseId, caseId),
      ),
    );
  if (mappings.length === 0) return null;
  const techniqueIds = [...new Set(mappings.map((m) => m.techniqueId))];
  let tactics: string[] = [];
  try {
    const techniques = await getTechniquesByIds(techniqueIds);
    for (const t of techniques) {
      const list = Array.isArray(t.tactics) ? t.tactics : [];
      for (const tac of list as Array<string | { id: string }>) {
        if (typeof tac === "string") tactics.push(tac);
        else if (tac && typeof tac === "object" && "id" in tac) {
          tactics.push(String(tac.id));
        }
      }
    }
  } catch {
    tactics = [];
  }
  return attackStageScoreFromTactics(tactics);
}

async function tiConfidenceForCase(
  organisationId: string,
  caseId: string,
): Promise<number | null> {
  const obs = await db
    .select({ value: observables.value })
    .from(observables)
    .where(eq(observables.caseId, caseId));
  if (obs.length === 0) return null;
  const values = obs.map((o) => o.value);
  const matches = await db
    .select({ confidence: tiIndicators.confidence })
    .from(tiIndicators)
    .where(
      and(
        eq(tiIndicators.organisationId, organisationId),
        inArray(tiIndicators.value, values),
      ),
    );
  if (matches.length === 0) return null;
  return Math.max(...matches.map((m) => m.confidence ?? 0));
}

async function relatedOpenCaseCount(
  organisationId: string,
  caseId: string,
): Promise<number> {
  const rels = await db
    .select({
      sourceCaseId: caseRelationships.sourceCaseId,
      targetCaseId: caseRelationships.targetCaseId,
    })
    .from(caseRelationships)
    .where(
      and(
        eq(caseRelationships.organisationId, organisationId),
        sql`(${caseRelationships.sourceCaseId} = ${caseId} or ${caseRelationships.targetCaseId} = ${caseId})`,
      ),
    );
  const otherIds = [
    ...new Set(
      rels.map((r) =>
        r.sourceCaseId === caseId ? r.targetCaseId : r.sourceCaseId,
      ),
    ),
  ];
  if (otherIds.length === 0) return 0;
  const open = await db
    .select({ id: cases.id })
    .from(cases)
    .where(
      and(
        eq(cases.organisationId, organisationId),
        inArray(cases.id, otherIds),
        ne(cases.status, "closed"),
      ),
    );
  return open.length;
}

function slaPressureFromState(slaState: unknown): number {
  if (!slaState || typeof slaState !== "object") return 0;
  const state = slaState as {
    breached?: Record<string, unknown>;
    atRisk?: Record<string, unknown>;
  };
  const breached = state.breached ? Object.keys(state.breached).length : 0;
  if (breached > 0) return 100;
  const atRisk = state.atRisk ? Object.keys(state.atRisk).length : 0;
  if (atRisk > 0) return 50;
  return 0;
}

export async function buildCaseScoringInput(
  organisationId: string,
  caseId: string,
): Promise<{ input: CaseScoringInput; caseRow: Case } | null> {
  const caseRow = await loadCaseInOrg(caseId, organisationId);
  if (!caseRow) return null;

  const settings = await getPriorityScoringSettings(organisationId);
  const entityIds = await entityIdsForCase(organisationId, caseId);
  const contexts = await listContextsForEntityIds(organisationId, entityIds);
  const now = new Date();

  const contextInputs: ContextScoringInput[] = contexts.map((c) => {
    const eff = effectiveContextFields(c);
    return {
      kind: c.kind,
      criticality: eff.criticality,
      privilegeLevel: eff.privilegeLevel,
      exposure: eff.exposure,
      isCrownJewel: eff.isCrownJewel,
      isStale: isContextStale(c, now, settings.staleAfterHours),
    };
  });

  const [attackStageScore, tiConfidence, relatedCount] = await Promise.all([
    attackStageForCase(organisationId, caseId),
    tiConfidenceForCase(organisationId, caseId),
    relatedOpenCaseCount(organisationId, caseId),
  ]);

  return {
    caseRow,
    input: {
      sourceSeverity: caseRow.severity,
      contexts: contextInputs,
      affectedEntityCount: entityIds.length,
      attackStageScore,
      tiConfidence,
      relatedOpenCaseCount: relatedCount,
      slaPressureScore: slaPressureFromState(caseRow.slaState),
    },
  };
}

/**
 * Recalculate and persist priority for a case. Never clears analyst overrides.
 * When scoring is disabled, still stores a severity-only baseline with
 * scoringEnabled=false so the UI can explain the state.
 */
export async function recalculateCasePriorityCore(
  organisationId: string,
  caseId: string,
): Promise<CasePriorityScore | null> {
  const built = await buildCaseScoringInput(organisationId, caseId);
  if (!built) return null;

  const settings = await getPriorityScoringSettings(organisationId);
  const result = settings.enabled
    ? calculatePriorityScore(
        built.input,
        settings.weights,
        settings.staleContextPolicy,
      )
    : calculatePriorityScore(
        {
          ...built.input,
          contexts: [],
          affectedEntityCount: 0,
          attackStageScore: null,
          tiConfidence: null,
          relatedOpenCaseCount: 0,
          slaPressureScore: 0,
        },
        { ...settings.weights, sourceSeverity: 1 },
        settings.staleContextPolicy,
      );

  const [existing] = await db
    .select()
    .from(casePriorityScores)
    .where(eq(casePriorityScores.caseId, caseId))
    .limit(1);

  const effectiveScore =
    existing?.analystOverrideScore != null
      ? existing.analystOverrideScore
      : result.calculatedScore;
  const scoreBand = scoreBandFromScore(effectiveScore);
  const now = new Date();

  const values = {
    organisationId,
    caseId,
    calculatedScore: result.calculatedScore,
    scoreBand,
    effectiveScore,
    calculationVersion: result.calculationVersion,
    factors: result.factors,
    weightsUsed: result.weightsUsed,
    inputsSnapshot: {
      sourceSeverity: built.input.sourceSeverity,
      contextCount: built.input.contexts.length,
      affectedEntityCount: built.input.affectedEntityCount,
      attackStageScore: built.input.attackStageScore,
      tiConfidence: built.input.tiConfidence,
      relatedOpenCaseCount: built.input.relatedOpenCaseCount,
      slaPressureScore: built.input.slaPressureScore,
    },
    scoringEnabled: settings.enabled,
    staleContextPolicy: settings.staleContextPolicy,
    hasCriticalContext: result.hasCriticalContext,
    hasCrownJewelContext: result.hasCrownJewelContext,
    hasStaleContext: result.hasStaleContext,
    calculatedAt: now,
    updatedAt: now,
  };

  if (existing) {
    const [updated] = await db
      .update(casePriorityScores)
      .set(values)
      .where(
        and(
          eq(casePriorityScores.id, existing.id),
          eq(casePriorityScores.organisationId, organisationId),
        ),
      )
      .returning();
    return updated ?? null;
  }

  const [inserted] = await db
    .insert(casePriorityScores)
    .values({
      id: newId("cps"),
      ...values,
      analystOverrideScore: null,
      analystOverrideReason: null,
      analystOverrideBy: null,
      analystOverrideAt: null,
    })
    .returning();
  return inserted ?? null;
}

export async function getCasePriorityCore(
  organisationId: string,
  caseId: string,
): Promise<CasePriorityScore | null> {
  const [row] = await db
    .select()
    .from(casePriorityScores)
    .where(
      and(
        eq(casePriorityScores.caseId, caseId),
        eq(casePriorityScores.organisationId, organisationId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function setPriorityOverrideCore(
  organisationId: string,
  caseId: string,
  override: { score: number | null; reason?: string | null },
  actorId: string | null,
): Promise<CasePriorityScore> {
  if (
    override.score !== null &&
    (!Number.isFinite(override.score) ||
      override.score < 0 ||
      override.score > 100)
  ) {
    throw new AssetContextError("Override score must be between 0 and 100");
  }

  let row = await getCasePriorityCore(organisationId, caseId);
  if (!row) {
    row = await recalculateCasePriorityCore(organisationId, caseId);
  }
  if (!row) throw new AssetContextError("Case not found", 404);

  const now = new Date();
  const calculated = row.calculatedScore;
  const effective =
    override.score === null ? calculated : Math.round(override.score);

  const [updated] = await db
    .update(casePriorityScores)
    .set({
      analystOverrideScore: override.score === null ? null : Math.round(override.score),
      analystOverrideReason:
        override.score === null ? null : (override.reason?.trim() || null),
      analystOverrideBy: override.score === null ? null : actorId,
      analystOverrideAt: override.score === null ? null : now,
      effectiveScore: effective,
      scoreBand: scoreBandFromScore(effective),
      updatedAt: now,
    })
    .where(
      and(
        eq(casePriorityScores.id, row.id),
        eq(casePriorityScores.organisationId, organisationId),
      ),
    )
    .returning();
  return updated!;
}

export async function listCriticalContextsForCase(
  organisationId: string,
  caseId: string,
) {
  const entityIds = await entityIdsForCase(organisationId, caseId);
  const contexts = await listContextsForEntityIds(organisationId, entityIds);
  return contexts.filter((c) => {
    const eff = effectiveContextFields(c);
    return (
      eff.isCrownJewel ||
      eff.criticality === "critical" ||
      eff.criticality === "high"
    );
  });
}

export { PRIORITY_CALCULATION_VERSION };
