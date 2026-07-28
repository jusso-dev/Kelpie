/**
 * Staff-side invitation lifecycle for the stakeholder portal.
 */

import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  cases,
  externalCollaborators,
  stakeholderInvitations,
  stakeholderSessions,
  type StakeholderInvitation,
} from "@/db/schema";
import { newId } from "@/lib/utils";
import { writeTimelineEvent } from "@/lib/timeline";
import { recordAuditEvent } from "@/lib/audit/events";
import type { AccessActor } from "@/lib/access";
import { generateInviteToken } from "./tokens";
import { assertCanShareCase } from "./sharing";
import { recordStakeholderAccess } from "./audit";
import {
  STAKEHOLDER_ROLES,
  StakeholderError,
  type StakeholderPap,
  type StakeholderRole,
  type StakeholderTlp,
} from "./types";

function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function loadCase(caseId: string, organisationId: string) {
  const [row] = await db
    .select({
      id: cases.id,
      organisationId: cases.organisationId,
      tlp: cases.tlp,
      pap: cases.pap,
      caseNumber: cases.caseNumber,
      title: cases.title,
      status: cases.status,
      severity: cases.severity,
    })
    .from(cases)
    .where(and(eq(cases.id, caseId), eq(cases.organisationId, organisationId)))
    .limit(1);
  return row ?? null;
}

export async function ensureExternalCollaborator(opts: {
  organisationId: string;
  email: string;
  displayName: string;
  organisationLabel?: string | null;
}): Promise<string> {
  const email = normaliseEmail(opts.email);
  if (!email || !email.includes("@") || email.length > 320) {
    throw new StakeholderError("A valid email is required", 400);
  }
  const displayName = opts.displayName.trim().slice(0, 200);
  if (displayName.length < 1) {
    throw new StakeholderError("Display name is required", 400);
  }

  const [existing] = await db
    .select({ id: externalCollaborators.id })
    .from(externalCollaborators)
    .where(
      and(
        eq(externalCollaborators.organisationId, opts.organisationId),
        eq(externalCollaborators.email, email),
      ),
    )
    .limit(1);
  if (existing) {
    await db
      .update(externalCollaborators)
      .set({
        displayName,
        organisationLabel: opts.organisationLabel?.trim() || null,
        updatedAt: new Date(),
      })
      .where(eq(externalCollaborators.id, existing.id));
    return existing.id;
  }

  const id = newId("ext_col");
  await db.insert(externalCollaborators).values({
    id,
    organisationId: opts.organisationId,
    email,
    displayName,
    organisationLabel: opts.organisationLabel?.trim() || null,
  });
  return id;
}

export type CreateInviteInput = {
  organisationId: string;
  caseId: string;
  actor: AccessActor;
  /** Staff user id; empty string stores null (API token without creator). */
  invitedByUserId: string | null;
  email: string;
  displayName: string;
  organisationLabel?: string | null;
  role: StakeholderRole;
  purpose: string;
  maxTlp: StakeholderTlp;
  maxPap: StakeholderPap;
  /** Hours until expiry; default 72, max 30 days. */
  expiresInHours?: number;
  singleUse?: boolean;
};

export type CreateInviteResult = {
  invitation: StakeholderInvitation;
  /** Plaintext invite token — shown once. */
  token: string;
};

export async function createStakeholderInvite(
  input: CreateInviteInput,
): Promise<CreateInviteResult> {
  if (!(STAKEHOLDER_ROLES as readonly string[]).includes(input.role)) {
    throw new StakeholderError("Invalid stakeholder role", 400);
  }
  const purpose = input.purpose.trim().slice(0, 500);
  if (purpose.length < 3) {
    throw new StakeholderError("Purpose must be at least 3 characters", 400);
  }

  const caseRow = await loadCase(input.caseId, input.organisationId);
  if (!caseRow) throw new StakeholderError("Case not found", 404);

  await assertCanShareCase({
    caseRow,
    actor: input.actor,
    maxTlp: input.maxTlp,
    maxPap: input.maxPap,
  });

  const hours = Math.min(
    Math.max(input.expiresInHours ?? 72, 1),
    24 * 30,
  );
  const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);
  const collaboratorId = await ensureExternalCollaborator({
    organisationId: input.organisationId,
    email: input.email,
    displayName: input.displayName,
    organisationLabel: input.organisationLabel,
  });

  const { plaintext, hash } = generateInviteToken();
  const id = newId("stk_inv");
  const [invitation] = await db
    .insert(stakeholderInvitations)
    .values({
      id,
      organisationId: input.organisationId,
      caseId: input.caseId,
      collaboratorId,
      role: input.role,
      purpose,
      status: "pending",
      tokenHash: hash,
      singleUse: input.singleUse ?? true,
      maxTlp: input.maxTlp,
      maxPap: input.maxPap,
      expiresAt,
      invitedBy: input.invitedByUserId || null,
    })
    .returning();
  if (!invitation) throw new StakeholderError("Failed to create invitation", 500);

  await writeTimelineEvent({
    caseId: input.caseId,
    actorId: input.invitedByUserId || null,
    eventType: "stakeholder_invite",
    payload: {
      invitation_id: id,
      role: input.role,
      purpose,
      max_tlp: input.maxTlp,
      max_pap: input.maxPap,
      expires_at: expiresAt.toISOString(),
      // Email only in staff timeline — never full token.
      collaborator_email_domain: normaliseEmail(input.email).split("@")[1] ?? null,
    },
  });

  await recordAuditEvent({
    organisationId: input.organisationId,
    actorId: input.invitedByUserId || null,
    actorType: input.invitedByUserId ? "user" : "api_token",
    action: "stakeholder.invite_created",
    targetType: "stakeholder_invitation",
    targetId: id,
    after: {
      case_id: input.caseId,
      role: input.role,
      max_tlp: input.maxTlp,
      max_pap: input.maxPap,
      expires_at: expiresAt.toISOString(),
      single_use: input.singleUse ?? true,
    },
  });

  return { invitation, token: plaintext };
}

