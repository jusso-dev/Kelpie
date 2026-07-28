/**
 * External portal + staff-side contribution mutations (issue #63).
 *
 * Enumeration resistance: every lookup is invitation/session-scoped. Wrong
 * IDs and cross-tenant IDs return the same 404. External never lists orgs,
 * members, or unrelated cases.
 */

import { and, desc, eq, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import {
  cases,
  stakeholderApprovals,
  stakeholderEvidenceRequests,
  stakeholderReadReceipts,
  stakeholderResponses,
  stakeholderUpdates,
  type StakeholderApproval,
  type StakeholderEvidenceRequest,
  type StakeholderResponse,
  type StakeholderUpdate,
} from "@/db/schema";
import { newId } from "@/lib/utils";
import { writeTimelineEvent } from "@/lib/timeline";
import { uploadEvidenceCore } from "@/lib/evidence/core";
import { recordAuditEvent } from "@/lib/audit/events";
import type { AccessActor } from "@/lib/access";
import { authorizeCase } from "@/lib/access";
import type { StakeholderAuthContext } from "./session";
import { recordStakeholderAccess } from "./audit";
import {
  ROLE_CAPABILITIES,
  StakeholderError,
  roleHasCapability,
  withinPapCeiling,
  withinTlpCeiling,
  type ExternalPortalView,
  type StakeholderPap,
  type StakeholderRole,
  type StakeholderTlp,
} from "./types";

async function loadCaseRow(caseId: string, organisationId: string) {
  const [row] = await db
    .select({
      id: cases.id,
      organisationId: cases.organisationId,
      caseNumber: cases.caseNumber,
      title: cases.title,
      status: cases.status,
      severity: cases.severity,
      tlp: cases.tlp,
      pap: cases.pap,
    })
    .from(cases)
    .where(and(eq(cases.id, caseId), eq(cases.organisationId, organisationId)))
    .limit(1);
  return row ?? null;
}

function assertCapability(
  role: StakeholderRole,
  capability: Parameters<typeof roleHasCapability>[1],
): void {
  if (!roleHasCapability(role, capability)) {
    throw new StakeholderError("This invitation cannot perform that action", 403);
  }
}

/** Build the exact redacted view an external collaborator receives. */
export async function buildExternalPortalView(
  ctx: StakeholderAuthContext,
): Promise<ExternalPortalView> {
  const caseRow = await loadCaseRow(ctx.caseId, ctx.organisationId);
  if (!caseRow) {
    throw new StakeholderError("Case not found", 404);
  }

  const maxTlp = ctx.invitation.maxTlp as StakeholderTlp;
  const maxPap = ctx.invitation.maxPap as StakeholderPap;
  const classificationRedacted =
    !withinTlpCeiling(caseRow.tlp, maxTlp) ||
    !withinPapCeiling(caseRow.pap, maxPap);

  const role = ctx.role;
  const caps = [...ROLE_CAPABILITIES[role]];

  const updates = roleHasCapability(role, "view_updates")
    ? await listVisibleUpdates(ctx, maxTlp, maxPap)
    : [];

  const evidenceRequests = roleHasCapability(role, "view_evidence_requests")
    ? await listEvidenceRequestsForInvite(ctx)
    : [];

  const approvals = roleHasCapability(role, "view_approvals")
    ? await listApprovalsForInvite(ctx)
    : [];

  const responses = await listResponsesForInvite(ctx);

  return {
    case: {
      caseNumber: caseRow.caseNumber,
      title: classificationRedacted ? "[classification restricted]" : caseRow.title,
      // Status can signal incident phase; redact when over ceiling.
      status: classificationRedacted ? "restricted" : caseRow.status,
      severity: classificationRedacted ? "unknown" : caseRow.severity,
      tlp: withinTlpCeiling(caseRow.tlp, maxTlp) ? caseRow.tlp : maxTlp,
      pap: withinPapCeiling(caseRow.pap, maxPap) ? caseRow.pap : maxPap,
      purpose: ctx.invitation.purpose,
      role,
      maxTlp,
      maxPap,
      classificationRedacted,
    },
    updates,
    evidenceRequests,
    approvals,
    responses,
    capabilities: caps,
    collaborator: {
      displayName: ctx.collaborator.displayName,
      email: ctx.collaborator.email,
      organisationLabel: ctx.collaborator.organisationLabel,
    },
  };
}

async function listVisibleUpdates(
  ctx: StakeholderAuthContext,
  maxTlp: StakeholderTlp,
  maxPap: StakeholderPap,
) {
  const rows = await db
    .select()
    .from(stakeholderUpdates)
    .where(
      and(
        eq(stakeholderUpdates.organisationId, ctx.organisationId),
        eq(stakeholderUpdates.caseId, ctx.caseId),
        or(
          isNull(stakeholderUpdates.invitationId),
          eq(stakeholderUpdates.invitationId, ctx.invitation.id),
        ),
      ),
    )
    .orderBy(desc(stakeholderUpdates.publishedAt));

  const receipts = await db
    .select({ updateId: stakeholderReadReceipts.updateId })
    .from(stakeholderReadReceipts)
    .where(eq(stakeholderReadReceipts.invitationId, ctx.invitation.id));
  const readSet = new Set(receipts.map((r) => r.updateId));

  return rows
    .filter(
      (u) =>
        withinTlpCeiling(u.tlp, maxTlp) && withinPapCeiling(u.pap, maxPap),
    )
    .map((u) => ({
      id: u.id,
      title: u.title,
      body: u.body,
      publishedAt: u.publishedAt.toISOString(),
      tlp: u.tlp,
      pap: u.pap,
      read: readSet.has(u.id),
    }));
}

async function listEvidenceRequestsForInvite(ctx: StakeholderAuthContext) {
  const rows = await db
    .select()
    .from(stakeholderEvidenceRequests)
    .where(
      and(
        eq(stakeholderEvidenceRequests.organisationId, ctx.organisationId),
        eq(stakeholderEvidenceRequests.invitationId, ctx.invitation.id),
      ),
    )
    .orderBy(desc(stakeholderEvidenceRequests.createdAt));
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    instructions: r.instructions,
    status: r.status,
    dueAt: r.dueAt?.toISOString() ?? null,
    fulfilledAt: r.fulfilledAt?.toISOString() ?? null,
  }));
}

