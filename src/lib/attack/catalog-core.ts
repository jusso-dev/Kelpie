/**
 * Versioned ATT&CK technique catalog: import, activation, and safe rollback.
 * Callers never touch `attackCatalogVersions`/`attackTechniques` directly —
 * everything (bundled baseline bootstrap, an admin-triggered URL refresh run
 * from the BullMQ worker) goes through this module so the "one active
 * version, deprecated techniques stay readable, failed imports never
 * corrupt the live catalog" invariants live in exactly one place.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  attackCatalogVersions,
  attackTechniques,
  type AttackCatalogVersion,
  type AttackTechniqueRow,
} from "@/db/schema";
import { newId } from "@/lib/utils";
import { baselineCatalogSource } from "./baseline-catalog";
import type { CatalogSourceInput, RawAttackTechnique } from "./types";

export class AttackCatalogError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "AttackCatalogError";
    this.status = status;
  }
}

/**
 * Pure merge function (no DB access) — testable in isolation. Combines a
 * freshly-fetched technique set with the previously-active set, carrying
 * forward any technique id present in `previous` but missing from
 * `incoming` as a `deprecated: true` entry (preserving its last-known name
 * and tactics rather than dropping it). A technique id present in both uses
 * the incoming (refreshed) data and is never marked deprecated by this
 * merge, even if the source itself no longer flags it.
 */
export function mergeCatalogTechniques(
  previous: RawAttackTechnique[],
  incoming: RawAttackTechnique[],
): RawAttackTechnique[] {
  const incomingIds = new Set(incoming.map((t) => t.techniqueId));
  const carriedForward = previous
    .filter((t) => !incomingIds.has(t.techniqueId))
    .map((t) => ({ ...t, deprecated: true }));
  return [...incoming, ...carriedForward];
}

/** Pure — distinct tactic ids across a technique set. */
export function countDistinctTactics(techniques: RawAttackTechnique[]): number {
  const ids = new Set<string>();
  for (const t of techniques) {
    for (const tactic of t.tactics) ids.add(tactic.id);
  }
  return ids.size;
}

function toRaw(row: AttackTechniqueRow): RawAttackTechnique {
  return {
    techniqueId: row.techniqueId,
    name: row.name,
    domain: row.domain,
    tactics: (row.tactics as Array<{ id: string; name: string }>) ?? [],
    isSubtechnique: row.isSubtechnique,
    parentTechniqueId: row.parentTechniqueId,
    platforms: (row.platforms as string[]) ?? [],
    dataSources: (row.dataSources as string[]) ?? [],
    description: row.description,
    url: row.url,
    deprecated: row.deprecated,
    revoked: row.revoked,
    supersededByTechniqueId: row.supersededByTechniqueId,
    attackVersion: row.attackVersion,
  };
}

export async function getActiveCatalogVersion(): Promise<AttackCatalogVersion | null> {
  const [row] = await db
    .select()
    .from(attackCatalogVersions)
    .where(eq(attackCatalogVersions.status, "active"))
    .limit(1);
  return row ?? null;
}

export async function listCatalogVersions(): Promise<AttackCatalogVersion[]> {
  return db
    .select()
    .from(attackCatalogVersions)
    .orderBy(desc(attackCatalogVersions.importedAt));
}

/**
 * Imports one catalog snapshot. Always creates a version row first (so a
 * failure is a visible, inspectable `failed` row rather than silently
 * vanishing), then attempts the heavy lift — carry-forward merge, technique
 * insert, activation — inside a transaction. Any failure there rolls the
 * transaction back (no technique rows persist, the previous active version
 * is untouched) and the version row is updated to `failed` with the error
 * message, outside the failed transaction.
 */
