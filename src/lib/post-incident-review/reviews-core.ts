/**
 * Case post-incident review lifecycle (issue #64):
 * create → edit revisions → submit → approve (binds revision) →
 * follow-ups / knowledge / improvements.
 *
 * Editing an approved review creates a new unapproved revision.
 * Knowledge summaries exclude sensitive fields by default.
 */

import { and, asc, desc, eq, inArray, lt, ne } from "drizzle-orm";
import { db } from "@/db";
import {
  casePostIncidentReviews,
  cases,
  knowledgeArticles,
  reviewFollowUpActions,
  reviewImprovementProposals,
  reviewRevisions,
  type CasePostIncidentReview,
  type KnowledgeArticle,
  type ReviewFollowUpAction,
  type ReviewImprovementProposal,
  type ReviewRevision,
} from "@/db/schema";
import {
  authorizeCase,
  resolveUserActor,
  type AccessActor,
} from "@/lib/access";
import { newId } from "@/lib/utils";
import {
  buildKnowledgeBody,
  contentFingerprint,
  normaliseReviewContent,
  redactContentForKnowledge,
  ReviewContentError,
} from "./content";
import {
  evaluateReviewRequired,
  getOrgReviewPolicy,
  reviewOpenWhileCaseClosed,
} from "./policy";
import {
  getReviewTemplateCore,
  listReviewTemplatesCore,
  seedBaselineReviewTemplates,
} from "./templates-core";
import type {
  FollowUpStatus,
  ImprovementKind,
  ImprovementStatus,
  KnowledgeStatus,
  ReviewContent,
  ReviewStatus,
} from "./types";

export class ReviewError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "ReviewError";
    this.status = status;
  }
}

export type ReviewView = CasePostIncidentReview & {
  currentRevision: ReviewRevision | null;
  approvedRevision: ReviewRevision | null;
  content: ReviewContent;
  caseStatus?: string | null;
  openWhileCaseClosed?: ReturnType<typeof reviewOpenWhileCaseClosed>;
};

async function loadCaseInOrg(organisationId: string, caseId: string) {
  const [row] = await db
    .select({
      id: cases.id,
      organisationId: cases.organisationId,
      status: cases.status,
      severity: cases.severity,
      classification: cases.classification,
      title: cases.title,
      caseNumber: cases.caseNumber,
      closedAt: cases.closedAt,
    })
    .from(cases)
    .where(and(eq(cases.id, caseId), eq(cases.organisationId, organisationId)))
    .limit(1);
  return row ?? null;
}

async function requireCaseView(
  organisationId: string,
  caseId: string,
  actorUserId: string | null,
  permission: "view_metadata" | "view_sensitive" | "export" = "view_metadata",
): Promise<void> {
  let actor: AccessActor;
  if (actorUserId) {
    const resolved = await resolveUserActor(organisationId, actorUserId);
    if (!resolved) throw new ReviewError("Case not found", 404);
    actor = resolved;
  } else {
    actor = {
      organisationId,
      userId: null,
      role: "system",
      teamIds: [],
    };
  }
  const gate = await authorizeCase(organisationId, caseId, actor, permission);
  if (!gate.ok) throw new ReviewError("Case not found", 404);
}

async function getRevision(
  organisationId: string,
  revisionId: string | null | undefined,
): Promise<ReviewRevision | null> {
  if (!revisionId) return null;
  const [row] = await db
    .select()
    .from(reviewRevisions)
    .where(
      and(
        eq(reviewRevisions.id, revisionId),
        eq(reviewRevisions.organisationId, organisationId),
      ),
    )
    .limit(1);
  return row ?? null;
}

function toView(
  review: CasePostIncidentReview,
  current: ReviewRevision | null,
  approved: ReviewRevision | null,
  caseStatus?: string | null,
): ReviewView {
  const content = normaliseReviewContent(current?.content ?? {});
  return {
    ...review,
    currentRevision: current,
    approvedRevision: approved,
    content,
    caseStatus: caseStatus ?? null,
    openWhileCaseClosed: caseStatus
      ? reviewOpenWhileCaseClosed({
          caseStatus,
          reviewStatus: review.status,
          requiredByPolicy: review.requiredByPolicy,
        })
      : undefined,
  };
}

export async function getReviewCore(
  organisationId: string,
  reviewId: string,
): Promise<ReviewView | null> {
  const [review] = await db
    .select()
    .from(casePostIncidentReviews)
    .where(
      and(
        eq(casePostIncidentReviews.id, reviewId),
        eq(casePostIncidentReviews.organisationId, organisationId),
      ),
    )
    .limit(1);
  if (!review) return null;
  const current = await getRevision(organisationId, review.currentRevisionId);
  const approved = await getRevision(organisationId, review.approvedRevisionId);
  const caseRow = await loadCaseInOrg(organisationId, review.caseId);
  return toView(review, current, approved, caseRow?.status ?? null);
}

