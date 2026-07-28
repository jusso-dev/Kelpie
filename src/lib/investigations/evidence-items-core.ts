/**
 * Investigation-level evidence records and relationships (issue #55). This
 * is deliberately distinct from `src/lib/evidence/core.ts` (issue #44), which
 * owns binary evidence storage and chain-of-custody integrity. An
 * `evidence_items` row may optionally point at an `attachments` row via
 * `attachmentId`, but never re-implements upload/storage/hashing/scanning.
 *
 * Ownership: `verdict` and `remediationState` (plus `analystNotes`) are
 * analyst-owned and only ever change through `setEvidenceItemVerdictCore` /
 * `setEvidenceItemRemediationCore` / `setEvidenceItemNotesCore`. `source`,
 * `firstSeenAt`, `lastSeenAt`, `value`, `description`, and `type` are
 * provider-owned/immutable at creation.
 */

import { and, desc, eq, lt, or } from "drizzle-orm";
import { db } from "@/db";
import {
  alerts,
  attachments,
  cases,
  entities,
  evidenceItems,
  evidenceRelationships,
  type EvidenceItem,
  type EvidenceRelationship,
} from "@/db/schema";
import { newId } from "@/lib/utils";
import { writeTimelineEvent } from "@/lib/timeline";
import { clampLimit, decodeCursor, encodeCursor, type ListPage } from "./pagination";

export class EvidenceItemError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "EvidenceItemError";
    this.status = status;
  }
}

async function loadCaseInOrg(caseId: string, organisationId: string) {
  const [c] = await db
    .select({ id: cases.id })
    .from(cases)
    .where(and(eq(cases.id, caseId), eq(cases.organisationId, organisationId)))
    .limit(1);
  return c ?? null;
}

export async function getEvidenceItemInOrg(
  id: string,
  organisationId: string,
): Promise<EvidenceItem | null> {
  const [row] = await db
    .select()
    .from(evidenceItems)
    .where(and(eq(evidenceItems.id, id), eq(evidenceItems.organisationId, organisationId)))
    .limit(1);
  return row ?? null;
}

export type CreateEvidenceItemInput = {
  organisationId: string;
  actorId: string | null;
  caseId: string;
  alertId?: string | null;
  entityId?: string | null;
  attachmentId?: string | null;
  type: string;
  value?: string | null;
  description?: string | null;
  source?: string;
  confidence?: number | null;
  firstSeenAt?: Date | null;
  lastSeenAt?: Date | null;
  rawPayloadRefId?: string | null;
};

export async function createEvidenceItemCore(
  input: CreateEvidenceItemInput,
): Promise<EvidenceItem> {
  if (!input.type.trim()) throw new EvidenceItemError("Evidence type is required");
  if (
    input.confidence !== undefined &&
    input.confidence !== null &&
    (input.confidence < 0 || input.confidence > 100)
  ) {
    throw new EvidenceItemError("Confidence must be between 0 and 100");
  }
  const caseRow = await loadCaseInOrg(input.caseId, input.organisationId);
  if (!caseRow) throw new EvidenceItemError("Case not found", 404);

  if (input.attachmentId) {
    const [att] = await db
      .select({ id: attachments.id })
      .from(attachments)
      .where(
        and(
          eq(attachments.id, input.attachmentId),
          eq(attachments.organisationId, input.organisationId),
        ),
      )
      .limit(1);
    if (!att) throw new EvidenceItemError("Attachment not found", 404);
  }

  // `alertId` and `entityId` arrive straight from the REST body, so they get
  // the same org-scoped existence check as `attachmentId` above. Without it a
  // caller could hang an evidence item in their own organisation off another
  // organisation's alert or entity just by guessing an opaque id.
  if (input.alertId) {
    const [alert] = await db
      .select({ id: alerts.id })
      .from(alerts)
      .where(and(eq(alerts.id, input.alertId), eq(alerts.organisationId, input.organisationId)))
      .limit(1);
    if (!alert) throw new EvidenceItemError("Alert not found", 404);
  }

  if (input.entityId) {
    const [entity] = await db
      .select({ id: entities.id })
      .from(entities)
      .where(
        and(eq(entities.id, input.entityId), eq(entities.organisationId, input.organisationId)),
      )
      .limit(1);
    if (!entity) throw new EvidenceItemError("Entity not found", 404);
  }

  const id = newId("evitem");
  const [row] = await db
    .insert(evidenceItems)
    .values({
      id,
      organisationId: input.organisationId,
      caseId: input.caseId,
      alertId: input.alertId ?? null,
      entityId: input.entityId ?? null,
      attachmentId: input.attachmentId ?? null,
      type: input.type.trim(),
      value: input.value ?? null,
      description: input.description ?? null,
      source: input.source ?? "analyst",
      confidence: input.confidence ?? null,
      firstSeenAt: input.firstSeenAt ?? null,
      lastSeenAt: input.lastSeenAt ?? null,
      rawPayloadRefId: input.rawPayloadRefId ?? null,
      createdBy: input.actorId,
    })
    .returning();
  if (!row) throw new EvidenceItemError("Evidence item could not be created", 500);

  await writeTimelineEvent({
    caseId: input.caseId,
    actorId: input.actorId,
    eventType: "evidence_item_created",
    payload: {
      evidence_item_id: id,
      type: row.type,
      alert_id: input.alertId ?? null,
      entity_id: input.entityId ?? null,
    },
  });
  return row;
}

