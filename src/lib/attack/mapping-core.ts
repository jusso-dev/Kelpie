/**
 * Core ATT&CK technique mapping mutations and queries, callable from server
 * actions, REST routes, and MCP tools alike. Callers must already have
 * resolved `organisationId` for the acting user/token; every function
 * re-verifies that the entity it touches belongs to that organisation before
 * doing anything with it (same pattern as `case-relationships-core.ts` and
 * `evidence/core.ts`).
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  attackTechniqueMappings,
  attachments,
  caseTasks,
  cases,
  observables,
  type AttackTechniqueMapping,
} from "@/db/schema";
import { newId } from "@/lib/utils";
import { writeTimelineEvent } from "@/lib/timeline";
import { getActiveCatalogVersion, getTechniquesByIds, resolveTechnique } from "./catalog-core";
import { findTactic } from "./tactics";

export const MAPPING_ENTITY_TYPES = [
  "case",
  "alert",
  "observable",
  "evidence",
  "task",
] as const;
export type MappingEntityType = (typeof MAPPING_ENTITY_TYPES)[number];

export const MAPPING_SOURCES = [
  "analyst",
  "detection_rule",
  "threat_intel",
  "provider",
] as const;

const TECHNIQUE_ID_PATTERN = /^T\d{4}(\.\d{3})?$/;

export class AttackMappingError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "AttackMappingError";
    this.status = status;
  }
}

export type MappingInput = {
  entityType: MappingEntityType;
  entityId: string;
  techniqueId: string;
  confidence?: number | null;
  source?: string;
  notes?: string | null;
  detectionNotes?: string | null;
  responseNotes?: string | null;
  actorAttribution?: string | null;
};

export type MappingUpdateInput = Partial<
  Pick<
    MappingInput,
    "confidence" | "source" | "notes" | "detectionNotes" | "responseNotes" | "actorAttribution"
  >
>;

export type TechniqueDisplay = {
  techniqueId: string;
  name: string | null;
  tactics: Array<{ id: string; name: string }>;
  deprecated: boolean;
  supersededByTechniqueId: string | null;
};

export type MappingView = AttackTechniqueMapping & { technique: TechniqueDisplay };

function validateConfidence(confidence: number | null | undefined) {
  if (confidence === undefined || confidence === null) return;
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 100) {
    throw new AttackMappingError("Confidence must be between 0 and 100");
  }
}

/**
 * Resolves the case an entity belongs to (for timeline/audit linkage) and
 * verifies the entity exists in the caller's organisation. `alert` has no
 * backing table on `main` yet (issue #55 lands it); rejecting it here keeps
 * the enum forward-compatible without ever skipping the tenant-ownership
 * check for a type we cannot actually verify.
 */
async function resolveEntityCase(
  organisationId: string,
  entityType: MappingEntityType,
  entityId: string,
): Promise<{ caseId: string }> {
  if (entityType === "case") {
    const [row] = await db
      .select({ id: cases.id })
      .from(cases)
      .where(and(eq(cases.id, entityId), eq(cases.organisationId, organisationId)))
      .limit(1);
    if (!row) throw new AttackMappingError("Case not found", 404);
    return { caseId: row.id };
  }
  if (entityType === "observable") {
    const [row] = await db
      .select({ caseId: observables.caseId, organisationId: cases.organisationId })
      .from(observables)
      .innerJoin(cases, eq(cases.id, observables.caseId))
      .where(and(eq(observables.id, entityId), eq(cases.organisationId, organisationId)))
      .limit(1);
    if (!row) throw new AttackMappingError("Observable not found", 404);
    return { caseId: row.caseId };
  }
  if (entityType === "evidence") {
    const [row] = await db
      .select({ caseId: attachments.caseId })
      .from(attachments)
      .where(and(eq(attachments.id, entityId), eq(attachments.organisationId, organisationId)))
      .limit(1);
    if (!row) throw new AttackMappingError("Evidence item not found", 404);
    return { caseId: row.caseId };
  }
  if (entityType === "task") {
    const [row] = await db
      .select({ caseId: caseTasks.caseId, organisationId: cases.organisationId })
      .from(caseTasks)
      .innerJoin(cases, eq(cases.id, caseTasks.caseId))
      .where(and(eq(caseTasks.id, entityId), eq(cases.organisationId, organisationId)))
      .limit(1);
    if (!row) throw new AttackMappingError("Task not found", 404);
    return { caseId: row.caseId };
  }
  throw new AttackMappingError(
    "Alert mappings are not yet supported on this deployment (pending issue #55: normalized alerts)",
    501,
  );
}