export async function listReviewsForCaseCore(
  organisationId: string,
  caseId: string,
): Promise<ReviewView[]> {
  const rows = await db
    .select()
    .from(casePostIncidentReviews)
    .where(
      and(
        eq(casePostIncidentReviews.organisationId, organisationId),
        eq(casePostIncidentReviews.caseId, caseId),
      ),
    )
    .orderBy(desc(casePostIncidentReviews.createdAt));
  const out: ReviewView[] = [];
  for (const review of rows) {
    const current = await getRevision(organisationId, review.currentRevisionId);
    const approved = await getRevision(
      organisationId,
      review.approvedRevisionId,
    );
    const caseRow = await loadCaseInOrg(organisationId, review.caseId);
    out.push(toView(review, current, approved, caseRow?.status ?? null));
  }
  return out;
}

export async function listOrgReviewsCore(
  organisationId: string,
  opts?: {
    status?: ReviewStatus;
    overdueOnly?: boolean;
    limit?: number;
  },
): Promise<ReviewView[]> {
  const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 200);
  const conditions = [eq(casePostIncidentReviews.organisationId, organisationId)];
  if (opts?.status) {
    conditions.push(eq(casePostIncidentReviews.status, opts.status));
  }
  if (opts?.overdueOnly) {
    conditions.push(
      lt(casePostIncidentReviews.dueAt, new Date()),
      ne(casePostIncidentReviews.status, "approved"),
      ne(casePostIncidentReviews.status, "published"),
      ne(casePostIncidentReviews.status, "cancelled"),
    );
  }
  const rows = await db
    .select()
    .from(casePostIncidentReviews)
    .where(and(...conditions))
    .orderBy(asc(casePostIncidentReviews.dueAt), desc(casePostIncidentReviews.createdAt))
    .limit(limit);
  const out: ReviewView[] = [];
  for (const review of rows) {
    const current = await getRevision(organisationId, review.currentRevisionId);
    const approved = await getRevision(
      organisationId,
      review.approvedRevisionId,
    );
    const caseRow = await loadCaseInOrg(organisationId, review.caseId);
    out.push(toView(review, current, approved, caseRow?.status ?? null));
  }
  return out;
}

export type CreateReviewInput = {
  title?: string;
  templateId?: string | null;
  content?: unknown;
};

export async function createReviewCore(
  organisationId: string,
  caseId: string,
  actorUserId: string | null,
  input: CreateReviewInput = {},
): Promise<ReviewView> {
  await requireCaseView(organisationId, caseId, actorUserId, "view_metadata");
  const caseRow = await loadCaseInOrg(organisationId, caseId);
  if (!caseRow) throw new ReviewError("Case not found", 404);

  await seedBaselineReviewTemplates(organisationId, actorUserId);

  let templateId = input.templateId ?? null;
  let templateVersionId: string | null = null;
  let templatePolicy: {
    requiredSeverities: unknown;
    requiredClassifications: unknown;
    name?: string;
  } | null = null;

  if (templateId) {
    const tpl = await getReviewTemplateCore(organisationId, templateId);
    if (!tpl || !tpl.isActive) {
      throw new ReviewError("Review template not found or inactive", 404);
    }
    templateVersionId = tpl.version.id;
    templatePolicy = {
      requiredSeverities: tpl.requiredSeverities,
      requiredClassifications: tpl.requiredClassifications,
      name: tpl.name,
    };
  } else {
    const list = await listReviewTemplatesCore(organisationId);
    const baseline =
      list.find((t) => t.catalogueKey === "default_post_incident") ?? list[0];
    if (baseline) {
      templateId = baseline.id;
      templateVersionId = baseline.version.id;
      templatePolicy = {
        requiredSeverities: baseline.requiredSeverities,
        requiredClassifications: baseline.requiredClassifications,
        name: baseline.name,
      };
    }
  }

  const orgPolicy = await getOrgReviewPolicy(organisationId);
  const policy = evaluateReviewRequired(
    orgPolicy,
    {
      severity: caseRow.severity,
      classification: caseRow.classification,
    },
    templatePolicy,
  );

  let dueAt: Date | null = null;
  if (policy.required) {
    const base = caseRow.closedAt ?? new Date();
    dueAt = new Date(
      base.getTime() + policy.dueDaysAfterClose * 24 * 60 * 60 * 1000,
    );
  }

  const title =
    input.title?.trim() ||
    `Post-incident review: ${caseRow.caseNumber} — ${caseRow.title}`.slice(
      0,
      300,
    );

  let content: ReviewContent;
  try {
    content = normaliseReviewContent(input.content ?? {});
  } catch (err) {
    throw new ReviewError(
      err instanceof ReviewContentError ? err.message : "Invalid content",
    );
  }
  const fingerprint = contentFingerprint(content);
  const reviewId = newId("pir");
  const revisionId = newId("pir_rev");

  await db.insert(casePostIncidentReviews).values({
    id: reviewId,
    organisationId,
    caseId,
    templateId,
    templateVersionId,
    status: "draft",
    requiredByPolicy: policy.required,
    policyReason: policy.reasons.length ? policy.reasons.join(",") : null,
    dueAt,
    currentRevisionId: revisionId,
    approvedRevisionId: null,
    title,
    createdBy: actorUserId,
  });

  await db.insert(reviewRevisions).values({
    id: revisionId,
    reviewId,
    organisationId,
    revision: 1,
    content,
    contentFingerprint: fingerprint,
    isApproved: false,
    createdBy: actorUserId,
  });

  const view = await getReviewCore(organisationId, reviewId);
  if (!view) throw new ReviewError("Failed to create review", 500);
  return view;
}

