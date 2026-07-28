/**
 * Correlation evaluation and suggestion lifecycle (issue #56).
 *
 * Evaluation is deterministic and transparent: each suggestion stores score,
 * contributing signals, rule key/version, and status. Suggestions never
 * mutate cases unless the organisation policy explicitly enables auto-merge
 * AND the rule is not in dry-run mode AND the score meets the auto threshold.
 */

import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  alertEntities,
  alerts,
  caseAlerts,
  correlationRules,
  correlationSuggestions,
  entities,
  organisations,
  type CorrelationRule,
  type CorrelationSuggestion,
} from "@/db/schema";
import { newId } from "@/lib/utils";
import { writeTimelineEvent } from "@/lib/timeline";
import { recordAuditEvent } from "@/lib/audit/events";
import {
  type AlertScoringInput,
  type CorrelationRuleConfig,
  mergeRuleConfig,
  scoreAlertPair,
  suggestKindForPair,
  suggestionFingerprint,
} from "./scoring";
import { parseCorrelationPolicy, type CorrelationPolicy } from "./policy";
import {
  attachAlertsToCaseCore,
  CorrelationError,
  createCaseFromAlertsCore,
  mergeCasesCore,
} from "./membership-core";
import {
  bumpRuleMetric,
  getCorrelationRuleCore,
  listActiveRulesForOrg,
} from "./rules-core";

const MAX_ALERTS_PER_EVAL = 200;
const MAX_PAIRS_PER_RULE = 100;

async function loadAlertFeatures(
  organisationId: string,
  alertIds?: string[],
): Promise<AlertScoringInput[]> {
  const conditions = [eq(alerts.organisationId, organisationId)];
  if (alertIds && alertIds.length > 0) {
    conditions.push(inArray(alerts.id, alertIds));
  }
  const rows = await db
    .select()
    .from(alerts)
    .where(and(...conditions))
    .orderBy(desc(alerts.detectedAt), desc(alerts.createdAt))
    .limit(MAX_ALERTS_PER_EVAL);

  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const [entityLinks, memberships, entityRows] = await Promise.all([
    db
      .select({
        alertId: alertEntities.alertId,
        entityId: alertEntities.entityId,
      })
      .from(alertEntities)
      .where(
        and(
          eq(alertEntities.organisationId, organisationId),
          inArray(alertEntities.alertId, ids),
        ),
      ),
    db
      .select({
        alertId: caseAlerts.alertId,
        caseId: caseAlerts.caseId,
      })
      .from(caseAlerts)
      .where(
        and(
          eq(caseAlerts.organisationId, organisationId),
          inArray(caseAlerts.alertId, ids),
        ),
      ),
    db
      .select({
        id: entities.id,
        canonicalKey: entities.canonicalKey,
      })
      .from(entities)
      .where(eq(entities.organisationId, organisationId)),
  ]);

  const entityById = new Map(entityRows.map((e) => [e.id, e]));
  const entitiesByAlert = new Map<string, string[]>();
  const observablesByAlert = new Map<string, string[]>();
  for (const link of entityLinks) {
    const list = entitiesByAlert.get(link.alertId) ?? [];
    list.push(link.entityId);
    entitiesByAlert.set(link.alertId, list);
    const ent = entityById.get(link.entityId);
    if (ent) {
      const obs = observablesByAlert.get(link.alertId) ?? [];
      obs.push(ent.canonicalKey);
      observablesByAlert.set(link.alertId, obs);
    }
  }
  const casesByAlert = new Map<string, string[]>();
  for (const m of memberships) {
    const list = casesByAlert.get(m.alertId) ?? [];
    list.push(m.caseId);
    casesByAlert.set(m.alertId, list);
  }

  return rows.map((row) => {
    const techniques = Array.isArray(row.attackTechniques)
      ? (row.attackTechniques as unknown[])
          .map((t) => {
            if (typeof t === "string") return t;
            if (t && typeof t === "object" && "id" in t) {
              return String((t as { id: unknown }).id);
            }
            return null;
          })
          .filter((t): t is string => Boolean(t))
      : [];
    return {
      id: row.id,
      title: row.title,
      tenantId: row.tenantId ?? "",
      externalId: row.externalId,
      sourceId: row.sourceId,
      detectionProduct: row.detectionProduct,
      detectionSource: row.detectionSource,
      detectedAt: row.detectedAt,
      entityIds: entitiesByAlert.get(row.id) ?? [],
      observableValues: observablesByAlert.get(row.id) ?? [],
      attackTechniqueIds: techniques,
      caseIds: casesByAlert.get(row.id) ?? [],
    };
  });
}

