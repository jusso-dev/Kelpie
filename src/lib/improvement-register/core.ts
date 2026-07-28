/**
 * Improvement register core (issue #66).
 *
 * Durable records for detection gaps, control weaknesses, process failures,
 * and related systemic work. Consumes #64 review improvement proposals without
 * replacing them. External ticket fields are bounded references only.
 */

import { and, asc, desc, eq, inArray, isNotNull, lt, ne } from "drizzle-orm";
import { db } from "@/db";
import {
  casePostIncidentReviews,
  cases,
  improvementRegisterEvents,
  improvementRegisterItems,
  improvementRegisterLinks,
  playbooks,
  reviewImprovementProposals,
  users,
  type ImprovementRegisterEvent,
  type ImprovementRegisterItem,
  type ImprovementRegisterLink,
} from "@/db/schema";
import {
  authorizeCase,
  hasPermission,
  REDACTED_PLACEHOLDER,
  resolveUserActor,
  type AccessActor,
  type AccessPermission,
} from "@/lib/access";
import { newId } from "@/lib/utils";
import {
  rankSimilarImprovements,
  type SimilarityMatch,
} from "./similarity";
import {
  CLOSABLE_STATUSES,
  OPEN_WORK_STATUSES,
  PROPOSAL_KIND_TO_REGISTER_TYPE,
  type ImprovementLinkKind,
  type ImprovementRegisterSeverity,
  type ImprovementRegisterStatus,
  type ImprovementRegisterType,
  type ImprovementSourceKind,
  type ImprovementTicketSyncState,
  type ImprovementValidationMethod,
} from "./types";

export class ImprovementRegisterError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "ImprovementRegisterError";
    this.status = status;
  }
}

export type CreateImprovementInput = {
  type: ImprovementRegisterType;
  title: string;
  description?: string | null;
  evidence?: Record<string, unknown> | null;
  sensitiveEvidence?: Record<string, unknown> | null;
  severity?: ImprovementRegisterSeverity;
  residualRisk?: string | null;
  ownerId?: string | null;
  dueAt?: Date | string | null;
  linkedPlaybookId?: string | null;
  externalTicketRef?: string | null;
  externalTicketUrl?: string | null;
  /** Create from a case (immutable source). */
  caseId?: string | null;
  /** Create from a post-incident review (immutable source). */
  reviewId?: string | null;
};

export type ImprovementView = ImprovementRegisterItem & {
  links: ImprovementRegisterLink[];
  /** True when sensitiveEvidence was redacted for this actor. */
  sensitiveEvidenceRedacted?: boolean;
};

async function resolveActor(
  organisationId: string,
  actorUserId: string | null,
): Promise<AccessActor> {
  if (actorUserId) {
    const resolved = await resolveUserActor(organisationId, actorUserId);
    if (!resolved) {
      throw new ImprovementRegisterError("Not found", 404);
    }
    return resolved;
  }
  return {
    organisationId,
    userId: null,
    role: "system",
    teamIds: [],
  };
}

async function requireCaseAccess(
  organisationId: string,
  caseId: string,
  actorUserId: string | null,
  required: AccessPermission,
): Promise<{ actor: AccessActor; permissions: Set<AccessPermission> }> {
  const actor = await resolveActor(organisationId, actorUserId);
  const result = await authorizeCase(organisationId, caseId, actor, required);
  if (!result.ok) {
    throw new ImprovementRegisterError(result.error, result.status);
  }
  return { actor, permissions: result.permissions };
}

async function assertOwnerInOrg(
  organisationId: string,
  ownerId: string | null | undefined,
): Promise<void> {
  if (!ownerId) return;
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, ownerId), eq(users.organisationId, organisationId)))
    .limit(1);
  if (!row) {
    throw new ImprovementRegisterError("Owner not found in organisation", 400);
  }
}

async function assertPlaybookInOrg(
  organisationId: string,
  playbookId: string | null | undefined,
): Promise<void> {
  if (!playbookId) return;
  const [row] = await db
    .select({ id: playbooks.id })
    .from(playbooks)
    .where(
      and(
        eq(playbooks.id, playbookId),
        eq(playbooks.organisationId, organisationId),
      ),
    )
    .limit(1);
  if (!row) {
    throw new ImprovementRegisterError("Playbook not found", 404);
  }
}

async function assertCaseInOrg(
  organisationId: string,
  caseId: string,
): Promise<{ id: string }> {
  const [row] = await db
    .select({ id: cases.id })
    .from(cases)
    .where(and(eq(cases.id, caseId), eq(cases.organisationId, organisationId)))
    .limit(1);
  if (!row) throw new ImprovementRegisterError("Case not found", 404);
  return row;
}

async function assertReviewInOrg(
  organisationId: string,
  reviewId: string,
): Promise<{ id: string; caseId: string }> {
  const [row] = await db
    .select({
      id: casePostIncidentReviews.id,
      caseId: casePostIncidentReviews.caseId,
    })
    .from(casePostIncidentReviews)
    .where(
      and(
        eq(casePostIncidentReviews.id, reviewId),
        eq(casePostIncidentReviews.organisationId, organisationId),
      ),
    )
    .limit(1);
  if (!row) throw new ImprovementRegisterError("Review not found", 404);
  return row;
}

async function appendEvent(input: {
  organisationId: string;
  improvementId: string;
  eventType: ImprovementRegisterEvent["eventType"];
  fromStatus?: ImprovementRegisterStatus | null;
  toStatus?: ImprovementRegisterStatus | null;
  actorId: string | null;
  payload?: Record<string, unknown>;
}): Promise<void> {
  await db.insert(improvementRegisterEvents).values({
    id: newId("imp_evt"),
    organisationId: input.organisationId,
    improvementId: input.improvementId,
    eventType: input.eventType,
    fromStatus: input.fromStatus ?? null,
    toStatus: input.toStatus ?? null,
    actorId: input.actorId,
    payload: input.payload ?? {},
  });
}

