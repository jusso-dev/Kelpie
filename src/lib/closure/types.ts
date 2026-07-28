/**
 * Case closure policy requirement shapes (issue #57).
 *
 * The shared evaluator in `evaluate.ts` is the only place these configs are
 * interpreted. UI, REST, bulk status, and automation all call that path, so a
 * new requirement type must be added here + in the evaluator + in tests in
 * the same change.
 */

import type { CaseClassification, CaseSeverity } from "@/lib/cases-core";

export const CLOSURE_REQUIREMENT_TYPES = [
  "required_tasks_complete",
  "required_custom_fields",
  "alerts_dispositioned",
  "evidence_verdicts",
  "containment_recorded",
  "eradication_recorded",
  "recovery_recorded",
  "disposition",
  "root_cause_and_conclusion",
  "business_impact_and_lessons",
  "required_approver",
  "response_actions_resolved",
  "related_high_severity_reviewed",
  "post_incident_review",
] as const;

export type ClosureRequirementType = (typeof CLOSURE_REQUIREMENT_TYPES)[number];

export type ClosureRequirementConfig =
  | { type: "required_tasks_complete" }
  | {
      type: "required_custom_fields";
      /** Empty/undefined = every active definition with `required: true`. */
      fieldKeys?: string[];
    }
  | { type: "alerts_dispositioned" }
  | { type: "evidence_verdicts" }
  | { type: "containment_recorded" }
  | { type: "eradication_recorded" }
  | { type: "recovery_recorded" }
  | { type: "disposition" }
  | { type: "root_cause_and_conclusion" }
  | { type: "business_impact_and_lessons" }
  | { type: "required_approver" }
  | { type: "response_actions_resolved" }
  | { type: "related_high_severity_reviewed" }
  | {
      type: "post_incident_review";
      severities?: CaseSeverity[];
      classifications?: CaseClassification[];
    };

export const CLOSURE_DISPOSITIONS = [
  "resolved",
  "false_positive",
  "duplicate",
  "benign",
  "risk_accepted",
] as const;
export type ClosureDisposition = (typeof CLOSURE_DISPOSITIONS)[number];

export const CLOSURE_DETERMINATIONS = [
  "true_positive",
  "false_positive",
  "benign",
  "inconclusive",
  "duplicate",
  "other",
] as const;
export type ClosureDetermination = (typeof CLOSURE_DETERMINATIONS)[number];

/** Disposition + narrative fields supplied by the closer. */
export type ClosureDispositionInput = {
  disposition: string;
  determination?: string | null;
  conclusion: string;
  rootCause?: string | null;
  businessImpact?: string | null;
  lessonsLearned?: string | null;
  /** Second person for required_approver / two-person override. */
  approverId?: string | null;
  /**
   * Related case ids the analyst attests they reviewed. Used by
   * `related_high_severity_reviewed`.
   */
  reviewedRelatedCaseIds?: string[];
  /** Explicit PIR completion flag for `post_incident_review`. */
  postIncidentReviewCompleted?: boolean;
};

export type ClosureRequirementResult = {
  type: ClosureRequirementType;
  label: string;
  passed: boolean;
  /** Human-readable missing pieces (task titles, field keys, alert ids…). */
  missing: string[];
  detail?: string;
};

export type ClosureEvaluation = {
  ok: boolean;
  policyId: string | null;
  policyVersionId: string | null;
  policyVersion: number | null;
  policyName: string | null;
  requireTwoPersonOverride: boolean;
  requirements: ClosureRequirementResult[];
  failed: ClosureRequirementResult[];
};

export type ResolvedClosurePolicy = {
  policyId: string | null;
  policyVersionId: string | null;
  policyVersion: number | null;
  policyName: string | null;
  requirements: ClosureRequirementConfig[];
  requireTwoPersonOverride: boolean;
};

/** Built-in fallback when an organisation has no active policy. */
export const BUILTIN_CLOSURE_REQUIREMENTS: ClosureRequirementConfig[] = [
  { type: "disposition" },
];

export class ClosureRequirementsError extends Error {
  evaluation: ClosureEvaluation;
  status = 422;
  constructor(evaluation: ClosureEvaluation) {
    super("closure_requirements_not_met");
    this.name = "ClosureRequirementsError";
    this.evaluation = evaluation;
  }
}

export class ClosureOverrideError extends Error {
  status: number;
  constructor(message: string, status = 403) {
    super(message);
    this.name = "ClosureOverrideError";
    this.status = status;
  }
}

export class ClosurePathError extends Error {
  status = 400;
  constructor(message: string) {
    super(message);
    this.name = "ClosurePathError";
  }
}
