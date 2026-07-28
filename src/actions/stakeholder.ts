"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import { resolveUserActor } from "@/lib/access";
import {
  createEvidenceRequest,
  createStakeholderApprovalRequest,
  createStakeholderInvite,
  listStakeholderInvites,
  previewExternalView,
  publishStakeholderUpdate,
  revokeStakeholderInvite,
  StakeholderError,
  type StakeholderPap,
  type StakeholderRole,
  type StakeholderTlp,
} from "@/lib/stakeholder";

function revalidateCase(caseId: string) {
  revalidatePath(`/cases/${caseId}`);
  revalidatePath(`/cases/${caseId}/comments`);
  revalidatePath(`/cases/${caseId}/timeline`);
}

export async function inviteStakeholderAction(input: {
  caseId: string;
  email: string;
  displayName: string;
  organisationLabel?: string;
  role: StakeholderRole;
  purpose: string;
  maxTlp: StakeholderTlp;
  maxPap: StakeholderPap;
  expiresInHours?: number;
  singleUse?: boolean;
}) {
  const user = await requireRole(["admin", "analyst"]);
  const actor = await resolveUserActor(user.organisationId, user.id);
  if (!actor) throw new Error("Forbidden");
  try {
    const result = await createStakeholderInvite({
      organisationId: user.organisationId,
      caseId: input.caseId,
      actor,
      invitedByUserId: user.id,
      email: input.email,
      displayName: input.displayName,
      organisationLabel: input.organisationLabel,
      role: input.role,
      purpose: input.purpose,
      maxTlp: input.maxTlp,
      maxPap: input.maxPap,
      expiresInHours: input.expiresInHours,
      singleUse: input.singleUse,
    });
    revalidateCase(input.caseId);
    return {
      ok: true as const,
      invitationId: result.invitation.id,
      token: result.token,
      expiresAt: result.invitation.expiresAt.toISOString(),
    };
  } catch (e) {
    if (e instanceof StakeholderError) {
      return { ok: false as const, error: e.message, status: e.status };
    }
    throw e;
  }
}

export async function revokeStakeholderInviteAction(input: {
  invitationId: string;
  caseId: string;
  reason?: string;
}) {
  const user = await requireRole(["admin", "analyst"]);
  try {
    await revokeStakeholderInvite({
      organisationId: user.organisationId,
      invitationId: input.invitationId,
      revokedByUserId: user.id,
      reason: input.reason,
    });
    revalidateCase(input.caseId);
    return { ok: true as const };
  } catch (e) {
    if (e instanceof StakeholderError) {
      return { ok: false as const, error: e.message };
    }
    throw e;
  }
}

export async function publishStakeholderUpdateAction(input: {
  caseId: string;
  title: string;
  body: string;
  tlp: StakeholderTlp;
  pap: StakeholderPap;
  invitationId?: string;
}) {
  const user = await requireRole(["admin", "analyst"]);
  const actor = await resolveUserActor(user.organisationId, user.id);
  if (!actor) throw new Error("Forbidden");
  try {
    const row = await publishStakeholderUpdate({
      organisationId: user.organisationId,
      caseId: input.caseId,
      actor,
      publishedByUserId: user.id,
      title: input.title,
      body: input.body,
      tlp: input.tlp,
      pap: input.pap,
      invitationId: input.invitationId,
    });
    revalidateCase(input.caseId);
    return { ok: true as const, id: row.id };
  } catch (e) {
    if (e instanceof StakeholderError) {
      return { ok: false as const, error: e.message };
    }
    throw e;
  }
}

export async function createEvidenceRequestAction(input: {
  caseId: string;
  invitationId: string;
  title: string;
  instructions: string;
}) {
  const user = await requireRole(["admin", "analyst"]);
  const actor = await resolveUserActor(user.organisationId, user.id);
  if (!actor) throw new Error("Forbidden");
  try {
    const row = await createEvidenceRequest({
      organisationId: user.organisationId,
      caseId: input.caseId,
      actor,
      requestedByUserId: user.id,
      invitationId: input.invitationId,
      title: input.title,
      instructions: input.instructions,
    });
    revalidateCase(input.caseId);
    return { ok: true as const, id: row.id };
  } catch (e) {
    if (e instanceof StakeholderError) {
      return { ok: false as const, error: e.message };
    }
    throw e;
  }
}

export async function createApprovalRequestAction(input: {
  caseId: string;
  invitationId: string;
  title: string;
  description: string;
}) {
  const user = await requireRole(["admin", "analyst"]);
  const actor = await resolveUserActor(user.organisationId, user.id);
  if (!actor) throw new Error("Forbidden");
  try {
    const row = await createStakeholderApprovalRequest({
      organisationId: user.organisationId,
      caseId: input.caseId,
      actor,
      requestedByUserId: user.id,
      invitationId: input.invitationId,
      title: input.title,
      description: input.description,
    });
    revalidateCase(input.caseId);
    return { ok: true as const, id: row.id };
  } catch (e) {
    if (e instanceof StakeholderError) {
      return { ok: false as const, error: e.message };
    }
    throw e;
  }
}

export async function previewStakeholderViewAction(invitationId: string) {
  const user = await requireRole(["admin", "analyst", "read_only"]);
  const actor = await resolveUserActor(user.organisationId, user.id);
  if (!actor) throw new Error("Forbidden");
  try {
    const view = await previewExternalView({
      organisationId: user.organisationId,
      invitationId,
      actor,
    });
    return { ok: true as const, view };
  } catch (e) {
    if (e instanceof StakeholderError) {
      return { ok: false as const, error: e.message };
    }
    throw e;
  }
}

export async function listStakeholderInvitesAction(caseId: string) {
  const user = await requireRole(["admin", "analyst", "read_only"]);
  const invites = await listStakeholderInvites(user.organisationId, caseId);
  return invites.map((i) => ({
    id: i.id,
    role: i.role,
    purpose: i.purpose,
    status: i.status,
    maxTlp: i.maxTlp,
    maxPap: i.maxPap,
    expiresAt: i.expiresAt.toISOString(),
    collaboratorEmail: i.collaboratorEmail,
    collaboratorName: i.collaboratorName,
    singleUse: i.singleUse,
    createdAt: i.createdAt.toISOString(),
  }));
}
