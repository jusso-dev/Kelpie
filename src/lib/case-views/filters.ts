/**
 * Build organisation-scoped case filter SQL from a CaseViewConfig / URL state.
 * Shared by the cases page, complete counts, and widget aggregates so page
 * rows and inbox counts always evaluate the same predicates.
 */
import {
  and,
  eq,
  ilike,
  inArray,
  isNull,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import {
  attackCatalogVersions,
  attackTechniqueMappings,
  attackTechniques,
  casePriorityScores,
  cases,
} from "@/db/schema";
import { caseSlaAtRiskSql, caseSlaBreachedSql, caseSlaWarningSql } from "@/lib/sla";
import type { CaseViewConfig } from "./config";

export type CaseFilterContext = {
  organisationId: string;
  userId: string;
  /** Watched case ids for the current user (empty ⇒ no watched matches). */
  watchedCaseIds: string[];
};

/**
 * Returns SQL clauses for the case list. Always includes organisation scope.
 * Caller should `and(...clauses)`.
 */
export function buildCaseFilterClauses(
  config: Pick<
    CaseViewConfig,
    | "q"
    | "status"
    | "severity"
    | "classification"
    | "tlp"
    | "assignee"
    | "queueId"
    | "view"
    | "tag"
    | "dataTag"
    | "source"
    | "technique"
    | "tactic"
    | "sla"
    | "priorityBand"
    | "minPriorityScore"
  >,
  ctx: CaseFilterContext,
): SQL[] {
  const filters: SQL[] = [eq(cases.organisationId, ctx.organisationId)];

  if (config.q) {
    filters.push(
      or(
        ilike(cases.caseNumber, `%${config.q}%`),
        ilike(cases.title, `%${config.q}%`),
      )!,
    );
  }
  if (config.status) filters.push(eq(cases.status, config.status));
  if (config.severity) filters.push(eq(cases.severity, config.severity));
  if (config.classification) {
    filters.push(eq(cases.classification, config.classification));
  }
  if (config.tlp) filters.push(eq(cases.tlp, config.tlp));
  if (config.assignee === "mine") {
    filters.push(eq(cases.assigneeId, ctx.userId));
  } else if (config.assignee === "unassigned") {
    filters.push(isNull(cases.assigneeId));
  } else if (config.assignee) {
    filters.push(eq(cases.assigneeId, config.assignee));
  }
  if (config.tag) filters.push(sql`${cases.tags} ? ${config.tag}`);
  if (config.dataTag) {
    filters.push(sql`${cases.dataClassificationTags} ? ${config.dataTag}`);
  }
  if (config.source) filters.push(eq(cases.sourceSystem, config.source));
  if (config.queueId === "none") {
    filters.push(isNull(cases.queueId));
  } else if (config.queueId) {
    filters.push(eq(cases.queueId, config.queueId));
  }
  if (config.technique) {
    filters.push(
      sql`EXISTS (SELECT 1 FROM ${attackTechniqueMappings} m WHERE m.case_id = ${cases.id} AND m.technique_id = ${config.technique})`,
    );
  }
  if (config.tactic) {
    filters.push(
      sql`EXISTS (
        SELECT 1 FROM ${attackTechniqueMappings} m
        WHERE m.case_id = ${cases.id}
          AND EXISTS (
            SELECT 1 FROM ${attackTechniques} t
            WHERE t.technique_id = m.technique_id
              AND t.catalog_version_id = (
                SELECT id FROM ${attackCatalogVersions} WHERE status = 'active' LIMIT 1
              )
              AND EXISTS (SELECT 1 FROM jsonb_array_elements(t.tactics) elem WHERE elem->>'id' = ${config.tactic})
          )
      )`,
    );
  }

  if (config.sla === "risk") filters.push(caseSlaAtRiskSql());

  // Built-in operational views (#54): indexed predicates, not client-side.
  switch (config.view) {
    case "unassigned":
      filters.push(isNull(cases.assigneeId));
      break;
    case "mine":
      filters.push(
        or(
          eq(cases.assigneeId, ctx.userId),
          sql`exists (select 1 from case_assignees ca where ca.case_id = ${cases.id} and ca.user_id = ${ctx.userId})`,
        )!,
      );
      break;
    case "watched":
      filters.push(
        ctx.watchedCaseIds.length > 0
          ? inArray(cases.id, ctx.watchedCaseIds)
          : sql`false`,
      );
      break;
    case "sla_warning":
      filters.push(caseSlaWarningSql());
      break;
    case "sla_breached":
      filters.push(caseSlaBreachedSql());
      break;
    case "awaiting_third_party":
      filters.push(eq(cases.waitingReason, "third_party"));
      break;
    case "awaiting_approval":
      filters.push(eq(cases.waitingReason, "approval"));
      break;
    case "stale_investigation":
      filters.push(
        sql`${cases.status} = 'in_progress' and now() - ${cases.lastActivityAt} > interval '3 days'`,
      );
      break;
    case "recently_reopened":
      filters.push(
        sql`${cases.lastReopenedAt} is not null and now() - ${cases.lastReopenedAt} < interval '7 days'`,
      );
      break;
  }

  // Optional #59 priority filters via indexed case_priority_scores join predicates.
  if (config.priorityBand) {
    filters.push(
      sql`EXISTS (
        SELECT 1 FROM ${casePriorityScores} cps
        WHERE cps.case_id = ${cases.id}
          AND cps.organisation_id = ${ctx.organisationId}
          AND cps.score_band = ${config.priorityBand}
      )`,
    );
  }
  if (config.minPriorityScore !== undefined) {
    filters.push(
      sql`EXISTS (
        SELECT 1 FROM ${casePriorityScores} cps
        WHERE cps.case_id = ${cases.id}
          AND cps.organisation_id = ${ctx.organisationId}
          AND cps.effective_score >= ${config.minPriorityScore}
      )`,
    );
  }

  return filters;
}

export function caseFilterWhere(
  config: Parameters<typeof buildCaseFilterClauses>[0],
  ctx: CaseFilterContext,
): SQL | undefined {
  return and(...buildCaseFilterClauses(config, ctx));
}