export async function setEvidenceItemVerdictCore(opts: {
  organisationId: string;
  actorId: string | null;
  evidenceItemId: string;
  verdict: EvidenceItem["verdict"];
}): Promise<EvidenceItem> {
  const existing = await getEvidenceItemInOrg(opts.evidenceItemId, opts.organisationId);
  if (!existing) throw new EvidenceItemError("Evidence item not found", 404);
  if (existing.verdict === opts.verdict) return existing;
  const [updated] = await db
    .update(evidenceItems)
    .set({ verdict: opts.verdict, updatedAt: new Date() })
    .where(eq(evidenceItems.id, opts.evidenceItemId))
    .returning();
  if (!updated) throw new EvidenceItemError("Evidence item not found", 404);
  await writeTimelineEvent({
    caseId: existing.caseId,
    actorId: opts.actorId,
    eventType: "evidence_item_verdict_changed",
    payload: { evidence_item_id: opts.evidenceItemId, from: existing.verdict, to: opts.verdict },
  });
  return updated;
}

export async function setEvidenceItemRemediationCore(opts: {
  organisationId: string;
  actorId: string | null;
  evidenceItemId: string;
  remediationState: EvidenceItem["remediationState"];
}): Promise<EvidenceItem> {
  const existing = await getEvidenceItemInOrg(opts.evidenceItemId, opts.organisationId);
  if (!existing) throw new EvidenceItemError("Evidence item not found", 404);
  if (existing.remediationState === opts.remediationState) return existing;
  const [updated] = await db
    .update(evidenceItems)
    .set({ remediationState: opts.remediationState, updatedAt: new Date() })
    .where(eq(evidenceItems.id, opts.evidenceItemId))
    .returning();
  if (!updated) throw new EvidenceItemError("Evidence item not found", 404);
  await writeTimelineEvent({
    caseId: existing.caseId,
    actorId: opts.actorId,
    eventType: "evidence_item_remediation_changed",
    payload: {
      evidence_item_id: opts.evidenceItemId,
      from: existing.remediationState,
      to: opts.remediationState,
    },
  });
  return updated;
}

export async function setEvidenceItemNotesCore(opts: {
  organisationId: string;
  evidenceItemId: string;
  notes: string | null;
}): Promise<EvidenceItem> {
  const existing = await getEvidenceItemInOrg(opts.evidenceItemId, opts.organisationId);
  if (!existing) throw new EvidenceItemError("Evidence item not found", 404);
  const [updated] = await db
    .update(evidenceItems)
    .set({ analystNotes: opts.notes?.trim() || null, updatedAt: new Date() })
    .where(eq(evidenceItems.id, opts.evidenceItemId))
    .returning();
  if (!updated) throw new EvidenceItemError("Evidence item not found", 404);
  return updated;
}

