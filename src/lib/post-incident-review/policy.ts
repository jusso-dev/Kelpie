/**
 * Post-incident review policy evaluation (issue #64).
 *
 * Policies may require a review by severity, classification, template, or
 * organisation setting. Operational case closure and review completion remain
 * separate — a case may close while its required review stays open.
 */

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { organisations } from "@/db/schema";
import {
  CASE_CLASSIFICATIONS,
  CASE_SEVERITIES,
  DEFAULT_ORG_REVIEW_POLICY,
  isCaseClassification,
  isCaseSeverity,
  type CaseClassification,
  type CaseSeverity,
  type OrgReviewPolicy,
  type PolicyEvaluation,
} from "./types";

export function parseOrgReviewPolicy(raw: unknown): OrgReviewPolicy {
  const base = { ...DEFAULT_ORG_REVIEW_POLICY };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
  const o = raw as Record<string, unknown>;
  if (typeof o.enabled === "boolean") base.enabled = o.enabled;
  if (typeof o.requireForAllCases === "boolean") {
    base.requireForAllCases = o.requireForAllCases;
  }
  if (
    typeof o.dueDaysAfterClose === "number" &&
    Number.isFinite(o.dueDaysAfterClose)
  ) {
    base.dueDaysAfterClose = Math.max(
      1,
      Math.min(365, Math.trunc(o.dueDaysAfterClose)),
    );
  }
  if (Array.isArray(o.requireBySeverities)) {
    base.requireBySeverities = o.requireBySeverities.filter(
      (s): s is CaseSeverity => typeof s === "string" && isCaseSeverity(s),
    );
  }
  if (Array.isArray(o.requireByClassifications)) {
    base.requireByClassifications = o.requireByClassifications.filter(
      (c): c is CaseClassification =>
        typeof c === "string" && isCaseClassification(c),
    );
  }
  return base;
}

export async function getOrgReviewPolicy(
  organisationId: string,
): Promise<OrgReviewPolicy> {
  const [row] = await db
    .select({ settings: organisations.settings })
    .from(organisations)
    .where(eq(organisations.id, organisationId))
    .limit(1);
  const settings = (row?.settings as Record<string, unknown>) ?? {};
  return parseOrgReviewPolicy(settings.postIncidentReview);
}

export async function setOrgReviewPolicy(
  organisationId: string,
  policy: OrgReviewPolicy,
): Promise<OrgReviewPolicy> {
  const normalised = parseOrgReviewPolicy(policy);
  const [row] = await db
    .select({ settings: organisations.settings })
    .from(organisations)
    .where(eq(organisations.id, organisationId))
    .limit(1);
  const settings = (row?.settings as Record<string, unknown>) ?? {};
  await db
    .update(organisations)
    .set({
      settings: { ...settings, postIncidentReview: normalised },
    })
    .where(eq(organisations.id, organisationId));
  return normalised;
}

export type CasePolicyInput = {
  severity: string;
  classification: string | null;
};

export type TemplatePolicyInput = {
  requiredSeverities: unknown;
  requiredClassifications: unknown;
  name?: string;
};

function asSeverityList(raw: unknown): CaseSeverity[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (s): s is CaseSeverity => typeof s === "string" && isCaseSeverity(s),
  );
}

function asClassificationList(raw: unknown): CaseClassification[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (c): c is CaseClassification =>
      typeof c === "string" && isCaseClassification(c),
  );
}

/**
 * Evaluate whether a review is required for a case given org + optional
 * template policy. Pure; safe for tests.
 */
export function evaluateReviewRequired(
  orgPolicy: OrgReviewPolicy,
  caseInput: CasePolicyInput,
  template?: TemplatePolicyInput | null,
): PolicyEvaluation {
  const reasons: string[] = [];
  const severity = isCaseSeverity(caseInput.severity)
    ? caseInput.severity
    : null;
  const classification =
    caseInput.classification && isCaseClassification(caseInput.classification)
      ? caseInput.classification
      : null;

  if (orgPolicy.enabled) {
    if (orgPolicy.requireForAllCases) {
      reasons.push("organisation_require_all");
    }
    if (
      severity &&
      orgPolicy.requireBySeverities.includes(severity)
    ) {
      reasons.push(`severity:${severity}`);
    }
    if (
      classification &&
      orgPolicy.requireByClassifications.includes(classification)
    ) {
      reasons.push(`classification:${classification}`);
    }
  }

  if (template) {
    const tSev = asSeverityList(template.requiredSeverities);
    const tClass = asClassificationList(template.requiredClassifications);
    if (severity && tSev.includes(severity)) {
      reasons.push(
        `template_severity:${template.name ?? "template"}:${severity}`,
      );
    }
    if (classification && tClass.includes(classification)) {
      reasons.push(
        `template_classification:${template.name ?? "template"}:${classification}`,
      );
    }
  }

  return {
    required: reasons.length > 0,
    reasons,
    dueDaysAfterClose: orgPolicy.dueDaysAfterClose,
  };
}

/**
 * Case may close operationally while a required review stays open.
 * This helper only describes review/case independence for reporting.
 */
export function reviewOpenWhileCaseClosed(input: {
  caseStatus: string;
  reviewStatus: string;
  requiredByPolicy: boolean;
}): {
  caseClosed: boolean;
  reviewOpen: boolean;
  overdueRisk: boolean;
} {
  const caseClosed = input.caseStatus === "closed";
  const terminal = new Set(["approved", "published", "cancelled"]);
  const reviewOpen = !terminal.has(input.reviewStatus);
  return {
    caseClosed,
    reviewOpen,
    overdueRisk: caseClosed && reviewOpen && input.requiredByPolicy,
  };
}

export { CASE_SEVERITIES, CASE_CLASSIFICATIONS, DEFAULT_ORG_REVIEW_POLICY };