async function recomputeRecurrence(
  organisationId: string,
  improvementId: string,
): Promise<number> {
  const rows = await db
    .select({ targetId: improvementRegisterLinks.targetId })
    .from(improvementRegisterLinks)
    .where(
      and(
        eq(improvementRegisterLinks.organisationId, organisationId),
        eq(improvementRegisterLinks.improvementId, improvementId),
        eq(improvementRegisterLinks.linkKind, "case"),
      ),
    );
  const distinct = new Set(rows.map((r) => r.targetId));
  const count = distinct.size;
  await db
    .update(improvementRegisterItems)
    .set({ recurrenceCount: count, updatedAt: new Date() })
    .where(
      and(
        eq(improvementRegisterItems.id, improvementId),
        eq(improvementRegisterItems.organisationId, organisationId),
      ),
    );
  return count;
}

async function insertLink(input: {
  organisationId: string;
  improvementId: string;
  linkKind: ImprovementLinkKind;
  targetId: string;
  isSource: boolean;
  actorUserId: string | null;
}): Promise<ImprovementRegisterLink> {
  const id = newId("imp_lnk");
  try {
    await db.insert(improvementRegisterLinks).values({
      id,
      organisationId: input.organisationId,
      improvementId: input.improvementId,
      linkKind: input.linkKind,
      targetId: input.targetId,
      isSource: input.isSource,
      createdBy: input.actorUserId,
    });
  } catch (err) {
    // Unique violation → already linked; return existing.
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("improvement_register_links_unique") || message.includes("unique")) {
      const [existing] = await db
        .select()
        .from(improvementRegisterLinks)
        .where(
          and(
            eq(improvementRegisterLinks.improvementId, input.improvementId),
            eq(improvementRegisterLinks.linkKind, input.linkKind),
            eq(improvementRegisterLinks.targetId, input.targetId),
          ),
        )
        .limit(1);
      if (existing) return existing;
    }
    throw err;
  }
  const [row] = await db
    .select()
    .from(improvementRegisterLinks)
    .where(eq(improvementRegisterLinks.id, id))
    .limit(1);
  if (!row) throw new ImprovementRegisterError("Failed to create link", 500);
  return row;
}