async function techniqueDisplaysFor(techniqueIds: string[]): Promise<Map<string, TechniqueDisplay>> {
  const out = new Map<string, TechniqueDisplay>();
  const unique = [...new Set(techniqueIds)];
  if (unique.length === 0) return out;
  const rows = await getTechniquesByIds(unique);
  const byId = new Map(rows.map((r) => [r.techniqueId, r]));
  for (const id of unique) {
    const row = byId.get(id);
    out.set(id, {
      techniqueId: id,
      name: row?.name ?? null,
      tactics: (row?.tactics as Array<{ id: string; name: string }>) ?? [],
      deprecated: row?.deprecated ?? false,
      supersededByTechniqueId: row?.supersededByTechniqueId ?? null,
    });
  }
  return out;
}

async function toMappingView(row: AttackTechniqueMapping): Promise<MappingView> {
  const displays = await techniqueDisplaysFor([row.techniqueId]);
  return {
    ...row,
    technique: displays.get(row.techniqueId) ?? {
      techniqueId: row.techniqueId,
      name: null,
      tactics: [],
      deprecated: false,
      supersededByTechniqueId: null,
    },
  };
}

async function toMappingViews(rows: AttackTechniqueMapping[]): Promise<MappingView[]> {
  const displays = await techniqueDisplaysFor(rows.map((r) => r.techniqueId));
  return rows.map((row) => ({
    ...row,
    technique: displays.get(row.techniqueId) ?? {
      techniqueId: row.techniqueId,
      name: null,
      tactics: [],
      deprecated: false,
      supersededByTechniqueId: null,
    },
  }));
}

export async function attachTechniqueCore(
  organisationId: string,
  actorId: string | null,
  input: MappingInput,
): Promise<MappingView> {
  const techniqueId = input.techniqueId.trim().toUpperCase();
  if (!TECHNIQUE_ID_PATTERN.test(techniqueId)) {
    throw new AttackMappingError("Technique id must look like T1059 or T1059.001");
  }
  if (!MAPPING_ENTITY_TYPES.includes(input.entityType)) {
    throw new AttackMappingError("Unknown entity type");
  }
  validateConfidence(input.confidence);
  const technique = await resolveTechnique(techniqueId);
  if (!technique) throw new AttackMappingError("Unknown ATT&CK technique id", 404);

  const { caseId } = await resolveEntityCase(organisationId, input.entityType, input.entityId);
  const activeVersion = await getActiveCatalogVersion();
  const source = input.source?.trim() || "analyst";

  const id = newId("attackmap");
  const [inserted] = await db
    .insert(attackTechniqueMappings)
    .values({
      id,
      organisationId,
      entityType: input.entityType,
      entityId: input.entityId,
      caseId,
      techniqueId,
      catalogVersionId: activeVersion?.id ?? null,
      confidence: input.confidence ?? null,
      source,
      notes: input.notes?.trim() || null,
      detectionNotes: input.detectionNotes?.trim() || null,
      responseNotes: input.responseNotes?.trim() || null,
      actorAttribution: input.actorAttribution?.trim() || null,
      createdBy: actorId,
    })
    .onConflictDoNothing()
    .returning();
  if (!inserted) {
    throw new AttackMappingError(
      `${techniqueId} is already mapped to this ${input.entityType}`,
      409,
    );
  }

  await writeTimelineEvent({
    caseId,
    actorId,
    eventType: "attack_mapping_changed",
    payload: {
      action: "created",
      mapping_id: id,
      entity_type: input.entityType,
      entity_id: input.entityId,
      technique_id: techniqueId,
      confidence: input.confidence ?? null,
      source,
    },
  });

  return toMappingView(inserted);
}

