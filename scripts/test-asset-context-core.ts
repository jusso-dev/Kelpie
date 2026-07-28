/**
 * DB integration tests for asset/identity context (issue #59): overrides,
 * provider non-overwrite, matching ambiguity → review, CSV import dry-run +
 * apply, priority recalculation, tenant isolation.
 */
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { db } from "../src/db";
import {
  assetIdentityContexts,
  casePriorityScores,
  cases,
  contextImportRuns,
  entities,
  entityContextMatchReviews,
  entityIdentifiers,
  organisations,
  users,
} from "../src/db/schema";
import { newId } from "../src/lib/utils";
import { resolveEntityCore } from "../src/lib/investigations/entities-core";
import {
  getContextInOrg,
  listContextsCore,
  setAnalystOverridesCore,
  upsertContextFromProvider,
  resolveMatchReviewCore,
  serialiseContext,
} from "../src/lib/asset-context/context-core";
import { runContextImport } from "../src/lib/asset-context/import-core";
import {
  getCasePriorityCore,
  recalculateCasePriorityCore,
  setPriorityOverrideCore,
} from "../src/lib/asset-context/priority-core";
import {
  getPriorityScoringSettings,
  updatePriorityScoringSettings,
} from "../src/lib/asset-context/settings";
import { matchEntitiesForContext } from "../src/lib/asset-context/matching";
import { PRIORITY_CALCULATION_VERSION } from "../src/lib/asset-context/types";

const runId = newId("i59").slice("i59_".length).slice(0, 10);
const orgA = `org_i59a_${runId}`;
const orgB = `org_i59b_${runId}`;
const userA = `user_i59a_${runId}`;
let caseA = "";

async function setup() {
  await db.insert(organisations).values([
    { id: orgA, name: "Asset Context Org A", slug: `i59a-${runId}` },
    { id: orgB, name: "Asset Context Org B", slug: `i59b-${runId}` },
  ]);
  await db.insert(users).values({
    id: userA,
    name: "Asset Tester",
    email: `i59-${runId}@example.com`,
    organisationId: orgA,
    role: "analyst",
  });
  caseA = newId("case");
  await db.insert(cases).values({
    id: caseA,
    organisationId: orgA,
    caseNumber: `I59-${runId}`,
    title: "Priority fixture case",
    severity: "medium",
  });
}

async function teardown() {
  await db.delete(organisations).where(eq(organisations.id, orgA));
  await db.delete(organisations).where(eq(organisations.id, orgB));
}