export async function importCatalogVersion(input: {
  source: "bundled_baseline" | "url_import";
  sourceUrl?: string | null;
  catalog: CatalogSourceInput;
  actorId?: string | null;
}): Promise<AttackCatalogVersion> {
  const version = input.catalog.version.trim();
  if (!version) throw new AttackCatalogError("A catalog version is required");
  if (input.catalog.techniques.length === 0) {
    throw new AttackCatalogError("Catalog import contained no techniques");
  }
  const existingVersion = await db
    .select({ id: attackCatalogVersions.id })
    .from(attackCatalogVersions)
    .where(eq(attackCatalogVersions.version, version))
    .limit(1);
  if (existingVersion.length > 0) {
    throw new AttackCatalogError(
      `Catalog version "${version}" has already been imported`,
      409,
    );
  }

  const versionId = newId("attackver");
  await db.insert(attackCatalogVersions).values({
    id: versionId,
    version,
    source: input.source,
    sourceUrl: input.sourceUrl ?? null,
    status: "pending",
    importedBy: input.actorId ?? null,
  });

  try {
    const previousActive = await getActiveCatalogVersion();
    const previousTechniqueRows = previousActive
      ? await db
          .select()
          .from(attackTechniques)
          .where(eq(attackTechniques.catalogVersionId, previousActive.id))
      : [];
    const merged = mergeCatalogTechniques(
      previousTechniqueRows.map(toRaw),
      input.catalog.techniques,
    );
    const tacticCount = countDistinctTactics(merged);

    await db.transaction(async (tx) => {
      await tx.insert(attackTechniques).values(
        merged.map((t) => ({
          id: newId("attacktech"),
          catalogVersionId: versionId,
          techniqueId: t.techniqueId,
          name: t.name,
          domain: t.domain ?? "enterprise",
          tactics: t.tactics,
          isSubtechnique: t.isSubtechnique ?? false,
          parentTechniqueId: t.parentTechniqueId ?? null,
          platforms: t.platforms ?? [],
          dataSources: t.dataSources ?? [],
          description: t.description ?? null,
          url: t.url ?? null,
          deprecated: t.deprecated ?? false,
          revoked: t.revoked ?? false,
          supersededByTechniqueId: t.supersededByTechniqueId ?? null,
          attackVersion: t.attackVersion ?? null,
        })),
      );
      if (previousActive) {
        await tx
          .update(attackCatalogVersions)
          .set({ status: "superseded", supersededAt: sql`now()` })
          .where(eq(attackCatalogVersions.id, previousActive.id));
      }
      await tx
        .update(attackCatalogVersions)
        .set({
          status: "active",
          activatedAt: sql`now()`,
          techniqueCount: merged.length,
          tacticCount,
        })
        .where(eq(attackCatalogVersions.id, versionId));
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown import failure";
    await db
      .update(attackCatalogVersions)
      .set({ status: "failed", error: message.slice(0, 2000) })
      .where(eq(attackCatalogVersions.id, versionId));
    throw new AttackCatalogError(`Catalog import failed and was rolled back: ${message}`, 502);
  }

  const [finalRow] = await db
    .select()
    .from(attackCatalogVersions)
    .where(eq(attackCatalogVersions.id, versionId))
    .limit(1);
  if (!finalRow) throw new AttackCatalogError("Catalog version disappeared after import");
  return finalRow;
}

/**
 * Explicit manual rollback of a specific (typically currently-active)
 * catalog version back to whichever version most recently held `superseded`
 * status. Does not delete anything — the bad version is marked
 * `rolled_back` and stays in the audit history.
 *
 * Critically, the version being restored may predate a technique the
 * version being abandoned introduced (e.g. an analyst mapped a case to a
 * technique that only exists starting from the version being rolled back).
 * Without carrying that technique forward into the restored version, it
 * would stop resolving entirely the moment the rollback flips which version
 * is active — worse than the normal deprecation path, since
 * `resolveTechnique`/`getTechniquesByIds` only ever query the currently
 * active version's rows. So, exactly like a normal `importCatalogVersion`
 * carry-forward, any technique id present on the version being rolled back
 * but absent from the version being restored is inserted into the restored
 * version as a `deprecated: true` row before it is reactivated — reusing
 * `mergeCatalogTechniques` rather than a parallel carry-forward path.
 */
export async function rollbackCatalogImport(
  catalogVersionId: string,
  reason: string,
): Promise<AttackCatalogVersion> {
  const trimmedReason = reason.trim();
  if (!trimmedReason) throw new AttackCatalogError("A reason is required to roll back a catalog import");
  const [target] = await db
    .select()
    .from(attackCatalogVersions)
    .where(eq(attackCatalogVersions.id, catalogVersionId))
    .limit(1);
  if (!target) throw new AttackCatalogError("Catalog version not found", 404);
  if (target.status !== "active") {
    throw new AttackCatalogError("Only the currently active catalog version can be rolled back", 409);
  }
  const [previous] = await db
    .select()
    .from(attackCatalogVersions)
    .where(
      and(
        eq(attackCatalogVersions.status, "superseded"),
        sql`${attackCatalogVersions.id} <> ${catalogVersionId}`,
      ),
    )
    .orderBy(desc(attackCatalogVersions.supersededAt))
    .limit(1);
  if (!previous) {
    throw new AttackCatalogError("No previous catalog version is available to roll back to", 409);
  }

  const [targetTechniqueRows, previousTechniqueRows] = await Promise.all([
    db.select().from(attackTechniques).where(eq(attackTechniques.catalogVersionId, target.id)),
    db.select().from(attackTechniques).where(eq(attackTechniques.catalogVersionId, previous.id)),
  ]);
  const previousIds = new Set(previousTechniqueRows.map((t) => t.techniqueId));
  // `mergeCatalogTechniques(previous, incoming)` returns `incoming` plus
  // whichever `previous` entries `incoming` is missing, marked deprecated —
  // here that means "the restored version's own techniques, plus whichever
  // of the abandoned version's techniques it doesn't already have". Only the
  // carried-forward tail is new; the restored version's own rows already
  // exist in the database and must not be re-inserted.
  const merged = mergeCatalogTechniques(targetTechniqueRows.map(toRaw), previousTechniqueRows.map(toRaw));
  const newlyCarriedForward = merged.filter((t) => !previousIds.has(t.techniqueId));
  const tacticCount = countDistinctTactics(merged);

  await db.transaction(async (tx) => {
    if (newlyCarriedForward.length > 0) {
      await tx.insert(attackTechniques).values(
        newlyCarriedForward.map((t) => ({
          id: newId("attacktech"),
          catalogVersionId: previous.id,
          techniqueId: t.techniqueId,
          name: t.name,
          domain: t.domain ?? "enterprise",
          tactics: t.tactics,
          isSubtechnique: t.isSubtechnique ?? false,
          parentTechniqueId: t.parentTechniqueId ?? null,
          platforms: t.platforms ?? [],
          dataSources: t.dataSources ?? [],
          description: t.description ?? null,
          url: t.url ?? null,
          deprecated: true,
          revoked: t.revoked ?? false,
          supersededByTechniqueId: t.supersededByTechniqueId ?? null,
          attackVersion: t.attackVersion ?? null,
        })),
      );
    }
    await tx
      .update(attackCatalogVersions)
      .set({ status: "rolled_back", error: trimmedReason })
      .where(eq(attackCatalogVersions.id, catalogVersionId));
    await tx
      .update(attackCatalogVersions)
      .set({
        status: "active",
        activatedAt: sql`now()`,
        supersededAt: null,
        techniqueCount: merged.length,
        tacticCount,
      })
      .where(eq(attackCatalogVersions.id, previous.id));
  });
  const [restored] = await db
    .select()
    .from(attackCatalogVersions)
    .where(eq(attackCatalogVersions.id, previous.id))
    .limit(1);
  if (!restored) throw new AttackCatalogError("Catalog version disappeared after rollback");
  return restored;
}

let ensureInitPromise: Promise<void> | null = null;

/**
 * Lazily bootstraps the bundled baseline catalog on first use (fresh
 * install / test run with no network access). Safe to call repeatedly and
 * concurrently — the unique `version` index means a race just hits the
 * `409 already imported` branch, which this function treats as success.
 */
export async function ensureCatalogInitialised(): Promise<void> {
  if (ensureInitPromise) return ensureInitPromise;
  ensureInitPromise = (async () => {
    const active = await getActiveCatalogVersion();
    if (active) return;
    try {
      await importCatalogVersion({
        source: "bundled_baseline",
        catalog: baselineCatalogSource(),
      });
    } catch (error) {
      if (error instanceof AttackCatalogError && error.status === 409) return;
      throw error;
    }
  })();
  try {
    await ensureInitPromise;
  } finally {
    ensureInitPromise = null;
  }
}

export async function resolveTechnique(techniqueId: string): Promise<AttackTechniqueRow | null> {
  await ensureCatalogInitialised();
  const active = await getActiveCatalogVersion();
  if (!active) return null;
  const [row] = await db
    .select()
    .from(attackTechniques)
    .where(
      and(
        eq(attackTechniques.catalogVersionId, active.id),
        eq(attackTechniques.techniqueId, techniqueId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Batch lookup of specific technique ids in the active catalog version, regardless of the 200-row cap `searchTechniques` applies for browse/search UI. */
export async function getTechniquesByIds(
  techniqueIds: string[],
): Promise<AttackTechniqueRow[]> {
  const unique = [...new Set(techniqueIds)];
  if (unique.length === 0) return [];
  await ensureCatalogInitialised();
  const active = await getActiveCatalogVersion();
  if (!active) return [];
  return db
    .select()
    .from(attackTechniques)
    .where(
      and(
        eq(attackTechniques.catalogVersionId, active.id),
        inArray(attackTechniques.techniqueId, unique),
      ),
    );
}

export async function searchTechniques(params: {
  query?: string;
  tactic?: string;
  includeDeprecated?: boolean;
  limit?: number;
}): Promise<AttackTechniqueRow[]> {
  await ensureCatalogInitialised();
  const active = await getActiveCatalogVersion();
  if (!active) return [];
  const filters = [eq(attackTechniques.catalogVersionId, active.id)];
  if (!params.includeDeprecated) {
    filters.push(eq(attackTechniques.deprecated, false));
  }
  if (params.tactic) {
    filters.push(
      sql`EXISTS (SELECT 1 FROM jsonb_array_elements(${attackTechniques.tactics}) elem WHERE elem->>'id' = ${params.tactic})`,
    );
  }
  if (params.query?.trim()) {
    const q = `%${params.query.trim().toLowerCase()}%`;
    filters.push(
      sql`(lower(${attackTechniques.techniqueId}) like ${q} or lower(${attackTechniques.name}) like ${q})`,
    );
  }
  return db
    .select()
    .from(attackTechniques)
    .where(and(...filters))
    .orderBy(attackTechniques.techniqueId)
    .limit(Math.min(params.limit ?? 50, 200));
}
