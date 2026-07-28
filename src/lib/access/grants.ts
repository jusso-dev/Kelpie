/**
 * Grant, revoke, break-glass, and visibility mutations (issue #61).
 *
 * Every mutation:
 * - requires a non-empty reason (except pure compartment membership edits
 *   which still record an access event)
 * - bumps access_policy_version
 * - writes case_access_events (never copies sensitive content)
 * - records a redacted organisation audit event
 */

import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  caseAccessEvents,
  caseAccessGrants,
  caseCompartmentMembers,
  caseCompartmentTeams,
  cases,
  teams,
  users,
} from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit/events";
import { sendEmail } from "@/lib/email";
import { newId } from "@/lib/utils";
import {
  evaluateCasePermissions,
  hasPermission,
} from "./evaluate";
import {
  bumpAccessPolicyVersion,
  listOrgAdminEmails,
  loadCaseAccessContext,
} from "./load";
import {
  ACCESS_REASON_MIN_LENGTH,
  BREAK_GLASS_DEFAULT_TTL_MS,
  type AccessActor,
  type AccessObjectType,
  type AccessPermission,
  type AccessSubjectType,
  type CaseVisibilityMode,
  isAccessPermission,
  isCaseVisibilityMode,
} from "./types";

export class AccessError extends Error {
  constructor(
    message: string,
    public status: number = 400,
  ) {
    super(message);
    this.name = "AccessError";
  }
}

function assertReason(reason: string | undefined | null): string {
  const trimmed = (reason ?? "").trim();
  if (trimmed.length < ACCESS_REASON_MIN_LENGTH) {
    throw new AccessError(
      `Reason is required (min ${ACCESS_REASON_MIN_LENGTH} characters)`,
      400,
    );
  }
  return trimmed;
}

function normalisePermissions(raw: string[]): AccessPermission[] {
  const out: AccessPermission[] = [];
  for (const p of raw) {
    if (!isAccessPermission(p)) {
      throw new AccessError(`Unknown permission: ${p}`, 400);
    }
    if (!out.includes(p)) out.push(p);
  }
  if (out.length === 0) {
    throw new AccessError("At least one permission is required", 400);
  }
  return out;
}

async function writeAccessEvent(input: {
  organisationId: string;
  caseId: string;
  actorId: string | null;
  action:
    | "visibility_changed"
    | "compartment_updated"
    | "grant_created"
    | "grant_revoked"
    | "break_glass"
    | "sensitive_viewed"
    | "export_denied"
    | "access_denied";
  subjectType?: AccessSubjectType | null;
  subjectId?: string | null;
  permissions?: AccessPermission[] | null;
  objectType?: AccessObjectType | null;
  objectId?: string | null;
  reason?: string | null;
  grantId?: string | null;
  effectiveFrom?: Date | null;
  effectiveUntil?: Date | null;
  metadata?: Record<string, unknown>;
}) {
  await db.insert(caseAccessEvents).values({
    id: newId("cacev"),
    organisationId: input.organisationId,
    caseId: input.caseId,
    actorId: input.actorId,
    action: input.action,
    subjectType: input.subjectType ?? null,
    subjectId: input.subjectId ?? null,
    permissions: input.permissions ?? null,
    objectType: input.objectType ?? null,
    objectId: input.objectId ?? null,
    reason: input.reason ?? null,
    grantId: input.grantId ?? null,
    effectiveFrom: input.effectiveFrom ?? null,
    effectiveUntil: input.effectiveUntil ?? null,
    metadata: input.metadata ?? {},
  });
}

async function requireCase(organisationId: string, caseId: string) {
  const [row] = await db
    .select({
      id: cases.id,
      caseNumber: cases.caseNumber,
      title: cases.title,
      organisationId: cases.organisationId,
      visibilityMode: cases.visibilityMode,
      accessPolicyVersion: cases.accessPolicyVersion,
    })
    .from(cases)
    .where(and(eq(cases.id, caseId), eq(cases.organisationId, organisationId)))
    .limit(1);
  if (!row) throw new AccessError("Case not found", 404);
  return row;
}

