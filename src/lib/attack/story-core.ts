/**
 * Explicit, analyst/provider-provenanced attack-story ordering for a case.
 * `sequenceIndex` is the only thing that determines display order — it is
 * always set explicitly (by an analyst reordering the story, or copied from
 * a provider-supplied sequence) and is never derived from `occurredAt`,
 * which is kept purely as optional contextual timing. This is the
 * acceptance criterion: ordering must not claim causality from timestamps
 * alone.
 */
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  attackStoryEntries,
  attackTechniqueMappings,
  cases,
  type AttackStoryEntry,
} from "@/db/schema";
import { newId } from "@/lib/utils";
import { writeTimelineEvent } from "@/lib/timeline";
import { getTechniquesByIds } from "./catalog-core";

export class AttackStoryError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "AttackStoryError";
    this.status = status;
  }
}

export type StoryEntryView = AttackStoryEntry & { techniqueName: string | null };

export type StoryEntryInput = {
  title: string;
  description?: string | null;
  provenance?: "analyst" | "provider";
  sourceRef?: string | null;
  occurredAt?: string | null;
  techniqueId?: string | null;
  mappingId?: string | null;
};

/**
 * Pure (no DB access) — returns `ids` with the entry at `id` moved to
 * `targetIndex` (clamped to the valid range), everything else kept in its
 * relative order. Used both to compute the reorder for `reorderStoryEntryCore`
 * and to compute the renumbering after a removal in `removeStoryEntryCore`.
 */
export function reorderIds(ids: string[], id: string, targetIndex: number): string[] {
  const index = ids.indexOf(id);
  if (index === -1) return ids;
  const clampedTarget = Math.max(0, Math.min(targetIndex, ids.length - 1));
  const next = [...ids];
  const [moved] = next.splice(index, 1);
  next.splice(clampedTarget, 0, moved);
  return next;
}

async function loadCaseInOrg(caseId: string, organisationId: string) {
  const [row] = await db
    .select({ id: cases.id })
    .from(cases)
    .where(and(eq(cases.id, caseId), eq(cases.organisationId, organisationId)))
    .limit(1);
  return row ?? null;
}

async function enrich(rows: AttackStoryEntry[]): Promise<StoryEntryView[]> {
  const ids = rows.map((r) => r.techniqueId).filter((id): id is string => Boolean(id));
  const techniques = await getTechniquesByIds(ids);
  const byId = new Map(techniques.map((t) => [t.techniqueId, t.name]));
  return rows.map((row) => ({
    ...row,
    techniqueName: row.techniqueId ? (byId.get(row.techniqueId) ?? null) : null,
  }));
}

export async function listStoryCore(
  organisationId: string,
  caseId: string,
): Promise<StoryEntryView[]> {
  const caseRow = await loadCaseInOrg(caseId, organisationId);
  if (!caseRow) throw new AttackStoryError("Case not found", 404);
  const rows = await db
    .select()
    .from(attackStoryEntries)
    .where(
      and(
        eq(attackStoryEntries.organisationId, organisationId),
        eq(attackStoryEntries.caseId, caseId),
      ),
    )
    .orderBy(asc(attackStoryEntries.sequenceIndex));
  return enrich(rows);
}