async function listApprovalsForInvite(ctx: StakeholderAuthContext) {
  const rows = await db
    .select()
    .from(stakeholderApprovals)
    .where(
      and(
        eq(stakeholderApprovals.organisationId, ctx.organisationId),
        eq(stakeholderApprovals.invitationId, ctx.invitation.id),
      ),
    )
    .orderBy(desc(stakeholderApprovals.createdAt));
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    status: r.status,
    decisionNote: r.decisionNote,
    decidedAt: r.decidedAt?.toISOString() ?? null,
  }));
}

async function listResponsesForInvite(ctx: StakeholderAuthContext) {
  const rows = await db
    .select()
    .from(stakeholderResponses)
    .where(
      and(
        eq(stakeholderResponses.organisationId, ctx.organisationId),
        eq(stakeholderResponses.invitationId, ctx.invitation.id),
      ),
    )
    .orderBy(desc(stakeholderResponses.createdAt));
  return rows.map((r) => ({
    id: r.id,
    body: r.body,
    createdAt: r.createdAt.toISOString(),
    attribution: `External · ${ctx.collaborator.displayName}`,
  }));
}

export async function markUpdateRead(
  ctx: StakeholderAuthContext,
  updateId: string,
): Promise<void> {
  assertCapability(ctx.role, "read_receipt");

  const [update] = await db
    .select()
    .from(stakeholderUpdates)
    .where(
      and(
        eq(stakeholderUpdates.id, updateId),
        eq(stakeholderUpdates.organisationId, ctx.organisationId),
        eq(stakeholderUpdates.caseId, ctx.caseId),
      ),
    )
    .limit(1);
  if (!update) throw new StakeholderError("Update not found", 404);
  if (
    update.invitationId &&
    update.invitationId !== ctx.invitation.id
  ) {
    throw new StakeholderError("Update not found", 404);
  }
  if (
    !withinTlpCeiling(update.tlp, ctx.invitation.maxTlp as StakeholderTlp) ||
    !withinPapCeiling(update.pap, ctx.invitation.maxPap as StakeholderPap)
  ) {
    throw new StakeholderError("Update not found", 404);
  }

  await db
    .insert(stakeholderReadReceipts)
    .values({
      id: newId("stk_rr"),
      organisationId: ctx.organisationId,
      invitationId: ctx.invitation.id,
      collaboratorId: ctx.collaborator.id,
      updateId,
    })
    .onConflictDoNothing();

  await recordStakeholderAccess({
    organisationId: ctx.organisationId,
    caseId: ctx.caseId,
    invitationId: ctx.invitation.id,
    collaboratorId: ctx.collaborator.id,
    sessionId: ctx.session.id,
    action: "update_read",
    targetType: "stakeholder_update",
    targetId: updateId,
    actorLabel: ctx.collaborator.email,
  });
}