/**
 * Save content. If the current revision is approved (or review is approved),
 * creates a new unapproved revision and moves the review out of approved.
 * Otherwise updates the current draft revision in place.
 */
export async function saveReviewContentCore(
  organisationId: string,
  reviewId: string,
  actorUserId: string | null,
  rawContent: unknown,
): Promise<ReviewView> {
  const existing = await getReviewCore(organisationId, reviewId);
  if (!existing) throw new ReviewError("Review not found", 404);
  if (existing.status === "cancelled") {
    throw new ReviewError("Cannot edit a cancelled review");
  }

  await requireCaseView(
    organisationId,
    existing.caseId,
    actorUserId,
    "view_metadata",
  );

  let content: ReviewContent;
  try {
    content = normaliseReviewContent(rawContent);
  } catch (err) {
    throw new ReviewError(
      err instanceof ReviewContentError ? err.message : "Invalid content",
    );
  }
  const fingerprint = contentFingerprint(content);
  const current = existing.currentRevision;
  const mustFork =
    !current ||
    current.isApproved ||
    existing.status === "approved" ||
    existing.status === "published" ||
    existing.status === "pending_approval";

  if (mustFork) {
    const nextRev = (current?.revision ?? 0) + 1;
    const revisionId = newId("pir_rev");
    await db.insert(reviewRevisions).values({
      id: revisionId,
      reviewId,
      organisationId,
      revision: nextRev,
      content,
      contentFingerprint: fingerprint,
      isApproved: false,
      createdBy: actorUserId,
    });
    await db
      .update(casePostIncidentReviews)
      .set({
        currentRevisionId: revisionId,
        status: "in_progress",
        submittedAt: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(casePostIncidentReviews.id, reviewId),
          eq(casePostIncidentReviews.organisationId, organisationId),
        ),
      );
  } else {
    await db
      .update(reviewRevisions)
      .set({
        content,
        contentFingerprint: fingerprint,
      })
      .where(
        and(
          eq(reviewRevisions.id, current.id),
          eq(reviewRevisions.organisationId, organisationId),
        ),
      );
    await db
      .update(casePostIncidentReviews)
      .set({
        status: existing.status === "draft" ? "in_progress" : existing.status,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(casePostIncidentReviews.id, reviewId),
          eq(casePostIncidentReviews.organisationId, organisationId),
        ),
      );
  }

  const view = await getReviewCore(organisationId, reviewId);
  if (!view) throw new ReviewError("Review not found", 404);
  return view;
}

export async function submitReviewCore(
  organisationId: string,
  reviewId: string,
  actorUserId: string | null,
): Promise<ReviewView> {
  const existing = await getReviewCore(organisationId, reviewId);
  if (!existing) throw new ReviewError("Review not found", 404);
  if (existing.status === "cancelled") {
    throw new ReviewError("Cannot submit a cancelled review");
  }
  if (existing.status === "approved" || existing.status === "published") {
    throw new ReviewError("Review is already approved; edit to create a new revision first");
  }
  await requireCaseView(
    organisationId,
    existing.caseId,
    actorUserId,
    "view_metadata",
  );
  if (!existing.currentRevision) {
    throw new ReviewError("Review has no content revision");
  }
  if (!existing.content.incidentSummary && !existing.content.knowledgeSummary) {
    throw new ReviewError(
      "Incident summary or knowledge summary is required before submit",
    );
  }

  await db
    .update(casePostIncidentReviews)
    .set({
      status: "pending_approval",
      submittedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(casePostIncidentReviews.id, reviewId),
        eq(casePostIncidentReviews.organisationId, organisationId),
      ),
    );

  const view = await getReviewCore(organisationId, reviewId);
  if (!view) throw new ReviewError("Review not found", 404);
  return view;
}

