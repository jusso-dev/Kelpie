/**
 * Structured investigation content blocks (issue #58).
 *
 * Ordered, versioned case narrative separate from conversational comments.
 * Revisions are append-only; restore always creates a new head revision.
 * Reorder writes one timeline event for the whole operation.
 * Links to alerts/entities/evidence/tasks/ATT&CK are organisation- and
 * case-authorised on every write.
 */
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  alertEntities,
  alerts,
  attackTechniqueMappings,
  caseAlerts,
  caseContentBlockLinks,
  caseContentBlockRevisions,
  caseContentBlocks,
  caseTasks,
  cases,
  comments,
  entities,
  evidenceItems,
  type CaseContentBlock,
  type CaseContentBlockLink,
  type CaseContentBlockRevision,
} from "@/db/schema";
import { newId } from "@/lib/utils";
import { writeTimelineEvent } from "@/lib/timeline";
import { reorderIds } from "@/lib/attack/story-core";

export const CASE_CONTENT_BLOCK_TYPES = [
  "investigation_note",
  "finding",
  "hypothesis",
  "decision",
  "evidence_summary",
  "containment_record",
  "eradication_record",
  "recovery_validation",
  "stakeholder_update",
  "code_query",
  "table",
  "checklist",
  "external_reference",
  "report_section",
] as const;

export type CaseContentBlockType = (typeof CASE_CONTENT_BLOCK_TYPES)[number];

export const CASE_CONTENT_BLOCK_LINK_TYPES = [
  "alert",
  "entity",
  "evidence_item",
  "task",
  "attack_technique",
  "attack_mapping",
] as const;

export type CaseContentBlockLinkType =
  (typeof CASE_CONTENT_BLOCK_LINK_TYPES)[number];

const TLP_VALUES = ["clear", "green", "amber", "amber_strict", "red"] as const;
const PAP_VALUES = ["clear", "green", "amber", "red"] as const;
export type BlockTlp = (typeof TLP_VALUES)[number];
export type BlockPap = (typeof PAP_VALUES)[number];

const MAX_TITLE = 500;
const MAX_CONTENT = 100_000;
const MAX_GROUP_KEY = 128;
const MAX_CHANGE_SUMMARY = 500;

export class ContentBlockError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "ContentBlockError";
    this.status = status;
  }
}

/**
 * Strip active HTML and dangerous URL schemes from Markdown body before
 * storage. Markdown structure (emphasis, lists, fenced code, links with
 * safe schemes) is preserved. Rendering still goes through `renderSafeMarkdown`.
 */
export function sanitizeContentMarkdown(input: string): string {
  let text = input.replace(/\r\n/g, "\n");
  // Drop raw HTML tags (including script/style/iframe) but keep angle brackets
  // that are not tags (e.g. comparison operators in prose/code after fence).
  text = text.replace(/<\/?[a-zA-Z][^>]*>/g, "");
  // Neutralise javascript:/data:/vbscript: in markdown links and images.
  text = text.replace(
    /(!?\[[^\]]*\]\()(\s*)(javascript|data|vbscript)\s*:/gi,
    "$1$2blocked:",
  );
  text = text.replace(
    /(!?\[[^\]]*\]\()(\s*)(<)\s*(javascript|data|vbscript)\s*:/gi,
    "$1$2$3blocked:",
  );
  // Autolink-style bare schemes.
  text = text.replace(
    /\b(javascript|data|vbscript)\s*:/gi,
    "blocked:",
  );
  return text;
}

export function isCaseContentBlockType(value: string): value is CaseContentBlockType {
  return (CASE_CONTENT_BLOCK_TYPES as readonly string[]).includes(value);
}

export function isCaseContentBlockLinkType(
  value: string,
): value is CaseContentBlockLinkType {
  return (CASE_CONTENT_BLOCK_LINK_TYPES as readonly string[]).includes(value);
}

export type ContentBlockView = CaseContentBlock & {
  links: CaseContentBlockLink[];
};

export type CreateContentBlockInput = {
  type: CaseContentBlockType;
  title: string;
  content?: string;
  contentStructured?: unknown;
  groupKey?: string | null;
  collapsed?: boolean;
  tlp?: BlockTlp;
  pap?: BlockPap;
  sensitive?: boolean;
  includeInReport?: boolean;
};

