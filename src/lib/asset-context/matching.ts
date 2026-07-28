/**
 * Type-aware, organisation-scoped entity matching for asset/identity context.
 * Ambiguous matches (2+ candidates) never auto-link — they enter review.
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  entities,
  entityIdentifiers,
  type Entity,
  type EntityIdentifier,
} from "@/db/schema";
import { canonicalizeIdentifierValue } from "@/lib/investigations/entities-core";
import type { AssetContextKind } from "./types";

export type MatchDecision =
  | { outcome: "none"; candidates: [] }
  | { outcome: "exact"; entity: Entity; candidates: [Entity] }
  | { outcome: "ambiguous"; candidates: Entity[]; reason: string };

/** Entity types a context kind is allowed to link to. */
export function allowedEntityTypes(kind: AssetContextKind): Entity["type"][] {
  switch (kind) {
    case "identity":
      return ["user_identity"];
    case "asset":
      return ["device_endpoint", "asset", "ip", "network"];
    case "application":
      return ["application", "cloud_resource"];
    case "business_service":
      return ["application", "asset", "cloud_resource"];
    default:
      return [];
  }
}

/**
 * Find entities in this organisation whose identifiers match the given
 * kind+value, restricted to entity types compatible with the context kind.
 */
export async function matchEntitiesForContext(input: {
  organisationId: string;
  contextKind: AssetContextKind;
  identifierKind: EntityIdentifier["kind"];
  identifierValue: string;
}): Promise<MatchDecision> {
  const value = canonicalizeIdentifierValue(
    input.identifierKind,
    input.identifierValue,
  );
  const allowed = allowedEntityTypes(input.contextKind);

  const identifierRows = await db
    .select({
      entityId: entityIdentifiers.entityId,
    })
    .from(entityIdentifiers)
    .where(
      and(
        eq(entityIdentifiers.organisationId, input.organisationId),
        eq(entityIdentifiers.kind, input.identifierKind),
        eq(entityIdentifiers.value, value),
      ),
    );

  if (identifierRows.length === 0) {
    return { outcome: "none", candidates: [] };
  }

  const entityIds = [...new Set(identifierRows.map((r) => r.entityId))];
  const rows = await db
    .select()
    .from(entities)
    .where(eq(entities.organisationId, input.organisationId));

  const candidates = rows.filter(
    (e) => entityIds.includes(e.id) && allowed.includes(e.type),
  );

  if (candidates.length === 0) {
    return { outcome: "none", candidates: [] };
  }
  if (candidates.length === 1) {
    return {
      outcome: "exact",
      entity: candidates[0]!,
      candidates: [candidates[0]!],
    };
  }
  return {
    outcome: "ambiguous",
    candidates,
    reason: `${candidates.length} entities share identifier ${input.identifierKind}=${value} for kind ${input.contextKind}`,
  };
}
