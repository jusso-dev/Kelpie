/**
 * Asset/identity context CRUD, analyst overrides, and entity-link resolution
 * (issue #59). Every function takes organisationId and re-checks ownership.
 */

import { and, desc, eq, inArray, notInArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  assetIdentityContexts,
  entities,
  entityContextMatchReviews,
  type AssetIdentityContext,
  type EntityContextMatchReview,
  type EntityIdentifier,
} from "@/db/schema";
import { canonicalizeIdentifierValue } from "@/lib/investigations/entities-core";
import { newId } from "@/lib/utils";
import { matchEntitiesForContext } from "./matching";
import { effectiveContextFields, isContextStale } from "./effective";
import {
  ASSET_CONTEXT_KINDS,
  AssetContextError,
  CRITICALITY_LEVELS,
  ENVIRONMENT_KINDS,
  EXPOSURE_LEVELS,
  PRIVILEGE_LEVELS,
  RECOVERY_PRIORITIES,
  type AssetContextKind,
  type ContextImportSource,
  type CriticalityLevel,
  type EnvironmentKind,
  type ExposureLevel,
  type PrivilegeLevel,
  type RecoveryPriority,
} from "./types";

export type ProviderContextFields = {
  criticality?: CriticalityLevel;
  privilegeLevel?: PrivilegeLevel;
  exposure?: ExposureLevel;
  environment?: EnvironmentKind;
  isCrownJewel?: boolean;
  recoveryPriority?: RecoveryPriority;
  ownerTeam?: string | null;
  ownerEmail?: string | null;
  businessService?: string | null;
  applicationName?: string | null;
  dataClassifications?: string[];
  regulatoryScope?: string[];
  attributes?: Record<string, unknown>;
};

export type UpsertContextInput = {
  organisationId: string;
  kind: AssetContextKind;
  displayName: string;
  primaryIdentifierKind: EntityIdentifier["kind"];
  primaryIdentifierValue: string;
  providerSource?: ContextImportSource;
  providerExternalId?: string | null;
  /** When true, skip entity auto-link (still records review on ambiguity if matching runs). */
  skipMatching?: boolean;
  actorId?: string | null;
  markSyncOk?: boolean;
} & ProviderContextFields;

export type AnalystOverrideInput = {
  criticalityOverride?: CriticalityLevel | null;
  privilegeLevelOverride?: PrivilegeLevel | null;
  exposureOverride?: ExposureLevel | null;
  isCrownJewelOverride?: boolean | null;
  recoveryPriorityOverride?: RecoveryPriority | null;
};

function assertKind(kind: string): asserts kind is AssetContextKind {
  if (!(ASSET_CONTEXT_KINDS as readonly string[]).includes(kind)) {
    throw new AssetContextError(`Unknown context kind: ${kind}`);
  }
}

function assertEnum<T extends string>(
  value: string | undefined | null,
  allowed: readonly T[],
  label: string,
): T | undefined {
  if (value == null || value === "") return undefined;
  if (!(allowed as readonly string[]).includes(value)) {
    throw new AssetContextError(`Invalid ${label}: ${value}`);
  }
  return value as T;
}

/**
 * Upsert a context record from a provider/import/REST source.
 * Only provider-owned columns are written — analyst override columns are
 * never touched here.
 */