async function assertCanAdminister(
  organisationId: string,
  caseId: string,
  actor: AccessActor,
) {
  const ctx = await loadCaseAccessContext(organisationId, caseId);
  if (!ctx) throw new AccessError("Case not found", 404);
  const perms = evaluateCasePermissions(ctx, actor);
  if (!hasPermission(perms, "administer_access")) {
    throw new AccessError("Not permitted to administer access", 403);
  }
  return { ctx, perms };
}

export type CreateGrantInput = {
  subjectType: AccessSubjectType;
  subjectId: string;
  permissions: string[];
  reason: string;
  expiresAt?: Date | null;
  objectType?: AccessObjectType;
  objectId?: string | null;
};

export async function createAccessGrant(
  organisationId: string,
  actor: AccessActor,
  caseId: string,
  input: CreateGrantInput,
): Promise<{ id: string; accessPolicyVersion: number }> {
  await assertCanAdminister(organisationId, caseId, actor);
  const caseRow = await requireCase(organisationId, caseId);
  const reason = assertReason(input.reason);
  const permissions = normalisePermissions(input.permissions);
  // Only organisation admins may grant administer_access (privilege escalation guard).
  if (
    permissions.includes("administer_access") &&
    actor.role !== "admin"
  ) {
    throw new AccessError(
      "Only organisation admins can grant administer_access",
      403,
    );
  }
  const objectType = input.objectType ?? "case";
  const objectId = objectType === "case" ? null : (input.objectId ?? null);
  if (objectType !== "case" && !objectId) {
    throw new AccessError("objectId is required for object-scoped grants", 400);
  }

  if (input.subjectType === "user") {
    const [subject] = await db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.id, input.subjectId),
          eq(users.organisationId, organisationId),
        ),
      )
      .limit(1);
    if (!subject) throw new AccessError("Subject user not found in organisation", 400);
  } else {
    const [subject] = await db
      .select({ id: teams.id })
      .from(teams)
      .where(
        and(
          eq(teams.id, input.subjectId),
          eq(teams.organisationId, organisationId),
        ),
      )
      .limit(1);
    if (!subject) throw new AccessError("Subject team not found in organisation", 400);
  }

  if (input.expiresAt && input.expiresAt.getTime() <= Date.now()) {
    throw new AccessError("expiresAt must be in the future", 400);
  }

  const id = newId("cagnt");
  const grantedAt = new Date();
  await db.insert(caseAccessGrants).values({
    id,
    organisationId,
    caseId,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    permissions,
    objectType,
    objectId,
    reason,
    grantedBy: actor.userId,
    grantedAt,
    expiresAt: input.expiresAt ?? null,
    isBreakGlass: false,
  });

  const version = await bumpAccessPolicyVersion(organisationId, caseId);
  await writeAccessEvent({
    organisationId,
    caseId,
    actorId: actor.userId,
    action: "grant_created",
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    permissions,
    objectType,
    objectId,
    reason,
    grantId: id,
    effectiveFrom: grantedAt,
    effectiveUntil: input.expiresAt ?? null,
  });
  await recordAuditEvent({
    organisationId,
    actorId: actor.userId,
    actorType: actor.userId ? "user" : "system",
    action: "case.access_grant_created",
    targetType: "case",
    targetId: caseId,
    targetLabel: caseRow.caseNumber,
    metadata: {
      grant_id: id,
      subject_type: input.subjectType,
      subject_id: input.subjectId,
      permissions,
      object_type: objectType,
      object_id: objectId,
      expires_at: input.expiresAt?.toISOString() ?? null,
      // reason recorded in access history; audit keeps a flag only
      reason_present: true,
    },
  });

  return { id, accessPolicyVersion: version ?? caseRow.accessPolicyVersion + 1 };
}