/**
 * Approve binds the exact current revision id + contentFingerprint.
 * Reject leaves the revision unapproved and returns review to in_progress.
 */
export async function decideReviewApprovalCore(
  organisationId: string,
  reviewId: string,
  actorUserId: string | null,
  decision: "approved" | "rejected",
  notes?: string | null,
): Promise<ReviewView> {
  const existing = await getReviewCore(organisationId, reviewId);
  if (!existing) throw new ReviewError("Review not found", 404);
  await requireCaseView(
    organisationId,
    existing.caseId,
    actorUserId,
    "view_metadata",
  );

  const revision = existing.currentRevision;
  if (!revision) throw new ReviewError("Review has no revision to approve");

  // Re-verify fingerprint still matches stored content (tamper check).
  const liveFp = contentFingerprint(
    normaliseReviewContent(revision.content),
  );
  if (liveFp !== revision.contentFingerprint) {
    throw new ReviewError(
      "Revision content fingerprint mismatch; reload and resubmit",
      409,
    );
  }

  if (decision === "rejected") {
    await db
      .update(reviewRevisions)
      .set({
        isApproved: false,
        approvalDecision: "rejected",
        approvedBy: actorUserId,
        approvedAt: new Date(),
        approvalNotes: notes?.trim() || null,
        boundContentFingerprint: null,
      })
      .where(
        and(
          eq(reviewRevisions.id, revision.id),
          eq(reviewRevisions.organisationId, organisationId),
        ),
      );
    await db
      .update(casePostIncidentReviews)
      .set({
        status: "in_progress",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(casePostIncidentReviews.id, reviewId),
          eq(casePostIncidentReviews.organisationId, organisationId),
        ),
      );
  } else {
    await db
      .update(reviewRevisions)
      .set({
        isApproved: true,
        approvalDecision: "approved",
        approvedBy: actorUserId,
        approvedAt: new Date(),
        approvalNotes: notes?.trim() || null,
        boundContentFingerprint: revision.contentFingerprint,
      })
      .where(
        and(
          eq(reviewRevisions.id, revision.id),
          eq(reviewRevisions.organisationId, organisationId),
        ),
      );
    await db
      .update(casePostIncidentReviews)
      .set({
        status: "approved",
        approvedRevisionId: revision.id,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(casePostIncidentReviews.id, reviewId),
          eq(casePostIncidentReviews.organisationId, organisationId),
        ),
      );
  }

  const view = await getReviewCore(organisationId, reviewId);
  if (!view) throw new ReviewError("Review not found", 404);
  return view;
}

export async function listRevisionsCore(
  organisationId: string,
  reviewId: string,
): Promise<ReviewRevision[]> {
  const review = await getReviewCore(organisationId, reviewId);
  if (!review) throw new ReviewError("Review not found", 404);
  return db
    .select()
    .from(reviewRevisions)
    .where(
      and(
        eq(reviewRevisions.reviewId, reviewId),
        eq(reviewRevisions.organisationId, organisationId),
      ),
    )
    .orderBy(desc(reviewRevisions.revision));
}

/* ── Follow-up actions ─────────────────────────────────────────────────── */

export type CreateFollowUpInput = {
  title: string;
  description?: string | null;
  ownerId?: string | null;
  dueAt?: string | null;
  theme?: string | null;
  externalTicketRef?: string | null;
  externalTicketUrl?: string | null;
};

export async function createFollowUpCore(
  organisationId: string,
  reviewId: string,
  actorUserId: string | null,
  input: CreateFollowUpInput,
): Promise<ReviewFollowUpAction> {
  const review = await getReviewCore(organisationId, reviewId);
  if (!review) throw new ReviewError("Review not found", 404);
  await requireCaseView(
    organisationId,
    review.caseId,
    actorUserId,
    "view_metadata",
  );
  const title = input.title?.trim();
  if (!title) throw new ReviewError("Follow-up title is required");
  if (title.length > 500) throw new ReviewError("Title too long");

  const id = newId("pir_fu");
  await db.insert(reviewFollowUpActions).values({
    id,
    organisationId,
    reviewId,
    caseId: review.caseId,
    title,
    description: input.description?.trim() || null,
    status: "open",
    ownerId: input.ownerId ?? null,
    dueAt: input.dueAt ? new Date(input.dueAt) : null,
    theme: input.theme?.trim() || null,
    externalTicketRef: input.externalTicketRef?.trim() || null,
    externalTicketUrl: input.externalTicketUrl?.trim() || null,
    createdBy: actorUserId,
  });
  const [row] = await db
    .select()
    .from(reviewFollowUpActions)
    .where(
      and(
        eq(reviewFollowUpActions.id, id),
        eq(reviewFollowUpActions.organisationId, organisationId),
      ),
    )
    .limit(1);
  if (!row) throw new ReviewError("Failed to create follow-up", 500);
  return row;
}

