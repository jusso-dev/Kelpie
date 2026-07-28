/**
 * Pure-logic unit tests for explainable case priority scoring (issue #59).
 * No database required.
 */
import assert from "node:assert/strict";
import {
  attackStageScoreFromTactics,
  calculatePriorityScore,
  normaliseWeights,
} from "../src/lib/asset-context/scoring";
import {
  applyStalePolicy,
  criticalityScore,
  effectiveContextFields,
  isContextStale,
  privilegeScore,
} from "../src/lib/asset-context/effective";
import {
  DEFAULT_PRIORITY_WEIGHTS,
  PRIORITY_CALCULATION_VERSION,
  type CaseScoringInput,
} from "../src/lib/asset-context/types";
import { parseContextCsv } from "../src/lib/asset-context/import-core";
import {
  mapDefenderDevices,
  mapEntraUsers,
} from "../src/lib/asset-context/providers";

function baseInput(overrides: Partial<CaseScoringInput> = {}): CaseScoringInput {
  return {
    sourceSeverity: "medium",
    contexts: [],
    affectedEntityCount: 0,
    attackStageScore: null,
    tiConfidence: null,
    relatedOpenCaseCount: 0,
    slaPressureScore: 0,
    ...overrides,
  };
}

// ── Scoring exposes factors, weights, version ──────────────────────────────
{
  const result = calculatePriorityScore(
    baseInput({
      sourceSeverity: "critical",
      contexts: [
        {
          kind: "asset",
          criticality: "critical",
          privilegeLevel: "none",
          exposure: "internet_facing",
          isCrownJewel: true,
          isStale: false,
        },
      ],
      affectedEntityCount: 4,
      attackStageScore: 85,
      tiConfidence: 90,
      relatedOpenCaseCount: 2,
      slaPressureScore: 100,
    }),
  );

  assert.equal(result.calculationVersion, PRIORITY_CALCULATION_VERSION);
  assert.ok(result.factors.length >= 9, "all weight factors present");
  for (const f of result.factors) {
    assert.ok(typeof f.id === "string");
    assert.ok(typeof f.label === "string");
    assert.ok(typeof f.weight === "number");
    assert.ok(typeof f.normalisedScore === "number");
    assert.ok(typeof f.contribution === "number");
    assert.ok(typeof f.detail === "string");
  }
  assert.deepEqual(result.weightsUsed, DEFAULT_PRIORITY_WEIGHTS);
  assert.ok(result.calculatedScore >= 0 && result.calculatedScore <= 100);
  assert.ok(result.hasCriticalContext);
  assert.ok(result.hasCrownJewelContext);
  assert.ok(["low", "medium", "high", "critical"].includes(result.scoreBand));
  console.log("ok: score exposes factors, weights, calculation version");
}

// ── Crown jewel / high criticality lifts score vs low asset ────────────────
{
  const low = calculatePriorityScore(
    baseInput({
      sourceSeverity: "low",
      contexts: [
        {
          kind: "asset",
          criticality: "low",
          privilegeLevel: "none",
          exposure: "internal",
          isCrownJewel: false,
          isStale: false,
        },
      ],
    }),
  );
  const high = calculatePriorityScore(
    baseInput({
      sourceSeverity: "low",
      contexts: [
        {
          kind: "asset",
          criticality: "critical",
          privilegeLevel: "none",
          exposure: "public",
          isCrownJewel: true,
          isStale: false,
        },
      ],
    }),
  );
  assert.ok(
    high.calculatedScore > low.calculatedScore,
    `crown jewel (${high.calculatedScore}) must rank above low asset (${low.calculatedScore})`,
  );
  console.log("ok: critical/crown-jewel context raises priority above low asset");
}