async function loadItem(
  organisationId: string,
  improvementId: string,
): Promise<ImprovementRegisterItem | null> {
  const [row] = await db
    .select()
    .from(improvementRegisterItems)
    .where(
      and(
        eq(improvementRegisterItems.id, improvementId),
        eq(improvementRegisterItems.organisationId, organisationId),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function loadLinks(
  organisationId: string,
  improvementId: string,
): Promise<ImprovementRegisterLink[]> {
  return db
    .select()
    .from(improvementRegisterLinks)
    .where(
      and(
        eq(improvementRegisterLinks.organisationId, organisationId),
        eq(improvementRegisterLinks.improvementId, improvementId),
      ),
    )
    .orderBy(asc(improvementRegisterLinks.createdAt));
}

/**
 * Redact sensitiveEvidence when actor lacks view_sensitive on the source case
 * (or any linked case that may have contributed restricted notes).
 */
async function applySensitiveRedaction(
  organisationId: string,
  item: ImprovementRegisterItem,
  actorUserId: string | null,
): Promise<ImprovementView> {
  const links = await loadLinks(organisationId, item.id);
  const base: ImprovementView = { ...item, links, sensitiveEvidenceRedacted: false };

  if (item.sensitiveEvidence == null) {
    return base;
  }

  // Prefer source case; else any linked case.
  const caseIds: string[] = [];
  if (item.sourceCaseId) caseIds.push(item.sourceCaseId);
  for (const l of links) {
    if (l.linkKind === "case" && !caseIds.includes(l.targetId)) {
      caseIds.push(l.targetId);
    }
  }

  if (caseIds.length === 0) {
    // No case context — keep redacted for non-admin actors for safety.
    const actor = await resolveActor(organisationId, actorUserId);
    if (actor.role !== "admin") {
      return {
        ...base,
        sensitiveEvidence: { [REDACTED_PLACEHOLDER]: true },
        sensitiveEvidenceRedacted: true,
      };
    }
    return base;
  }

  let canView = false;
  for (const caseId of caseIds) {
    try {
      const { permissions } = await requireCaseAccess(
        organisationId,
        caseId,
        actorUserId,
        "view_metadata",
      );
      if (hasPermission(permissions, "view_sensitive")) {
        canView = true;
        break;
      }
    } catch {
      // cannot know case — ignore
    }
  }

  if (!canView) {
    return {
      ...base,
      sensitiveEvidence: { [REDACTED_PLACEHOLDER]: true },
      sensitiveEvidenceRedacted: true,
    };
  }
  return base;
}

function parseDueAt(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new ImprovementRegisterError("Invalid dueAt", 400);
    }
    return value;
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new ImprovementRegisterError("Invalid dueAt", 400);
  }
  return d;
}

export async function createImprovementCore(
  organisationId: string,
  actorUserId: string | null,
  input: CreateImprovementInput,
): Promise<ImprovementView> {
  const title = input.title?.trim();
  if (!title) throw new ImprovementRegisterError("Title is required");
  await assertOwnerInOrg(organisationId, input.ownerId);
  await assertPlaybookInOrg(organisationId, input.linkedPlaybookId);

  let sourceKind: ImprovementSourceKind = "manual";
  let sourceCaseId: string | null = null;
  let sourceReviewId: string | null = null;

  if (input.reviewId) {
    const review = await assertReviewInOrg(organisationId, input.reviewId);
    await requireCaseAccess(
      organisationId,
      review.caseId,
      actorUserId,
      "edit",
    );
    sourceKind = "review";
    sourceReviewId = review.id;
    sourceCaseId = review.caseId;
  } else if (input.caseId) {
    await assertCaseInOrg(organisationId, input.caseId);
    await requireCaseAccess(
      organisationId,
      input.caseId,
      actorUserId,
      "edit",
    );
    sourceKind = "case";
    sourceCaseId = input.caseId;
  }

  const id = newId("imp");
  const dueAt = parseDueAt(input.dueAt);

  await db.insert(improvementRegisterItems).values({
    id,
    organisationId,
    type: input.type,
    title: title.slice(0, 500),
    description: input.description?.trim() || null,
    evidence: input.evidence ?? {},
    sensitiveEvidence: input.sensitiveEvidence ?? null,
    severity: input.severity ?? "medium",
    residualRisk: input.residualRisk?.trim() || null,
    status: "open",
    ownerId: input.ownerId ?? null,
    dueAt,
    recurrenceCount: 0,
    linkedPlaybookId: input.linkedPlaybookId ?? null,
    externalTicketRef: input.externalTicketRef?.trim() || null,
    externalTicketUrl: input.externalTicketUrl?.trim() || null,
    externalTicketSyncState: input.externalTicketRef ? "linked" : "none",
    sourceKind,
    sourceCaseId,
    sourceReviewId,
    sourceProposalId: null,
    createdBy: actorUserId,
  });

  if (sourceCaseId) {
    await insertLink({
      organisationId,
      improvementId: id,
      linkKind: "case",
      targetId: sourceCaseId,
      isSource: true,
      actorUserId,
    });
  }
  if (sourceReviewId) {
    await insertLink({
      organisationId,
      improvementId: id,
      linkKind: "review",
      targetId: sourceReviewId,
      isSource: true,
      actorUserId,
    });
  }
  if (input.linkedPlaybookId) {
    await insertLink({
      organisationId,
      improvementId: id,
      linkKind: "playbook",
      targetId: input.linkedPlaybookId,
      isSource: false,
      actorUserId,
    });
  }

  await recomputeRecurrence(organisationId, id);
  await appendEvent({
    organisationId,
    improvementId: id,
    eventType: "created",
    toStatus: "open",
    actorId: actorUserId,
    payload: {
      sourceKind,
      sourceCaseId,
      sourceReviewId,
      type: input.type,
    },
  });

  const item = await loadItem(organisationId, id);
  if (!item) throw new ImprovementRegisterError("Failed to create improvement", 500);
  return applySensitiveRedaction(organisationId, item, actorUserId);
}

/**
 * Promote a #64 review_improvement_proposal into the durable register.
 * Does not delete or overwrite the proposal; marks it accepted and links
 * immutably via source_proposal_id.
 */
export async function createFromProposalCore(
  organisationId: string,
  actorUserId: string | null,
  proposalId: string,
  overrides: {
    type?: ImprovementRegisterType;
    title?: string;
    description?: string | null;
    severity?: ImprovementRegisterSeverity;
    ownerId?: string | null;
    dueAt?: Date | string | null;
  } = {},
): Promise<ImprovementView> {
  const [proposal] = await db
    .select()
    .from(reviewImprovementProposals)
    .where(
      and(
        eq(reviewImprovementProposals.id, proposalId),
        eq(reviewImprovementProposals.organisationId, organisationId),
      ),
    )
    .limit(1);
  if (!proposal) {
    throw new ImprovementRegisterError("Improvement proposal not found", 404);
  }

  // Idempotent: if already promoted, return the existing register item.
  const [existing] = await db
    .select()
    .from(improvementRegisterItems)
    .where(
      and(
        eq(improvementRegisterItems.organisationId, organisationId),
        eq(improvementRegisterItems.sourceProposalId, proposalId),
      ),
    )
    .limit(1);
  if (existing) {
    return applySensitiveRedaction(organisationId, existing, actorUserId);
  }

  await requireCaseAccess(
    organisationId,
    proposal.caseId,
    actorUserId,
    "edit",
  );

  const mappedType =
    overrides.type ??
    PROPOSAL_KIND_TO_REGISTER_TYPE[proposal.kind] ??
    "documentation_gap";

  const title = (overrides.title ?? proposal.title).trim();
  if (!title) throw new ImprovementRegisterError("Title is required");

  const ownerId = overrides.ownerId !== undefined ? overrides.ownerId : proposal.ownerId;
  await assertOwnerInOrg(organisationId, ownerId);
  if (proposal.linkedPlaybookId) {
    await assertPlaybookInOrg(organisationId, proposal.linkedPlaybookId);
  }

  const id = newId("imp");
  const dueAt = parseDueAt(overrides.dueAt);

  await db.insert(improvementRegisterItems).values({
    id,
    organisationId,
    type: mappedType,
    title: title.slice(0, 500),
    description:
      overrides.description !== undefined
        ? overrides.description?.trim() || null
        : proposal.description,
    evidence: {
      fromProposal: true,
      proposalKind: proposal.kind,
      proposalId: proposal.id,
    },
    sensitiveEvidence: null,
    severity: overrides.severity ?? "medium",
    residualRisk: null,
    status: "open",
    ownerId: ownerId ?? null,
    dueAt,
    recurrenceCount: 0,
    linkedPlaybookId: proposal.linkedPlaybookId,
    externalTicketRef: proposal.externalTicketRef,
    externalTicketUrl: proposal.externalTicketUrl,
    externalTicketSyncState: proposal.externalTicketRef ? "linked" : "none",
    sourceKind: "review_proposal",
    sourceCaseId: proposal.caseId,
    sourceReviewId: proposal.reviewId,
    sourceProposalId: proposal.id,
    createdBy: actorUserId,
  });

  await insertLink({
    organisationId,
    improvementId: id,
    linkKind: "case",
    targetId: proposal.caseId,
    isSource: true,
    actorUserId,
  });
  await insertLink({
    organisationId,
    improvementId: id,
    linkKind: "review",
    targetId: proposal.reviewId,
    isSource: true,
    actorUserId,
  });
  await insertLink({
    organisationId,
    improvementId: id,
    linkKind: "review_proposal",
    targetId: proposal.id,
    isSource: true,
    actorUserId,
  });
  if (proposal.linkedPlaybookId) {
    await insertLink({
      organisationId,
      improvementId: id,
      linkKind: "playbook",
      targetId: proposal.linkedPlaybookId,
      isSource: false,
      actorUserId,
    });
  }

  // Accept the proposal without rewriting its audit fields beyond status.
  if (proposal.status === "proposed" || proposal.status === "deferred") {
    await db
      .update(reviewImprovementProposals)
      .set({ status: "accepted", updatedAt: new Date() })
      .where(
        and(
          eq(reviewImprovementProposals.id, proposal.id),
          eq(reviewImprovementProposals.organisationId, organisationId),
        ),
      );
  }

  await recomputeRecurrence(organisationId, id);
  await appendEvent({
    organisationId,
    improvementId: id,
    eventType: "created",
    toStatus: "open",
    actorId: actorUserId,
    payload: {
      sourceKind: "review_proposal",
      sourceProposalId: proposal.id,
      sourceCaseId: proposal.caseId,
      sourceReviewId: proposal.reviewId,
      type: mappedType,
    },
  });

  const item = await loadItem(organisationId, id);
  if (!item) throw new ImprovementRegisterError("Failed to create improvement", 500);
  return applySensitiveRedaction(organisationId, item, actorUserId);
}

export async function getImprovementCore(
  organisationId: string,
  improvementId: string,
  actorUserId: string | null,
): Promise<ImprovementView | null> {
  const item = await loadItem(organisationId, improvementId);
  if (!item) return null;
  // If source case is restricted and actor cannot know it exists, still allow
  // reading the register record but redact sensitive fields (done below).
  if (item.sourceCaseId) {
    try {
      await requireCaseAccess(
        organisationId,
        item.sourceCaseId,
        actorUserId,
        "know_exists",
      );
    } catch {
      // Register items are org-scoped; do not 404 solely on source case.
    }
  }
  return applySensitiveRedaction(organisationId, item, actorUserId);
}

export async function listImprovementsCore(
  organisationId: string,
  actorUserId: string | null,
  filters: {
    status?: ImprovementRegisterStatus | ImprovementRegisterStatus[];
    type?: ImprovementRegisterType | ImprovementRegisterType[];
    ownerId?: string | null;
    caseId?: string | null;
    overdueOnly?: boolean;
    limit?: number;
  } = {},
): Promise<ImprovementView[]> {
  // Touch actor resolution for fail-closed org membership when a user is set.
  await resolveActor(organisationId, actorUserId);

  const conditions = [eq(improvementRegisterItems.organisationId, organisationId)];

  if (filters.status) {
    const statuses = Array.isArray(filters.status)
      ? filters.status
      : [filters.status];
    if (statuses.length === 1) {
      conditions.push(eq(improvementRegisterItems.status, statuses[0]!));
    } else if (statuses.length > 1) {
      conditions.push(inArray(improvementRegisterItems.status, statuses));
    }
  }
  if (filters.type) {
    const types = Array.isArray(filters.type) ? filters.type : [filters.type];
    if (types.length === 1) {
      conditions.push(eq(improvementRegisterItems.type, types[0]!));
    } else if (types.length > 1) {
      conditions.push(inArray(improvementRegisterItems.type, types));
    }
  }
  if (filters.ownerId) {
    conditions.push(eq(improvementRegisterItems.ownerId, filters.ownerId));
  }
  if (filters.overdueOnly) {
    conditions.push(isNotNull(improvementRegisterItems.dueAt));
    conditions.push(lt(improvementRegisterItems.dueAt, new Date()));
    conditions.push(
      inArray(improvementRegisterItems.status, [...OPEN_WORK_STATUSES]),
    );
  }

  let query = db
    .select()
    .from(improvementRegisterItems)
    .where(and(...conditions))
    .orderBy(desc(improvementRegisterItems.updatedAt))
    .limit(Math.min(filters.limit ?? 100, 500));

  let rows = await query;

  if (filters.caseId) {
    await assertCaseInOrg(organisationId, filters.caseId);
    await requireCaseAccess(
      organisationId,
      filters.caseId,
      actorUserId,
      "know_exists",
    );
    const linked = await db
      .select({ improvementId: improvementRegisterLinks.improvementId })
      .from(improvementRegisterLinks)
      .where(
        and(
          eq(improvementRegisterLinks.organisationId, organisationId),
          eq(improvementRegisterLinks.linkKind, "case"),
          eq(improvementRegisterLinks.targetId, filters.caseId),
        ),
      );
    const ids = new Set(linked.map((l) => l.improvementId));
    rows = rows.filter((r) => ids.has(r.id) || r.sourceCaseId === filters.caseId);
  }

  const out: ImprovementView[] = [];
  for (const row of rows) {
    out.push(await applySensitiveRedaction(organisationId, row, actorUserId));
  }
  return out;
}

export async function updateImprovementCore(
  organisationId: string,
  improvementId: string,
  actorUserId: string | null,
  input: {
    title?: string;
    description?: string | null;
    evidence?: Record<string, unknown> | null;
    sensitiveEvidence?: Record<string, unknown> | null;
    severity?: ImprovementRegisterSeverity;
    residualRisk?: string | null;
    status?: ImprovementRegisterStatus;
    ownerId?: string | null;
    dueAt?: Date | string | null;
    linkedPlaybookId?: string | null;
  },
): Promise<ImprovementView> {
  const existing = await loadItem(organisationId, improvementId);
  if (!existing) {
    throw new ImprovementRegisterError("Improvement not found", 404);
  }

  if (existing.sourceCaseId) {
    await requireCaseAccess(
      organisationId,
      existing.sourceCaseId,
      actorUserId,
      "edit",
    );
  } else {
    await resolveActor(organisationId, actorUserId);
  }

  // Status transitions to closed must use closeImprovementCore (validation).
  if (input.status === "closed") {
    throw new ImprovementRegisterError(
      "Use the close endpoint with validation method and evidence",
      400,
    );
  }
  if (input.status === "reopened") {
    throw new ImprovementRegisterError(
      "Use the reopen endpoint to reopen a closed improvement",
      400,
    );
  }

  const patch: Partial<typeof improvementRegisterItems.$inferInsert> = {
    updatedAt: new Date(),
  };
  const events: Array<{
    eventType: ImprovementRegisterEvent["eventType"];
    fromStatus?: ImprovementRegisterStatus | null;
    toStatus?: ImprovementRegisterStatus | null;
    payload?: Record<string, unknown>;
  }> = [];

  if (input.title !== undefined) {
    const title = input.title.trim();
    if (!title) throw new ImprovementRegisterError("Title is required");
    patch.title = title.slice(0, 500);
  }
  if (input.description !== undefined) {
    patch.description = input.description?.trim() || null;
  }
  if (input.evidence !== undefined) {
    patch.evidence = input.evidence ?? {};
  }
  if (input.sensitiveEvidence !== undefined) {
    patch.sensitiveEvidence = input.sensitiveEvidence;
  }
  if (input.severity !== undefined) patch.severity = input.severity;
  if (input.residualRisk !== undefined) {
    patch.residualRisk = input.residualRisk?.trim() || null;
  }
  if (input.dueAt !== undefined) {
    patch.dueAt = parseDueAt(input.dueAt);
  }
  if (input.ownerId !== undefined) {
    await assertOwnerInOrg(organisationId, input.ownerId);
    patch.ownerId = input.ownerId;
    events.push({
      eventType: "assigned",
      payload: { ownerId: input.ownerId },
    });
  }
  if (input.linkedPlaybookId !== undefined) {
    await assertPlaybookInOrg(organisationId, input.linkedPlaybookId);
    patch.linkedPlaybookId = input.linkedPlaybookId;
    if (input.linkedPlaybookId) {
      await insertLink({
        organisationId,
        improvementId,
        linkKind: "playbook",
        targetId: input.linkedPlaybookId,
        isSource: false,
        actorUserId,
      });
    }
  }
  if (input.status !== undefined && input.status !== existing.status) {
    patch.status = input.status;
    events.push({
      eventType: "status_changed",
      fromStatus: existing.status as ImprovementRegisterStatus,
      toStatus: input.status,
    });
  } else {
    events.push({ eventType: "updated", payload: { fields: Object.keys(input) } });
  }

  await db
    .update(improvementRegisterItems)
    .set(patch)
    .where(
      and(
        eq(improvementRegisterItems.id, improvementId),
        eq(improvementRegisterItems.organisationId, organisationId),
      ),
    );

  for (const e of events) {
    await appendEvent({
      organisationId,
      improvementId,
      eventType: e.eventType,
      fromStatus: e.fromStatus,
      toStatus: e.toStatus,
      actorId: actorUserId,
      payload: e.payload,
    });
  }

  const item = await loadItem(organisationId, improvementId);
  if (!item) throw new ImprovementRegisterError("Improvement not found", 404);
  return applySensitiveRedaction(organisationId, item, actorUserId);
}

export async function linkImprovementCore(
  organisationId: string,
  improvementId: string,
  actorUserId: string | null,
  input: { linkKind: ImprovementLinkKind; targetId: string },
): Promise<ImprovementView> {
  const existing = await loadItem(organisationId, improvementId);
  if (!existing) {
    throw new ImprovementRegisterError("Improvement not found", 404);
  }

  const targetId = input.targetId.trim();
  if (!targetId) throw new ImprovementRegisterError("targetId is required");

  if (input.linkKind === "case") {
    await assertCaseInOrg(organisationId, targetId);
    await requireCaseAccess(organisationId, targetId, actorUserId, "edit");
  } else if (input.linkKind === "review") {
    const review = await assertReviewInOrg(organisationId, targetId);
    await requireCaseAccess(
      organisationId,
      review.caseId,
      actorUserId,
      "edit",
    );
  } else if (input.linkKind === "playbook") {
    await assertPlaybookInOrg(organisationId, targetId);
    await resolveActor(organisationId, actorUserId);
  } else if (input.linkKind === "review_proposal") {
    const [proposal] = await db
      .select({ id: reviewImprovementProposals.id, caseId: reviewImprovementProposals.caseId })
      .from(reviewImprovementProposals)
      .where(
        and(
          eq(reviewImprovementProposals.id, targetId),
          eq(reviewImprovementProposals.organisationId, organisationId),
        ),
      )
      .limit(1);
    if (!proposal) {
      throw new ImprovementRegisterError("Improvement proposal not found", 404);
    }
    await requireCaseAccess(
      organisationId,
      proposal.caseId,
      actorUserId,
      "edit",
    );
  }

  await insertLink({
    organisationId,
    improvementId,
    linkKind: input.linkKind,
    targetId,
    isSource: false,
    actorUserId,
  });

  // When linking a review, also link its case for recurrence accuracy.
  if (input.linkKind === "review") {
    const review = await assertReviewInOrg(organisationId, targetId);
    await insertLink({
      organisationId,
      improvementId,
      linkKind: "case",
      targetId: review.caseId,
      isSource: false,
      actorUserId,
    });
  }

  const recurrence = await recomputeRecurrence(organisationId, improvementId);
  await appendEvent({
    organisationId,
    improvementId,
    eventType: "linked",
    actorId: actorUserId,
    payload: {
      linkKind: input.linkKind,
      targetId,
      recurrenceCount: recurrence,
    },
  });

  const item = await loadItem(organisationId, improvementId);
  if (!item) throw new ImprovementRegisterError("Improvement not found", 404);
  return applySensitiveRedaction(organisationId, item, actorUserId);
}

export async function unlinkImprovementCore(
  organisationId: string,
  improvementId: string,
  actorUserId: string | null,
  linkId: string,
): Promise<ImprovementView> {
  const existing = await loadItem(organisationId, improvementId);
  if (!existing) {
    throw new ImprovementRegisterError("Improvement not found", 404);
  }
  if (existing.sourceCaseId) {
    await requireCaseAccess(
      organisationId,
      existing.sourceCaseId,
      actorUserId,
      "edit",
    );
  } else {
    await resolveActor(organisationId, actorUserId);
  }

  const [link] = await db
    .select()
    .from(improvementRegisterLinks)
    .where(
      and(
        eq(improvementRegisterLinks.id, linkId),
        eq(improvementRegisterLinks.improvementId, improvementId),
        eq(improvementRegisterLinks.organisationId, organisationId),
      ),
    )
    .limit(1);
  if (!link) throw new ImprovementRegisterError("Link not found", 404);
  if (link.isSource) {
    throw new ImprovementRegisterError(
      "Immutable source links cannot be removed",
      400,
    );
  }

  await db
    .delete(improvementRegisterLinks)
    .where(eq(improvementRegisterLinks.id, linkId));

  const recurrence = await recomputeRecurrence(organisationId, improvementId);
  await appendEvent({
    organisationId,
    improvementId,
    eventType: "unlinked",
    actorId: actorUserId,
    payload: {
      linkKind: link.linkKind,
      targetId: link.targetId,
      recurrenceCount: recurrence,
    },
  });

  const item = await loadItem(organisationId, improvementId);
  if (!item) throw new ImprovementRegisterError("Improvement not found", 404);
  return applySensitiveRedaction(organisationId, item, actorUserId);
}

export async function closeImprovementCore(
  organisationId: string,
  improvementId: string,
  actorUserId: string | null,
  input: {
    validationMethod: ImprovementValidationMethod;
    validationEvidence: string;
  },
): Promise<ImprovementView> {
  const existing = await loadItem(organisationId, improvementId);
  if (!existing) {
    throw new ImprovementRegisterError("Improvement not found", 404);
  }
  if (existing.sourceCaseId) {
    await requireCaseAccess(
      organisationId,
      existing.sourceCaseId,
      actorUserId,
      "edit",
    );
  } else {
    await resolveActor(organisationId, actorUserId);
  }

  if (existing.status === "closed") {
    throw new ImprovementRegisterError("Improvement is already closed", 400);
  }
  if (
    !(CLOSABLE_STATUSES as readonly string[]).includes(existing.status) &&
    existing.status !== "deferred" &&
    existing.status !== "rejected"
  ) {
    throw new ImprovementRegisterError(
      `Cannot close improvement in status ${existing.status}`,
      400,
    );
  }

  const evidence = input.validationEvidence?.trim();
  if (!evidence) {
    throw new ImprovementRegisterError(
      "Closing requires validation evidence or reference",
      400,
    );
  }
  if (!input.validationMethod) {
    throw new ImprovementRegisterError(
      "Closing requires a validation method",
      400,
    );
  }

  const now = new Date();
  const fromStatus = existing.status as ImprovementRegisterStatus;

  await db
    .update(improvementRegisterItems)
    .set({
      status: "closed",
      validationMethod: input.validationMethod,
      validationEvidence: evidence.slice(0, 10_000),
      validatedBy: actorUserId,
      validatedAt: now,
      closedBy: actorUserId,
      closedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(improvementRegisterItems.id, improvementId),
        eq(improvementRegisterItems.organisationId, organisationId),
      ),
    );

  await appendEvent({
    organisationId,
    improvementId,
    eventType: "validated",
    fromStatus,
    toStatus: "closed",
    actorId: actorUserId,
    payload: {
      validationMethod: input.validationMethod,
      validationEvidence: evidence.slice(0, 10_000),
      validatedAt: now.toISOString(),
    },
  });
  await appendEvent({
    organisationId,
    improvementId,
    eventType: "closed",
    fromStatus,
    toStatus: "closed",
    actorId: actorUserId,
    payload: {
      closedAt: now.toISOString(),
      validationMethod: input.validationMethod,
    },
  });

  const item = await loadItem(organisationId, improvementId);
  if (!item) throw new ImprovementRegisterError("Improvement not found", 404);
  return applySensitiveRedaction(organisationId, item, actorUserId);
}

/**
 * Reopen a closed improvement. Prior validation/closure history remains in
 * events; current validation fields are cleared for a fresh cycle but the
 * history payload retains the previous proof.
 */
export async function reopenImprovementCore(
  organisationId: string,
  improvementId: string,
  actorUserId: string | null,
  reason?: string | null,
): Promise<ImprovementView> {
  const existing = await loadItem(organisationId, improvementId);
  if (!existing) {
    throw new ImprovementRegisterError("Improvement not found", 404);
  }
  if (existing.sourceCaseId) {
    await requireCaseAccess(
      organisationId,
      existing.sourceCaseId,
      actorUserId,
      "edit",
    );
  } else {
    await resolveActor(organisationId, actorUserId);
  }

  if (existing.status !== "closed") {
    throw new ImprovementRegisterError(
      "Only closed improvements can be reopened",
      400,
    );
  }

  const prior = {
    validationMethod: existing.validationMethod,
    validationEvidence: existing.validationEvidence,
    validatedBy: existing.validatedBy,
    validatedAt: existing.validatedAt?.toISOString() ?? null,
    closedBy: existing.closedBy,
    closedAt: existing.closedAt?.toISOString() ?? null,
  };

  await db
    .update(improvementRegisterItems)
    .set({
      status: "reopened",
      validationMethod: null,
      validationEvidence: null,
      validatedBy: null,
      validatedAt: null,
      closedBy: null,
      closedAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(improvementRegisterItems.id, improvementId),
        eq(improvementRegisterItems.organisationId, organisationId),
      ),
    );

  await appendEvent({
    organisationId,
    improvementId,
    eventType: "reopened",
    fromStatus: "closed",
    toStatus: "reopened",
    actorId: actorUserId,
    payload: {
      reason: reason?.trim() || null,
      priorClosure: prior,
    },
  });

  const item = await loadItem(organisationId, improvementId);
  if (!item) throw new ImprovementRegisterError("Improvement not found", 404);
  return applySensitiveRedaction(organisationId, item, actorUserId);
}

/**
 * Bounded external ticket sync: only updates ticket ref/url/sync state.
 * Never replaces owner, links, status (except conflict flag), or history.
 */
export async function syncExternalTicketCore(
  organisationId: string,
  improvementId: string,
  actorUserId: string | null,
  input: {
    externalTicketRef?: string | null;
    externalTicketUrl?: string | null;
    syncState?: ImprovementTicketSyncState;
    conflict?: boolean;
    error?: string | null;
  },
): Promise<ImprovementView> {
  const existing = await loadItem(organisationId, improvementId);
  if (!existing) {
    throw new ImprovementRegisterError("Improvement not found", 404);
  }
  await resolveActor(organisationId, actorUserId);

  // Reject attempts to smuggle ownership/status through this path.
  const forbiddenKeys = Object.keys(input).filter(
    (k) =>
      ![
        "externalTicketRef",
        "externalTicketUrl",
        "syncState",
        "conflict",
        "error",
      ].includes(k),
  );
  if (forbiddenKeys.length > 0) {
    throw new ImprovementRegisterError(
      "External ticket sync cannot modify ownership, links, or audit fields",
      400,
    );
  }

  const isConflict = input.conflict === true || input.syncState === "conflict";
  const syncState: ImprovementTicketSyncState = isConflict
    ? "conflict"
    : (input.syncState ??
      (input.externalTicketRef !== undefined
        ? input.externalTicketRef
          ? "synced"
          : "none"
        : existing.externalTicketSyncState));

  const patch: Partial<typeof improvementRegisterItems.$inferInsert> = {
    updatedAt: new Date(),
    externalTicketSyncState: syncState,
    externalTicketSyncedAt: new Date(),
    externalTicketSyncError: isConflict
      ? (input.error?.trim() || "External ticket sync conflict")
      : input.error?.trim() || null,
  };
  if (input.externalTicketRef !== undefined) {
    patch.externalTicketRef = input.externalTicketRef?.trim() || null;
  }
  if (input.externalTicketUrl !== undefined) {
    patch.externalTicketUrl = input.externalTicketUrl?.trim() || null;
  }

  // Preserve ownership, status, links — only ticket fields change.
  await db
    .update(improvementRegisterItems)
    .set(patch)
    .where(
      and(
        eq(improvementRegisterItems.id, improvementId),
        eq(improvementRegisterItems.organisationId, organisationId),
      ),
    );

  await appendEvent({
    organisationId,
    improvementId,
    eventType: isConflict ? "ticket_conflict" : "ticket_synced",
    actorId: actorUserId,
    payload: {
      externalTicketRef:
        input.externalTicketRef !== undefined
          ? input.externalTicketRef
          : existing.externalTicketRef,
      syncState,
      // Snapshot of fields that must never be replaced by ticket systems:
      preservedOwnerId: existing.ownerId,
      preservedStatus: existing.status,
      preservedRecurrenceCount: existing.recurrenceCount,
    },
  });

  const item = await loadItem(organisationId, improvementId);
  if (!item) throw new ImprovementRegisterError("Improvement not found", 404);
  return applySensitiveRedaction(organisationId, item, actorUserId);
}

export async function suggestSimilarImprovementsCore(
  organisationId: string,
  actorUserId: string | null,
  query: {
    type?: ImprovementRegisterType;
    title: string;
    description?: string | null;
    limit?: number;
  },
): Promise<SimilarityMatch[]> {
  await resolveActor(organisationId, actorUserId);
  const title = query.title?.trim();
  if (!title) throw new ImprovementRegisterError("Title is required for suggestions");

  const candidates = await db
    .select({
      id: improvementRegisterItems.id,
      type: improvementRegisterItems.type,
      title: improvementRegisterItems.title,
      description: improvementRegisterItems.description,
      status: improvementRegisterItems.status,
      severity: improvementRegisterItems.severity,
      recurrenceCount: improvementRegisterItems.recurrenceCount,
    })
    .from(improvementRegisterItems)
    .where(
      and(
        eq(improvementRegisterItems.organisationId, organisationId),
        ne(improvementRegisterItems.status, "rejected"),
      ),
    )
    .limit(500);

  return rankSimilarImprovements(
    {
      type: query.type,
      title,
      description: query.description,
    },
    candidates.map((c) => ({
      ...c,
      type: c.type as ImprovementRegisterType,
    })),
    { limit: query.limit ?? 5 },
  );
}

export async function listImprovementEventsCore(
  organisationId: string,
  improvementId: string,
  actorUserId: string | null,
): Promise<ImprovementRegisterEvent[]> {
  const item = await loadItem(organisationId, improvementId);
  if (!item) throw new ImprovementRegisterError("Improvement not found", 404);
  await resolveActor(organisationId, actorUserId);
  return db
    .select()
    .from(improvementRegisterEvents)
    .where(
      and(
        eq(improvementRegisterEvents.organisationId, organisationId),
        eq(improvementRegisterEvents.improvementId, improvementId),
      ),
    )
    .orderBy(asc(improvementRegisterEvents.createdAt));
}

export type ImprovementDashboard = {
  byType: Array<{ type: string; count: number }>;
  bySeverity: Array<{ severity: string; count: number }>;
  byStatus: Array<{ status: string; count: number }>;
  byOwner: Array<{ ownerId: string | null; count: number }>;
  overdue: Array<{
    id: string;
    title: string;
    type: string;
    severity: string;
    ownerId: string | null;
    dueAt: string;
    status: string;
  }>;
  highRecurrence: Array<{
    id: string;
    title: string;
    type: string;
    recurrenceCount: number;
    status: string;
  }>;
  validationPending: Array<{
    id: string;
    title: string;
    type: string;
    status: string;
    ownerId: string | null;
  }>;
  totals: {
    openWork: number;
    closed: number;
    overdue: number;
    withValidation: number;
  };
};

export async function improvementDashboardCore(
  organisationId: string,
  actorUserId: string | null,
): Promise<ImprovementDashboard> {
  await resolveActor(organisationId, actorUserId);

  const rows = await db
    .select()
    .from(improvementRegisterItems)
    .where(eq(improvementRegisterItems.organisationId, organisationId));

  const byTypeMap = new Map<string, number>();
  const bySeverityMap = new Map<string, number>();
  const byStatusMap = new Map<string, number>();
  const byOwnerMap = new Map<string | null, number>();
  const overdue: ImprovementDashboard["overdue"] = [];
  const highRecurrence: ImprovementDashboard["highRecurrence"] = [];
  const validationPending: ImprovementDashboard["validationPending"] = [];
  let openWork = 0;
  let closed = 0;
  let withValidation = 0;
  const now = Date.now();

  for (const r of rows) {
    byTypeMap.set(r.type, (byTypeMap.get(r.type) ?? 0) + 1);
    bySeverityMap.set(r.severity, (bySeverityMap.get(r.severity) ?? 0) + 1);
    byStatusMap.set(r.status, (byStatusMap.get(r.status) ?? 0) + 1);
    byOwnerMap.set(r.ownerId, (byOwnerMap.get(r.ownerId) ?? 0) + 1);

    const isOpen = (OPEN_WORK_STATUSES as readonly string[]).includes(r.status);
    if (isOpen) openWork += 1;
    if (r.status === "closed") closed += 1;
    if (r.validationMethod) withValidation += 1;

    if (
      isOpen &&
      r.dueAt &&
      r.dueAt.getTime() < now
    ) {
      overdue.push({
        id: r.id,
        title: r.title,
        type: r.type,
        severity: r.severity,
        ownerId: r.ownerId,
        dueAt: r.dueAt.toISOString(),
        status: r.status,
      });
    }

    if (r.recurrenceCount >= 2) {
      highRecurrence.push({
        id: r.id,
        title: r.title,
        type: r.type,
        recurrenceCount: r.recurrenceCount,
        status: r.status,
      });
    }

    if (r.status === "in_progress" || r.status === "validated") {
      if (!r.validationMethod || r.status === "in_progress") {
        validationPending.push({
          id: r.id,
          title: r.title,
          type: r.type,
          status: r.status,
          ownerId: r.ownerId,
        });
      }
    }
  }

  overdue.sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  highRecurrence.sort((a, b) => b.recurrenceCount - a.recurrenceCount);

  return {
    byType: [...byTypeMap.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count),
    bySeverity: [...bySeverityMap.entries()]
      .map(([severity, count]) => ({ severity, count }))
      .sort((a, b) => b.count - a.count),
    byStatus: [...byStatusMap.entries()]
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count),
    byOwner: [...byOwnerMap.entries()]
      .map(([ownerId, count]) => ({ ownerId, count }))
      .sort((a, b) => b.count - a.count),
    overdue: overdue.slice(0, 50),
    highRecurrence: highRecurrence.slice(0, 50),
    validationPending: validationPending.slice(0, 50),
    totals: {
      openWork,
      closed,
      overdue: overdue.length,
      withValidation,
    },
  };
}