export async function revokeAccessGrant(
  organisationId: string,
  actor: AccessActor,
  caseId: string,
  grantId: string,
  reason: string,
): Promise<{ accessPolicyVersion: number }> {
  await assertCanAdminister(organisationId, caseId, actor);
  const caseRow = await requireCase(organisationId, caseId);
  const revokeReason = assertReason(reason);

  const [grant] = await db
    .select()
    .from(caseAccessGrants)
    .where(
      and(
        eq(caseAccessGrants.id, grantId),
        eq(caseAccessGrants.caseId, caseId),
        eq(caseAccessGrants.organisationId, organisationId),
      ),
    )
    .limit(1);
  if (!grant) throw new AccessError("Grant not found", 404);
  if (grant.revokedAt) throw new AccessError("Grant already revoked", 409);

  const revokedAt = new Date();
  await db
    .update(caseAccessGrants)
    .set({
      revokedAt,
      revokedBy: actor.userId,
      revokeReason,
    })
    .where(eq(caseAccessGrants.id, grantId));

  const version = await bumpAccessPolicyVersion(organisationId, caseId);
  await writeAccessEvent({
    organisationId,
    caseId,
    actorId: actor.userId,
    action: "grant_revoked",
    subjectType: grant.subjectType,
    subjectId: grant.subjectId,
    permissions: grant.permissions as AccessPermission[],
    objectType: grant.objectType,
    objectId: grant.objectId,
    reason: revokeReason,
    grantId,
    effectiveFrom: grant.grantedAt,
    effectiveUntil: revokedAt,
    metadata: { previous_expires_at: grant.expiresAt?.toISOString() ?? null },
  });
  await recordAuditEvent({
    organisationId,
    actorId: actor.userId,
    actorType: actor.userId ? "user" : "system",
    action: "case.access_grant_revoked",
    targetType: "case",
    targetId: caseId,
    targetLabel: caseRow.caseNumber,
    metadata: {
      grant_id: grantId,
      subject_type: grant.subjectType,
      subject_id: grant.subjectId,
      reason_present: true,
    },
  });

  return { accessPolicyVersion: version ?? caseRow.accessPolicyVersion + 1 };
}

/**
 * Emergency break-glass: any authenticated org member may request temporary
 * access for themselves. Always requires reason, always expires, always
 * notifies organisation admins, fully audited.
 */
export async function breakGlassAccess(
  organisationId: string,
  actor: AccessActor,
  caseId: string,
  input: {
    reason: string;
    ttlMs?: number;
    permissions?: string[];
  },
): Promise<{ id: string; expiresAt: Date; accessPolicyVersion: number }> {
  if (!actor.userId) {
    throw new AccessError("Break-glass requires a user-backed actor", 403);
  }
  if (actor.organisationId !== organisationId) {
    throw new AccessError("Case not found", 404);
  }

  const caseRow = await requireCase(organisationId, caseId);
  const reason = assertReason(input.reason);
  const ttl = input.ttlMs ?? BREAK_GLASS_DEFAULT_TTL_MS;
  if (ttl <= 0 || ttl > 24 * 60 * 60 * 1000) {
    throw new AccessError("Break-glass TTL must be between 1 ms and 24 hours", 400);
  }

  const permissions = normalisePermissions(
    input.permissions ?? [
      "know_exists",
      "view_metadata",
      "view_sensitive",
      "edit",
    ],
  );
  // Break-glass never grants administer_access or export (export is
  // higher-risk and must be explicitly granted by an administrator).
  const filtered = permissions.filter(
    (p) => p !== "administer_access" && p !== "export",
  );
  if (filtered.length === 0) {
    throw new AccessError("No valid break-glass permissions", 400);
  }

  const grantedAt = new Date();
  const expiresAt = new Date(grantedAt.getTime() + ttl);
  const id = newId("cagnt");

  await db.insert(caseAccessGrants).values({
    id,
    organisationId,
    caseId,
    subjectType: "user",
    subjectId: actor.userId,
    permissions: filtered,
    objectType: "case",
    objectId: null,
    reason,
    grantedBy: actor.userId,
    grantedAt,
    expiresAt,
    isBreakGlass: true,
  });

  const version = await bumpAccessPolicyVersion(organisationId, caseId);
  await writeAccessEvent({
    organisationId,
    caseId,
    actorId: actor.userId,
    action: "break_glass",
    subjectType: "user",
    subjectId: actor.userId,
    permissions: filtered,
    objectType: "case",
    reason,
    grantId: id,
    effectiveFrom: grantedAt,
    effectiveUntil: expiresAt,
  });
  await recordAuditEvent({
    organisationId,
    actorId: actor.userId,
    actorType: "user",
    action: "case.access_break_glass",
    targetType: "case",
    targetId: caseId,
    targetLabel: caseRow.caseNumber,
    metadata: {
      grant_id: id,
      permissions: filtered,
      expires_at: expiresAt.toISOString(),
      reason_present: true,
    },
  });

  // Notify admins immediately (best-effort; never block the grant).
  const admins = await listOrgAdminEmails(organisationId);
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const notifyBody =
    `Break-glass access was used on case ${caseRow.caseNumber}.\n` +
    `Actor: ${actor.userId}\n` +
    `Expires: ${expiresAt.toISOString()}\n` +
    `Reason was supplied (see access history in Kelpie).\n` +
    `${appUrl}/cases/${caseId}\n`;
  await Promise.all(
    admins
      .filter((a) => a.id !== actor.userId)
      .map((a) =>
        sendEmail({
          to: a.email,
          subject: `[Kelpie] Break-glass access on ${caseRow.caseNumber}`,
          text: notifyBody,
        }).catch(() => {
          /* best-effort */
        }),
      ),
  );

  return {
    id,
    expiresAt,
    accessPolicyVersion: version ?? caseRow.accessPolicyVersion + 1,
  };
}

