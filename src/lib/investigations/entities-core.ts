/**
 * Entity resolution and deduplication (issue #55). Callers must already have
 * resolved `organisationId`; every function re-verifies that anything it
 * touches belongs to that organisation, following the same pattern as
 * `case-relationships-core` and `lib/evidence/core`.
 *
 * Deduplication is type-aware: two sightings of "the same" user/device/file/
 * etc resolve to one `entities` row because their identifiers normalise to
 * the same `(organisationId, kind, value)` key in `entity_identifiers`. If a
 * caller ever supplies identifiers that already point at two *different*
 * existing entities (e.g. an email and a SID that were previously recorded
 * separately), this resolves to the earliest-created of the two rather than
 * merging them — full entity-merge tooling is out of scope for #55.
 */

import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  entities,
  entityIdentifiers,
  type Entity,
  type EntityIdentifier,
} from "@/db/schema";
import { newId } from "@/lib/utils";

export class EntityError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "EntityError";
    this.status = status;
  }
}

export type EntityIdentifierKind = EntityIdentifier["kind"];
export type EntityType = Entity["type"];

const LOWERCASE_KINDS = new Set<EntityIdentifierKind>([
  "email",
  "upn",
  "hostname",
  "fqdn",
  "sha256",
  "sha1",
  "md5",
  "device_id",
  "aad_object_id",
  "cloud_resource_id",
  "tenant_id",
  "application_id",
  "process_guid",
]);

/** Type-aware normalisation so the same raw value always produces the same canonical key. */
export function canonicalizeIdentifierValue(
  kind: EntityIdentifierKind,
  rawValue: string,
): string {
  const trimmed = rawValue.trim();
  if (kind === "sid") return trimmed.toUpperCase();
  if (kind === "fqdn" || kind === "hostname") {
    return trimmed.toLowerCase().replace(/\.$/, "");
  }
  if (LOWERCASE_KINDS.has(kind)) return trimmed.toLowerCase();
  // ip, url, other: case may be meaningful (URL path), only trim.
  return trimmed;
}

export type EntityIdentifierInput = {
  kind: EntityIdentifierKind;
  value: string;
  source?: string | null;
};

export type ResolveEntityInput = {
  organisationId: string;
  type: EntityType;
  displayName: string;
  identifiers: EntityIdentifierInput[];
  attributes?: Record<string, unknown>;
};

export type ResolveEntityResult = { entity: Entity; created: boolean };

async function findEntitiesForIdentifiers(
  organisationId: string,
  identifiers: Array<{ kind: EntityIdentifierKind; value: string }>,
): Promise<Map<string, string>> {
  const byKey = new Map<string, string>();
  if (identifiers.length === 0) return byKey;
  const rows = await db
    .select({
      kind: entityIdentifiers.kind,
      value: entityIdentifiers.value,
      entityId: entityIdentifiers.entityId,
    })
    .from(entityIdentifiers)
    .where(eq(entityIdentifiers.organisationId, organisationId));
  const wanted = new Set(identifiers.map((i) => `${i.kind}:${i.value}`));
  for (const row of rows) {
    const key = `${row.kind}:${row.value}`;
    if (wanted.has(key)) byKey.set(key, row.entityId);
  }
  return byKey;
}

/**
 * Resolves the entity that a set of identifiers refers to, creating one if
 * none of the identifiers have been seen before. Updates `lastSeenAt` and
 * shallow-merges `attributes` (provider-owned: new keys always win) either
 * way, and records any identifier not previously seen for this entity.
 */