export type UpdateContentBlockInput = {
  type?: CaseContentBlockType;
  title?: string;
  content?: string;
  contentStructured?: unknown | null;
  groupKey?: string | null;
  collapsed?: boolean;
  tlp?: BlockTlp;
  pap?: BlockPap;
  sensitive?: boolean;
  includeInReport?: boolean;
  changeSummary?: string | null;
};

async function loadCaseInOrg(caseId: string, organisationId: string) {
  const [row] = await db
    .select({ id: cases.id })
    .from(cases)
    .where(and(eq(cases.id, caseId), eq(cases.organisationId, organisationId)))
    .limit(1);
  return row ?? null;
}

function normaliseTitle(title: string): string {
  const t = title.trim();
  if (!t) throw new ContentBlockError("A title is required");
  if (t.length > MAX_TITLE) {
    throw new ContentBlockError(`Title must be at most ${MAX_TITLE} characters`);
  }
  return t;
}

function normaliseContent(content: string | undefined): string {
  const raw = content ?? "";
  if (raw.length > MAX_CONTENT) {
    throw new ContentBlockError(`Content must be at most ${MAX_CONTENT} characters`);
  }
  return sanitizeContentMarkdown(raw);
}

function normaliseTlp(value: string | undefined, fallback: BlockTlp): BlockTlp {
  if (value === undefined) return fallback;
  if (!(TLP_VALUES as readonly string[]).includes(value)) {
    throw new ContentBlockError("Invalid TLP value");
  }
  return value as BlockTlp;
}

function normalisePap(value: string | undefined, fallback: BlockPap): BlockPap {
  if (value === undefined) return fallback;
  if (!(PAP_VALUES as readonly string[]).includes(value)) {
    throw new ContentBlockError("Invalid PAP value");
  }
  return value as BlockPap;
}

function defaultIncludeInReport(sensitive: boolean, explicit?: boolean): boolean {
  if (explicit !== undefined) return explicit;
  // Conservative export default for sensitive blocks until field-level policies land.
  return !sensitive;
}

async function withLinks(blocks: CaseContentBlock[]): Promise<ContentBlockView[]> {
  const map = new Map<string, CaseContentBlockLink[]>();
  if (blocks.length > 0) {
    const rows = await db
      .select()
      .from(caseContentBlockLinks)
      .where(
        inArray(
          caseContentBlockLinks.blockId,
          blocks.map((b) => b.id),
        ),
      )
      .orderBy(asc(caseContentBlockLinks.createdAt));
    for (const row of rows) {
      const list = map.get(row.blockId) ?? [];
      list.push(row);
      map.set(row.blockId, list);
    }
  }
  return blocks.map((b) => ({ ...b, links: map.get(b.id) ?? [] }));
}

async function appendRevision(opts: {
  block: CaseContentBlock;
  editorId: string | null;
  changeSummary?: string | null;
  restoredFromRevision?: number | null;
}): Promise<CaseContentBlockRevision> {
  const revId = newId("cbrev");
  const [row] = await db
    .insert(caseContentBlockRevisions)
    .values({
      id: revId,
      blockId: opts.block.id,
      organisationId: opts.block.organisationId,
      caseId: opts.block.caseId,
      revisionNumber: opts.block.revisionNumber,
      type: opts.block.type,
      title: opts.block.title,
      content: opts.block.content,
      contentStructured: opts.block.contentStructured,
      tlp: opts.block.tlp,
      pap: opts.block.pap,
      sensitive: opts.block.sensitive,
      includeInReport: opts.block.includeInReport,
      editorId: opts.editorId,
      changeSummary: opts.changeSummary?.trim() || null,
      restoredFromRevision: opts.restoredFromRevision ?? null,
    })
    .returning();
  if (!row) throw new ContentBlockError("Revision could not be recorded", 500);
  return row;
}