export async function upsertContextFromProvider(
  input: UpsertContextInput,
): Promise<{ context: AssetIdentityContext; created: boolean; matchReviewId: string | null }> {
  assertKind(input.kind);
  if (!input.displayName.trim()) {
    throw new AssetContextError("displayName is required");
  }
  const identValue = canonicalizeIdentifierValue(
    input.primaryIdentifierKind,
    input.primaryIdentifierValue,
  );
  if (!identValue) {
    throw new AssetContextError("primaryIdentifierValue is required");
  }

  const criticality =
    assertEnum(input.criticality, CRITICALITY_LEVELS, "criticality") ?? "medium";
  const privilegeLevel =
    assertEnum(input.privilegeLevel, PRIVILEGE_LEVELS, "privilegeLevel") ??
    "none";
  const exposure =
    assertEnum(input.exposure, EXPOSURE_LEVELS, "exposure") ?? "internal";
  const environment =
    assertEnum(input.environment, ENVIRONMENT_KINDS, "environment") ??
    "unknown";
  const recoveryPriority =
    assertEnum(
      input.recoveryPriority,
      RECOVERY_PRIORITIES,
      "recoveryPriority",
    ) ?? "none";

  const providerSource = input.providerSource ?? "manual";
  const now = new Date();

  // Prefer provider external id match, then identifier unique key.
  let existing: AssetIdentityContext | null = null;
  if (input.providerExternalId) {
    const [byExt] = await db
      .select()
      .from(assetIdentityContexts)
      .where(
        and(
          eq(assetIdentityContexts.organisationId, input.organisationId),
          eq(assetIdentityContexts.providerSource, providerSource),
          eq(assetIdentityContexts.providerExternalId, input.providerExternalId),
        ),
      )
      .limit(1);
    existing = byExt ?? null;
  }
  if (!existing) {
    const [byIdent] = await db
      .select()
      .from(assetIdentityContexts)
      .where(
        and(
          eq(assetIdentityContexts.organisationId, input.organisationId),
          eq(assetIdentityContexts.kind, input.kind),
          eq(assetIdentityContexts.primaryIdentifierKind, input.primaryIdentifierKind),
          eq(assetIdentityContexts.primaryIdentifierValue, identValue),
        ),
      )
      .limit(1);
    existing = byIdent ?? null;
  }

  const providerFields = {
    displayName: input.displayName.trim(),
    criticality,
    privilegeLevel,
    exposure,
    environment,
    isCrownJewel: Boolean(input.isCrownJewel),
    recoveryPriority,
    ownerTeam: input.ownerTeam?.trim() || null,
    ownerEmail: input.ownerEmail?.trim().toLowerCase() || null,
    businessService: input.businessService?.trim() || null,
    applicationName: input.applicationName?.trim() || null,
    dataClassifications: input.dataClassifications ?? [],
    regulatoryScope: input.regulatoryScope ?? [],
    attributes: {
      ...((existing?.attributes as Record<string, unknown>) ?? {}),
      ...(input.attributes ?? {}),
    },
    providerSource,
    providerExternalId: input.providerExternalId ?? existing?.providerExternalId ?? null,
    providerUpdatedAt: now,
    lastSyncAt: input.markSyncOk === false ? existing?.lastSyncAt ?? null : now,
    lastSyncStatus:
      input.markSyncOk === false
        ? existing?.lastSyncStatus ?? "never_synced"
        : ("ok" as const),
    lastSyncError: input.markSyncOk === false ? existing?.lastSyncError ?? null : null,
    updatedBy: input.actorId ?? null,
    updatedAt: now,
    primaryIdentifierKind: input.primaryIdentifierKind,
    primaryIdentifierValue: identValue,
    kind: input.kind,
  };

  let context: AssetIdentityContext;
  let created = false;

  if (existing) {
    const [updated] = await db
      .update(assetIdentityContexts)
      .set(providerFields)
      .where(
        and(
          eq(assetIdentityContexts.id, existing.id),
          eq(assetIdentityContexts.organisationId, input.organisationId),
        ),
      )
      .returning();
    context = updated!;
  } else {
    const id = newId("actx");
    const [inserted] = await db
      .insert(assetIdentityContexts)
      .values({
        id,
        organisationId: input.organisationId,
        entityId: null,
        createdBy: input.actorId ?? null,
        ...providerFields,
      })
      .returning();
    context = inserted!;
    created = true;
  }

  let matchReviewId: string | null = null;
  if (!input.skipMatching && !context.entityId) {
    const match = await matchEntitiesForContext({
      organisationId: input.organisationId,
      contextKind: input.kind,
      identifierKind: input.primaryIdentifierKind,
      identifierValue: identValue,
    });
    if (match.outcome === "exact") {
      const [linked] = await db
        .update(assetIdentityContexts)
        .set({ entityId: match.entity.id, updatedAt: now })
        .where(eq(assetIdentityContexts.id, context.id))
        .returning();
      context = linked ?? context;
    } else if (match.outcome === "ambiguous") {
      const [review] = await db
        .insert(entityContextMatchReviews)
        .values({
          id: newId("mrev"),
          organisationId: input.organisationId,
          contextId: context.id,
          status: "pending",
          candidateEntityIds: match.candidates.map((c) => c.id),
          matchReason: match.reason,
        })
        .returning();
      matchReviewId = review?.id ?? null;
    }
  }

  return { context, created, matchReviewId };
}