export async function listEvidenceItemsForCase(
  organisationId: string,
  caseId: string,
  opts: { limit?: number | null; cursor?: string | null } = {},
): Promise<ListPage<EvidenceItem>> {
  const caseRow = await loadCaseInOrg(caseId, organisationId);
  if (!caseRow) throw new EvidenceItemError("Case not found", 404);

  const limit = clampLimit(opts.limit);
  const cursor = decodeCursor(opts.cursor);
  const conditions = [
    eq(evidenceItems.caseId, caseId),
    eq(evidenceItems.organisationId, organisationId),
  ];
  if (cursor) {
    conditions.push(
      or(
        lt(evidenceItems.createdAt, cursor.at),
        and(eq(evidenceItems.createdAt, cursor.at), lt(evidenceItems.id, cursor.id))!,
      )!,
    );
  }
  const rows = await db
    .select()
    .from(evidenceItems)
    .where(and(...conditions))
    .orderBy(desc(evidenceItems.createdAt), desc(evidenceItems.id))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  return {
    items: page,
    nextCursor: hasMore && last ? encodeCursor({ at: last.createdAt, id: last.id }) : null,
  };
}

export const EVIDENCE_RELATIONSHIP_TYPES = [
  "related_to",
  "duplicate_of",
  "derived_from",
] as const;
export type EvidenceRelationshipTypeInput = (typeof EVIDENCE_RELATIONSHIP_TYPES)[number];

function canonicalPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

/** Canonicalises symmetric types (`related_to`, `duplicate_of`) by sorted id, mirroring `case-relationships-core`, so an edge can never be stored twice. */
function canonicalizeEvidenceEdge(
  sourceId: string,
  targetId: string,
  relationshipType: EvidenceRelationshipTypeInput,
): { sourceEvidenceId: string; targetEvidenceId: string; relationshipType: EvidenceRelationshipTypeInput } {
  if (relationshipType === "derived_from") {
    return { sourceEvidenceId: sourceId, targetEvidenceId: targetId, relationshipType };
  }
  const [a, b] = canonicalPair(sourceId, targetId);
  return { sourceEvidenceId: a, targetEvidenceId: b, relationshipType };
}

export async function linkEvidenceRelationshipCore(opts: {
  organisationId: string;
  actorId: string | null;
  sourceEvidenceId: string;
  targetEvidenceId: string;
  relationshipType: EvidenceRelationshipTypeInput;
  reason: string;
}): Promise<EvidenceRelationship> {
  const reason = opts.reason.trim();
  if (!reason) throw new EvidenceItemError("A reason is required to link evidence");
  if (opts.sourceEvidenceId === opts.targetEvidenceId) {
    throw new EvidenceItemError("Evidence cannot be linked to itself");
  }
  const [source, target] = await Promise.all([
    getEvidenceItemInOrg(opts.sourceEvidenceId, opts.organisationId),
    getEvidenceItemInOrg(opts.targetEvidenceId, opts.organisationId),
  ]);
  if (!source) throw new EvidenceItemError("Evidence item not found", 404);
  if (!target) throw new EvidenceItemError("Target evidence item not found", 404);
  if (source.caseId !== target.caseId) {
    throw new EvidenceItemError("Evidence items must belong to the same case", 400);
  }

  const canonical = canonicalizeEvidenceEdge(
    opts.sourceEvidenceId,
    opts.targetEvidenceId,
    opts.relationshipType,
  );
  const [inserted] = await db
    .insert(evidenceRelationships)
    .values({
      id: newId("evrel"),
      organisationId: opts.organisationId,
      sourceEvidenceId: canonical.sourceEvidenceId,
      targetEvidenceId: canonical.targetEvidenceId,
      relationshipType: canonical.relationshipType,
      reason,
      createdBy: opts.actorId,
    })
    .onConflictDoNothing()
    .returning();
  if (!inserted) {
    throw new EvidenceItemError("This evidence relationship already exists", 409);
  }

  await writeTimelineEvent({
    caseId: source.caseId,
    actorId: opts.actorId,
    eventType: "evidence_relationship_created",
    payload: {
      relationship_id: inserted.id,
      relationship_type: canonical.relationshipType,
      source_evidence_id: canonical.sourceEvidenceId,
      target_evidence_id: canonical.targetEvidenceId,
      reason,
    },
  });
  return inserted;
}

export async function listEvidenceRelationshipsFor(
  evidenceItemId: string,
  organisationId: string,
): Promise<EvidenceRelationship[]> {
  return db
    .select()
    .from(evidenceRelationships)
    .where(
      and(
        eq(evidenceRelationships.organisationId, organisationId),
        or(
          eq(evidenceRelationships.sourceEvidenceId, evidenceItemId),
          eq(evidenceRelationships.targetEvidenceId, evidenceItemId),
        ),
      ),
    )
    .orderBy(desc(evidenceRelationships.createdAt));
}