function pairCaseIds(a: AlertScoringInput, b: AlertScoringInput): string[] {
  return [...new Set([...a.caseIds, ...b.caseIds])];
}

function targetCaseForPair(
  kind: "group_alerts" | "attach_to_case" | "merge_cases",
  a: AlertScoringInput,
  b: AlertScoringInput,
): string | null {
  if (kind === "attach_to_case") {
    return a.caseIds[0] ?? b.caseIds[0] ?? null;
  }
  if (kind === "merge_cases") {
    const all = pairCaseIds(a, b).sort();
    return all[0] ?? null;
  }
  return null;
}

export type EvaluateCorrelationResult = {
  suggestions: CorrelationSuggestion[];
  evaluatedPairs: number;
  created: number;
  skippedExisting: number;
  autoApplied: number;
  dryRun: boolean;
  ruleId: string;
  ruleKey: string;
  ruleVersion: number;
};

async function evaluateOneRule(opts: {
  organisationId: string;
  actorId: string | null;
  rule: CorrelationRule;
  features: AlertScoringInput[];
  policy: CorrelationPolicy;
  forceDryRun: boolean;
}): Promise<EvaluateCorrelationResult> {
  const config = mergeRuleConfig(
    opts.rule.config as Partial<CorrelationRuleConfig>,
  );
  const dryRun = opts.forceDryRun || opts.rule.dryRun;
  const created: CorrelationSuggestion[] = [];
  let evaluatedPairs = 0;
  let skippedExisting = 0;
  let autoApplied = 0;

  const features = opts.features;
  for (let i = 0; i < features.length; i++) {
    for (let j = i + 1; j < features.length; j++) {
      if (created.length + skippedExisting >= MAX_PAIRS_PER_RULE) break;
      const a = features[i]!;
      const b = features[j]!;
      evaluatedPairs += 1;

      const kind = suggestKindForPair(a, b);
      if (!kind) continue;

      const scored = scoreAlertPair(a, b, config);
      if (scored.score < opts.rule.scoreThreshold) continue;

      const alertIds = [a.id, b.id].sort();
      const caseIds = pairCaseIds(a, b);
      const targetCaseId = targetCaseForPair(kind, a, b);
      const fingerprint = suggestionFingerprint(
        kind,
        alertIds,
        caseIds,
        opts.rule.ruleKey,
      );

      const [existing] = await db
        .select()
        .from(correlationSuggestions)
        .where(
          and(
            eq(correlationSuggestions.organisationId, opts.organisationId),
            eq(correlationSuggestions.fingerprint, fingerprint),
            eq(correlationSuggestions.status, "pending"),
          ),
        )
        .limit(1);
      if (existing) {
        skippedExisting += 1;
        continue;
      }

      const [inserted] = await db
        .insert(correlationSuggestions)
        .values({
          id: newId("corsug"),
          organisationId: opts.organisationId,
          ruleId: opts.rule.id,
          ruleKey: opts.rule.ruleKey,
          ruleVersion: opts.rule.version,
          kind,
          status: "pending",
          score: scored.score,
          contributingSignals: scored.matchedSignals,
          alertIds,
          caseIds,
          targetCaseId,
          explanation: scored.explanation,
          fingerprint,
        })
        .onConflictDoNothing()
        .returning();

      if (!inserted) {
        skippedExisting += 1;
        continue;
      }

      created.push(inserted);
      await bumpRuleMetric({
        organisationId: opts.organisationId,
        ruleKey: opts.rule.ruleKey,
        ruleVersion: opts.rule.version,
        field: "suggestionCount",
      });

      const canAuto =
        !dryRun &&
        opts.policy.autoMergeEnabled &&
        (opts.policy.autoAcceptThreshold === null ||
          scored.score >= opts.policy.autoAcceptThreshold);

      if (canAuto && (kind === "merge_cases" || kind === "attach_to_case")) {
        try {
          await acceptSuggestionCore({
            organisationId: opts.organisationId,
            actorId: opts.actorId,
            suggestionId: inserted.id,
            reason: `Auto-applied by policy (score ${scored.score})`,
            autoApplied: true,
          });
          autoApplied += 1;
        } catch {
          // Leave pending if auto-apply fails (e.g. version conflict).
        }
      }
    }
  }

  return {
    suggestions: created,
    evaluatedPairs,
    created: created.length,
    skippedExisting,
    autoApplied,
    dryRun,
    ruleId: opts.rule.id,
    ruleKey: opts.rule.ruleKey,
    ruleVersion: opts.rule.version,
  };
}