// ── Identity privilege factor ──────────────────────────────────────────────
{
  const standard = calculatePriorityScore(
    baseInput({
      contexts: [
        {
          kind: "identity",
          criticality: "medium",
          privilegeLevel: "standard",
          exposure: "internal",
          isCrownJewel: false,
          isStale: false,
        },
      ],
    }),
  );
  const domainAdmin = calculatePriorityScore(
    baseInput({
      contexts: [
        {
          kind: "identity",
          criticality: "medium",
          privilegeLevel: "domain_admin",
          exposure: "internal",
          isCrownJewel: false,
          isStale: false,
        },
      ],
    }),
  );
  const privFactor = (r: typeof standard) =>
    r.factors.find((f) => f.id === "identityPrivilege")!.normalisedScore;
  assert.ok(privFactor(domainAdmin) > privFactor(standard));
  console.log("ok: domain_admin privilege scores higher than standard");
}

// ── Stale context policy: discount / exclude / include ─────────────────────
{
  const staleCtx = {
    kind: "asset" as const,
    criticality: "critical" as const,
    privilegeLevel: "none" as const,
    exposure: "internet_facing" as const,
    isCrownJewel: true,
    isStale: true,
  };
  const fresh = calculatePriorityScore(baseInput({ contexts: [{ ...staleCtx, isStale: false }] }), null, "discount");
  const discounted = calculatePriorityScore(baseInput({ contexts: [staleCtx] }), null, "discount");
  const excluded = calculatePriorityScore(baseInput({ contexts: [staleCtx] }), null, "exclude");
  const included = calculatePriorityScore(baseInput({ contexts: [staleCtx] }), null, "include");

  const assetFactor = (r: typeof fresh) =>
    r.factors.find((f) => f.id === "assetCriticality")!;

  assert.ok(assetFactor(discounted).normalisedScore < assetFactor(fresh).normalisedScore);
  assert.ok(assetFactor(discounted).staleDiscountApplied);
  assert.equal(assetFactor(excluded).normalisedScore, 0);
  assert.equal(assetFactor(included).normalisedScore, assetFactor(fresh).normalisedScore);
  assert.ok(discounted.hasStaleContext);
  console.log("ok: stale context policy discount/exclude/include");
}

// ── applyStalePolicy helper ────────────────────────────────────────────────
{
  assert.deepEqual(applyStalePolicy(80, false, "discount"), {
    score: 80,
    discounted: false,
    excluded: false,
  });
  assert.deepEqual(applyStalePolicy(80, true, "discount"), {
    score: 40,
    discounted: true,
    excluded: false,
  });
  assert.deepEqual(applyStalePolicy(80, true, "exclude"), {
    score: 0,
    discounted: false,
    excluded: true,
  });
  console.log("ok: applyStalePolicy helper");
}

// ── Weight bounds ──────────────────────────────────────────────────────────
{
  const bad = normaliseWeights({
    sourceSeverity: 1,
    assetCriticality: 1,
    identityPrivilege: 1,
    affectedEntityCount: 1,
    attackStage: 1,
    tiConfidence: 1,
    externalExposure: 1,
    relatedCases: 1,
    slaState: 1,
  });
  assert.equal(bad.ok, false);
  const ok = normaliseWeights({ sourceSeverity: 0.5 });
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.weights.sourceSeverity, 0.5);
    assert.equal(ok.weights.assetCriticality, DEFAULT_PRIORITY_WEIGHTS.assetCriticality);
  }
  console.log("ok: weight normalisation bounds");
}

// ── Analyst effective fields prefer overrides ──────────────────────────────
{
  const eff = effectiveContextFields({
    criticality: "low",
    criticalityOverride: "critical",
    privilegeLevel: "standard",
    privilegeLevelOverride: "domain_admin",
    exposure: "internal",
    exposureOverride: null,
    isCrownJewel: false,
    isCrownJewelOverride: true,
    recoveryPriority: "none",
    recoveryPriorityOverride: "p1",
  });
  assert.equal(eff.criticality, "critical");
  assert.equal(eff.privilegeLevel, "domain_admin");
  assert.equal(eff.exposure, "internal");
  assert.equal(eff.isCrownJewel, true);
  assert.equal(eff.recoveryPriority, "p1");
  assert.equal(eff.criticalityIsOverride, true);
  assert.equal(eff.exposureIsOverride, false);
  console.log("ok: effective fields prefer analyst overrides");
}

