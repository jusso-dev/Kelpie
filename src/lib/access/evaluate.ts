/**
 * Pure case-compartment policy evaluation (issue #61).
 *
 * Deny by default. No I/O. Safe to call from REST, MCP, jobs, webhooks,
 * reports, search, and notifications with the same inputs.
 */

import {
  type AccessActor,
  type AccessObjectType,
  type AccessPermission,
  type ActiveGrant,
  type CaseAccessContext,
  REDACTED_PLACEHOLDER,
  accessCacheKey,
} from "./types";

export { accessCacheKey, REDACTED_PLACEHOLDER };

function isGrantActive(grant: ActiveGrant, now: Date): boolean {
  if (grant.revokedAt) return false;
  if (grant.expiresAt && grant.expiresAt.getTime() <= now.getTime()) return false;
  return true;
}

function grantMatchesActor(grant: ActiveGrant, actor: AccessActor): boolean {
  if (grant.subjectType === "user") {
    return actor.userId !== null && grant.subjectId === actor.userId;
  }
  if (grant.subjectType === "team") {
    return actor.teamIds.includes(grant.subjectId);
  }
  return false;
}

/**
 * Whether the actor is in the case's base compartment for the current mode.
 * Assigning or mentioning a user never contributes here — only explicit
 * compartment membership (teams/members) or organisation mode does.
 */
export function isInBaseCompartment(
  ctx: CaseAccessContext,
  actor: AccessActor,
): boolean {
  if (actor.organisationId !== ctx.organisationId) return false;

  if (actor.role === "system_internal") return true;

  // Unprivileged system automation (no user) only sees organisation mode.
  if (actor.role === "system" && !actor.userId) {
    return ctx.visibilityMode === "organisation";
  }

  if (!actor.userId) return false;

  switch (ctx.visibilityMode) {
    case "organisation":
      return true;
    case "selected_teams":
      return ctx.compartmentTeamIds.some((teamId) =>
        actor.teamIds.includes(teamId),
      );
    case "explicit_members":
      return ctx.compartmentMemberIds.includes(actor.userId);
    case "restricted":
      return false;
    default:
      // Unknown mode → deny.
      return false;
  }
}

/**
 * Evaluate the full permission set for an actor on a case.
 * Object-scoped grants (objectType !== "case") are collected separately via
 * `objectPermissions` — case-level evaluation only applies case-scoped grants.
 */
export function evaluateCasePermissions(
  ctx: CaseAccessContext,
  actor: AccessActor,
): Set<AccessPermission> {
  const perms = new Set<AccessPermission>();

  // Cross-tenant always denies.
  if (actor.organisationId !== ctx.organisationId) return perms;

  const now = ctx.now ?? new Date();

  // Trusted internal jobs: full access within the organisation only.
  if (actor.role === "system_internal") {
    perms.add("know_exists");
    perms.add("view_metadata");
    perms.add("view_sensitive");
    perms.add("edit");
    perms.add("export");
    perms.add("administer_access");
    return perms;
  }

  // Org admins always know the case exists and can administer ACL, even on
  // restricted cases — they do NOT automatically get view_metadata /
  // view_sensitive / edit / export for non-organisation modes.
  if (actor.role === "admin") {
    perms.add("know_exists");
    perms.add("administer_access");
  }

  const inBase = isInBaseCompartment(ctx, actor);

  if (inBase) {
    perms.add("know_exists");
    perms.add("view_metadata");

    if (actor.role === "admin" || actor.role === "analyst") {
      perms.add("edit");
      perms.add("export");
    }

    // Organisation mode: open within tenant — sensitive content visible to
    // any org member who can already see the case (need-to-know not active).
    // Compartment modes: view_sensitive only via grant / break-glass.
    if (ctx.visibilityMode === "organisation") {
      perms.add("view_sensitive");
      // read_only keeps view but not edit/export (already handled above).
    }
  }

  // Case-scoped grants.
  for (const grant of ctx.grants) {
    if (grant.objectType !== "case") continue;
    if (!isGrantActive(grant, now)) continue;
    if (!grantMatchesActor(grant, actor)) continue;
    for (const p of grant.permissions) {
      perms.add(p);
    }
  }

  return perms;
}

export function hasPermission(
  perms: Set<AccessPermission>,
  permission: AccessPermission,
): boolean {
  return perms.has(permission);
}

/**
 * Object-level sensitive content check. Non-sensitive objects are readable
 * with view_metadata. Sensitive objects need view_sensitive at case level
 * OR an active object-scoped grant that includes view_sensitive.
 */
export function canViewSensitiveObject(
  casePerms: Set<AccessPermission>,
  opts: {
    sensitive: boolean;
    objectType: AccessObjectType;
    objectId: string;
    grants: ActiveGrant[];
    actor: AccessActor;
    now?: Date;
  },
): boolean {
  if (!casePerms.has("view_metadata") && !casePerms.has("view_sensitive")) {
    return false;
  }
  if (!opts.sensitive) {
    return casePerms.has("view_metadata") || casePerms.has("view_sensitive");
  }
  if (casePerms.has("view_sensitive")) return true;

  const now = opts.now ?? new Date();
  for (const grant of opts.grants) {
    if (grant.objectType !== opts.objectType) continue;
    if (grant.objectId !== opts.objectId) continue;
    if (!isGrantActive(grant, now)) continue;
    if (!grantMatchesActor(grant, opts.actor)) continue;
    if (grant.permissions.includes("view_sensitive")) return true;
  }
  return false;
}

/**
 * Deterministic redaction of a sensitive payload field. Never encodes the
 * original length or content type in a way that leaks the secret.
 */
export function redactSensitiveContent<T extends Record<string, unknown>>(
  value: T,
  fields: (keyof T)[],
): T {
  const out = { ...value };
  for (const field of fields) {
    if (field in out && out[field] !== undefined && out[field] !== null) {
      out[field] = REDACTED_PLACEHOLDER as T[keyof T];
    }
  }
  return out;
}

/**
 * Case list row redaction when actor has know_exists but not view_metadata.
 * Hides title/summary and any free-text that could leak subject matter.
 */
export function redactCaseListRow<T extends Record<string, unknown>>(
  row: T,
  perms: Set<AccessPermission>,
): T {
  if (!perms.has("know_exists")) {
    // Caller should have filtered these out; return empty-safe shape.
    return {
      ...row,
      title: REDACTED_PLACEHOLDER,
      summary: null,
    } as T;
  }
  if (perms.has("view_metadata")) return row;
  return {
    ...row,
    title: REDACTED_PLACEHOLDER,
    summary: null,
  } as T;
}

/** Uniform not-found response shape — never distinguish missing vs forbidden. */
export const ACCESS_NOT_FOUND = {
  error: "Not found",
  status: 404 as const,
};

export const ACCESS_FORBIDDEN_EXPORT = {
  error: "Export is not permitted for this case",
  status: 403 as const,
};