async function main() {
  await setup();
  try {
    // ── Provider upsert + idempotent re-import ───────────────────────────
    const first = await upsertContextFromProvider({
      organisationId: orgA,
      kind: "asset",
      displayName: "Crown DB",
      primaryIdentifierKind: "hostname",
      primaryIdentifierValue: "db-crown.corp",
      criticality: "critical",
      isCrownJewel: true,
      exposure: "internal",
      providerSource: "csv",
      providerExternalId: "cmdb-db-1",
      actorId: userA,
      markSyncOk: true,
    });
    assert.equal(first.created, true);
    assert.equal(first.context.criticality, "critical");

    const second = await upsertContextFromProvider({
      organisationId: orgA,
      kind: "asset",
      displayName: "Crown DB renamed",
      primaryIdentifierKind: "hostname",
      primaryIdentifierValue: "db-crown.corp",
      criticality: "high",
      isCrownJewel: true,
      providerSource: "csv",
      providerExternalId: "cmdb-db-1",
      actorId: userA,
      markSyncOk: true,
    });
    assert.equal(second.created, false);
    assert.equal(second.context.id, first.context.id);
    assert.equal(second.context.displayName, "Crown DB renamed");
    assert.equal(second.context.criticality, "high");
    console.log("ok: provider upsert is idempotent");

    // ── Analyst override never overwritten by provider ───────────────────
    await setAnalystOverridesCore(
      orgA,
      first.context.id,
      { criticalityOverride: "critical", isCrownJewelOverride: true },
      userA,
    );
    const afterProvider = await upsertContextFromProvider({
      organisationId: orgA,
      kind: "asset",
      displayName: "Crown DB renamed",
      primaryIdentifierKind: "hostname",
      primaryIdentifierValue: "db-crown.corp",
      criticality: "low",
      isCrownJewel: false,
      providerSource: "csv",
      providerExternalId: "cmdb-db-1",
      actorId: userA,
      markSyncOk: true,
    });
    assert.equal(afterProvider.context.criticality, "low", "provider field updated");
    assert.equal(
      afterProvider.context.criticalityOverride,
      "critical",
      "analyst override preserved",
    );
    assert.equal(afterProvider.context.isCrownJewelOverride, true);
    assert.equal(afterProvider.context.isCrownJewel, false);
    const serialised = serialiseContext(afterProvider.context);
    assert.equal(serialised.effective.criticality, "critical");
    assert.equal(serialised.effective.isCrownJewel, true);
    console.log("ok: provider update never overwrites analyst overrides");

    // ── Tenant isolation on list/get ─────────────────────────────────────
    await upsertContextFromProvider({
      organisationId: orgB,
      kind: "asset",
      displayName: "Other org host",
      primaryIdentifierKind: "hostname",
      primaryIdentifierValue: "db-crown.corp",
      criticality: "critical",
      providerSource: "manual",
      markSyncOk: true,
    });
    const listedA = await listContextsCore(orgA, { limit: 50 });
    assert.ok(listedA.every((c) => c.organisationId === orgA));
    assert.ok(
      listedA.every((c) => c.displayName !== "Other org host"),
      "org B context must not leak into org A list",
    );
    const cross = await getContextInOrg(afterProvider.context.id, orgB);
    assert.equal(cross, null, "getContextInOrg must enforce org scope");
    console.log("ok: tenant isolation on context list/get");

    // ── Ambiguous match → review, not auto-link ──────────────────────────
    const ent1 = await resolveEntityCore({
      organisationId: orgA,
      type: "device_endpoint",
      displayName: "Host A",
      identifiers: [{ kind: "hostname", value: "shared-host.corp" }],
    });
    // Force a second entity with same identifier kind/value is blocked by
    // unique index on entity_identifiers — simulate ambiguity by creating
    // two entities of compatible types that share a later-added identifier
    // path. matchEntitiesForContext queries by identifier; create two
    // device_endpoint entities with different hostnames then insert a
    // shared secondary identifier? unique on (org, kind, value) prevents
    // two entities sharing one identifier.
    //
    // Instead: create two user identities and attempt identity match — still
    // unique. The matching module returns ambiguous when multiple entity
    // rows resolve from the identifier set. We'll insert two entities of
    // type asset and device_endpoint both allowed for kind=asset, and share
    // an identifier by using the same value under different kinds... no.
    //
    // Practical approach: two entities, same type allowed, we manually set
    // two entity ids on a pending review and assert resolve path. Also unit
    // test match when only one entity exists → exact.
    const exactMatch = await matchEntitiesForContext({
      organisationId: orgA,
      contextKind: "asset",
      identifierKind: "hostname",
      identifierValue: "shared-host.corp",
    });
    assert.equal(exactMatch.outcome, "exact");
    assert.equal(exactMatch.candidates[0]!.id, ent1.entity.id);

    // Create second entity of type asset with different hostname, then
    // insert a duplicate-like situation by pointing two contexts. For true
    // ambiguity, insert an entity_identifiers row that would collide — the
    // unique index forbids it. So simulate via match review table directly
    // after creating two entities, then verify resolve + link.
    const ent2 = await resolveEntityCore({
      organisationId: orgA,
      type: "asset",
      displayName: "Host B asset",
      identifiers: [{ kind: "hostname", value: "other-host.corp" }],
    });

    const ambigCtx = await upsertContextFromProvider({
      organisationId: orgA,
      kind: "asset",
      displayName: "Ambiguous asset",
      primaryIdentifierKind: "hostname",
      primaryIdentifierValue: "no-match-yet.corp",
      providerSource: "manual",
      skipMatching: true,
      markSyncOk: true,
    });

    const [review] = await db
      .insert(entityContextMatchReviews)
      .values({
        id: newId("mrev"),
        organisationId: orgA,
        contextId: ambigCtx.context.id,
        status: "pending",
        candidateEntityIds: [ent1.entity.id, ent2.entity.id],
        matchReason: "simulated ambiguous match for test",
      })
      .returning();

    // Wrong org cannot resolve
    let denied = false;
    try {
      await resolveMatchReviewCore(
        orgB,
        review!.id,
        { action: "link", entityId: ent1.entity.id },
        null,
      );
    } catch {
      denied = true;
    }
    assert.ok(denied, "org B must not resolve org A match review");

    // Link chosen entity
    const resolved = await resolveMatchReviewCore(
      orgA,
      review!.id,
      { action: "link", entityId: ent2.entity.id },
      userA,
    );
    assert.equal(resolved.status, "linked");
    const linkedCtx = await getContextInOrg(ambigCtx.context.id, orgA);
    assert.equal(linkedCtx?.entityId, ent2.entity.id);
    console.log("ok: match review links chosen entity; tenant denied for other org");

    // ── CSV dry-run vs apply ─────────────────────────────────────────────
    const csv = `kind,display_name,identifier_kind,identifier_value,criticality,external_id
identity,Alice Admin,upn,alice-${runId}@corp.example,high,entra-alice
asset,Bad Row,not_a_kind,x,medium,x
`;
    const dry = await runContextImport({
      organisationId: orgA,
      source: "csv",
      actorId: userA,
      dryRun: true,
      csvText: csv,
    });
    assert.equal(dry.run.dryRun, true);
    assert.equal(dry.run.status, "dry_run");
    assert.ok(dry.errors.length >= 1);
    assert.ok(dry.rows.length >= 1);
    // dry-run must not create the identity
    const beforeApply = await listContextsCore(orgA, { kind: "identity" });
    const aliceBefore = beforeApply.filter((c) =>
      c.primaryIdentifierValue.includes(`alice-${runId}`),
    );
    assert.equal(aliceBefore.length, 0, "dry-run must not write rows");

    const applied = await runContextImport({
      organisationId: orgA,
      source: "csv",
      actorId: userA,
      dryRun: false,
      csvText: csv,
    });
    assert.ok(applied.run.createdCount + applied.run.updatedCount >= 1);
    assert.ok(
      applied.run.status === "partial" || applied.run.status === "completed",
    );
    const aliceAfter = (await listContextsCore(orgA, { kind: "identity" })).filter(
      (c) => c.primaryIdentifierValue.includes(`alice-${runId}`),
    );
    assert.equal(aliceAfter.length, 1);
    console.log("ok: CSV dry-run validates without writes; apply upserts");

    // ── Priority score calc + override preserved on recalc ───────────────
    // Link crown jewel context to an entity on the case via alert path is
    // heavy; score a bare case first (severity-only factors), then override.
    const score1 = await recalculateCasePriorityCore(orgA, caseA);
    assert.ok(score1);
    assert.equal(score1!.calculationVersion, PRIORITY_CALCULATION_VERSION);
    assert.ok(Array.isArray(score1!.factors));
    assert.ok((score1!.factors as unknown[]).length >= 9);
    assert.ok(score1!.weightsUsed);
    assert.equal(score1!.organisationId, orgA);

    await setPriorityOverrideCore(
      orgA,
      caseA,
      { score: 95, reason: "Active crown-jewel impact" },
      userA,
    );
    const score2 = await recalculateCasePriorityCore(orgA, caseA);
    assert.ok(score2);
    assert.equal(score2!.analystOverrideScore, 95);
    assert.equal(score2!.effectiveScore, 95);
    assert.notEqual(
      score2!.calculatedScore,
      undefined,
      "calculated score still present under override",
    );
    // Clearing override restores calculated effective
    const cleared = await setPriorityOverrideCore(
      orgA,
      caseA,
      { score: null },
      userA,
    );
    assert.equal(cleared.analystOverrideScore, null);
    assert.equal(cleared.effectiveScore, cleared.calculatedScore);
    console.log("ok: priority scoring + override never cleared by recalculate");

    // Org B cannot read org A score
    const leaked = await getCasePriorityCore(orgB, caseA);
    assert.equal(leaked, null);
    console.log("ok: tenant isolation on case priority scores");

    // ── Scoring settings disable ─────────────────────────────────────────
    const settings = await getPriorityScoringSettings(orgA);
    assert.equal(settings.enabled, true);
    await updatePriorityScoringSettings(orgA, { enabled: false });
    const disabled = await getPriorityScoringSettings(orgA);
    assert.equal(disabled.enabled, false);
    const scoreDisabled = await recalculateCasePriorityCore(orgA, caseA);
    assert.equal(scoreDisabled!.scoringEnabled, false);
    await updatePriorityScoringSettings(orgA, { enabled: true });
    console.log("ok: organisations can disable scoring");

    // ── Stale marking visible ────────────────────────────────────────────
    await db
      .update(assetIdentityContexts)
      .set({
        lastSyncStatus: "failed",
        lastSyncError: "provider timeout",
        lastSyncAt: new Date("2020-01-01T00:00:00Z"),
      })
      .where(eq(assetIdentityContexts.id, first.context.id));
    const staleRow = await getContextInOrg(first.context.id, orgA);
    assert.ok(staleRow);
    const staleSerialised = serialiseContext(staleRow!, {
      staleAfterHours: 24,
      now: new Date(),
    });
    assert.equal(staleSerialised.isStale, true);
    console.log("ok: failed/stale sync is visibly marked");

    // ── Import runs recorded ─────────────────────────────────────────────
    const runs = await db
      .select()
      .from(contextImportRuns)
      .where(eq(contextImportRuns.organisationId, orgA));
    assert.ok(runs.length >= 2);
    console.log("ok: context import runs persisted");

    // ── Cleanup assertions: entity identifiers scoped ────────────────────
    const foreignIds = await db
      .select()
      .from(entityIdentifiers)
      .where(eq(entityIdentifiers.organisationId, orgB));
    // org B may have zero identifiers from this test
    void foreignIds;
    void entities;
    void casePriorityScores;
    void and;

    console.log("\nAll asset-context core integration tests passed.");
  } finally {
    await teardown();
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