export async function postStakeholderResponse(
  ctx: StakeholderAuthContext,
  body: string,
  inReplyToUpdateId?: string | null,
): Promise<StakeholderResponse> {
  assertCapability(ctx.role, "respond");
  const text = body.trim().slice(0, 10_000);
  if (text.length < 1) {
    throw new StakeholderError("Response body is required", 400);
  }

  if (inReplyToUpdateId) {
    const [u] = await db
      .select({ id: stakeholderUpdates.id })
      .from(stakeholderUpdates)
      .where(
        and(
          eq(stakeholderUpdates.id, inReplyToUpdateId),
          eq(stakeholderUpdates.caseId, ctx.caseId),
          eq(stakeholderUpdates.organisationId, ctx.organisationId),
        ),
      )
      .limit(1);
    if (!u) throw new StakeholderError("Update not found", 404);
  }

  const id = newId("stk_rsp");
  const [row] = await db
    .insert(stakeholderResponses)
    .values({
      id,
      organisationId: ctx.organisationId,
      caseId: ctx.caseId,
      invitationId: ctx.invitation.id,
      collaboratorId: ctx.collaborator.id,
      inReplyToUpdateId: inReplyToUpdateId ?? null,
      body: text,
    })
    .returning();
  if (!row) throw new StakeholderError("Failed to save response", 500);

  await writeTimelineEvent({
    caseId: ctx.caseId,
    actorId: null,
    eventType: "stakeholder_response",
    payload: {
      response_id: id,
      invitation_id: ctx.invitation.id,
      source: "external",
      attribution: ctx.collaborator.displayName,
      collaborator_id: ctx.collaborator.id,
      body_preview: text.slice(0, 200),
    },
  });

  await recordStakeholderAccess({
    organisationId: ctx.organisationId,
    caseId: ctx.caseId,
    invitationId: ctx.invitation.id,
    collaboratorId: ctx.collaborator.id,
    sessionId: ctx.session.id,
    action: "response_posted",
    targetType: "stakeholder_response",
    targetId: id,
    actorLabel: ctx.collaborator.email,
  });

  return row;
}

export async function fulfillEvidenceRequest(
  ctx: StakeholderAuthContext,
  requestId: string,
  file: { buffer: Buffer; filename: string; contentType: string | null },
): Promise<{ request: StakeholderEvidenceRequest; attachmentId: string }> {
  assertCapability(ctx.role, "upload_evidence");

  const [req] = await db
    .select()
    .from(stakeholderEvidenceRequests)
    .where(
      and(
        eq(stakeholderEvidenceRequests.id, requestId),
        eq(stakeholderEvidenceRequests.organisationId, ctx.organisationId),
        eq(stakeholderEvidenceRequests.invitationId, ctx.invitation.id),
      ),
    )
    .limit(1);
  if (!req) throw new StakeholderError("Evidence request not found", 404);
  if (req.status !== "open") {
    throw new StakeholderError("Evidence request is no longer open", 409);
  }

  // Same quarantine / integrity / custody pipeline as #44.
  const attachment = await uploadEvidenceCore({
    organisationId: ctx.organisationId,
    caseId: ctx.caseId,
    actorId: null,
    buffer: file.buffer,
    filename: file.filename,
    declaredContentType: file.contentType,
    source: "stakeholder_portal",
    acquisitionSource: `external:${ctx.collaborator.email}`,
    examinerNotes: `Uploaded via stakeholder portal for request ${req.id}`,
  });

  // Atomic fulfill: concurrent uploads cannot both mark the same request.
  // Loser still leaves an attachment on the case (scanned); status stays single-winner.
  const now = new Date();
  const [updated] = await db
    .update(stakeholderEvidenceRequests)
    .set({
      status: "fulfilled",
      fulfilledAttachmentId: attachment.id,
      fulfilledAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(stakeholderEvidenceRequests.id, requestId),
        eq(stakeholderEvidenceRequests.status, "open"),
        eq(stakeholderEvidenceRequests.organisationId, ctx.organisationId),
        eq(stakeholderEvidenceRequests.invitationId, ctx.invitation.id),
      ),
    )
    .returning();
  if (!updated) {
    throw new StakeholderError("Evidence request is no longer open", 409);
  }

  await writeTimelineEvent({
    caseId: ctx.caseId,
    actorId: null,
    eventType: "stakeholder_evidence",
    payload: {
      request_id: requestId,
      attachment_id: attachment.id,
      invitation_id: ctx.invitation.id,
      source: "external",
      attribution: ctx.collaborator.displayName,
      filename: attachment.filename,
      status: attachment.status,
    },
  });

  await recordStakeholderAccess({
    organisationId: ctx.organisationId,
    caseId: ctx.caseId,
    invitationId: ctx.invitation.id,
    collaboratorId: ctx.collaborator.id,
    sessionId: ctx.session.id,
    action: "evidence_uploaded",
    targetType: "attachment",
    targetId: attachment.id,
    metadata: {
      request_id: requestId,
      evidence_status: attachment.status,
    },
    actorLabel: ctx.collaborator.email,
  });

  return { request: updated, attachmentId: attachment.id };
}