/**
 * Evaluate one rule (or all active rules) against recent org alerts.
 * Always records suggestions; never auto-mutates when rule.dryRun or when
 * org policy.autoMergeEnabled is false.
 */
export async function evaluateCorrelationCore(opts: {
  organisationId: string;
  actorId: string | null;
  ruleId?: string;
  alertIds?: string[];
  /** When true, force dry-run even if the rule has dryRun=false. */
  forceDryRun?: boolean;
}): Promise<EvaluateCorrelationResult[]> {
  let rules: CorrelationRule[];
  if (opts.ruleId) {
    const rule = await getCorrelationRuleCore(
      opts.organisationId,
      opts.ruleId,
    );
    if (!rule) throw new CorrelationError("Rule not found", 404);
    rules = [rule];
  } else {
    rules = await listActiveRulesForOrg(opts.organisationId);
  }
  if (rules.length === 0) {
    throw new CorrelationError("No active correlation rules to evaluate", 404);
  }

  const features = await loadAlertFeatures(
    opts.organisationId,
    opts.alertIds,
  );
  const [org] = await db
    .select({ settings: organisations.settings })
    .from(organisations)
    .where(eq(organisations.id, opts.organisationId))
    .limit(1);
  const policy = parseCorrelationPolicy(org?.settings);

  const results: EvaluateCorrelationResult[] = [];
  for (const rule of rules) {
    results.push(
      await evaluateOneRule({
        organisationId: opts.organisationId,
        actorId: opts.actorId,
        rule,
        features,
        policy,
        forceDryRun: opts.forceDryRun === true,
      }),
    );
  }
  return results;
}

export async function listSuggestionsCore(opts: {
  organisationId: string;
  status?: "pending" | "accepted" | "rejected" | "expired" | "auto_applied";
  caseId?: string;
  limit?: number;
}): Promise<CorrelationSuggestion[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const rows = await db
    .select()
    .from(correlationSuggestions)
    .where(
      and(
        eq(correlationSuggestions.organisationId, opts.organisationId),
        opts.status
          ? eq(correlationSuggestions.status, opts.status)
          : undefined,
      ),
    )
    .orderBy(desc(correlationSuggestions.generatedAt))
    .limit(limit * 2);

  if (!opts.caseId) return rows.slice(0, limit);

  return rows
    .filter((row) => {
      const caseIds = Array.isArray(row.caseIds)
        ? (row.caseIds as string[])
        : [];
      return caseIds.includes(opts.caseId!) || row.targetCaseId === opts.caseId;
    })
    .slice(0, limit);
}

