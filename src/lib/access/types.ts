/**
 * Field-level sensitivity and case compartment types (issue #61).
 *
 * Permissions are independent: export is not implied by view, and
 * know_exists is not implied by administer_access alone (admins still get
 * know_exists explicitly so they can manage ACL without reading content).
 */

export const ACCESS_PERMISSIONS = [
  "know_exists",
  "view_metadata",
  "view_sensitive",
  "edit",
  "export",
  "administer_access",
] as const;

export type AccessPermission = (typeof ACCESS_PERMISSIONS)[number];

export const CASE_VISIBILITY_MODES = [
  "organisation",
  "selected_teams",
  "explicit_members",
  "restricted",
] as const;

export type CaseVisibilityMode = (typeof CASE_VISIBILITY_MODES)[number];

export const ACCESS_SUBJECT_TYPES = ["user", "team"] as const;
export type AccessSubjectType = (typeof ACCESS_SUBJECT_TYPES)[number];

export const ACCESS_OBJECT_TYPES = [
  "case",
  "custom_field",
  "content_block",
  "comment",
  "evidence",
  "alert",
  "entity",
] as const;
export type AccessObjectType = (typeof ACCESS_OBJECT_TYPES)[number];

export const ACCESS_EVENT_ACTIONS = [
  "visibility_changed",
  "compartment_updated",
  "grant_created",
  "grant_revoked",
  "break_glass",
  "sensitive_viewed",
  "export_denied",
  "access_denied",
] as const;
export type AccessEventAction = (typeof ACCESS_EVENT_ACTIONS)[number];

/**
 * Actor for policy evaluation. `system` is for unprivileged automation that
 * only sees organisation-visible cases. `system_internal` is for trusted
 * in-process jobs that must touch every case (SLA, migrations) — never use
 * it on user-facing request paths.
 */
export type AccessActorRole =
  | "admin"
  | "analyst"
  | "read_only"
  | "system"
  | "system_internal";

export type AccessActor = {
  organisationId: string;
  userId: string | null;
  role: AccessActorRole;
  teamIds: string[];
};

export type ActiveGrant = {
  id?: string;
  subjectType: AccessSubjectType;
  subjectId: string;
  permissions: AccessPermission[];
  objectType: AccessObjectType;
  objectId: string | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  isBreakGlass: boolean;
};

export type CaseAccessContext = {
  organisationId: string;
  caseId: string;
  visibilityMode: CaseVisibilityMode;
  accessPolicyVersion: number;
  compartmentTeamIds: string[];
  compartmentMemberIds: string[];
  grants: ActiveGrant[];
  /** Override clock for tests. */
  now?: Date;
};

/** Deterministic placeholder used wherever sensitive content is withheld. */
export const REDACTED_PLACEHOLDER = "[redacted]";

/** Default break-glass lifetime. */
export const BREAK_GLASS_DEFAULT_TTL_MS = 4 * 60 * 60 * 1000;

/** Minimum reason length for grants and break-glass. */
export const ACCESS_REASON_MIN_LENGTH = 8;

export function isAccessPermission(value: string): value is AccessPermission {
  return (ACCESS_PERMISSIONS as readonly string[]).includes(value);
}

export function isCaseVisibilityMode(value: string): value is CaseVisibilityMode {
  return (CASE_VISIBILITY_MODES as readonly string[]).includes(value);
}

export function isAccessObjectType(value: string): value is AccessObjectType {
  return (ACCESS_OBJECT_TYPES as readonly string[]).includes(value);
}

/**
 * Cache key for policy decisions. Always includes organisation, actor, and
 * access-policy version so a grant/revoke invalidates prior decisions.
 */
export function accessCacheKey(parts: {
  organisationId: string;
  actorId: string | null;
  caseId: string;
  policyVersion: number;
  permission?: AccessPermission;
  objectType?: AccessObjectType;
  objectId?: string | null;
}): string {
  const base = [
    parts.organisationId,
    parts.actorId ?? "system",
    parts.caseId,
    `v${parts.policyVersion}`,
  ];
  if (parts.permission) base.push(parts.permission);
  if (parts.objectType) {
    base.push(parts.objectType);
    base.push(parts.objectId ?? "-");
  }
  return base.join(":");
}