export async function updateMappingCore(
  organisationId: string,
  actorId: string | null,
  mappingId: string,
  patch: MappingUpdateInput,
): Promise<MappingView> {
  validateConfidence(patch.confidence);
  const [existing] = await db
    .select()
    .from(attackTechniqueMappings)
    .where(
      and(
        eq(attackTechniqueMappings.id, mappingId),
        eq(attackTechniqueMappings.organisationId, organisationId),
      ),
    )
    .limit(1);
  if (!existing) throw new AttackMappingError("Mapping not found", 404);

  const nextValues = {
    confidence: patch.confidence !== undefined ? patch.confidence : existing.confidence,
    source: patch.source !== undefined ? patch.source.trim() || "analyst" : existing.source,
    notes: patch.notes !== undefined ? patch.notes?.trim() || null : existing.notes,
    detectionNotes:
      patch.detectionNotes !== undefined
        ? patch.detectionNotes?.trim() || null
        : existing.detectionNotes,
    responseNotes:
      patch.responseNotes !== undefined
        ? patch.responseNotes?.trim() || null
        : existing.responseNotes,
    actorAttribution:
      patch.actorAttribution !== undefined
        ? patch.actorAttribution?.trim() || null
        : existing.actorAttribution,
  };

  const [updated] = await db
    .update(attackTechniqueMappings)
    .set({ ...nextValues, updatedBy: actorId, updatedAt: new Date() })
    .where(eq(attackTechniqueMappings.id, mappingId))
    .returning();
  if (!updated) throw new AttackMappingError("Mapping not found", 404);

  if (existing.caseId) {
    await writeTimelineEvent({
      caseId: existing.caseId,
      actorId,
      eventType: "attack_mapping_changed",
      payload: {
        action: "updated",
        mapping_id: mappingId,
        entity_type: existing.entityType,
        entity_id: existing.entityId,
        technique_id: existing.techniqueId,
        before: {
          confidence: existing.confidence,
          source: existing.source,
        },
        after: {
          confidence: updated.confidence,
          source: updated.source,
        },
      },
    });
  }

  return toMappingView(updated);
}

export async function removeMappingCore(
  organisationId: string,
  actorId: string | null,
  mappingId: string,
): Promise<void> {
  const [existing] = await db
    .select()
    .from(attackTechniqueMappings)
    .where(
      and(
        eq(attackTechniqueMappings.id, mappingId),
        eq(attackTechniqueMappings.organisationId, organisationId),
      ),
    )
    .limit(1);
  if (!existing) throw new AttackMappingError("Mapping not found", 404);

  await db.delete(attackTechniqueMappings).where(eq(attackTechniqueMappings.id, mappingId));

  if (existing.caseId) {
    await writeTimelineEvent({
      caseId: existing.caseId,
      actorId,
      eventType: "attack_mapping_changed",
      payload: {
        action: "removed",
        mapping_id: mappingId,
        entity_type: existing.entityType,
        entity_id: existing.entityId,
        technique_id: existing.techniqueId,
      },
    });
  }
}

export async function listMappingsForEntity(
  organisationId: string,
  entityType: MappingEntityType,
  entityId: string,
): Promise<MappingView[]> {
  const rows = await db
    .select()
    .from(attackTechniqueMappings)
    .where(
      and(
        eq(attackTechniqueMappings.organisationId, organisationId),
        eq(attackTechniqueMappings.entityType, entityType),
        eq(attackTechniqueMappings.entityId, entityId),
      ),
    )
    .orderBy(desc(attackTechniqueMappings.createdAt));
  return toMappingViews(rows);
}

/** Every mapping touching a case, across all entity types attached to it (the case itself, its observables, evidence, and tasks). */
export async function listMappingsForCase(
  organisationId: string,
  caseId: string,
): Promise<MappingView[]> {
  const rows = await db
    .select()
    .from(attackTechniqueMappings)
    .where(
      and(
        eq(attackTechniqueMappings.organisationId, organisationId),
        eq(attackTechniqueMappings.caseId, caseId),
      ),
    )
    .orderBy(desc(attackTechniqueMappings.createdAt));
  return toMappingViews(rows);
}

export async function listMappingsForCases(
  organisationId: string,
  caseIds: string[],
): Promise<MappingView[]> {
  if (caseIds.length === 0) return [];
  const rows = await db
    .select()
    .from(attackTechniqueMappings)
    .where(
      and(
        eq(attackTechniqueMappings.organisationId, organisationId),
        inArray(attackTechniqueMappings.caseId, caseIds),
      ),
    );
  return toMappingViews(rows);
}

export function tacticsForMapping(view: MappingView): Array<{ id: string; name: string }> {
  if (view.technique.tactics.length > 0) return view.technique.tactics;
  return [];
}

export { findTactic };
