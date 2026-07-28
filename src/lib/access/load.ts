/**
 * Load case access context and resolve actors (issue #61).
 */

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  caseAccessGrants,
  caseCompartmentMembers,
  caseCompartmentTeams,
  cases,
  teamMembers,
  users,
} from "@/db/schema";
import type {
  AccessActor,
  AccessObjectType,
  AccessPermission,
  ActiveGrant,
  CaseAccessContext,
  CaseVisibilityMode,
} from "./types";
import { isAccessPermission } from "./types";

function parsePermissions(raw: unknown): AccessPermission[] {
  if (!Array.isArray(raw)) return [];
  const out: AccessPermission[] = [];
  for (const item of raw) {
    if (typeof item === "string" && isAccessPermission(item)) out.push(item);
  }
  return out;
}

function mapGrant(row: typeof caseAccessGrants.$inferSelect): ActiveGrant {
  return {
    id: row.id,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    permissions: parsePermissions(row.permissions),
    objectType: row.objectType as AccessObjectType,
    objectId: row.objectId,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    isBreakGlass: row.isBreakGlass,
  };
}

export async function loadUserTeamIds(
  organisationId: string,
  userId: string,
): Promise<string[]> {
  const rows = await db
    .select({ teamId: teamMembers.teamId })
    .from(teamMembers)
    .where(
      and(
        eq(teamMembers.organisationId, organisationId),
        eq(teamMembers.userId, userId),
      ),
    );
  return rows.map((r) => r.teamId);
}

/**
 * Resolve an AccessActor for a user id within an organisation.
 * Returns null if the user is missing or belongs to another org.
 */