export async function decideStakeholderApproval(
  ctx: StakeholderAuthContext,
  approvalId: string,
  decision: "approved" | "rejected",
  note?: string | null,
): Promise<StakeholderApproval> {
  assertCapability(ctx.role, "approve");

  const [row] = await db
    .select()
    .from(stakeholderApprovals)
    .where(
      and(
        eq(stakeholderApprovals.id, approvalId),
        eq(stakeholderApprovals.organisationId, ctx.organisationId),
        eq(stakeholderApprovals.invitationId, ctx.invitation.id),
      ),
    )
    .limit(1);
  if (!row) throw new StakeholderError("Approval request not found", 404);
  if (row.status !== "pending") {
    throw new StakeholderError("Approval is no longer pending", 409);
  }

  // Atomic decide: only one concurrent decision wins (status-conditional UPDATE).
  const now = new Date();
  const [updated] = await db
    .update(stakeholderApprovals)
    .set({
      status: decision,
      decisionNote: note?.trim().slice(0, 2000) || null,
      decidedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(stakeholderApprovals.id, approvalId),
        eq(stakeholderApprovals.status, "pending"),
        eq(stakeholderApprovals.organisationId, ctx.organisationId),
        eq(stakeholderApprovals.invitationId, ctx.invitation.id),
      ),
    )
    .returning();
  if (!updated) {
    throw new StakeholderError("Approval is no longer pending", 409);
  }

  await writeTimelineEvent({
    caseId: ctx.caseId,
    actorId: null,
    eventType: "stakeholder_approval",
    payload: {
      approval_id: approvalId,
      invitation_id: ctx.invitation.id,
      source: "external",
      attribution: ctx.collaborator.displayName,
      decision,
      decision_note: note?.trim().slice(0, 200) || null,
    },
  });

  await recordStakeholderAccess({
    organisationId: ctx.organisationId,
    caseId: ctx.caseId,
    invitationId: ctx.invitation.id,
    collaboratorId: ctx.collaborator.id,
    sessionId: ctx.session.id,
    action: `approval_${decision}`,
    targetType: "stakeholder_approval",
    targetId: approvalId,
    actorLabel: ctx.collaborator.email,
  });

  return updated;
}

/* ── Staff mutations ─────────────────────────────────────────────────────── */

