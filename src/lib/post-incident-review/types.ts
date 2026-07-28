/**
 * Post-incident review domain types (issue #64).
 */

export const REVIEW_SECTION_KEYS = [
  "incident_summary",
  "business_impact",
  "detection",
  "key_events",
  "root_cause",
  "containment",
  "what_worked",
  "what_failed",
  "control_gaps",
  "detection_gaps",
  "process_gaps",
  "communication_gaps",
  "follow_ups",
  "participants",
  "knowledge_summary",
] as const;

export type ReviewSectionKey = (typeof REVIEW_SECTION_KEYS)[number];

export type ReviewSectionConfig = {
  key: ReviewSectionKey;
  title?: string;
  required: boolean;
  order: number;
};

export const REVIEW_STATUSES = [
  "draft",
  "in_progress",
  "pending_approval",
  "approved",
  "published",
  "cancelled",
] as const;

export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const FOLLOW_UP_STATUSES = [
  "open",
  "in_progress",
  "done",
  "cancelled",
  "deferred",
] as const;

export type FollowUpStatus = (typeof FOLLOW_UP_STATUSES)[number];

export const IMPROVEMENT_KINDS = [
  "playbook_revision",
  "detection_improvement",
  "integration_backlog",
  "control_gap",
  "process_gap",
  "communication_gap",
  "other",
] as const;

export type ImprovementKind = (typeof IMPROVEMENT_KINDS)[number];

export const IMPROVEMENT_STATUSES = [
  "proposed",
  "accepted",
  "in_progress",
  "done",
  "rejected",
  "deferred",
] as const;

export type ImprovementStatus = (typeof IMPROVEMENT_STATUSES)[number];

export const KNOWLEDGE_STATUSES = ["draft", "published", "archived"] as const;
export type KnowledgeStatus = (typeof KNOWLEDGE_STATUSES)[number];

export const CASE_SEVERITIES = ["low", "medium", "high", "critical"] as const;
export type CaseSeverity = (typeof CASE_SEVERITIES)[number];

export const CASE_CLASSIFICATIONS = [
  "malware",
  "phishing",
  "unauthorised_access",
  "data_breach",
  "dos",
  "policy_violation",
  "other",
] as const;
export type CaseClassification = (typeof CASE_CLASSIFICATIONS)[number];

/**
 * Structured review body stored on each revision.
 * Fields listed in SENSITIVE_CONTENT_KEYS are excluded from knowledge
 * summaries unless the actor has view_sensitive and opts in.
 */
export type ReviewContent = {
  incidentSummary?: string;
  businessImpact?: string;
  detectionSource?: string;
  detectionEffectiveness?: string;
  keyEvents?: Array<{ at?: string; description: string }>;
  rootCause?: string;
  contributingFactors?: string[];
  containmentEffectiveness?: string;
  whatWorked?: string[];
  whatFailed?: string[];
  controlGaps?: string[];
  detectionGaps?: string[];
  processGaps?: string[];
  communicationGaps?: string[];
  participants?: Array<{ userId?: string; name: string; role?: string }>;
  /** Publishable narrative suitable for knowledge base. */
  knowledgeSummary?: string;
  themes?: string[];
  /** Restricted / sensitive — excluded from knowledge by default. */
  sensitiveEvidenceNotes?: string;
  restrictedNotes?: string;
};

/** Content keys that must never appear in default knowledge summaries. */
export const SENSITIVE_CONTENT_KEYS = [
  "sensitiveEvidenceNotes",
  "restrictedNotes",
] as const;

export type SensitiveContentKey = (typeof SENSITIVE_CONTENT_KEYS)[number];

/**
 * Organisation-level post-incident review policy (stored in
 * organisations.settings.postIncidentReview).
 */
export type OrgReviewPolicy = {
  /** Master switch. When false, only template-level requirements apply. */
  enabled: boolean;
  /** Severities that require a review (default high + critical). */
  requireBySeverities: CaseSeverity[];
  /** Classifications that require a review (empty = no classification trigger). */
  requireByClassifications: CaseClassification[];
  /** When true every case requires a review regardless of severity. */
  requireForAllCases: boolean;
  /** Days after case close for review due date (default 14). */
  dueDaysAfterClose: number;
};

export const DEFAULT_ORG_REVIEW_POLICY: OrgReviewPolicy = {
  enabled: true,
  requireBySeverities: ["high", "critical"],
  requireByClassifications: [],
  requireForAllCases: false,
  dueDaysAfterClose: 14,
};

export type PolicyEvaluation = {
  required: boolean;
  reasons: string[];
  dueDaysAfterClose: number;
};

export function isReviewSectionKey(v: string): v is ReviewSectionKey {
  return (REVIEW_SECTION_KEYS as readonly string[]).includes(v);
}

export function isCaseSeverity(v: string): v is CaseSeverity {
  return (CASE_SEVERITIES as readonly string[]).includes(v);
}

export function isCaseClassification(v: string): v is CaseClassification {
  return (CASE_CLASSIFICATIONS as readonly string[]).includes(v);
}