export function serializeImprovement(view: ImprovementView) {
  return {
    id: view.id,
    type: view.type,
    title: view.title,
    description: view.description,
    evidence: view.evidence,
    sensitiveEvidence: view.sensitiveEvidence,
    sensitiveEvidenceRedacted: view.sensitiveEvidenceRedacted ?? false,
    severity: view.severity,
    residualRisk: view.residualRisk,
    status: view.status,
    ownerId: view.ownerId,
    dueAt: view.dueAt?.toISOString() ?? null,
    recurrenceCount: view.recurrenceCount,
    linkedPlaybookId: view.linkedPlaybookId,
    externalTicketRef: view.externalTicketRef,
    externalTicketUrl: view.externalTicketUrl,
    externalTicketSyncState: view.externalTicketSyncState,
    externalTicketSyncedAt: view.externalTicketSyncedAt?.toISOString() ?? null,
    externalTicketSyncError: view.externalTicketSyncError,
    validationMethod: view.validationMethod,
    validationEvidence: view.validationEvidence,
    validatedBy: view.validatedBy,
    validatedAt: view.validatedAt?.toISOString() ?? null,
    closedBy: view.closedBy,
    closedAt: view.closedAt?.toISOString() ?? null,
    sourceKind: view.sourceKind,
    sourceCaseId: view.sourceCaseId,
    sourceReviewId: view.sourceReviewId,
    sourceProposalId: view.sourceProposalId,
    createdBy: view.createdBy,
    createdAt: view.createdAt.toISOString(),
    updatedAt: view.updatedAt.toISOString(),
    links: view.links.map((l) => ({
      id: l.id,
      linkKind: l.linkKind,
      targetId: l.targetId,
      isSource: l.isSource,
      createdAt: l.createdAt.toISOString(),
    })),
  };
}