export async function resolveUserActor(
  organisationId: string,
  userId: string,
): Promise<AccessActor | null> {
  const [user] = await db
    .select({
      id: users.id,
      role: users.role,
      organisationId: users.organisationId,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user || user.organisationId !== organisationId) return null;
  const teamIds = await loadUserTeamIds(organisationId, userId);
  return {
    organisationId,
    userId: user.id,
    role: user.role,
    teamIds,
  };
}

/**
 * Resolve actor for an API token. User-backed tokens inherit the creating
 * user's role and teams. Pure automation tokens are `system` and only see
 * organisation-visible cases unless grants are attached to a team (they
 * cannot receive user grants).
 */
export async function resolveTokenActor(token: {
  organisationId: string;
  createdBy: string | null;
}): Promise<AccessActor> {
  if (token.createdBy) {
    const actor = await resolveUserActor(token.organisationId, token.createdBy);
    if (actor) return actor;
  }
  return {
    organisationId: token.organisationId,
    userId: null,
    role: "system",
    teamIds: [],
  };
}

/** Privileged in-process actor — never attach to user request paths. */
export function systemInternalActor(organisationId: string): AccessActor {
  return {
    organisationId,
    userId: null,
    role: "system_internal",
    teamIds: [],
  };
}

export async function loadCaseAccessContext(
  organisationId: string,
  caseId: string,
  opts?: { now?: Date },
): Promise<CaseAccessContext | null> {
  const [row] = await db
    .select({
      id: cases.id,
      organisationId: cases.organisationId,
      visibilityMode: cases.visibilityMode,
      accessPolicyVersion: cases.accessPolicyVersion,
    })
    .from(cases)
    .where(and(eq(cases.id, caseId), eq(cases.organisationId, organisationId)))
    .limit(1);
  if (!row) return null;

  const [teamRows, memberRows, grantRows] = await Promise.all([
    db
      .select({ teamId: caseCompartmentTeams.teamId })
      .from(caseCompartmentTeams)
      .where(
        and(
          eq(caseCompartmentTeams.caseId, caseId),
          eq(caseCompartmentTeams.organisationId, organisationId),
        ),
      ),
    db
      .select({ userId: caseCompartmentMembers.userId })
      .from(caseCompartmentMembers)
      .where(
        and(
          eq(caseCompartmentMembers.caseId, caseId),
          eq(caseCompartmentMembers.organisationId, organisationId),
        ),
      ),
    db
      .select()
      .from(caseAccessGrants)
      .where(
        and(
          eq(caseAccessGrants.caseId, caseId),
          eq(caseAccessGrants.organisationId, organisationId),
          isNull(caseAccessGrants.revokedAt),
        ),
      ),
  ]);

  return {
    organisationId: row.organisationId,
    caseId: row.id,
    visibilityMode: row.visibilityMode as CaseVisibilityMode,
    accessPolicyVersion: row.accessPolicyVersion,
    compartmentTeamIds: teamRows.map((t) => t.teamId),
    compartmentMemberIds: memberRows.map((m) => m.userId),
    grants: grantRows.map(mapGrant),
    now: opts?.now,
  };
}

/**
 * SQL predicate: cases the actor may know exist (for list/search filters).
 * Deny by default for unknown modes. Cross-org already filtered by caller.
 */
export function caseKnowExistsSql(actor: AccessActor) {
  if (actor.role === "system_internal") {
    return sql`true`;
  }

  if (actor.role === "system" && !actor.userId) {
    return sql`${cases.visibilityMode} = 'organisation'`;
  }

  const userId = actor.userId;
  if (!userId) {
    return sql`false`;
  }

  // Admin: all modes (know_exists for ACL management).
  if (actor.role === "admin") {
    return sql`true`;
  }

  const teamIds = actor.teamIds;
  const teamList =
    teamIds.length > 0
      ? sql.join(
          teamIds.map((id) => sql`${id}`),
          sql`, `,
        )
      : null;

  const teamMatch =
    teamList !== null
      ? sql`exists (
          select 1 from case_compartment_teams ct
          where ct.case_id = ${cases.id}
            and ct.organisation_id = ${cases.organisationId}
            and ct.team_id in (${teamList})
        )`
      : sql`false`;

  const memberMatch = sql`exists (
    select 1 from case_compartment_members cm
    where cm.case_id = ${cases.id}
      and cm.organisation_id = ${cases.organisationId}
      and cm.user_id = ${userId}
  )`;

  // permissions is a JSON array of strings; `?` checks top-level key or
  // array element membership for the permission name.
  const grantMatch = sql`exists (
    select 1 from case_access_grants g
    where g.case_id = ${cases.id}
      and g.organisation_id = ${cases.organisationId}
      and g.revoked_at is null
      and (g.expires_at is null or g.expires_at > now())
      and g.object_type = 'case'
      and (
        (g.subject_type = 'user' and g.subject_id = ${userId})
        ${
          teamList !== null
            ? sql`or (g.subject_type = 'team' and g.subject_id in (${teamList}))`
            : sql``
        }
      )
      and (
        g.permissions::jsonb ? 'know_exists'
        or g.permissions::jsonb ? 'view_metadata'
        or g.permissions::jsonb ? 'view_sensitive'
        or g.permissions::jsonb ? 'edit'
        or g.permissions::jsonb ? 'export'
        or g.permissions::jsonb ? 'administer_access'
      )
  )`;

  return sql`(
    ${cases.visibilityMode} = 'organisation'
    or (
      ${cases.visibilityMode} = 'selected_teams'
      and ${teamMatch}
    )
    or (
      ${cases.visibilityMode} = 'explicit_members'
      and ${memberMatch}
    )
    or ${grantMatch}
  )`;
}

/**
 * Bump access_policy_version for a case (call inside grant/revoke/visibility
 * mutations). Returns the new version or null if the case is missing.
 */
export async function bumpAccessPolicyVersion(
  organisationId: string,
  caseId: string,
): Promise<number | null> {
  const [updated] = await db
    .update(cases)
    .set({
      accessPolicyVersion: sql`${cases.accessPolicyVersion} + 1`,
    })
    .where(and(eq(cases.id, caseId), eq(cases.organisationId, organisationId)))
    .returning({ version: cases.accessPolicyVersion });
  return updated?.version ?? null;
}

export async function listOrgAdminEmails(
  organisationId: string,
): Promise<Array<{ id: string; email: string; name: string }>> {
  return db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(
      and(eq(users.organisationId, organisationId), eq(users.role, "admin")),
    );
}

/** Load many case access contexts (for batch list redaction). */
export async function loadCaseAccessContexts(
  organisationId: string,
  caseIds: string[],
): Promise<Map<string, CaseAccessContext>> {
  const map = new Map<string, CaseAccessContext>();
  if (caseIds.length === 0) return map;

  const rows = await db
    .select({
      id: cases.id,
      organisationId: cases.organisationId,
      visibilityMode: cases.visibilityMode,
      accessPolicyVersion: cases.accessPolicyVersion,
    })
    .from(cases)
    .where(
      and(
        eq(cases.organisationId, organisationId),
        inArray(cases.id, caseIds),
      ),
    );

  const [teamRows, memberRows, grantRows] = await Promise.all([
    db
      .select()
      .from(caseCompartmentTeams)
      .where(
        and(
          eq(caseCompartmentTeams.organisationId, organisationId),
          inArray(caseCompartmentTeams.caseId, caseIds),
        ),
      ),
    db
      .select()
      .from(caseCompartmentMembers)
      .where(
        and(
          eq(caseCompartmentMembers.organisationId, organisationId),
          inArray(caseCompartmentMembers.caseId, caseIds),
        ),
      ),
    db
      .select()
      .from(caseAccessGrants)
      .where(
        and(
          eq(caseAccessGrants.organisationId, organisationId),
          inArray(caseAccessGrants.caseId, caseIds),
          isNull(caseAccessGrants.revokedAt),
        ),
      ),
  ]);

  for (const row of rows) {
    map.set(row.id, {
      organisationId: row.organisationId,
      caseId: row.id,
      visibilityMode: row.visibilityMode as CaseVisibilityMode,
      accessPolicyVersion: row.accessPolicyVersion,
      compartmentTeamIds: teamRows
        .filter((t) => t.caseId === row.id)
        .map((t) => t.teamId),
      compartmentMemberIds: memberRows
        .filter((m) => m.caseId === row.id)
        .map((m) => m.userId),
      grants: grantRows.filter((g) => g.caseId === row.id).map(mapGrant),
    });
  }
  return map;
}
