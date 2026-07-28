/**
 * Detection / control / process improvement register domain types (issue #66).
 */

export const IMPROVEMENT_REGISTER_TYPES = [
  "detection_gap",
  "logging_gap",
  "integration_defect",
  "playbook_defect",
  "security_control_gap",
  "process_failure",
  "training_need",
  "documentation_gap",
] as const;

export type ImprovementRegisterType =
  (typeof IMPROVEMENT_REGISTER_TYPES)[number];

export const IMPROVEMENT_REGISTER_STATUSES = [
  "open",
  "in_review",
  "accepted",
  "in_progress",
  "validated",
  "closed",
  "reopened",
  "rejected",
  "deferred",
] as const;

export type ImprovementRegisterStatus =
  (typeof IMPROVEMENT_REGISTER_STATUSES)[number];

export const IMPROVEMENT_REGISTER_SEVERITIES = [
  "low",
  "medium",
  "high",
  "critical",
] as const;

export type ImprovementRegisterSeverity =
  (typeof IMPROVEMENT_REGISTER_SEVERITIES)[number];

export const IMPROVEMENT_LINK_KINDS = [
  "case",
  "review",
  "review_proposal",
  "playbook",
] as const;

export type ImprovementLinkKind = (typeof IMPROVEMENT_LINK_KINDS)[number];

export const IMPROVEMENT_SOURCE_KINDS = [
  "case",
  "review",
  "review_proposal",
  "manual",
] as const;

export type ImprovementSourceKind = (typeof IMPROVEMENT_SOURCE_KINDS)[number];

export const IMPROVEMENT_VALIDATION_METHODS = [
  "retest",
  "monitoring",
  "peer_review",
  "document_review",
  "exercise",
  "other",
] as const;

export type ImprovementValidationMethod =
  (typeof IMPROVEMENT_VALIDATION_METHODS)[number];

export const IMPROVEMENT_TICKET_SYNC_STATES = [
  "none",
  "linked",
  "pending",
  "synced",
  "conflict",
  "failed",
] as const;

export type ImprovementTicketSyncState =
  (typeof IMPROVEMENT_TICKET_SYNC_STATES)[number];

export const IMPROVEMENT_REGISTER_EVENT_TYPES = [
  "created",
  "updated",
  "status_changed",
  "linked",
  "unlinked",
  "assigned",
  "validated",
  "closed",
  "reopened",
  "ticket_synced",
  "ticket_conflict",
] as const;

export type ImprovementRegisterEventType =
  (typeof IMPROVEMENT_REGISTER_EVENT_TYPES)[number];

/** Statuses that may transition to closed (after validation). */
export const CLOSABLE_STATUSES: readonly ImprovementRegisterStatus[] = [
  "open",
  "in_review",
  "accepted",
  "in_progress",
  "validated",
  "reopened",
] as const;

/** Statuses considered open work for dashboard/overdue. */
export const OPEN_WORK_STATUSES: readonly ImprovementRegisterStatus[] = [
  "open",
  "in_review",
  "accepted",
  "in_progress",
  "validated",
  "reopened",
  "deferred",
] as const;

/**
 * Map #64 review_improvement_kind → register type.
 * Communication gaps fold into process_failure; free-form "other" into
 * documentation_gap so the register stays within its fixed taxonomy.
 */
export const PROPOSAL_KIND_TO_REGISTER_TYPE: Record<
  string,
  ImprovementRegisterType
> = {
  playbook_revision: "playbook_defect",
  detection_improvement: "detection_gap",
  integration_backlog: "integration_defect",
  control_gap: "security_control_gap",
  process_gap: "process_failure",
  communication_gap: "process_failure",
  other: "documentation_gap",
};

export function isImprovementRegisterType(
  v: string,
): v is ImprovementRegisterType {
  return (IMPROVEMENT_REGISTER_TYPES as readonly string[]).includes(v);
}

export function isImprovementRegisterStatus(
  v: string,
): v is ImprovementRegisterStatus {
  return (IMPROVEMENT_REGISTER_STATUSES as readonly string[]).includes(v);
}

export function isImprovementLinkKind(v: string): v is ImprovementLinkKind {
  return (IMPROVEMENT_LINK_KINDS as readonly string[]).includes(v);
}

export function isImprovementValidationMethod(
  v: string,
): v is ImprovementValidationMethod {
  return (IMPROVEMENT_VALIDATION_METHODS as readonly string[]).includes(v);
}