export type SetVisibilityInput = {
  visibilityMode: string;
  teamIds?: string[];
  memberIds?: string[];
  reason: string;
};

export async function setCaseVisibility(
  organisationId: string,
  actor: AccessActor,
  caseId: string,
  input: SetVisibilityInput,
): Promise<{ accessPolicyVersion: number; visibilityMode: CaseVisibilityMode }> {
  await assertCanAdminister(organisationId, caseId, actor);
  const caseRow = await requireCase(organisationId, caseId);
  const reason = assertReason(input.reason);
  if (!isCaseVisibilityMode(input.visibilityMode)) {
    throw new AccessError("Invalid visibility mode", 400);
  }
  const mode = input.visibilityMode;

  if (mode === "selected_teams") {
    const teamIds = [...new Set(input.teamIds ?? [])];
    if (teamIds.length === 0) {
      throw new AccessError(
        "selected_teams requires at least one teamId",
        400,
      );
    }
    const found = await db
      .select({ id: teams.id })
      .from(teams)
      .where(
        and(eq(teams.organisationId, organisationId), eq(teams.id, teamIds[0]!)),
      );
    // Validate all team ids belong to org.
    for (const teamId of teamIds) {
      const [t] = await db
        .select({ id: teams.id })
        .from(teams)
        .where(
          and(eq(teams.id, teamId), eq(teams.organisationId, organisationId)),
        )
        .limit(1);
      if (!t) throw new AccessError(`Team not found: ${teamId}`, 400);
    }
    void found;
    await db
      .delete(caseCompartmentTeams)
      .where(
        and(
          eq(caseCompartmentTeams.caseId, caseId),
          eq(caseCompartmentTeams.organisationId, organisationId),
        ),
      );
    if (teamIds.length > 0) {
      await db.insert(caseCompartmentTeams).values(
        teamIds.map((teamId) => ({
          id: newId("cact"),
          organisationId,
          caseId,
          teamId,
          addedBy: actor.userId,
        })),
      );
    }
  }

  if (mode === "explicit_members") {
    const memberIds = [...new Set(input.memberIds ?? [])];
    if (memberIds.length === 0) {
      throw new AccessError(
        "explicit_members requires at least one memberId",
        400,
      );
    }
    for (const userId of memberIds) {
      const [u] = await db
        .select({ id: users.id })
        .from(users)
        .where(
          and(eq(users.id, userId), eq(users.organisationId, organisationId)),
        )
        .limit(1);
      if (!u) throw new AccessError(`Member not found: ${userId}`, 400);
    }
    await db
      .delete(caseCompartmentMembers)
      .where(
        and(
          eq(caseCompartmentMembers.caseId, caseId),
          eq(caseCompartmentMembers.organisationId, organisationId),
        ),
      );
    await db.insert(caseCompartmentMembers).values(
      memberIds.map((userId) => ({
        id: newId("cacm"),
        organisationId,
        caseId,
        userId,
        addedBy: actor.userId,
      })),
    );
  }

  await db
    .update(cases)
    .set({ visibilityMode: mode })
    .where(and(eq(cases.id, caseId), eq(cases.organisationId, organisationId)));

  const version = await bumpAccessPolicyVersion(organisationId, caseId);
  await writeAccessEvent({
    organisationId,
    caseId,
    actorId: actor.userId,
    action: "visibility_changed",
    reason,
    metadata: {
      from: caseRow.visibilityMode,
      to: mode,
      team_ids: mode === "selected_teams" ? (input.teamIds ?? []) : undefined,
      member_ids:
        mode === "explicit_members" ? (input.memberIds ?? []) : undefined,
    },
  });
  await recordAuditEvent({
    organisationId,
    actorId: actor.userId,
    actorType: actor.userId ? "user" : "system",
    action: "case.visibility_changed",
    targetType: "case",
    targetId: caseId,
    targetLabel: caseRow.caseNumber,
    before: { visibility_mode: caseRow.visibilityMode },
    after: { visibility_mode: mode },
    metadata: { reason_present: true },
  });

  return {
    accessPolicyVersion: version ?? caseRow.accessPolicyVersion + 1,
    visibilityMode: mode,
  };
}

