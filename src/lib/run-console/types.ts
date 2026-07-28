/**
 * Unified read model for the automation / response-action run console
 * (issue #67). This is intentionally a thin adapter shape over each
 * durable run record Kelpie already keeps (`response_action_runs`,
 * `automation_runs`, `webhook_deliveries`, `mobile_notification_deliveries`,
 * `audit_export_jobs`, `enrichment_runs`, and the `ti_feeds` / `case_sources`
 * poll status rows). It never becomes a generic execution table: each
 * adapter still reads and writes its own table with its own invariants, and
 * only maps its native shape onto `RunRecord` for display/filtering.
 */

export const RUN_TYPES = [
  "response_action",
  "automation",
  "enrichment",
  "case_source_poll",
  "ti_feed_poll",
  "notification",
  "report",
] as const;
export type RunType = (typeof RUN_TYPES)[number];

export const RUN_STATES = [
  "queued",
  "running",
  "waiting_approval",
  "succeeded",
  "partially_succeeded",
  "failed",
  "cancelled",
] as const;
export type RunState = (typeof RUN_STATES)[number];

export const ERROR_CATEGORIES = [
  "validation",
  "config",
  "approval_expired",
  "target_changed",
  "kill_switch",
  "provider_error",
  "timeout",
  "network",
  "cancelled",
  "unknown",
] as const;
export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];

export interface RunActor {
  id: string | null;
  label: string | null;
}

export interface RunApproval {
  requiredApproval: boolean;
  requestedBy: RunActor | null;
  approvedBy: RunActor | null;
  approvedAt: string | null;
  expiresAt: string | null;
}

export interface RunLineage {
  attempt: number;
  parentRunId: string | null;
  rootRunId: string | null;
}

export interface RunTimestamps {
  queuedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface RunCancel {
  /** True once a caller has asked for cancellation, whether or not it changed the outcome. */
  requested: boolean;
  requestedAt: string | null;
  requestedBy: RunActor | null;
}

export interface RunKillSwitchState {
  organisationActive: boolean;
  providerActive: boolean;
  actionActive: boolean;
}

/** A single unified row in the run console. Always organisation-scoped. */
export interface RunRecord {
  id: string;
  runType: RunType;
  organisationId: string;
  caseId: string | null;
  caseNumber: string | null;
  /** e.g. response action name, automation rule name, feed name, webhook name. */
  trigger: string;
  /** e.g. response action kind, automation targetProfile, feed/case-source kind. */
  ruleOrActionRef: string | null;
  ruleOrActionVersion: number | null;
  /** The configured `response_actions`/`automation_rules` row id, used to scope an action-level kill switch. Null for run types with no per-action configuration row. */
  actionId: string | null;
  provider: string | null;
  state: RunState;
  approval: RunApproval;
  lineage: RunLineage;
  timestamps: RunTimestamps;
  providerRequestId: string | null;
  /** Redacted, size-capped summary. Never contains credentials or raw payloads. */
  inputSummary: Record<string, unknown> | null;
  outputSummary: Record<string, unknown> | null;
  errorCategory: ErrorCategory | null;
  errorSummary: string | null;
  cancel: RunCancel;
  killSwitch: RunKillSwitchState;
  retryable: boolean;
  cancellable: boolean;
}

export interface RunFilters {
  caseId?: string;
  runType?: RunType;
  /** The configured action/rule id (`RunRecord.actionId`), not a free-text name. */
  action?: string;
  provider?: string;
  state?: RunState;
  /** "success" | "failure" style coarse result, independent of in-flight states. */
  result?: "success" | "failure" | "partial";
  actorId?: string;
  from?: Date;
  to?: Date;
}

export interface RunPage {
  runs: RunRecord[];
  nextCursor: string | null;
}
