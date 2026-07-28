/**
 * Integration coverage for ATT&CK catalog versioning against a real Postgres
 * instance (issue #48): bundled-baseline bootstrap, a successful refresh
 * that deprecates a retired technique while carrying it forward, a failed
 * import that rolls back automatically without disturbing the currently
 * active version, and explicit manual rollback. No HTTP server needed —
 * this exercises `catalog-core.ts` directly, same shape as
 * `scripts/test-case-sources.ts`.
 */
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { attackCatalogVersions, attackTechniques } from "../src/db/schema";
import {
  ensureCatalogInitialised,
  getActiveCatalogVersion,
  importCatalogVersion,
  resolveTechnique,
  rollbackCatalogImport,
} from "../src/lib/attack/catalog-core";

async function main() {
  // The ATT&CK catalog is deliberately a single, organisation-independent
  // global singleton (versions are not scoped per org), so this test cannot
  // namespace fixtures the way per-tenant tests do. It resets the catalog
  // tables to empty before running so repeated runs are deterministic; only
  // run this against a throwaway test database, never a database with real
  // catalog/mapping data.
  await db.delete(attackTechniques);
  await db.delete(attackCatalogVersions);

  // ── 1. Bundled baseline bootstraps automatically, idempotently ──────────
  await ensureCatalogInitialised();
  const active1 = await getActiveCatalogVersion();
  assert.ok(active1, "ensureCatalogInitialised must leave an active catalog version");
  assert.equal(active1?.source, "bundled_baseline");

  // Calling it again (and concurrently) must not create a second version.
  await Promise.all([ensureCatalogInitialised(), ensureCatalogInitialised()]);
  const versionsAfterRepeat = await db.select().from(attackCatalogVersions);
  assert.equal(
    versionsAfterRepeat.filter((v) => v.status === "active").length,
    1,
    "exactly one catalog version must be active after repeated/concurrent bootstrap",
  );

  const beforeSecondImport = await getActiveCatalogVersion();
  assert.ok(beforeSecondImport);

  // ── 2. A successful import carries forward a retired technique, marks it deprecated ──
  const testVersion = `attack-test-${Date.now()}`;
  const activated = await importCatalogVersion({
    source: "url_import",
    sourceUrl: "https://example.test/attack-catalog.json",
    catalog: {
      version: testVersion,
      techniques: [
        {
          techniqueId: "T9001",
          name: "Fixture Technique",
          tactics: [{ id: "execution", name: "Execution" }],
        },
        // Re-supplied unchanged so this test can assert it is NOT marked
        // deprecated by the merge, distinguishing "still current" from
        // "dropped by this source" (T1086, which is NOT re-supplied here).
        {
          techniqueId: "T1059",
          name: "Command and Scripting Interpreter",
          tactics: [{ id: "execution", name: "Execution" }],
        },
      ],
    },
  });
  assert.equal(activated.status, "active", "a successful import must activate the new version");
  assert.equal(activated.techniqueCount > 1, true, "the new version must carry forward every technique from the previous active version, not just the new one");

  const previousNowSuperseded = await db
    .select()
    .from(attackCatalogVersions)
    .where(eq(attackCatalogVersions.id, beforeSecondImport!.id))
    .limit(1);
  assert.equal(previousNowSuperseded[0]?.status, "superseded", "the old active version must become superseded, not deleted");

  const retiredResolved = await resolveTechnique("T1086");
  assert.ok(retiredResolved, "a technique dropped from the new source must still resolve (readable on historical cases)");
  assert.equal(retiredResolved?.deprecated, true, "a technique dropped from the new source must be marked deprecated");
  assert.equal(retiredResolved?.catalogVersionId, activated.id, "the carried-forward row must belong to the new (currently active) version, not the old one");

  const stableResolved = await resolveTechnique("T1059");
  assert.ok(stableResolved);
  assert.equal(stableResolved?.deprecated, false, "a technique still present in the new source must not be marked deprecated");

  const newResolved = await resolveTechnique("T9001");
  assert.ok(newResolved, "a brand-new technique id from the source must resolve");
  assert.equal(newResolved?.deprecated, false);

  console.log("catalog versioning + deprecation carry-forward integration test passed");

  // ── 3. Re-importing the same version string is rejected (stable, not duplicated) ──
  await assert.rejects(
    () =>
      importCatalogVersion({
        source: "url_import",
        catalog: { version: testVersion, techniques: [{ techniqueId: "T9002", name: "x", tactics: [] }] },
      }),
    /already been imported/,
    "importing an already-used version string must be rejected, not silently duplicated",
  );

  // ── 4. A malformed import (duplicate technique id within one source) fails safely ──
  const beforeFailure = await getActiveCatalogVersion();
  assert.ok(beforeFailure);
  const failingVersion = `attack-test-fail-${Date.now()}`;
  await assert.rejects(
    () =>
      importCatalogVersion({
        source: "url_import",
        catalog: {
          version: failingVersion,
          techniques: [
            { techniqueId: "T9099", name: "Duplicate A", tactics: [] },
            { techniqueId: "T9099", name: "Duplicate B", tactics: [] },
          ],
        },
      }),
    /Catalog import failed and was rolled back/,
    "a source with a duplicate technique id must violate the (catalogVersionId, techniqueId) unique index and fail",
  );

  const failedRow = await db
    .select()
    .from(attackCatalogVersions)
    .where(eq(attackCatalogVersions.version, failingVersion))
    .limit(1);
  assert.equal(failedRow.length, 1, "a failed import must still leave one inspectable version row");
  assert.equal(failedRow[0]?.status, "failed", "a failed import's version row must be marked failed");
  assert.ok(failedRow[0]?.error && failedRow[0].error.length > 0, "a failed import must record an error message");

  const orphanedTechniqueRows = await db
    .select()
    .from(attackTechniques)
    .where(eq(attackTechniques.catalogVersionId, failedRow[0]!.id));
  assert.equal(orphanedTechniqueRows.length, 0, "a failed import must roll back its technique inserts, leaving zero rows for the failed version");

  const stillActiveAfterFailure = await getActiveCatalogVersion();
  assert.equal(
    stillActiveAfterFailure?.id,
    beforeFailure?.id,
    "a failed import must never change which catalog version is active",
  );
  assert.equal(stillActiveAfterFailure?.status, "active");

  console.log("failed-import safe-rollback integration test passed");

  // ── 5. Explicit manual rollback restores the previous version ───────────
  const currentActive = await getActiveCatalogVersion();
  assert.ok(currentActive);
  const rolledBackTo = await rollbackCatalogImport(currentActive!.id, "Integration test manual rollback");
  assert.equal(rolledBackTo.status, "active");
  const afterManualRollback = await getActiveCatalogVersion();
  assert.equal(afterManualRollback?.id, rolledBackTo.id);

  const rolledBackRow = await db
    .select()
    .from(attackCatalogVersions)
    .where(eq(attackCatalogVersions.id, currentActive!.id))
    .limit(1);
  assert.equal(rolledBackRow[0]?.status, "rolled_back", "the rolled-back version must stay visible in history, not be deleted");

  // Rolling back a non-active version must be rejected.
  await assert.rejects(
    () => rollbackCatalogImport(currentActive!.id, "second attempt"),
    /Only the currently active catalog version can be rolled back/,
  );

  console.log("manual catalog rollback integration test passed");
  console.log("attack catalog import integration tests passed");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