export async function listFollowUpsCore(
  organisationId: string,
  reviewId: string,
): Promise<ReviewFollowUpAction[]> {
  return db
    .select()
    .from(reviewFollowUpActions)
    .where(
      and(
        eq(reviewFollowUpActions.organisationId, organisationId),
        eq(reviewFollowUpActions.reviewId, reviewId),
      ),
    )
    .orderBy(asc(reviewFollowUpActions.dueAt), desc(reviewFollowUpActions.createdAt));
}

export type UpdateFollowUpInput = {
  title?: string;
  description?: string | null;
  status?: FollowUpStatus;
  ownerId?: string | null;
  dueAt?: string | null;
  theme?: string | null;
  externalTicketRef?: string | null;
  externalTicketUrl?: string | null;
};

export async function updateFollowUpCore(
  organisationId: string,
  followUpId: string,
  actorUserId: string | null,
  input: UpdateFollowUpInput,
): Promise<ReviewFollowUpAction> {
  const [existing] = await db
    .select()
    .from(reviewFollowUpActions)
    .where(
      and(
        eq(reviewFollowUpActions.id, followUpId),
        eq(reviewFollowUpActions.organisationId, organisationId),
      ),
    )
    .limit(1);
  if (!existing) throw new ReviewError("Follow-up not found", 404);
  await requireCaseView(
    organisationId,
    existing.caseId,
    actorUserId,
    "view_metadata",
  );

  const patch: Partial<typeof reviewFollowUpActions.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (input.title !== undefined) {
    const title = input.title.trim();
    if (!title) throw new ReviewError("Title is required");
    patch.title = title.slice(0, 500);
  }
  if (input.description !== undefined) {
    patch.description = input.description?.trim() || null;
  }
  if (input.ownerId !== undefined) patch.ownerId = input.ownerId;
  if (input.dueAt !== undefined) {
    patch.dueAt = input.dueAt ? new Date(input.dueAt) : null;
  }
  if (input.theme !== undefined) patch.theme = input.theme?.trim() || null;
  if (input.externalTicketRef !== undefined) {
    patch.externalTicketRef = input.externalTicketRef?.trim() || null;
  }
  if (input.externalTicketUrl !== undefined) {
    patch.externalTicketUrl = input.externalTicketUrl?.trim() || null;
  }
  if (input.status !== undefined) {
    patch.status = input.status;
    if (input.status === "done") {
      patch.completedAt = new Date();
      patch.completedBy = actorUserId;
    } else if (existing.status === "done") {
      patch.completedAt = null;
      patch.completedBy = null;
    }
  }

  await db
    .update(reviewFollowUpActions)
    .set(patch)
    .where(
      and(
        eq(reviewFollowUpActions.id, followUpId),
        eq(reviewFollowUpActions.organisationId, organisationId),
      ),
    );
  const [row] = await db
    .select()
    .from(reviewFollowUpActions)
    .where(eq(reviewFollowUpActions.id, followUpId))
    .limit(1);
  if (!row) throw new ReviewError("Follow-up not found", 404);
  return row;
}

/* ── Knowledge articles ────────────────────────────────────────────────── */

export type CreateKnowledgeInput = {
  title?: string;
  /** When true, include sensitive fields — requires view_sensitive. */
  includeSensitive?: boolean;
  status?: KnowledgeStatus;
};