export async function listContentBlocksCore(
  organisationId: string,
  caseId: string,
  opts?: { includeArchived?: boolean },
): Promise<ContentBlockView[]> {
  const caseRow = await loadCaseInOrg(caseId, organisationId);
  if (!caseRow) throw new ContentBlockError("Case not found", 404);

  const conditions = [
    eq(caseContentBlocks.organisationId, organisationId),
    eq(caseContentBlocks.caseId, caseId),
  ];
  if (!opts?.includeArchived) {
    conditions.push(isNull(caseContentBlocks.archivedAt));
  }

  const rows = await db
    .select()
    .from(caseContentBlocks)
    .where(and(...conditions))
    .orderBy(asc(caseContentBlocks.sequenceIndex));
  return withLinks(rows);
}

export async function getContentBlockCore(
  organisationId: string,
  caseId: string,
  blockId: string,
): Promise<ContentBlockView> {
  const [row] = await db
    .select()
    .from(caseContentBlocks)
    .where(
      and(
        eq(caseContentBlocks.id, blockId),
        eq(caseContentBlocks.organisationId, organisationId),
        eq(caseContentBlocks.caseId, caseId),
      ),
    )
    .limit(1);
  if (!row) throw new ContentBlockError("Content block not found", 404);
  const [view] = await withLinks([row]);
  return view;
}