export async function resolveEntityCore(
  input: ResolveEntityInput,
): Promise<ResolveEntityResult> {
  if (input.identifiers.length === 0) {
    throw new EntityError("At least one identifier is required to resolve an entity");
  }
  if (!input.displayName.trim()) {
    throw new EntityError("A display name is required");
  }

  const normalised = input.identifiers.map((i) => ({
    kind: i.kind,
    value: canonicalizeIdentifierValue(i.kind, i.value),
    source: i.source ?? null,
  }));

  const existingByKey = await findEntitiesForIdentifiers(
    input.organisationId,
    normalised,
  );
  const distinctEntityIds = [...new Set(existingByKey.values())].sort();

  let entity: Entity;
  let created = false;

  if (distinctEntityIds.length > 0) {
    const [row] = await db
      .select()
      .from(entities)
      .where(
        and(
          eq(entities.organisationId, input.organisationId),
          eq(entities.id, distinctEntityIds[0]!),
        ),
      )
      .limit(1);
    if (!row) throw new EntityError("Entity not found", 404);
    entity = row;
  } else {
    const primary = normalised[0]!;
    const id = newId("ent");
    const [inserted] = await db
      .insert(entities)
      .values({
        id,
        organisationId: input.organisationId,
        type: input.type,
        displayName: input.displayName.trim(),
        canonicalKey: primary.value,
        attributes: input.attributes ?? {},
      })
      .onConflictDoNothing()
      .returning();
    if (inserted) {
      entity = inserted;
      created = true;
    } else {
      const [existing] = await db
        .select()
        .from(entities)
        .where(
          and(
            eq(entities.organisationId, input.organisationId),
            eq(entities.type, input.type),
            eq(entities.canonicalKey, primary.value),
          ),
        )
        .limit(1);
      if (!existing) throw new EntityError("Entity could not be resolved", 500);
      entity = existing;
    }
  }

  // Record any identifier not already attached to this entity.
  const newIdentifiers = normalised.filter(
    (i) => !existingByKey.has(`${i.kind}:${i.value}`),
  );
  for (const ident of newIdentifiers) {
    await db
      .insert(entityIdentifiers)
      .values({
        id: newId("entid"),
        organisationId: input.organisationId,
        entityId: entity.id,
        kind: ident.kind,
        value: ident.value,
        source: ident.source,
      })
      .onConflictDoNothing();
  }

  const mergedAttributes = {
    ...(entity.attributes as Record<string, unknown>),
    ...(input.attributes ?? {}),
  };
  const [updated] = await db
    .update(entities)
    .set({ lastSeenAt: new Date(), updatedAt: new Date(), attributes: mergedAttributes })
    .where(eq(entities.id, entity.id))
    .returning();

  return { entity: updated ?? entity, created };
}

export async function getEntityInOrg(
  entityId: string,
  organisationId: string,
): Promise<Entity | null> {
  const [row] = await db
    .select()
    .from(entities)
    .where(and(eq(entities.id, entityId), eq(entities.organisationId, organisationId)))
    .limit(1);
  return row ?? null;
}

export async function listIdentifiersForEntity(
  entityId: string,
  organisationId: string,
): Promise<EntityIdentifier[]> {
  return db
    .select()
    .from(entityIdentifiers)
    .where(
      and(
        eq(entityIdentifiers.entityId, entityId),
        eq(entityIdentifiers.organisationId, organisationId),
      ),
    )
    .orderBy(desc(entityIdentifiers.lastSeenAt));
}

export async function listEntitiesByIds(
  entityIds: string[],
  organisationId: string,
): Promise<Entity[]> {
  if (entityIds.length === 0) return [];
  return db
    .select()
    .from(entities)
    .where(
      and(
        eq(entities.organisationId, organisationId),
        inArray(entities.id, entityIds),
      ),
    );
}

/** Analyst-owned free-text notes on an entity. Never touched by provider sync. */
export async function setEntityNotesCore(opts: {
  entityId: string;
  organisationId: string;
  notes: string | null;
}): Promise<Entity> {
  const existing = await getEntityInOrg(opts.entityId, opts.organisationId);
  if (!existing) throw new EntityError("Entity not found", 404);
  const [updated] = await db
    .update(entities)
    .set({ notes: opts.notes?.trim() || null, updatedAt: new Date() })
    .where(eq(entities.id, opts.entityId))
    .returning();
  if (!updated) throw new EntityError("Entity not found", 404);
  return updated;
}