export async function publishKnowledgeFromReviewCore(
  organisationId: string,
  reviewId: string,
  actorUserId: string | null,
  input: CreateKnowledgeInput = {},
): Promise<KnowledgeArticle> {
  const review = await getReviewCore(organisationId, reviewId);
  if (!review) throw new ReviewError("Review not found", 404);

  const includeSensitive = Boolean(input.includeSensitive);
  if (includeSensitive) {
    await requireCaseView(
      organisationId,
      review.caseId,
      actorUserId,
      "view_sensitive",
    );
  } else {
    await requireCaseView(
      organisationId,
      review.caseId,
      actorUserId,
      "view_metadata",
    );
  }

  // Prefer approved revision content for knowledge; fall back to current.
  const sourceRevision = review.approvedRevision ?? review.currentRevision;
  if (!sourceRevision) {
    throw new ReviewError("Review has no content to publish");
  }
  const content = normaliseReviewContent(sourceRevision.content);
  const built = buildKnowledgeBody(content, { includeSensitive });

  const id = newId("know");
  const status: KnowledgeStatus = input.status ?? "published";
  const title =
    input.title?.trim() ||
    `Lessons: ${review.title}`.slice(0, 300);

  await db.insert(knowledgeArticles).values({
    id,
    organisationId,
    sourceReviewId: reviewId,
    sourceCaseId: review.caseId,
    sourceRevisionId: sourceRevision.id,
    title,
    summary: built.summary,
    body: built.body,
    status,
    includesSensitive: built.includesSensitive,
    themes: built.themes,
    createdBy: actorUserId,
    publishedBy: status === "published" ? actorUserId : null,
    publishedAt: status === "published" ? new Date() : null,
  });

  if (status === "published" && review.status === "approved") {
    await db
      .update(casePostIncidentReviews)
      .set({ status: "published", publishedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(casePostIncidentReviews.id, reviewId),
          eq(casePostIncidentReviews.organisationId, organisationId),
        ),
      );
  }

  const [row] = await db
    .select()
    .from(knowledgeArticles)
    .where(
      and(
        eq(knowledgeArticles.id, id),
        eq(knowledgeArticles.organisationId, organisationId),
      ),
    )
    .limit(1);
  if (!row) throw new ReviewError("Failed to create knowledge article", 500);
  return row;
}

/**
 * Serialize a knowledge article for API. If includesSensitive and actor
 * lacks view_sensitive, strip those fields from body (defense in depth).
 */
export async function toPublicKnowledgeArticle(
  organisationId: string,
  article: KnowledgeArticle,
  actorUserId: string | null,
): Promise<Record<string, unknown>> {
  let body = article.body as Record<string, unknown>;
  let includesSensitive = article.includesSensitive;

  if (article.includesSensitive && article.sourceCaseId) {
    let allowed = false;
    try {
      await requireCaseView(
        organisationId,
        article.sourceCaseId,
        actorUserId,
        "view_sensitive",
      );
      allowed = true;
    } catch {
      allowed = false;
    }
    if (!allowed) {
      const redacted = redactContentForKnowledge({
        sensitiveEvidenceNotes:
          typeof body.sensitiveEvidenceNotes === "string"
            ? body.sensitiveEvidenceNotes
            : undefined,
        restrictedNotes:
          typeof body.restrictedNotes === "string"
            ? body.restrictedNotes
            : undefined,
      });
      void redacted;
      const { sensitiveEvidenceNotes: _s, restrictedNotes: _r, ...rest } = body;
      body = rest;
      includesSensitive = false;
    }
  }

  return {
    id: article.id,
    title: article.title,
    summary: article.summary,
    body,
    status: article.status,
    includesSensitive,
    themes: article.themes,
    sourceReviewId: article.sourceReviewId,
    sourceCaseId: article.sourceCaseId,
    sourceRevisionId: article.sourceRevisionId,
    createdAt: article.createdAt.toISOString(),
    publishedAt: article.publishedAt?.toISOString() ?? null,
  };
}