export async function listStakeholderInvites(
  organisationId: string,
  caseId: string,
): Promise<
  Array<
    StakeholderInvitation & {
      collaboratorEmail: string;
      collaboratorName: string;
    }
  >
> {
  const rows = await db
    .select({
      invitation: stakeholderInvitations,
      email: externalCollaborators.email,
      name: externalCollaborators.displayName,
    })
    .from(stakeholderInvitations)
    .innerJoin(
      externalCollaborators,
      eq(externalCollaborators.id, stakeholderInvitations.collaboratorId),
    )
    .where(
      and(
        eq(stakeholderInvitations.organisationId, organisationId),
        eq(stakeholderInvitations.caseId, caseId),
      ),
    )
    .orderBy(desc(stakeholderInvitations.createdAt));

  return rows.map((r) => ({
    ...r.invitation,
    collaboratorEmail: r.email,
    collaboratorName: r.name,
  }));
}

export async function revokeStakeholderInvite(opts: {
  organisationId: string;
  invitationId: string;
  revokedByUserId: string | null;
  reason?: string | null;
}): Promise<StakeholderInvitation> {
  const [inv] = await db
    .select()
    .from(stakeholderInvitations)
    .where(
      and(
        eq(stakeholderInvitations.id, opts.invitationId),
        eq(stakeholderInvitations.organisationId, opts.organisationId),
      ),
    )
    .limit(1);
  if (!inv) throw new StakeholderError("Invitation not found", 404);
  if (inv.status === "revoked") {
    return inv;
  }

  const now = new Date();
  const [updated] = await db
    .update(stakeholderInvitations)
    .set({
      status: "revoked",
      revokedAt: now,
      revokedBy: opts.revokedByUserId || null,
      revokeReason: opts.reason?.trim() || null,
      updatedAt: now,
    })
    .where(eq(stakeholderInvitations.id, opts.invitationId))
    .returning();
  if (!updated) throw new StakeholderError("Invitation not found", 404);

  // Kill all sessions for this invite promptly.
  await db
    .update(stakeholderSessions)
    .set({ revokedAt: now })
    .where(
      and(
        eq(stakeholderSessions.invitationId, opts.invitationId),
        isNull(stakeholderSessions.revokedAt),
      ),
    );

  await writeTimelineEvent({
    caseId: inv.caseId,
    actorId: opts.revokedByUserId || null,
    eventType: "stakeholder_invite",
    payload: {
      invitation_id: inv.id,
      action: "revoked",
      reason: opts.reason?.trim() || null,
    },
  });

  await recordAuditEvent({
    organisationId: opts.organisationId,
    actorId: opts.revokedByUserId || null,
    actorType: opts.revokedByUserId ? "user" : "api_token",
    action: "stakeholder.invite_revoked",
    targetType: "stakeholder_invitation",
    targetId: inv.id,
    after: { revoked_at: now.toISOString(), reason: opts.reason?.trim() || null },
  });

  await recordStakeholderAccess({
    organisationId: opts.organisationId,
    caseId: inv.caseId,
    invitationId: inv.id,
    collaboratorId: inv.collaboratorId,
    action: "invite_revoked",
    targetType: "stakeholder_invitation",
    targetId: inv.id,
    metadata: { reason: opts.reason?.trim() || null },
  });

  return updated;
}

/**
 * Mark expired pending invites. Sessions already past expiresAt fail auth
 * independently; this keeps status accurate for staff UI.
 */
export async function expireStaleInvites(organisationId?: string): Promise<number> {
  const now = new Date();
  const conditions = [
    inArray(stakeholderInvitations.status, ["pending", "accepted"]),
    sql`${stakeholderInvitations.expiresAt} <= ${now}`,
  ];
  if (organisationId) {
    conditions.push(eq(stakeholderInvitations.organisationId, organisationId));
  }
  const updated = await db
    .update(stakeholderInvitations)
    .set({ status: "expired", updatedAt: now })
    .where(and(...conditions))
    .returning({ id: stakeholderInvitations.id });
  return updated.length;
}

export async function getInvitationInOrg(
  invitationId: string,
  organisationId: string,
): Promise<StakeholderInvitation | null> {
  const [row] = await db
    .select()
    .from(stakeholderInvitations)
    .where(
      and(
        eq(stakeholderInvitations.id, invitationId),
        eq(stakeholderInvitations.organisationId, organisationId),
      ),
    )
    .limit(1);
  return row ?? null;
}