// ── Staleness clock ────────────────────────────────────────────────────────
{
  const now = new Date("2026-07-28T12:00:00Z");
  const fresh = isContextStale(
    { lastSyncAt: new Date("2026-07-28T10:00:00Z"), lastSyncStatus: "ok" },
    now,
    24,
  );
  const old = isContextStale(
    { lastSyncAt: new Date("2026-07-01T10:00:00Z"), lastSyncStatus: "ok" },
    now,
    24,
  );
  const failed = isContextStale(
    { lastSyncAt: new Date("2026-07-28T11:00:00Z"), lastSyncStatus: "failed" },
    now,
    24,
  );
  assert.equal(fresh, false);
  assert.equal(old, true);
  assert.equal(failed, true);
  console.log("ok: staleness detection");
}

// ── ATT&CK stage mapping ───────────────────────────────────────────────────
{
  assert.equal(attackStageScoreFromTactics([]), null);
  assert.ok((attackStageScoreFromTactics(["exfiltration"]) ?? 0) >
    (attackStageScoreFromTactics(["initial-access"]) ?? 0));
  console.log("ok: ATT&CK stage scoring");
}

// ── Score helpers ──────────────────────────────────────────────────────────
{
  assert.ok(criticalityScore("critical", true) > criticalityScore("low", false));
  assert.ok(privilegeScore("domain_admin") > privilegeScore("standard"));
  console.log("ok: criticality/privilege helpers");
}

// ── CSV dry-run parsing ────────────────────────────────────────────────────
{
  const good = parseContextCsv(
    `kind,display_name,identifier_kind,identifier_value,criticality,privilege_level,is_crown_jewel
asset,DB Primary,hostname,db-primary.corp,critical,none,true
identity,Admin User,upn,admin@corp.example,high,domain_admin,true
`,
    "org_test",
  );
  assert.equal(good.errors.length, 0);
  assert.equal(good.rows.length, 2);
  assert.equal(good.rows[0]!.isCrownJewel, true);
  assert.equal(good.rows[1]!.privilegeLevel, "domain_admin");

  const bad = parseContextCsv(
    `kind,display_name,identifier_kind,identifier_value
not_a_kind,x,hostname,y
asset,,hostname,z
asset,ok,hostname,
`,
    "org_test",
  );
  assert.ok(bad.errors.length >= 3);
  console.log("ok: CSV parse validates rows with dry-run errors");
}

// ── Provider adapters ──────────────────────────────────────────────────────
{
  const entra = mapEntraUsers("org_x", [
    {
      id: "aad-1",
      displayName: "Domain Admin",
      userPrincipalName: "da@corp.example",
      jobTitle: "Domain Administrator",
    },
  ]);
  assert.equal(entra.length, 1);
  assert.equal(entra[0]!.kind, "identity");
  assert.equal(entra[0]!.providerSource, "entra");
  assert.equal(entra[0]!.privilegeLevel, "domain_admin");

  const devices = mapDefenderDevices("org_x", [
    {
      id: "def-1",
      deviceName: "WKSTN-01",
      riskScore: "high",
      exposureLevel: "high",
    },
  ]);
  assert.equal(devices[0]!.kind, "asset");
  assert.equal(devices[0]!.primaryIdentifierKind, "hostname");
  assert.equal(devices[0]!.criticality, "high");
  assert.equal(devices[0]!.exposure, "internet_facing");
  console.log("ok: Entra and Defender provider adapters");
}

console.log("\nAll asset-context scoring unit tests passed.");