export async function createContentBlockCore(
  organisationId: string,
  actorId: string | null,
  caseId: string,
  input: CreateContentBlockInput,
): Promise<ContentBlockView> {
  if (!isCaseContentBlockType(input.type)) {
    throw new ContentBlockError("Unknown content block type");
  }
  const caseRow = await loadCaseInOrg(caseId, organisationId);
  if (!caseRow) throw new ContentBlockError("Case not found", 404);

  const title = normaliseTitle(input.title);
  const content = normaliseContent(input.content);
  const sensitive = Boolean(input.sensitive);
  const includeInReport = defaultIncludeInReport(sensitive, input.includeInReport);
  const tlp = normaliseTlp(input.tlp, "amber");
  const pap = normalisePap(input.pap, "amber");
  const groupKey =
    input.groupKey === undefined || input.groupKey === null
      ? null
      : input.groupKey.trim().slice(0, MAX_GROUP_KEY) || null;

  const id = newId("cblock");
  const inserted = await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT id FROM ${caseContentBlocks} WHERE ${caseContentBlocks.caseId} = ${caseId} FOR UPDATE`,
    );
    const existing = await tx
      .select({ sequenceIndex: caseContentBlocks.sequenceIndex })
      .from(caseContentBlocks)
      .where(eq(caseContentBlocks.caseId, caseId))
      .orderBy(asc(caseContentBlocks.sequenceIndex));
    const nextSequenceIndex =
      existing.length > 0 ? existing[existing.length - 1].sequenceIndex + 1 : 0;

    const [row] = await tx
      .insert(caseContentBlocks)
      .values({
        id,
        organisationId,
        caseId,
        type: input.type,
        title,
        content,
        contentStructured: input.contentStructured ?? null,
        sequenceIndex: nextSequenceIndex,
        groupKey,
        collapsed: Boolean(input.collapsed),
        tlp,
        pap,
        sensitive,
        includeInReport,
        authorId: actorId,
        lastEditorId: actorId,
        revisionNumber: 1,
      })
      .returning();
    if (!row) throw new ContentBlockError("Content block could not be created", 500);

    await tx.insert(caseContentBlockRevisions).values({
      id: newId("cbrev"),
      blockId: id,
      organisationId,
      caseId,
      revisionNumber: 1,
      type: row.type,
      title: row.title,
      content: row.content,
      contentStructured: row.contentStructured,
      tlp: row.tlp,
      pap: row.pap,
      sensitive: row.sensitive,
      includeInReport: row.includeInReport,
      editorId: actorId,
      changeSummary: "created",
    });
    return row;
  });

  await writeTimelineEvent({
    caseId,
    actorId,
    eventType: "content_block_changed",
    payload: {
      action: "created",
      block_id: id,
      type: inserted.type,
      title: inserted.title,
      revision: 1,
    },
  });

  const [view] = await withLinks([inserted]);
  return view;
}

export async function updateContentBlockCore(
  organisationId: string,
  actorId: string | null,
  caseId: string,
  blockId: string,
  patch: UpdateContentBlockInput,
): Promise<ContentBlockView> {
  const [existing] = await db
    .select()
    .from(caseContentBlocks)
    .where(
      and(
        eq(caseContentBlocks.id, blockId),
        eq(caseContentBlocks.organisationId, organisationId),
        eq(caseContentBlocks.caseId, caseId),
      ),
    )
    .limit(1);
  if (!existing) throw new ContentBlockError("Content block not found", 404);
  if (existing.archivedAt) {
    throw new ContentBlockError("Archived blocks cannot be edited; restore archive first", 409);
  }

  if (patch.type !== undefined && !isCaseContentBlockType(patch.type)) {
    throw new ContentBlockError("Unknown content block type");
  }

  const title =
    patch.title !== undefined ? normaliseTitle(patch.title) : existing.title;
  const content =
    patch.content !== undefined
      ? normaliseContent(patch.content)
      : existing.content;
  const sensitive =
    patch.sensitive !== undefined ? Boolean(patch.sensitive) : existing.sensitive;
  const includeInReport =
    patch.includeInReport !== undefined
      ? Boolean(patch.includeInReport)
      : existing.includeInReport;
  const tlp = normaliseTlp(patch.tlp, existing.tlp as BlockTlp);
  const pap = normalisePap(patch.pap, existing.pap as BlockPap);
  const groupKey =
    patch.groupKey === undefined
      ? existing.groupKey
      : patch.groupKey === null
        ? null
        : patch.groupKey.trim().slice(0, MAX_GROUP_KEY) || null;
  const contentStructured =
    patch.contentStructured === undefined
      ? existing.contentStructured
      : patch.contentStructured;
  const collapsed =
    patch.collapsed !== undefined ? Boolean(patch.collapsed) : existing.collapsed;
  const type = patch.type ?? existing.type;
  const nextRevision = existing.revisionNumber + 1;
  const changeSummary =
    patch.changeSummary === undefined
      ? null
      : patch.changeSummary?.trim().slice(0, MAX_CHANGE_SUMMARY) || null;

  const [updated] = await db
    .update(caseContentBlocks)
    .set({
      type,
      title,
      content,
      contentStructured,
      groupKey,
      collapsed,
      tlp,
      pap,
      sensitive,
      includeInReport,
      lastEditorId: actorId,
      revisionNumber: nextRevision,
      updatedAt: new Date(),
    })
    .where(eq(caseContentBlocks.id, blockId))
    .returning();
  if (!updated) throw new ContentBlockError("Content block not found", 404);

  await appendRevision({
    block: updated,
    editorId: actorId,
    changeSummary: changeSummary ?? "updated",
  });

  await writeTimelineEvent({
    caseId,
    actorId,
    eventType: "content_block_changed",
    payload: {
      action: "updated",
      block_id: blockId,
      type: updated.type,
      title: updated.title,
      revision: nextRevision,
    },
  });

  const [view] = await withLinks([updated]);
  return view;
}

export async function archiveContentBlockCore(
  organisationId: string,
  actorId: string | null,
  caseId: string,
  blockId: string,
): Promise<ContentBlockView> {
  const [existing] = await db
    .select()
    .from(caseContentBlocks)
    .where(
      and(
        eq(caseContentBlocks.id, blockId),
        eq(caseContentBlocks.organisationId, organisationId),
        eq(caseContentBlocks.caseId, caseId),
      ),
    )
    .limit(1);
  if (!existing) throw new ContentBlockError("Content block not found", 404);
  if (existing.archivedAt) {
    const [view] = await withLinks([existing]);
    return view;
  }

  const [updated] = await db
    .update(caseContentBlocks)
    .set({
      archivedAt: new Date(),
      archivedById: actorId,
      lastEditorId: actorId,
      updatedAt: new Date(),
    })
    .where(eq(caseContentBlocks.id, blockId))
    .returning();
  if (!updated) throw new ContentBlockError("Content block not found", 404);

  await writeTimelineEvent({
    caseId,
    actorId,
    eventType: "content_block_changed",
    payload: {
      action: "archived",
      block_id: blockId,
      type: updated.type,
      title: updated.title,
    },
  });

  const [view] = await withLinks([updated]);
  return view;
}

/**
 * Restores an earlier revision as a new head. Prior revision rows stay intact
 * (including those written after the restored one).
 */
export async function restoreContentBlockRevisionCore(
  organisationId: string,
  actorId: string | null,
  caseId: string,
  blockId: string,
  revisionNumber: number,
): Promise<ContentBlockView> {
  if (!Number.isInteger(revisionNumber) || revisionNumber < 1) {
    throw new ContentBlockError("revisionNumber must be a positive integer");
  }

  const [existing] = await db
    .select()
    .from(caseContentBlocks)
    .where(
      and(
        eq(caseContentBlocks.id, blockId),
        eq(caseContentBlocks.organisationId, organisationId),
        eq(caseContentBlocks.caseId, caseId),
      ),
    )
    .limit(1);
  if (!existing) throw new ContentBlockError("Content block not found", 404);

  const [source] = await db
    .select()
    .from(caseContentBlockRevisions)
    .where(
      and(
        eq(caseContentBlockRevisions.blockId, blockId),
        eq(caseContentBlockRevisions.revisionNumber, revisionNumber),
      ),
    )
    .limit(1);
  if (!source) throw new ContentBlockError("Revision not found", 404);

  const nextRevision = existing.revisionNumber + 1;
  const [updated] = await db
    .update(caseContentBlocks)
    .set({
      type: source.type,
      title: source.title,
      content: source.content,
      contentStructured: source.contentStructured,
      tlp: source.tlp,
      pap: source.pap,
      sensitive: source.sensitive,
      includeInReport: source.includeInReport,
      lastEditorId: actorId,
      revisionNumber: nextRevision,
      archivedAt: null,
      archivedById: null,
      updatedAt: new Date(),
    })
    .where(eq(caseContentBlocks.id, blockId))
    .returning();
  if (!updated) throw new ContentBlockError("Content block not found", 404);

  await appendRevision({
    block: updated,
    editorId: actorId,
    changeSummary: `restored from revision ${revisionNumber}`,
    restoredFromRevision: revisionNumber,
  });

  await writeTimelineEvent({
    caseId,
    actorId,
    eventType: "content_block_changed",
    payload: {
      action: "restored",
      block_id: blockId,
      type: updated.type,
      title: updated.title,
      revision: nextRevision,
      restored_from_revision: revisionNumber,
    },
  });

  const [view] = await withLinks([updated]);
  return view;
}

export async function listContentBlockRevisionsCore(
  organisationId: string,
  caseId: string,
  blockId: string,
): Promise<CaseContentBlockRevision[]> {
  const [existing] = await db
    .select({ id: caseContentBlocks.id })
    .from(caseContentBlocks)
    .where(
      and(
        eq(caseContentBlocks.id, blockId),
        eq(caseContentBlocks.organisationId, organisationId),
        eq(caseContentBlocks.caseId, caseId),
      ),
    )
    .limit(1);
  if (!existing) throw new ContentBlockError("Content block not found", 404);

  return db
    .select()
    .from(caseContentBlockRevisions)
    .where(eq(caseContentBlockRevisions.blockId, blockId))
    .orderBy(asc(caseContentBlockRevisions.revisionNumber));
}

/**
 * Moves one block to `targetIndex` among non-archived blocks for the case,
 * renumbers sequence indexes, and writes **one** timeline event for the whole
 * reorder (not one per moved row).
 */
export async function reorderContentBlocksCore(
  organisationId: string,
  actorId: string | null,
  caseId: string,
  blockId: string,
  targetIndex: number,
): Promise<ContentBlockView[]> {
  const caseRow = await loadCaseInOrg(caseId, organisationId);
  if (!caseRow) throw new ContentBlockError("Case not found", 404);

  const clampedTarget = await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(caseContentBlocks)
      .where(
        and(
          eq(caseContentBlocks.caseId, caseId),
          eq(caseContentBlocks.organisationId, organisationId),
          isNull(caseContentBlocks.archivedAt),
        ),
      )
      .orderBy(asc(caseContentBlocks.sequenceIndex))
      .for("update");

    if (!rows.some((r) => r.id === blockId)) {
      throw new ContentBlockError("Content block not found", 404);
    }

    const orderedIds = reorderIds(
      rows.map((r) => r.id),
      blockId,
      targetIndex,
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    const reordered = orderedIds.map((id) => byId.get(id)!);
    const nextTarget = orderedIds.indexOf(blockId);

    for (let i = 0; i < reordered.length; i++) {
      await tx
        .update(caseContentBlocks)
        .set({ sequenceIndex: -(i + 1), updatedAt: new Date() })
        .where(eq(caseContentBlocks.id, reordered[i].id));
    }
    for (let i = 0; i < reordered.length; i++) {
      await tx
        .update(caseContentBlocks)
        .set({ sequenceIndex: i, updatedAt: new Date() })
        .where(eq(caseContentBlocks.id, reordered[i].id));
    }
    return nextTarget;
  });

  await writeTimelineEvent({
    caseId,
    actorId,
    eventType: "content_block_changed",
    payload: {
      action: "reordered",
      block_id: blockId,
      new_index: clampedTarget,
    },
  });

  return listContentBlocksCore(organisationId, caseId);
}

/**
 * Promote a case comment into a content block. Preserves original author,
 * original timestamp, source comment link, and promoting actor.
 */
export async function promoteCommentToContentBlockCore(
  organisationId: string,
  actorId: string | null,
  caseId: string,
  commentId: string,
  input?: {
    type?: CaseContentBlockType;
    title?: string;
    sensitive?: boolean;
    includeInReport?: boolean;
    tlp?: BlockTlp;
    pap?: BlockPap;
  },
): Promise<ContentBlockView> {
  const caseRow = await loadCaseInOrg(caseId, organisationId);
  if (!caseRow) throw new ContentBlockError("Case not found", 404);

  const [comment] = await db
    .select()
    .from(comments)
    .where(and(eq(comments.id, commentId), eq(comments.caseId, caseId)))
    .limit(1);
  if (!comment) throw new ContentBlockError("Comment not found", 404);

  // Tenant check: case already verified in org; comment is case-scoped so
  // ownership follows the case. Cross-case comment ids 404 above.

  const existingPromotion = await db
    .select({ id: caseContentBlocks.id })
    .from(caseContentBlocks)
    .where(eq(caseContentBlocks.sourceCommentId, commentId))
    .limit(1);
  if (existingPromotion[0]) {
    throw new ContentBlockError(
      "This comment has already been promoted to a content block",
      409,
    );
  }

  const type = input?.type ?? "investigation_note";
  if (!isCaseContentBlockType(type)) {
    throw new ContentBlockError("Unknown content block type");
  }
  const title = normaliseTitle(
    input?.title ??
      (comment.body.trim().length > 80
        ? `${comment.body.trim().slice(0, 77)}...`
        : comment.body.trim() || "Promoted comment"),
  );
  const content = normaliseContent(comment.body);
  const sensitive = Boolean(input?.sensitive);
  const includeInReport = defaultIncludeInReport(sensitive, input?.includeInReport);
  const tlp = normaliseTlp(input?.tlp, "amber");
  const pap = normalisePap(input?.pap, "amber");
  const id = newId("cblock");
  const now = new Date();

  const inserted = await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT id FROM ${caseContentBlocks} WHERE ${caseContentBlocks.caseId} = ${caseId} FOR UPDATE`,
    );
    const existing = await tx
      .select({ sequenceIndex: caseContentBlocks.sequenceIndex })
      .from(caseContentBlocks)
      .where(eq(caseContentBlocks.caseId, caseId))
      .orderBy(asc(caseContentBlocks.sequenceIndex));
    const nextSequenceIndex =
      existing.length > 0 ? existing[existing.length - 1].sequenceIndex + 1 : 0;

    const [row] = await tx
      .insert(caseContentBlocks)
      .values({
        id,
        organisationId,
        caseId,
        type,
        title,
        content,
        sequenceIndex: nextSequenceIndex,
        tlp,
        pap,
        sensitive,
        includeInReport,
        authorId: comment.authorId,
        lastEditorId: actorId,
        revisionNumber: 1,
        sourceCommentId: comment.id,
        promotedById: actorId,
        promotedAt: now,
        originalAuthorId: comment.authorId,
        originalCreatedAt: comment.createdAt,
      })
      .returning();
    if (!row) throw new ContentBlockError("Content block could not be created", 500);

    await tx.insert(caseContentBlockRevisions).values({
      id: newId("cbrev"),
      blockId: id,
      organisationId,
      caseId,
      revisionNumber: 1,
      type: row.type,
      title: row.title,
      content: row.content,
      contentStructured: row.contentStructured,
      tlp: row.tlp,
      pap: row.pap,
      sensitive: row.sensitive,
      includeInReport: row.includeInReport,
      editorId: actorId,
      changeSummary: "promoted from comment",
    });
    return row;
  });

  await writeTimelineEvent({
    caseId,
    actorId,
    eventType: "content_block_changed",
    payload: {
      action: "promoted",
      block_id: id,
      type: inserted.type,
      title: inserted.title,
      source_comment_id: comment.id,
      original_author_id: comment.authorId,
      original_created_at: comment.createdAt.toISOString(),
      promoted_by_id: actorId,
    },
  });

  const [view] = await withLinks([inserted]);
  return view;
}

