/**
 * Typed integration health + bidirectional sync contract (issue #60).
 *
 * Shared by Sentinel, Defender XDR, Tawny, TI feeds, enrichers, webhooks, and
 * future connectors. Diagnostics never include plaintext credentials or raw
 * provider payloads — only references, fingerprints, categories, and
 * redacted summaries.
 */

export const CONNECTION_KINDS = [
  "case_source",
  "ti_feed",
  "webhook",
  "inbound_source",
  "enrichment",
  "response_action",
] as const;
export type ConnectionKind = (typeof CONNECTION_KINDS)[number];

export const HEALTH_STATUSES = [
  "healthy",
  "degraded",
  "unhealthy",
  "paused",
  "rate_limited",
  "expired",
  "conflicting",
  "unknown",
] as const;
export type HealthStatus = (typeof HEALTH_STATUSES)[number];

export const HEALTH_ERROR_CATEGORIES = [
  "auth",
  "credential_expired",
  "credential_expiring",
  "rate_limit",
  "stale_cursor",
  "network",
  "timeout",
  "provider_error",
  "config",
  "permission",
  "subscription_expired",
  "conflict",
  "paused",
  "unknown",
] as const;
export type HealthErrorCategory = (typeof HEALTH_ERROR_CATEGORIES)[number];

/** Per-field ownership for inbound/outbound synchronisation. */
export const FIELD_OWNERSHIPS = [
  "source_owned",
  "kelpie_owned",
  "last_write_wins",
  "manual_conflict",
  "one_way_only",
] as const;
export type FieldOwnership = (typeof FIELD_OWNERSHIPS)[number];

/** Syncable case fields for source connectors. */
export const SYNC_FIELDS = [
  "status",
  "severity",
  "assigneeId",
  "classification",
  "title",
  "summary",
  "closure",
  "comments",
] as const;
export type SyncField = (typeof SYNC_FIELDS)[number];

export const CREDENTIAL_ROTATION_STATES = [
  "active",
  "expiring",
  "expired",
  "rotated",
  "revoked",
] as const;
export type CredentialRotationState =
  (typeof CREDENTIAL_ROTATION_STATES)[number];

export const CONFLICT_STATUSES = [
  "open",
  "resolved_keep_kelpie",
  "resolved_take_source",
  "dismissed",
] as const;
export type ConflictStatus = (typeof CONFLICT_STATUSES)[number];

export const SYNC_WRITE_STATUSES = [
  "pending",
  "succeeded",
  "failed",
  "retrying",
] as const;
export type SyncWriteStatus = (typeof SYNC_WRITE_STATUSES)[number];

/** Advance warning windows used by credential / subscription expiry checks. */
export const CREDENTIAL_EXPIRY_WARNING_MS = 7 * 24 * 60 * 60 * 1000;
export const DEFAULT_FRESHNESS_THRESHOLD_MINUTES = 60;

/**
 * Default field ownership for case-source connectors. Narrative fields and
 * assignment stay Kelpie-owned; source severity/status/classification may
 * refresh until an analyst takes ownership via explicit policy change.
 * Outbound is never enabled by these defaults.
 */
export const DEFAULT_CASE_SOURCE_FIELD_POLICIES: Record<SyncField, FieldOwnership> =
  {
    status: "source_owned",
    severity: "source_owned",
    assigneeId: "kelpie_owned",
    classification: "source_owned",
    title: "source_owned",
    summary: "kelpie_owned",
    closure: "kelpie_owned",
    comments: "one_way_only",
  };

/**
 * Support-safe, secret-free health snapshot returned by admin diagnostics and
 * the integrations API. Safe to export for support tickets.
 */
export interface IntegrationHealth {
  connectionKind: ConnectionKind;
  connectionId: string;
  displayName: string;
  status: HealthStatus;
  errorCategory: HealthErrorCategory | null;
  errorSummary: string | null;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  rateLimitRemaining: number | null;
  rateLimitResetAt: string | null;
  queueDepth: number | null;
  pollingLagSeconds: number | null;
  webhookSubscriptionExpiresAt: string | null;
  backfillState: string;
  lastSourceCursor: string | null;
  readPermissionOk: boolean | null;
  writePermissionOk: boolean | null;
  writeEnabled: boolean;
  isPaused: boolean;
  credentials: IntegrationCredentialView[];
  warnings: IntegrationWarning[];
  openConflictCount: number;
  lastTestAt: string | null;
  lastTestResult: string | null;
  outboundEnabled: boolean;
  freshnessThresholdMinutes: number;
  stale: boolean;
}

export interface IntegrationCredentialView {
  id: string;
  label: string;
  /** Opaque reference only — never the secret material. */
  reference: string;
  fingerprint: string | null;
  consentedScopes: string[];
  expiresAt: string | null;
  rotatedAt: string | null;
  rotationState: CredentialRotationState;
}

export interface IntegrationWarning {
  code:
    | "credential_expiring"
    | "credential_expired"
    | "subscription_expiring"
    | "subscription_expired"
    | "stale_cursor"
    | "rate_limited"
    | "open_conflicts"
    | "write_disabled"
    | "paused";
  message: string;
  severity: "info" | "warning" | "critical";
}

export interface CaseStaleness {
  caseId: string;
  sourceSystem: string | null;
  connectionKind: ConnectionKind | null;
  connectionId: string | null;
  stale: boolean;
  lastSuccessAt: string | null;
  freshnessThresholdMinutes: number;
  reason: string | null;
}

export function isConnectionKind(value: string): value is ConnectionKind {
  return (CONNECTION_KINDS as readonly string[]).includes(value);
}

export function isFieldOwnership(value: string): value is FieldOwnership {
  return (FIELD_OWNERSHIPS as readonly string[]).includes(value);
}

export function isSyncField(value: string): value is SyncField {
  return (SYNC_FIELDS as readonly string[]).includes(value);
}
