/**
 * BullMQ-driven catalog refresh. Two entry points: refreshing from the
 * bundled offline baseline (used for the automatic bootstrap and available
 * as a manual "restore the shipped baseline" action), and refreshing from an
 * administrator-configured URL. Both funnel into `importCatalogVersion`,
 * which does the actual versioning/rollback work.
 */
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { attackCatalogVersions } from "@/db/schema";
import { safeFetch } from "@/lib/outbound-request";
import { BASELINE_CATALOG_VERSION, baselineCatalogSource } from "./baseline-catalog";
import { AttackCatalogError, importCatalogVersion } from "./catalog-core";
import type { CatalogSourceInput } from "./types";

const rawTechniqueSchema = z.object({
  techniqueId: z.string().trim().min(1).max(32),
  name: z.string().trim().min(1).max(256),
  domain: z.enum(["enterprise", "mobile", "ics"]).optional(),
  tactics: z
    .array(z.object({ id: z.string().trim().min(1).max(64), name: z.string().trim().min(1).max(128) }))
    .default([]),
  isSubtechnique: z.boolean().optional(),
  parentTechniqueId: z.string().trim().min(1).max(32).nullable().optional(),
  platforms: z.array(z.string()).optional(),
  dataSources: z.array(z.string()).optional(),
  description: z.string().max(10_000).nullable().optional(),
  url: z.string().url().max(2048).nullable().optional(),
  deprecated: z.boolean().optional(),
  revoked: z.boolean().optional(),
  supersededByTechniqueId: z.string().trim().min(1).max(32).nullable().optional(),
  attackVersion: z.string().max(32).nullable().optional(),
});

/** The contract a `url_import` catalog source must return. */
const catalogSourceSchema = z.object({
  version: z.string().trim().min(1).max(64),
  techniques: z.array(rawTechniqueSchema).min(1),
});

export async function fetchCatalogFromUrl(url: string): Promise<CatalogSourceInput> {
  const res = await safeFetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new AttackCatalogError(`Catalog source HTTP ${res.status}`, 502);
  const body = await res.json().catch(() => {
    throw new AttackCatalogError("Catalog source did not return valid JSON");
  });
  const parsed = catalogSourceSchema.safeParse(body);
  if (!parsed.success) {
    throw new AttackCatalogError(
      `Catalog source payload failed validation: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
    );
  }
  return parsed.data;
}

export async function refreshAttackCatalogFromBundled(actorId?: string | null) {
  // First import uses the stable baseline version string. Subsequent restores
  // (admin "restore shipped baseline" after a URL import, or a second click)
  // stamp a unique version so the unique(version) constraint does not 409
  // while content still comes from the same offline bundle.
  const base = baselineCatalogSource();
  const existing = await db
    .select({ id: attackCatalogVersions.id })
    .from(attackCatalogVersions)
    .where(eq(attackCatalogVersions.version, BASELINE_CATALOG_VERSION))
    .limit(1);
  const catalog =
    existing.length === 0
      ? base
      : {
          ...base,
          version: `${BASELINE_CATALOG_VERSION}+restore-${Date.now()}`,
        };
  return importCatalogVersion({
    source: "bundled_baseline",
    catalog,
    actorId,
  });
}

export async function refreshAttackCatalogFromUrl(url: string, actorId?: string | null) {
  const catalog = await fetchCatalogFromUrl(url);
  return importCatalogVersion({
    source: "url_import",
    sourceUrl: url,
    catalog,
    actorId,
  });
}