/**
 * Authorise a link target against the organisation and case. Returns the
 * canonical target id (e.g. uppercased technique id).
 */
async function assertLinkTargetAuthorised(opts: {
  organisationId: string;
  caseId: string;
  linkType: CaseContentBlockLinkType;
  targetId: string;
}): Promise<string> {
  const targetId = opts.targetId.trim();
  if (!targetId) throw new ContentBlockError("targetId is required");

  switch (opts.linkType) {
    case "alert": {
      const [link] = await db
        .select({ alertId: caseAlerts.alertId })
        .from(caseAlerts)
        .where(
          and(
            eq(caseAlerts.caseId, opts.caseId),
            eq(caseAlerts.organisationId, opts.organisationId),
            eq(caseAlerts.alertId, targetId),
          ),
        )
        .limit(1);
      if (!link) {
        // Uniform 404 — no unscoped alert lookup (would oracle foreign-tenant ids).
        throw new ContentBlockError("Alert not found", 404);
      }
      return link.alertId;
    }
    case "entity": {
      // Case-authorised only: entity must appear on a case-linked alert or
      // evidence item. Uniform 404 whether the entity is missing, other-org,
      // or merely not associated with this case (no membership oracle).
      const [viaAlert] = await db
        .select({ entityId: alertEntities.entityId })
        .from(alertEntities)
        .innerJoin(
          caseAlerts,
          and(
            eq(caseAlerts.alertId, alertEntities.alertId),
            eq(caseAlerts.caseId, opts.caseId),
            eq(caseAlerts.organisationId, opts.organisationId),
          ),
        )
        .where(
          and(
            eq(alertEntities.entityId, targetId),
            eq(alertEntities.organisationId, opts.organisationId),
          ),
        )
        .limit(1);
      if (viaAlert) return viaAlert.entityId;

      const [viaEvidence] = await db
        .select({ entityId: evidenceItems.entityId })
        .from(evidenceItems)
        .where(
          and(
            eq(evidenceItems.entityId, targetId),
            eq(evidenceItems.caseId, opts.caseId),
            eq(evidenceItems.organisationId, opts.organisationId),
          ),
        )
        .limit(1);
      if (!viaEvidence?.entityId) {
        throw new ContentBlockError("Entity not found", 404);
      }
      return viaEvidence.entityId;
    }
    case "evidence_item": {
      const [item] = await db
        .select({ id: evidenceItems.id })
        .from(evidenceItems)
        .where(
          and(
            eq(evidenceItems.id, targetId),
            eq(evidenceItems.caseId, opts.caseId),
            eq(evidenceItems.organisationId, opts.organisationId),
          ),
        )
        .limit(1);
      if (!item) throw new ContentBlockError("Evidence item not found", 404);
      return item.id;
    }
    case "task": {
      const [task] = await db
        .select({ id: caseTasks.id })
        .from(caseTasks)
        .innerJoin(cases, eq(cases.id, caseTasks.caseId))
        .where(
          and(
            eq(caseTasks.id, targetId),
            eq(caseTasks.caseId, opts.caseId),
            eq(cases.organisationId, opts.organisationId),
          ),
        )
        .limit(1);
      if (!task) throw new ContentBlockError("Task not found", 404);
      return task.id;
    }
    case "attack_technique": {
      const techniqueId = targetId.toUpperCase();
      if (!/^T\d{4}(\.\d{3})?$/.test(techniqueId)) {
        throw new ContentBlockError(
          "Technique id must look like T1059 or T1059.001",
        );
      }
      return techniqueId;
    }
    case "attack_mapping": {
      const [mapping] = await db
        .select({ id: attackTechniqueMappings.id })
        .from(attackTechniqueMappings)
        .where(
          and(
            eq(attackTechniqueMappings.id, targetId),
            eq(attackTechniqueMappings.organisationId, opts.organisationId),
            eq(attackTechniqueMappings.caseId, opts.caseId),
          ),
        )
        .limit(1);
      if (!mapping) throw new ContentBlockError("ATT&CK mapping not found", 404);
      return mapping.id;
    }
    default:
      throw new ContentBlockError("Unknown link type");
  }
}