export async function listAccessGrants(
  organisationId: string,
  caseId: string,
  opts?: { includeRevoked?: boolean },
) {
  const filters = [
    eq(caseAccessGrants.organisationId, organisationId),
    eq(caseAccessGrants.caseId, caseId),
  ];
  if (!opts?.includeRevoked) {
    filters.push(isNull(caseAccessGrants.revokedAt));
  }
  return db
    .select()
    .from(caseAccessGrants)
    .where(and(...filters))
    .orderBy(desc(caseAccessGrants.grantedAt));
}

export async function listAccessHistory(
  organisationId: string,
  caseId: string,
  opts?: { limit?: number },
) {
  const limit = Math.min(opts?.limit ?? 100, 500);
  return db
    .select()
    .from(caseAccessEvents)
    .where(
      and(
        eq(caseAccessEvents.organisationId, organisationId),
        eq(caseAccessEvents.caseId, caseId),
      ),
    )
    .orderBy(desc(caseAccessEvents.occurredAt))
    .limit(limit);
}

export async function getCaseAccessSummary(
  organisationId: string,
  caseId: string,
) {
  const ctx = await loadCaseAccessContext(organisationId, caseId);
  if (!ctx) return null;
  const [teams, members, grants] = await Promise.all([
    db
      .select({
        id: caseCompartmentTeams.id,
        teamId: caseCompartmentTeams.teamId,
      })
      .from(caseCompartmentTeams)
      .where(
        and(
          eq(caseCompartmentTeams.caseId, caseId),
          eq(caseCompartmentTeams.organisationId, organisationId),
        ),
      ),
    db
      .select({
        id: caseCompartmentMembers.id,
        userId: caseCompartmentMembers.userId,
      })
      .from(caseCompartmentMembers)
      .where(
        and(
          eq(caseCompartmentMembers.caseId, caseId),
          eq(caseCompartmentMembers.organisationId, organisationId),
        ),
      ),
    listAccessGrants(organisationId, caseId, { includeRevoked: false }),
  ]);
  return {
    visibilityMode: ctx.visibilityMode,
    accessPolicyVersion: ctx.accessPolicyVersion,
    teams,
    members,
    grants,
  };
}