export async function getContextInOrg(
  contextId: string,
  organisationId: string,
): Promise<AssetIdentityContext | null> {
  const [row] = await db
    .select()
    .from(assetIdentityContexts)
    .where(
      and(
        eq(assetIdentityContexts.id, contextId),
        eq(assetIdentityContexts.organisationId, organisationId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function listContextsCore(
  organisationId: string,
  opts: {
    kind?: AssetContextKind;
    criticalOnly?: boolean;
    crownJewelOnly?: boolean;
    limit?: number;
    entityId?: string;
  } = {},
): Promise<AssetIdentityContext[]> {
  const conditions = [eq(assetIdentityContexts.organisationId, organisationId)];
  if (opts.kind) conditions.push(eq(assetIdentityContexts.kind, opts.kind));
  if (opts.entityId) {
    conditions.push(eq(assetIdentityContexts.entityId, opts.entityId));
  }
  if (opts.crownJewelOnly) {
    conditions.push(
      or(
        eq(assetIdentityContexts.isCrownJewel, true),
        eq(assetIdentityContexts.isCrownJewelOverride, true),
      )!,
    );
  }
  if (opts.criticalOnly) {
    conditions.push(
      or(
        eq(assetIdentityContexts.criticality, "critical"),
        eq(assetIdentityContexts.criticalityOverride, "critical"),
        eq(assetIdentityContexts.isCrownJewel, true),
        eq(assetIdentityContexts.isCrownJewelOverride, true),
      )!,
    );
  }

  return db
    .select()
    .from(assetIdentityContexts)
    .where(and(...conditions))
    .orderBy(desc(assetIdentityContexts.updatedAt))
    .limit(Math.min(opts.limit ?? 100, 500));
}

/**
 * Analyst override write path. Pass `null` on an override field to clear it
 * (revert to provider value). Omitted fields are left unchanged.
 */
export async function setAnalystOverridesCore(
  organisationId: string,
  contextId: string,
  overrides: AnalystOverrideInput,
  actorId: string | null,
): Promise<AssetIdentityContext> {
  const existing = await getContextInOrg(contextId, organisationId);
  if (!existing) throw new AssetContextError("Context not found", 404);

  const patch: Partial<AssetIdentityContext> = {
    updatedAt: new Date(),
    updatedBy: actorId,
  };

  if ("criticalityOverride" in overrides) {
    patch.criticalityOverride =
      overrides.criticalityOverride === null
        ? null
        : assertEnum(
            overrides.criticalityOverride ?? undefined,
            CRITICALITY_LEVELS,
            "criticalityOverride",
          ) ?? null;
  }
  if ("privilegeLevelOverride" in overrides) {
    patch.privilegeLevelOverride =
      overrides.privilegeLevelOverride === null
        ? null
        : assertEnum(
            overrides.privilegeLevelOverride ?? undefined,
            PRIVILEGE_LEVELS,
            "privilegeLevelOverride",
          ) ?? null;
  }
  if ("exposureOverride" in overrides) {
    patch.exposureOverride =
      overrides.exposureOverride === null
        ? null
        : assertEnum(
            overrides.exposureOverride ?? undefined,
            EXPOSURE_LEVELS,
            "exposureOverride",
          ) ?? null;
  }
  if ("isCrownJewelOverride" in overrides) {
    patch.isCrownJewelOverride =
      overrides.isCrownJewelOverride === null
        ? null
        : overrides.isCrownJewelOverride;
  }
  if ("recoveryPriorityOverride" in overrides) {
    patch.recoveryPriorityOverride =
      overrides.recoveryPriorityOverride === null
        ? null
        : assertEnum(
            overrides.recoveryPriorityOverride ?? undefined,
            RECOVERY_PRIORITIES,
            "recoveryPriorityOverride",
          ) ?? null;
  }

  const [updated] = await db
    .update(assetIdentityContexts)
    .set(patch)
    .where(
      and(
        eq(assetIdentityContexts.id, contextId),
        eq(assetIdentityContexts.organisationId, organisationId),
      ),
    )
    .returning();
  return updated!;
}

export async function linkContextToEntityCore(
  organisationId: string,
  contextId: string,
  entityId: string,
  actorId: string | null,
): Promise<AssetIdentityContext> {
  const existing = await getContextInOrg(contextId, organisationId);
  if (!existing) throw new AssetContextError("Context not found", 404);

  const [entity] = await db
    .select({ id: entities.id })
    .from(entities)
    .where(
      and(eq(entities.id, entityId), eq(entities.organisationId, organisationId)),
    )
    .limit(1);
  if (!entity) throw new AssetContextError("Entity not found", 404);

  const [updated] = await db
    .update(assetIdentityContexts)
    .set({
      entityId,
      updatedAt: new Date(),
      updatedBy: actorId,
    })
    .where(
      and(
        eq(assetIdentityContexts.id, contextId),
        eq(assetIdentityContexts.organisationId, organisationId),
      ),
    )
    .returning();

  // Close any pending reviews for this context.
  await db
    .update(entityContextMatchReviews)
    .set({
      status: "linked",
      resolvedEntityId: entityId,
      resolvedBy: actorId,
      resolvedAt: new Date(),
    })
    .where(
      and(
        eq(entityContextMatchReviews.contextId, contextId),
        eq(entityContextMatchReviews.organisationId, organisationId),
        eq(entityContextMatchReviews.status, "pending"),
      ),
    );

  return updated!;
}

export async function resolveMatchReviewCore(
  organisationId: string,
  reviewId: string,
  decision: { action: "link"; entityId: string } | { action: "dismiss" },
  actorId: string | null,
): Promise<EntityContextMatchReview> {
  const [review] = await db
    .select()
    .from(entityContextMatchReviews)
    .where(
      and(
        eq(entityContextMatchReviews.id, reviewId),
        eq(entityContextMatchReviews.organisationId, organisationId),
      ),
    )
    .limit(1);
  if (!review) throw new AssetContextError("Match review not found", 404);
  if (review.status !== "pending") {
    throw new AssetContextError("Match review is already resolved");
  }

  if (decision.action === "link") {
    const candidates = Array.isArray(review.candidateEntityIds)
      ? (review.candidateEntityIds as string[])
      : [];
    if (!candidates.includes(decision.entityId)) {
      throw new AssetContextError(
        "Chosen entity is not a candidate for this review",
      );
    }
    await linkContextToEntityCore(
      organisationId,
      review.contextId,
      decision.entityId,
      actorId,
    );
    const [updated] = await db
      .select()
      .from(entityContextMatchReviews)
      .where(eq(entityContextMatchReviews.id, reviewId))
      .limit(1);
    return updated!;
  }

  const [dismissed] = await db
    .update(entityContextMatchReviews)
    .set({
      status: "dismissed",
      resolvedBy: actorId,
      resolvedAt: new Date(),
    })
    .where(eq(entityContextMatchReviews.id, reviewId))
    .returning();
  return dismissed!;
}

export async function listPendingMatchReviews(
  organisationId: string,
): Promise<EntityContextMatchReview[]> {
  return db
    .select()
    .from(entityContextMatchReviews)
    .where(
      and(
        eq(entityContextMatchReviews.organisationId, organisationId),
        eq(entityContextMatchReviews.status, "pending"),
      ),
    )
    .orderBy(desc(entityContextMatchReviews.createdAt));
}

export async function listContextsForEntityIds(
  organisationId: string,
  entityIds: string[],
): Promise<AssetIdentityContext[]> {
  if (entityIds.length === 0) return [];
  return db
    .select()
    .from(assetIdentityContexts)
    .where(
      and(
        eq(assetIdentityContexts.organisationId, organisationId),
        inArray(assetIdentityContexts.entityId, entityIds),
      ),
    );
}

export function serialiseContext(
  row: AssetIdentityContext,
  opts: {
    staleAfterHours?: number;
    now?: Date;
    /** When true, omit owner email, identifiers, attributes, sync errors. */
    redacted?: boolean;
  } = {},
) {
  const effective = effectiveContextFields(row);
  const now = opts.now ?? new Date();
  const stale = isContextStale(row, now, opts.staleAfterHours);
  if (opts.redacted) {
    return {
      id: row.id,
      organisationId: row.organisationId,
      kind: row.kind,
      entityId: row.entityId,
      displayName: row.displayName,
      criticality: row.criticality,
      privilegeLevel: row.privilegeLevel,
      exposure: row.exposure,
      environment: row.environment,
      isCrownJewel: row.isCrownJewel,
      recoveryPriority: row.recoveryPriority,
      lastSyncStatus: row.lastSyncStatus,
      lastSyncAt: row.lastSyncAt,
      effective,
      isStale: stale,
    };
  }
  // Explicit allowlist — never spread the full row (avoids accidental leaks).
  return {
    id: row.id,
    organisationId: row.organisationId,
    kind: row.kind,
    entityId: row.entityId,
    displayName: row.displayName,
    primaryIdentifierKind: row.primaryIdentifierKind,
    primaryIdentifierValue: row.primaryIdentifierValue,
    ownerEmail: row.ownerEmail,
    ownerTeam: row.ownerTeam,
    businessService: row.businessService,
    applicationName: row.applicationName,
    criticality: row.criticality,
    privilegeLevel: row.privilegeLevel,
    exposure: row.exposure,
    environment: row.environment,
    isCrownJewel: row.isCrownJewel,
    recoveryPriority: row.recoveryPriority,
    dataClassifications: row.dataClassifications,
    regulatoryScope: row.regulatoryScope,
    attributes: row.attributes,
    criticalityOverride: row.criticalityOverride,
    privilegeLevelOverride: row.privilegeLevelOverride,
    exposureOverride: row.exposureOverride,
    isCrownJewelOverride: row.isCrownJewelOverride,
    recoveryPriorityOverride: row.recoveryPriorityOverride,
    providerSource: row.providerSource,
    providerExternalId: row.providerExternalId,
    providerUpdatedAt: row.providerUpdatedAt,
    lastSyncAt: row.lastSyncAt,
    lastSyncStatus: row.lastSyncStatus,
    lastSyncError: row.lastSyncError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    effective,
    isStale: stale,
  };
}

export async function markContextSyncFailed(
  organisationId: string,
  contextId: string,
  error: string,
): Promise<void> {
  await db
    .update(assetIdentityContexts)
    .set({
      lastSyncStatus: "failed",
      lastSyncError: error.slice(0, 2000),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(assetIdentityContexts.id, contextId),
        eq(assetIdentityContexts.organisationId, organisationId),
      ),
    );
}

/** Mark contexts not seen in this sync as stale (org+source scoped). */
export async function markMissingContextsStale(
  organisationId: string,
  providerSource: ContextImportSource,
  seenExternalIds: string[],
): Promise<number> {
  if (seenExternalIds.length === 0) return 0;
  const result = await db
    .update(assetIdentityContexts)
    .set({
      lastSyncStatus: "stale",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(assetIdentityContexts.organisationId, organisationId),
        eq(assetIdentityContexts.providerSource, providerSource),
        sql`${assetIdentityContexts.providerExternalId} is not null`,
        notInArray(assetIdentityContexts.providerExternalId, seenExternalIds),
      ),
    )
    .returning({ id: assetIdentityContexts.id });
  return result.length;
}