export async function publishStakeholderUpdate(opts: {
  organisationId: string;
  caseId: string;
  actor: AccessActor;
  publishedByUserId: string;
  title: string;
  body: string;
  tlp: StakeholderTlp;
  pap: StakeholderPap;
  invitationId?: string | null;
}): Promise<StakeholderUpdate> {
  const decision = await authorizeCase(
    opts.organisationId,
    opts.caseId,
    opts.actor,
    "edit",
  );
  if (!decision.ok) throw new StakeholderError("Case not found", 404);

  const title = opts.title.trim().slice(0, 200);
  const body = opts.body.trim().slice(0, 20_000);
  if (title.length < 1 || body.length < 1) {
    throw new StakeholderError("Title and body are required", 400);
  }

  if (opts.invitationId) {
    const { stakeholderInvitations } = await import("@/db/schema");
    const [inv] = await db
      .select({ id: stakeholderInvitations.id })
      .from(stakeholderInvitations)
      .where(
        and(
          eq(stakeholderInvitations.id, opts.invitationId),
          eq(stakeholderInvitations.organisationId, opts.organisationId),
          eq(stakeholderInvitations.caseId, opts.caseId),
        ),
      )
      .limit(1);
    if (!inv) throw new StakeholderError("Invitation not found", 404);
  }

  const id = newId("stk_upd");
  const [row] = await db
    .insert(stakeholderUpdates)
    .values({
      id,
      organisationId: opts.organisationId,
      caseId: opts.caseId,
      invitationId: opts.invitationId ?? null,
      title,
      body,
      tlp: opts.tlp,
      pap: opts.pap,
      publishedBy: opts.publishedByUserId,
    })
    .returning();
  if (!row) throw new StakeholderError("Failed to publish update", 500);

  await writeTimelineEvent({
    caseId: opts.caseId,
    actorId: opts.publishedByUserId,
    eventType: "stakeholder_update",
    payload: {
      update_id: id,
      title,
      tlp: opts.tlp,
      pap: opts.pap,
      invitation_id: opts.invitationId ?? null,
      source: "analyst",
    },
  });

  await recordAuditEvent({
    organisationId: opts.organisationId,
    actorId: opts.publishedByUserId,
    actorType: "user",
    action: "stakeholder.update_published",
    targetType: "stakeholder_update",
    targetId: id,
  });

  return row;
}

export async function createEvidenceRequest(opts: {
  organisationId: string;
  caseId: string;
  actor: AccessActor;
  requestedByUserId: string;
  invitationId: string;
  title: string;
  instructions: string;
  dueAt?: Date | null;
}): Promise<StakeholderEvidenceRequest> {
  const decision = await authorizeCase(
    opts.organisationId,
    opts.caseId,
    opts.actor,
    "edit",
  );
  if (!decision.ok) throw new StakeholderError("Case not found", 404);

  const { stakeholderInvitations } = await import("@/db/schema");
  const [inv] = await db
    .select()
    .from(stakeholderInvitations)
    .where(
      and(
        eq(stakeholderInvitations.id, opts.invitationId),
        eq(stakeholderInvitations.organisationId, opts.organisationId),
        eq(stakeholderInvitations.caseId, opts.caseId),
      ),
    )
    .limit(1);
  if (!inv) throw new StakeholderError("Invitation not found", 404);
  if (inv.status === "revoked" || inv.status === "expired") {
    throw new StakeholderError("Invitation is not active", 409);
  }
  if (!roleHasCapability(inv.role as StakeholderRole, "upload_evidence")) {
    throw new StakeholderError(
      "Invitation role cannot provide evidence",
      400,
    );
  }

  const title = opts.title.trim().slice(0, 200);
  const instructions = opts.instructions.trim().slice(0, 5000);
  if (title.length < 1 || instructions.length < 1) {
    throw new StakeholderError("Title and instructions are required", 400);
  }

  const id = newId("stk_ereq");
  const [row] = await db
    .insert(stakeholderEvidenceRequests)
    .values({
      id,
      organisationId: opts.organisationId,
      caseId: opts.caseId,
      invitationId: opts.invitationId,
      title,
      instructions,
      dueAt: opts.dueAt ?? null,
      requestedBy: opts.requestedByUserId,
    })
    .returning();
  if (!row) throw new StakeholderError("Failed to create evidence request", 500);

  await writeTimelineEvent({
    caseId: opts.caseId,
    actorId: opts.requestedByUserId,
    eventType: "stakeholder_evidence",
    payload: {
      request_id: id,
      invitation_id: opts.invitationId,
      action: "requested",
      title,
      source: "analyst",
    },
  });

  return row;
}