export async function addContentBlockLinkCore(
  organisationId: string,
  actorId: string | null,
  caseId: string,
  blockId: string,
  linkType: CaseContentBlockLinkType,
  targetId: string,
): Promise<CaseContentBlockLink> {
  if (!isCaseContentBlockLinkType(linkType)) {
    throw new ContentBlockError("Unknown link type");
  }
  const block = await getContentBlockCore(organisationId, caseId, blockId);
  if (block.archivedAt) {
    throw new ContentBlockError("Cannot link an archived content block", 409);
  }

  const canonicalTarget = await assertLinkTargetAuthorised({
    organisationId,
    caseId,
    linkType,
    targetId,
  });

  const id = newId("cblink");
  try {
    const [row] = await db
      .insert(caseContentBlockLinks)
      .values({
        id,
        blockId,
        organisationId,
        caseId,
        linkType,
        targetId: canonicalTarget,
        createdBy: actorId,
      })
      .returning();
    if (!row) throw new ContentBlockError("Link could not be created", 500);

    await writeTimelineEvent({
      caseId,
      actorId,
      eventType: "content_block_changed",
      payload: {
        action: "link_added",
        block_id: blockId,
        link_type: linkType,
        target_id: canonicalTarget,
      },
    });
    return row;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("case_content_block_links_unique_idx") || message.includes("unique")) {
      throw new ContentBlockError("Link already exists", 409);
    }
    throw err;
  }
}