export async function addStoryEntryCore(
  organisationId: string,
  actorId: string | null,
  caseId: string,
  input: StoryEntryInput,
): Promise<StoryEntryView> {
  const title = input.title.trim();
  if (!title) throw new AttackStoryError("A title is required for a story entry");
  const caseRow = await loadCaseInOrg(caseId, organisationId);
  if (!caseRow) throw new AttackStoryError("Case not found", 404);

  if (input.mappingId) {
    const [mapping] = await db
      .select({ id: attackTechniqueMappings.id })
      .from(attackTechniqueMappings)
      .where(
        and(
          eq(attackTechniqueMappings.id, input.mappingId),
          eq(attackTechniqueMappings.organisationId, organisationId),
          eq(attackTechniqueMappings.caseId, caseId),
        ),
      )
      .limit(1);
    if (!mapping) throw new AttackStoryError("Mapping not found on this case", 404);
  }

  const occurredAt = input.occurredAt ? new Date(input.occurredAt) : null;
  if (input.occurredAt && (!occurredAt || Number.isNaN(occurredAt.getTime()))) {
    throw new AttackStoryError("occurredAt must be a valid timestamp");
  }

  const id = newId("attackstory");
  // Allocate sequenceIndex inside a transaction with a lock on the case's
  // story rows so concurrent POSTs cannot both claim the same next index.
  const inserted = await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT id FROM ${attackStoryEntries} WHERE ${attackStoryEntries.caseId} = ${caseId} FOR UPDATE`,
    );
    const existing = await tx
      .select({ sequenceIndex: attackStoryEntries.sequenceIndex })
      .from(attackStoryEntries)
      .where(eq(attackStoryEntries.caseId, caseId))
      .orderBy(asc(attackStoryEntries.sequenceIndex));
    const nextSequenceIndex =
      existing.length > 0 ? existing[existing.length - 1].sequenceIndex + 1 : 0;
    const [row] = await tx
      .insert(attackStoryEntries)
      .values({
        id,
        organisationId,
        caseId,
        mappingId: input.mappingId ?? null,
        techniqueId: input.techniqueId?.trim().toUpperCase() || null,
        sequenceIndex: nextSequenceIndex,
        title,
        description: input.description?.trim() || null,
        provenance: input.provenance ?? "analyst",
        sourceRef: input.sourceRef?.trim() || null,
        occurredAt,
        createdBy: actorId,
      })
      .returning();
    return row;
  });
  if (!inserted) throw new AttackStoryError("Story entry could not be created");

  await writeTimelineEvent({
    caseId,
    actorId,
    eventType: "attack_story_changed",
    payload: { action: "created", entry_id: id, title, provenance: inserted.provenance },
  });

  const [view] = await enrich([inserted]);
  return view;
}

/**
 * Moves an entry to `targetIndex` (0-based, among the case's entries) and
 * renumbers every affected entry inside one transaction so the unique
 * `(caseId, sequenceIndex)` index is never transiently violated.
 */
export async function reorderStoryEntryCore(
  organisationId: string,
  actorId: string | null,
  caseId: string,
  entryId: string,
  targetIndex: number,
): Promise<StoryEntryView[]> {
  const caseRow = await loadCaseInOrg(caseId, organisationId);
  if (!caseRow) throw new AttackStoryError("Case not found", 404);

  const clampedTarget = await db.transaction(async (tx) => {
    // Lock all story rows for the case before computing the new order so
    // concurrent reorders cannot clobber each other mid-renumber.
    const rows = await tx
      .select()
      .from(attackStoryEntries)
      .where(eq(attackStoryEntries.caseId, caseId))
      .orderBy(asc(attackStoryEntries.sequenceIndex))
      .for("update");
    if (!rows.some((r) => r.id === entryId)) {
      throw new AttackStoryError("Story entry not found", 404);
    }

    const orderedIds = reorderIds(rows.map((r) => r.id), entryId, targetIndex);
    const byId = new Map(rows.map((r) => [r.id, r]));
    const reordered = orderedIds.map((id) => byId.get(id)!);
    const nextTarget = orderedIds.indexOf(entryId);

    // Two-phase renumber (offset then final) so intermediate writes never
    // collide with the unique (caseId, sequenceIndex) index.
    for (let i = 0; i < reordered.length; i++) {
      await tx
        .update(attackStoryEntries)
        .set({ sequenceIndex: -(i + 1) })
        .where(eq(attackStoryEntries.id, reordered[i].id));
    }
    for (let i = 0; i < reordered.length; i++) {
      await tx
        .update(attackStoryEntries)
        .set({ sequenceIndex: i })
        .where(eq(attackStoryEntries.id, reordered[i].id));
    }
    return nextTarget;
  });

  await writeTimelineEvent({
    caseId,
    actorId,
    eventType: "attack_story_changed",
    payload: { action: "reordered", entry_id: entryId, new_index: clampedTarget },
  });

  return listStoryCore(organisationId, caseId);
}

export async function updateStoryEntryCore(
  organisationId: string,
  actorId: string | null,
  caseId: string,
  entryId: string,
  patch: Partial<Pick<StoryEntryInput, "title" | "description" | "sourceRef" | "occurredAt">>,
): Promise<StoryEntryView> {
  const [existing] = await db
    .select()
    .from(attackStoryEntries)
    .where(
      and(
        eq(attackStoryEntries.id, entryId),
        eq(attackStoryEntries.organisationId, organisationId),
        eq(attackStoryEntries.caseId, caseId),
      ),
    )
    .limit(1);
  if (!existing) throw new AttackStoryError("Story entry not found", 404);

  const title = patch.title !== undefined ? patch.title.trim() : existing.title;
  if (!title) throw new AttackStoryError("A title is required for a story entry");
  const occurredAt =
    patch.occurredAt !== undefined
      ? patch.occurredAt
        ? new Date(patch.occurredAt)
        : null
      : existing.occurredAt;

  const [updated] = await db
    .update(attackStoryEntries)
    .set({
      title,
      description: patch.description !== undefined ? patch.description?.trim() || null : existing.description,
      sourceRef: patch.sourceRef !== undefined ? patch.sourceRef?.trim() || null : existing.sourceRef,
      occurredAt,
    })
    .where(eq(attackStoryEntries.id, entryId))
    .returning();
  if (!updated) throw new AttackStoryError("Story entry not found", 404);

  await writeTimelineEvent({
    caseId,
    actorId,
    eventType: "attack_story_changed",
    payload: { action: "updated", entry_id: entryId, title },
  });

  const [view] = await enrich([updated]);
  return view;
}

export async function removeStoryEntryCore(
  organisationId: string,
  actorId: string | null,
  caseId: string,
  entryId: string,
): Promise<void> {
  const [existing] = await db
    .select()
    .from(attackStoryEntries)
    .where(
      and(
        eq(attackStoryEntries.id, entryId),
        eq(attackStoryEntries.organisationId, organisationId),
        eq(attackStoryEntries.caseId, caseId),
      ),
    )
    .limit(1);
  if (!existing) throw new AttackStoryError("Story entry not found", 404);

  const rows = await db
    .select()
    .from(attackStoryEntries)
    .where(eq(attackStoryEntries.caseId, caseId))
    .orderBy(asc(attackStoryEntries.sequenceIndex));
  const remaining = rows.filter((r) => r.id !== entryId);

  await db.transaction(async (tx) => {
    await tx.delete(attackStoryEntries).where(eq(attackStoryEntries.id, entryId));
    for (let i = 0; i < remaining.length; i++) {
      await tx
        .update(attackStoryEntries)
        .set({ sequenceIndex: -(i + 1) })
        .where(eq(attackStoryEntries.id, remaining[i].id));
    }
    for (let i = 0; i < remaining.length; i++) {
      await tx
        .update(attackStoryEntries)
        .set({ sequenceIndex: i })
        .where(eq(attackStoryEntries.id, remaining[i].id));
    }
  });

  await writeTimelineEvent({
    caseId,
    actorId,
    eventType: "attack_story_changed",
    payload: { action: "removed", entry_id: entryId, title: existing.title },
  });
}