export async function createStakeholderApprovalRequest(opts: {
  organisationId: string;
  caseId: string;
  actor: AccessActor;
  requestedByUserId: string;
  invitationId: string;
  title: string;
  description: string;
}): Promise<StakeholderApproval> {
  const decision = await authorizeCase(
    opts.organisationId,
    opts.caseId,
    opts.actor,
    "edit",
  );
  if (!decision.ok) throw new StakeholderError("Case not found", 404);

  const { stakeholderInvitations } = await import("@/db/schema");
  const [inv] = await db
    .select()
    .from(stakeholderInvitations)
    .where(
      and(
        eq(stakeholderInvitations.id, opts.invitationId),
        eq(stakeholderInvitations.organisationId, opts.organisationId),
        eq(stakeholderInvitations.caseId, opts.caseId),
      ),
    )
    .limit(1);
  if (!inv) throw new StakeholderError("Invitation not found", 404);
  if (!roleHasCapability(inv.role as StakeholderRole, "approve")) {
    throw new StakeholderError("Invitation role cannot approve", 400);
  }

  const title = opts.title.trim().slice(0, 200);
  const description = opts.description.trim().slice(0, 5000);
  if (title.length < 1 || description.length < 1) {
    throw new StakeholderError("Title and description are required", 400);
  }

  const id = newId("stk_apr");
  const [row] = await db
    .insert(stakeholderApprovals)
    .values({
      id,
      organisationId: opts.organisationId,
      caseId: opts.caseId,
      invitationId: opts.invitationId,
      title,
      description,
      requestedBy: opts.requestedByUserId,
    })
    .returning();
  if (!row) throw new StakeholderError("Failed to create approval request", 500);

  await writeTimelineEvent({
    caseId: opts.caseId,
    actorId: opts.requestedByUserId,
    eventType: "stakeholder_approval",
    payload: {
      approval_id: id,
      invitation_id: opts.invitationId,
      action: "requested",
      title,
      source: "analyst",
    },
  });

  return row;
}

/**
 * Analyst preview of the exact external view for an invitation without
 * creating a session. Uses invitation ceilings and role capabilities.
 */
export async function previewExternalView(opts: {
  organisationId: string;
  invitationId: string;
  actor: AccessActor;
  /** When set, invitation must belong to this case (path param binding). */
  caseId?: string;
}): Promise<ExternalPortalView> {
  const { stakeholderInvitations, externalCollaborators } = await import(
    "@/db/schema"
  );
  const conditions = [
    eq(stakeholderInvitations.id, opts.invitationId),
    eq(stakeholderInvitations.organisationId, opts.organisationId),
  ];
  if (opts.caseId) {
    conditions.push(eq(stakeholderInvitations.caseId, opts.caseId));
  }
  const [inv] = await db
    .select()
    .from(stakeholderInvitations)
    .where(and(...conditions))
    .limit(1);
  if (!inv) throw new StakeholderError("Invitation not found", 404);
  if (opts.caseId && inv.caseId !== opts.caseId) {
    throw new StakeholderError("Invitation not found", 404);
  }

  const decision = await authorizeCase(
    opts.organisationId,
    inv.caseId,
    opts.actor,
    "view_metadata",
  );
  if (!decision.ok) throw new StakeholderError("Invitation not found", 404);

  const [collab] = await db
    .select()
    .from(externalCollaborators)
    .where(eq(externalCollaborators.id, inv.collaboratorId))
    .limit(1);
  if (!collab) throw new StakeholderError("Invitation not found", 404);

  // Synthetic auth context — no real session.
  const fakeCtx = {
    session: {
      id: "preview",
      organisationId: inv.organisationId,
      invitationId: inv.id,
      collaboratorId: inv.collaboratorId,
      caseId: inv.caseId,
      tokenHash: "",
      expiresAt: inv.expiresAt,
      revokedAt: null,
      lastSeenAt: null,
      createdAt: inv.createdAt,
    },
    invitation: inv,
    collaborator: collab,
    role: inv.role as StakeholderRole,
    caseId: inv.caseId,
    organisationId: inv.organisationId,
  } satisfies StakeholderAuthContext;

  return buildExternalPortalView(fakeCtx);
}

/** Staff listing of external responses with attribution flags. */
export async function listCaseExternalContributions(
  organisationId: string,
  caseId: string,
) {
  const { externalCollaborators } = await import("@/db/schema");
  const rows = await db
    .select({
      id: stakeholderResponses.id,
      body: stakeholderResponses.body,
      createdAt: stakeholderResponses.createdAt,
      invitationId: stakeholderResponses.invitationId,
      displayName: externalCollaborators.displayName,
      email: externalCollaborators.email,
    })
    .from(stakeholderResponses)
    .innerJoin(
      externalCollaborators,
      eq(externalCollaborators.id, stakeholderResponses.collaboratorId),
    )
    .where(
      and(
        eq(stakeholderResponses.organisationId, organisationId),
        eq(stakeholderResponses.caseId, caseId),
      ),
    )
    .orderBy(desc(stakeholderResponses.createdAt));

  return rows.map((r) => ({
    id: r.id,
    body: r.body,
    createdAt: r.createdAt.toISOString(),
    invitationId: r.invitationId,
    source: "external" as const,
    attribution: r.displayName,
    email: r.email,
  }));
}