export async function removeContentBlockLinkCore(
  organisationId: string,
  actorId: string | null,
  caseId: string,
  blockId: string,
  linkId: string,
): Promise<void> {
  const [existing] = await db
    .select()
    .from(caseContentBlockLinks)
    .where(
      and(
        eq(caseContentBlockLinks.id, linkId),
        eq(caseContentBlockLinks.blockId, blockId),
        eq(caseContentBlockLinks.organisationId, organisationId),
        eq(caseContentBlockLinks.caseId, caseId),
      ),
    )
    .limit(1);
  if (!existing) throw new ContentBlockError("Link not found", 404);

  await db
    .delete(caseContentBlockLinks)
    .where(eq(caseContentBlockLinks.id, linkId));

  await writeTimelineEvent({
    caseId,
    actorId,
    eventType: "content_block_changed",
    payload: {
      action: "link_removed",
      block_id: blockId,
      link_type: existing.linkType,
      target_id: existing.targetId,
    },
  });
}

/**
 * Blocks eligible for report inclusion: not archived, includeInReport true,
 * and (by default) not sensitive. Callers can pass `includeSensitive` when a
 * future field-level policy grants it.
 */
export async function listReportContentBlocksCore(
  organisationId: string,
  caseId: string,
  opts?: { includeSensitive?: boolean; types?: CaseContentBlockType[] },
): Promise<ContentBlockView[]> {
  const all = await listContentBlocksCore(organisationId, caseId, {
    includeArchived: false,
  });
  return all.filter((b) => {
    if (!b.includeInReport) return false;
    if (b.sensitive && !opts?.includeSensitive) return false;
    if (opts?.types && !opts.types.includes(b.type as CaseContentBlockType)) {
      return false;
    }
    return true;
  });
}