export async function getKnowledgeArticleCore(
  organisationId: string,
  articleId: string,
): Promise<KnowledgeArticle | null> {
  const [row] = await db
    .select()
    .from(knowledgeArticles)
    .where(
      and(
        eq(knowledgeArticles.id, articleId),
        eq(knowledgeArticles.organisationId, organisationId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function listKnowledgeArticlesCore(
  organisationId: string,
  opts?: { status?: KnowledgeStatus; limit?: number },
): Promise<KnowledgeArticle[]> {
  const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 200);
  const conditions = [eq(knowledgeArticles.organisationId, organisationId)];
  if (opts?.status) conditions.push(eq(knowledgeArticles.status, opts.status));
  return db
    .select()
    .from(knowledgeArticles)
    .where(and(...conditions))
    .orderBy(desc(knowledgeArticles.createdAt))
    .limit(limit);
}

/* ── Improvement proposals ─────────────────────────────────────────────── */

export type CreateImprovementInput = {
  kind: ImprovementKind;
  title: string;
  description?: string | null;
  linkedPlaybookId?: string | null;
  ownerId?: string | null;
  externalTicketRef?: string | null;
  externalTicketUrl?: string | null;
};

export async function createImprovementCore(
  organisationId: string,
  reviewId: string,
  actorUserId: string | null,
  input: CreateImprovementInput,
): Promise<ReviewImprovementProposal> {
  const review = await getReviewCore(organisationId, reviewId);
  if (!review) throw new ReviewError("Review not found", 404);
  await requireCaseView(
    organisationId,
    review.caseId,
    actorUserId,
    "view_metadata",
  );
  const title = input.title?.trim();
  if (!title) throw new ReviewError("Title is required");

  const id = newId("pir_imp");
  await db.insert(reviewImprovementProposals).values({
    id,
    organisationId,
    reviewId,
    caseId: review.caseId,
    kind: input.kind,
    title: title.slice(0, 500),
    description: input.description?.trim() || null,
    status: "proposed",
    linkedPlaybookId: input.linkedPlaybookId ?? null,
    ownerId: input.ownerId ?? null,
    externalTicketRef: input.externalTicketRef?.trim() || null,
    externalTicketUrl: input.externalTicketUrl?.trim() || null,
    createdBy: actorUserId,
  });
  const [row] = await db
    .select()
    .from(reviewImprovementProposals)
    .where(eq(reviewImprovementProposals.id, id))
    .limit(1);
  if (!row) throw new ReviewError("Failed to create improvement", 500);
  return row;
}

export async function listImprovementsCore(
  organisationId: string,
  reviewId: string,
): Promise<ReviewImprovementProposal[]> {
  return db
    .select()
    .from(reviewImprovementProposals)
    .where(
      and(
        eq(reviewImprovementProposals.organisationId, organisationId),
        eq(reviewImprovementProposals.reviewId, reviewId),
      ),
    )
    .orderBy(desc(reviewImprovementProposals.createdAt));
}

export async function updateImprovementCore(
  organisationId: string,
  improvementId: string,
  actorUserId: string | null,
  input: {
    title?: string;
    description?: string | null;
    status?: ImprovementStatus;
    ownerId?: string | null;
    externalTicketRef?: string | null;
    externalTicketUrl?: string | null;
  },
): Promise<ReviewImprovementProposal> {
  const [existing] = await db
    .select()
    .from(reviewImprovementProposals)
    .where(
      and(
        eq(reviewImprovementProposals.id, improvementId),
        eq(reviewImprovementProposals.organisationId, organisationId),
      ),
    )
    .limit(1);
  if (!existing) throw new ReviewError("Improvement not found", 404);
  await requireCaseView(
    organisationId,
    existing.caseId,
    actorUserId,
    "view_metadata",
  );

  const patch: Partial<typeof reviewImprovementProposals.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (input.title !== undefined) {
    const title = input.title.trim();
    if (!title) throw new ReviewError("Title is required");
    patch.title = title.slice(0, 500);
  }
  if (input.description !== undefined) {
    patch.description = input.description?.trim() || null;
  }
  if (input.status !== undefined) patch.status = input.status;
  if (input.ownerId !== undefined) patch.ownerId = input.ownerId;
  if (input.externalTicketRef !== undefined) {
    patch.externalTicketRef = input.externalTicketRef?.trim() || null;
  }
  if (input.externalTicketUrl !== undefined) {
    patch.externalTicketUrl = input.externalTicketUrl?.trim() || null;
  }

  await db
    .update(reviewImprovementProposals)
    .set(patch)
    .where(
      and(
        eq(reviewImprovementProposals.id, improvementId),
        eq(reviewImprovementProposals.organisationId, organisationId),
      ),
    );
  const [row] = await db
    .select()
    .from(reviewImprovementProposals)
    .where(eq(reviewImprovementProposals.id, improvementId))
    .limit(1);
  if (!row) throw new ReviewError("Improvement not found", 404);
  return row;
}

/* ── Reporting ─────────────────────────────────────────────────────────── */

export async function reviewReportingSummaryCore(
  organisationId: string,
): Promise<{
  overdueReviews: number;
  openRequiredReviews: number;
  openWhileCaseClosed: number;
  overdueFollowUps: number;
  openFollowUps: number;
  themes: Array<{ theme: string; count: number }>;
  improvementByKind: Array<{ kind: string; count: number }>;
}> {
  const openStatuses = ["draft", "in_progress", "pending_approval"] as const;
  const reviews = await db
    .select({
      id: casePostIncidentReviews.id,
      status: casePostIncidentReviews.status,
      requiredByPolicy: casePostIncidentReviews.requiredByPolicy,
      dueAt: casePostIncidentReviews.dueAt,
      caseId: casePostIncidentReviews.caseId,
    })
    .from(casePostIncidentReviews)
    .where(eq(casePostIncidentReviews.organisationId, organisationId));

  const now = new Date();
  let overdueReviews = 0;
  let openRequiredReviews = 0;
  let openWhileCaseClosed = 0;

  const caseIds = [...new Set(reviews.map((r) => r.caseId))];
  const caseStatusMap = new Map<string, string>();
  if (caseIds.length) {
    const caseRows = await db
      .select({ id: cases.id, status: cases.status })
      .from(cases)
      .where(
        and(eq(cases.organisationId, organisationId), inArray(cases.id, caseIds)),
      );
    for (const c of caseRows) caseStatusMap.set(c.id, c.status);
  }

  for (const r of reviews) {
    const open = (openStatuses as readonly string[]).includes(r.status);
    if (open && r.requiredByPolicy) openRequiredReviews++;
    if (open && r.dueAt && r.dueAt < now) overdueReviews++;
    if (open && r.requiredByPolicy && caseStatusMap.get(r.caseId) === "closed") {
      openWhileCaseClosed++;
    }
  }

  const followUps = await db
    .select({
      status: reviewFollowUpActions.status,
      dueAt: reviewFollowUpActions.dueAt,
      theme: reviewFollowUpActions.theme,
    })
    .from(reviewFollowUpActions)
    .where(eq(reviewFollowUpActions.organisationId, organisationId));

  let overdueFollowUps = 0;
  let openFollowUps = 0;
  const themeCounts = new Map<string, number>();
  for (const f of followUps) {
    const open = f.status === "open" || f.status === "in_progress";
    if (open) openFollowUps++;
    if (open && f.dueAt && f.dueAt < now) overdueFollowUps++;
    if (f.theme) {
      themeCounts.set(f.theme, (themeCounts.get(f.theme) ?? 0) + 1);
    }
  }

  // Themes from approved/published revisions' content.
  const themeFromContent = new Map<string, number>();
  const approvedReviews = reviews.filter(
    (r) => r.status === "approved" || r.status === "published",
  );
  for (const r of approvedReviews) {
    const full = await getReviewCore(organisationId, r.id);
    for (const t of full?.content.themes ?? []) {
      themeFromContent.set(t, (themeFromContent.get(t) ?? 0) + 1);
    }
  }
  for (const [t, c] of themeCounts) {
    themeFromContent.set(t, (themeFromContent.get(t) ?? 0) + c);
  }

  const improvements = await db
    .select({
      kind: reviewImprovementProposals.kind,
    })
    .from(reviewImprovementProposals)
    .where(eq(reviewImprovementProposals.organisationId, organisationId));
  const kindCounts = new Map<string, number>();
  for (const i of improvements) {
    kindCounts.set(i.kind, (kindCounts.get(i.kind) ?? 0) + 1);
  }

  return {
    overdueReviews,
    openRequiredReviews,
    openWhileCaseClosed,
    overdueFollowUps,
    openFollowUps,
    themes: [...themeFromContent.entries()]
      .map(([theme, count]) => ({ theme, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 50),
    improvementByKind: [...kindCounts.entries()]
      .map(([kind, count]) => ({ kind, count }))
      .sort((a, b) => b.count - a.count),
  };
}

export function serializeReview(view: ReviewView): Record<string, unknown> {
  return {
    id: view.id,
    caseId: view.caseId,
    templateId: view.templateId,
    templateVersionId: view.templateVersionId,
    status: view.status,
    requiredByPolicy: view.requiredByPolicy,
    policyReason: view.policyReason,
    dueAt: view.dueAt?.toISOString() ?? null,
    title: view.title,
    content: view.content,
    currentRevision: view.currentRevision
      ? {
          id: view.currentRevision.id,
          revision: view.currentRevision.revision,
          contentFingerprint: view.currentRevision.contentFingerprint,
          isApproved: view.currentRevision.isApproved,
          approvalDecision: view.currentRevision.approvalDecision,
          approvedBy: view.currentRevision.approvedBy,
          approvedAt: view.currentRevision.approvedAt?.toISOString() ?? null,
          boundContentFingerprint: view.currentRevision.boundContentFingerprint,
          createdAt: view.currentRevision.createdAt.toISOString(),
        }
      : null,
    approvedRevision: view.approvedRevision
      ? {
          id: view.approvedRevision.id,
          revision: view.approvedRevision.revision,
          contentFingerprint: view.approvedRevision.contentFingerprint,
          isApproved: view.approvedRevision.isApproved,
          approvedBy: view.approvedRevision.approvedBy,
          approvedAt: view.approvedRevision.approvedAt?.toISOString() ?? null,
          boundContentFingerprint:
            view.approvedRevision.boundContentFingerprint,
        }
      : null,
    caseStatus: view.caseStatus ?? null,
    openWhileCaseClosed: view.openWhileCaseClosed ?? null,
    createdAt: view.createdAt.toISOString(),
    updatedAt: view.updatedAt.toISOString(),
    submittedAt: view.submittedAt?.toISOString() ?? null,
    approvedAt: view.approvedAt?.toISOString() ?? null,
    publishedAt: view.publishedAt?.toISOString() ?? null,
  };
}