export async function getSuggestionInOrg(
  suggestionId: string,
  organisationId: string,
): Promise<CorrelationSuggestion | null> {
  const [row] = await db
    .select()
    .from(correlationSuggestions)
    .where(
      and(
        eq(correlationSuggestions.id, suggestionId),
        eq(correlationSuggestions.organisationId, organisationId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function rejectSuggestionCore(opts: {
  organisationId: string;
  actorId: string | null;
  suggestionId: string;
  reason: string;
}): Promise<CorrelationSuggestion> {
  const reason = opts.reason.trim();
  if (!reason) {
    throw new CorrelationError(
      "A reason is required to reject a suggestion",
    );
  }

  const suggestion = await getSuggestionInOrg(
    opts.suggestionId,
    opts.organisationId,
  );
  if (!suggestion) throw new CorrelationError("Suggestion not found", 404);
  if (suggestion.status !== "pending") {
    throw new CorrelationError(
      `Suggestion is already ${suggestion.status}`,
      409,
    );
  }

  const [updated] = await db
    .update(correlationSuggestions)
    .set({
      status: "rejected",
      resolvedAt: new Date(),
      resolvedBy: opts.actorId,
      resolveReason: reason,
    })
    .where(
      and(
        eq(correlationSuggestions.id, suggestion.id),
        eq(correlationSuggestions.status, "pending"),
      ),
    )
    .returning();
  if (!updated) {
    throw new CorrelationError("Suggestion is no longer pending", 409);
  }

  await bumpRuleMetric({
    organisationId: opts.organisationId,
    ruleKey: suggestion.ruleKey,
    ruleVersion: suggestion.ruleVersion,
    field: "rejectedCount",
  });

  const caseIds = Array.isArray(suggestion.caseIds)
    ? (suggestion.caseIds as string[])
    : [];
  for (const caseId of caseIds) {
    await writeTimelineEvent({
      caseId,
      actorId: opts.actorId,
      eventType: "correlation_suggestion_rejected",
      payload: {
        suggestion_id: suggestion.id,
        score: suggestion.score,
        explanation: suggestion.explanation,
        reason,
        kind: suggestion.kind,
      },
    });
  }

  await recordAuditEvent({
    organisationId: opts.organisationId,
    actorId: opts.actorId,
    actorType: opts.actorId ? "user" : "system",
    action: "correlation.suggestion_rejected",
    targetType: "correlation_suggestion",
    targetId: suggestion.id,
    metadata: {
      reason,
      score: suggestion.score,
      kind: suggestion.kind,
      alert_ids: suggestion.alertIds,
      case_ids: suggestion.caseIds,
    },
  });

  return updated;
}

export async function acceptSuggestionCore(opts: {
  organisationId: string;
  actorId: string | null;
  suggestionId: string;
  reason: string;
  autoApplied?: boolean;
  expectedVersions?: Record<string, number>;
}): Promise<{
  suggestion: CorrelationSuggestion;
  result: Record<string, unknown>;
}> {
  const reason = opts.reason.trim();
  if (!reason) {
    throw new CorrelationError(
      "A reason is required to accept a suggestion",
    );
  }

  const suggestion = await getSuggestionInOrg(
    opts.suggestionId,
    opts.organisationId,
  );
  if (!suggestion) throw new CorrelationError("Suggestion not found", 404);
  if (suggestion.status !== "pending") {
    throw new CorrelationError(
      `Suggestion is already ${suggestion.status}`,
      409,
    );
  }

  const alertIds = Array.isArray(suggestion.alertIds)
    ? (suggestion.alertIds as string[])
    : [];
  const caseIds = Array.isArray(suggestion.caseIds)
    ? (suggestion.caseIds as string[])
    : [];

  let result: Record<string, unknown> = {};

  if (suggestion.kind === "group_alerts") {
    result = await createCaseFromAlertsCore({
      organisationId: opts.organisationId,
      actorId: opts.actorId,
      alertIds,
      reason,
      suggestionId: suggestion.id,
      expectedVersions: opts.expectedVersions,
    });
  } else if (suggestion.kind === "attach_to_case") {
    const target =
      suggestion.targetCaseId ??
      caseIds.find((id) => id) ??
      null;
    if (!target) {
      throw new CorrelationError(
        "Suggestion has no target case to attach to",
        409,
      );
    }
    // Attach alerts that are not already on the target.
    const already = await db
      .select({ alertId: caseAlerts.alertId })
      .from(caseAlerts)
      .where(
        and(
          eq(caseAlerts.organisationId, opts.organisationId),
          eq(caseAlerts.caseId, target),
          inArray(caseAlerts.alertId, alertIds),
        ),
      );
    const alreadySet = new Set(already.map((r) => r.alertId));
    const toAttach = alertIds.filter((id) => !alreadySet.has(id));
    if (toAttach.length > 0) {
      result = await attachAlertsToCaseCore({
        organisationId: opts.organisationId,
        actorId: opts.actorId,
        caseId: target,
        alertIds: toAttach,
        reason,
        suggestionId: suggestion.id,
        expectedVersions: opts.expectedVersions,
      });
    } else {
      result = { attachedAlertIds: [], operationId: null };
    }
  } else if (suggestion.kind === "merge_cases") {
    const canonical =
      suggestion.targetCaseId ??
      [...caseIds].sort()[0] ??
      null;
    if (!canonical) {
      throw new CorrelationError("Suggestion has no cases to merge", 409);
    }
    const sources = caseIds.filter((id) => id !== canonical);
    if (sources.length === 0) {
      throw new CorrelationError(
        "Suggestion does not span multiple cases",
        409,
      );
    }
    result = await mergeCasesCore({
      organisationId: opts.organisationId,
      actorId: opts.actorId,
      canonicalCaseId: canonical,
      sourceCaseIds: sources,
      reason,
      suggestionId: suggestion.id,
      expectedVersions: opts.expectedVersions,
      autoApplied: opts.autoApplied === true,
    });
  } else {
    throw new CorrelationError("Unknown suggestion kind", 400);
  }

  const newStatus = opts.autoApplied ? "auto_applied" : "accepted";
  const [updated] = await db
    .update(correlationSuggestions)
    .set({
      status: newStatus,
      resolvedAt: new Date(),
      resolvedBy: opts.actorId,
      resolveReason: reason,
    })
    .where(
      and(
        eq(correlationSuggestions.id, suggestion.id),
        eq(correlationSuggestions.status, "pending"),
      ),
    )
    .returning();
  if (!updated) {
    throw new CorrelationError("Suggestion is no longer pending", 409);
  }

  await bumpRuleMetric({
    organisationId: opts.organisationId,
    ruleKey: suggestion.ruleKey,
    ruleVersion: suggestion.ruleVersion,
    field: opts.autoApplied ? "autoAppliedCount" : "acceptedCount",
  });

  for (const caseId of caseIds) {
    await writeTimelineEvent({
      caseId,
      actorId: opts.actorId,
      eventType: "correlation_suggestion_accepted",
      payload: {
        suggestion_id: suggestion.id,
        score: suggestion.score,
        explanation: suggestion.explanation,
        reason,
        kind: suggestion.kind,
        auto_applied: opts.autoApplied === true,
        contributing_signals: suggestion.contributingSignals,
      },
    });
  }

  await recordAuditEvent({
    organisationId: opts.organisationId,
    actorId: opts.actorId,
    actorType: opts.actorId ? "user" : "system",
    action: opts.autoApplied
      ? "correlation.suggestion_auto_applied"
      : "correlation.suggestion_accepted",
    targetType: "correlation_suggestion",
    targetId: suggestion.id,
    metadata: {
      reason,
      score: suggestion.score,
      kind: suggestion.kind,
      alert_ids: alertIds,
      case_ids: caseIds,
      result,
    },
  });

  return { suggestion: updated, result };
}

/** Dry-run evaluation that does not persist suggestions (preview only). */
export async function dryRunCorrelationCore(opts: {
  organisationId: string;
  ruleId?: string;
  alertIds?: string[];
}): Promise<
  Array<{
    ruleKey: string;
    ruleVersion: number;
    pairs: Array<{
      alertIds: string[];
      caseIds: string[];
      kind: string;
      score: number;
      explanation: string;
      contributingSignals: unknown;
    }>;
  }>
> {
  let rules: CorrelationRule[];
  if (opts.ruleId) {
    const rule = await getCorrelationRuleCore(
      opts.organisationId,
      opts.ruleId,
    );
    if (!rule) throw new CorrelationError("Rule not found", 404);
    rules = [rule];
  } else {
    rules = await listActiveRulesForOrg(opts.organisationId);
    if (rules.length === 0) {
      // Fall back to any non-superseded rule for dry-run previews.
      rules = await db
        .select()
        .from(correlationRules)
        .where(eq(correlationRules.organisationId, opts.organisationId))
        .orderBy(desc(correlationRules.version))
        .limit(5);
    }
  }

  const features = await loadAlertFeatures(
    opts.organisationId,
    opts.alertIds,
  );
  const out: Array<{
    ruleKey: string;
    ruleVersion: number;
    pairs: Array<{
      alertIds: string[];
      caseIds: string[];
      kind: string;
      score: number;
      explanation: string;
      contributingSignals: unknown;
    }>;
  }> = [];

  for (const rule of rules) {
    const config = mergeRuleConfig(
      rule.config as Partial<CorrelationRuleConfig>,
    );
    const pairs: Array<{
      alertIds: string[];
      caseIds: string[];
      kind: string;
      score: number;
      explanation: string;
      contributingSignals: unknown;
    }> = [];
    for (let i = 0; i < features.length; i++) {
      for (let j = i + 1; j < features.length; j++) {
        if (pairs.length >= MAX_PAIRS_PER_RULE) break;
        const a = features[i]!;
        const b = features[j]!;
        const kind = suggestKindForPair(a, b);
        if (!kind) continue;
        const scored = scoreAlertPair(a, b, config);
        if (scored.score < rule.scoreThreshold) continue;
        pairs.push({
          alertIds: [a.id, b.id].sort(),
          caseIds: pairCaseIds(a, b),
          kind,
          score: scored.score,
          explanation: scored.explanation,
          contributingSignals: scored.matchedSignals,
        });
      }
    }
    out.push({
      ruleKey: rule.ruleKey,
      ruleVersion: rule.version,
      pairs,
    });
  }
  return out;
}
