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
  alerts,
  attackTechniqueMappings,
  attachments,
  caseAlerts,
  caseTasks,
  cases,
  observables,
  type AttackTechniqueMapping,
} from "@/db/schema";
import { newId } from "@/lib/utils";
import { writeTimelineEvent } from "@/lib/timeline";
import { recordAuditEvent } from "@/lib/audit/events";
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
 * Resolves the case an entity belongs to (for timeline/audit linkage, best
 * effort for `alert`) and verifies the entity exists in the caller's
 * organisation — same ownership-check shape for every branch: select scoped
 * by `(id, organisationId)`, throw 404 if nothing matches.
 *
 * `alert` is the one branch that can legitimately return a null `caseId`:
 * an alert is linked to cases many-to-many via `case_alerts` (issue #55) and
 * can exist before it is linked to any case at all. When it is linked to
 * more than one, the row marked `isPrimary` is preferred, otherwise the most
 * recently linked case; a mapping on an unlinked alert still succeeds, it
 * just has no case to attach a timeline entry to (the org audit trail still
 * records it — see the `caseId` null-checks at each call site).
 */
async function resolveEntityCase(
  organisationId: string,
  entityType: MappingEntityType,
  entityId: string,
): Promise<{ caseId: string | null }> {
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
  // entityType === "alert"
  const [alertRow] = await db
    .select({ id: alerts.id })
    .from(alerts)
    .where(and(eq(alerts.id, entityId), eq(alerts.organisationId, organisationId)))
    .limit(1);
  if (!alertRow) throw new AttackMappingError("Alert not found", 404);
  const [link] = await db
    .select({ caseId: caseAlerts.caseId })
    .from(caseAlerts)
    .where(and(eq(caseAlerts.alertId, entityId), eq(caseAlerts.organisationId, organisationId)))
    .orderBy(desc(caseAlerts.isPrimary), desc(caseAlerts.createdAt))
    .limit(1);
  return { caseId: link?.caseId ?? null };
}

/** Records the org-wide audit trail entry directly for a mapping change with no linked case (only possible for an unlinked `alert`); every other entity type always has a case and goes through `writeTimelineEvent` instead, which records both the case timeline and this same audit trail in one call. */
async function recordMappingAuditWithoutCase(opts: {
  organisationId: string;
  actorId: string | null;
  action: string;
  mappingId: string;
  metadata: Record<string, unknown>;
}) {
  await recordAuditEvent({
    organisationId: opts.organisationId,
    actorId: opts.actorId,
    actorType: opts.actorId ? "user" : "system",
    action: `attack_mapping.${opts.action}`,
    targetType: "attack_mapping",
    targetId: opts.mappingId,
    metadata: opts.metadata,
  });
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

  const auditPayload = {
    action: "created",
    mapping_id: id,
    entity_type: input.entityType,
    entity_id: input.entityId,
    technique_id: techniqueId,
    confidence: input.confidence ?? null,
    source,
  };
  if (caseId) {
    await writeTimelineEvent({
      caseId,
      actorId,
      eventType: "attack_mapping_changed",
      payload: auditPayload,
    });
  } else {
    await recordMappingAuditWithoutCase({
      organisationId,
      actorId,
      action: "created",
      mappingId: id,
      metadata: auditPayload,
    });
  }

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

  const updatePayload = {
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
  };
  if (existing.caseId) {
    await writeTimelineEvent({
      caseId: existing.caseId,
      actorId,
      eventType: "attack_mapping_changed",
      payload: updatePayload,
    });
  } else {
    await recordMappingAuditWithoutCase({
      organisationId,
      actorId,
      action: "updated",
      mappingId,
      metadata: updatePayload,
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

  const removePayload = {
    action: "removed",
    mapping_id: mappingId,
    entity_type: existing.entityType,
    entity_id: existing.entityId,
    technique_id: existing.techniqueId,
  };
  if (existing.caseId) {
    await writeTimelineEvent({
      caseId: existing.caseId,
      actorId,
      eventType: "attack_mapping_changed",
      payload: removePayload,
    });
  } else {
    await recordMappingAuditWithoutCase({
      organisationId,
      actorId,
      action: "removed",
      mappingId,
      metadata: removePayload,
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

/** Every mapping touching a case, across all entity types attached to it (the case itself, its linked alerts, observables, evidence, and tasks). */
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
