/**
 * Pure unit coverage for alert correlation scoring (issue #56). No DB.
 */
import assert from "node:assert/strict";
import {
  DEFAULT_CORRELATION_CONFIG,
  scoreAlertPair,
  suggestKindForPair,
  suggestionFingerprint,
  type AlertScoringInput,
} from "../src/lib/correlation/scoring";
import {
  DEFAULT_CORRELATION_POLICY,
  parseCorrelationPolicy,
  correlationPolicyPatch,
} from "../src/lib/correlation/policy";

function alert(partial: Partial<AlertScoringInput> & { id: string }): AlertScoringInput {
  return {
    title: partial.title ?? partial.id,
    tenantId: partial.tenantId ?? "",
    externalId: partial.externalId ?? partial.id,
    sourceId: partial.sourceId ?? "src1",
    detectionProduct: partial.detectionProduct ?? null,
    detectionSource: partial.detectionSource ?? null,
    detectedAt: partial.detectedAt ?? new Date("2026-01-01T00:00:00Z"),
    entityIds: partial.entityIds ?? [],
    observableValues: partial.observableValues ?? [],
    attackTechniqueIds: partial.attackTechniqueIds ?? [],
    caseIds: partial.caseIds ?? [],
    id: partial.id,
  };
}

// Shared entity → high score
{
  const a = alert({ id: "a1", entityIds: ["e1", "e2"] });
  const b = alert({ id: "a2", entityIds: ["e1"] });
  const scored = scoreAlertPair(a, b, DEFAULT_CORRELATION_CONFIG);
  assert.ok(scored.score >= 50, `expected strong entity score, got ${scored.score}`);
  assert.deepEqual(scored.matchedSignals.sharedEntityIds, ["e1"]);
  assert.ok(scored.explanation.includes("shared entit"));
  console.log("ok: shared entity raises score and explanation");
}

// Same provider incident id → near-certain
{
  const a = alert({ id: "a1", sourceId: "src", externalId: "INC-9" });
  const b = alert({ id: "a2", sourceId: "src", externalId: "INC-9" });
  const scored = scoreAlertPair(a, b);
  assert.ok(scored.score >= 95);
  assert.equal(scored.matchedSignals.sameProviderIncidentId, true);
  console.log("ok: same provider incident id scores near-certain");
}

// requireSameTenant zeros cross-tenant
{
  const a = alert({ id: "a1", tenantId: "t1", entityIds: ["e1"] });
  const b = alert({ id: "a2", tenantId: "t2", entityIds: ["e1"] });
  const scored = scoreAlertPair(a, b, {
    ...DEFAULT_CORRELATION_CONFIG,
    requireSameTenant: true,
  });
  assert.equal(scored.score, 0);
  console.log("ok: requireSameTenant blocks cross-tenant pairs");
}

// ATT&CK + product + window
{
  const t0 = new Date("2026-01-01T12:00:00Z");
  const t1 = new Date("2026-01-01T12:30:00Z");
  const a = alert({
    id: "a1",
    detectionProduct: "Defender",
    attackTechniqueIds: ["T1059.001"],
    detectedAt: t0,
  });
  const b = alert({
    id: "a2",
    detectionProduct: "defender",
    attackTechniqueIds: ["T1059.001", "T1003"],
    detectedAt: t1,
  });
  const scored = scoreAlertPair(a, b);
  assert.equal(scored.matchedSignals.sameDetectionProduct, true);
  assert.equal(scored.matchedSignals.withinTimeWindow, true);
  assert.ok(scored.matchedSignals.sharedAttackTechniques.includes("t1059.001"));
  assert.ok(scored.score > 0);
  console.log("ok: product, time window, and ATT&CK contribute");
}

// suggest kind
{
  assert.equal(
    suggestKindForPair(alert({ id: "a" }), alert({ id: "b" })),
    "group_alerts",
  );
  assert.equal(
    suggestKindForPair(alert({ id: "a", caseIds: ["c1"] }), alert({ id: "b" })),
    "attach_to_case",
  );
  assert.equal(
    suggestKindForPair(
      alert({ id: "a", caseIds: ["c1"] }),
      alert({ id: "b", caseIds: ["c2"] }),
    ),
    "merge_cases",
  );
  assert.equal(
    suggestKindForPair(
      alert({ id: "a", caseIds: ["c1"] }),
      alert({ id: "b", caseIds: ["c1"] }),
    ),
    null,
  );
  console.log("ok: suggestion kind from membership");
}

// fingerprint stable
{
  const fp1 = suggestionFingerprint("merge_cases", ["b", "a"], ["c2", "c1"], "rule");
  const fp2 = suggestionFingerprint("merge_cases", ["a", "b"], ["c1", "c2"], "rule");
  assert.equal(fp1, fp2);
  console.log("ok: fingerprint is order-independent");
}

// policy defaults and parse
{
  assert.equal(DEFAULT_CORRELATION_POLICY.autoMergeEnabled, false);
  const parsed = parseCorrelationPolicy({
    correlation: {
      autoMergeEnabled: true,
      autoAcceptThreshold: 90,
      mergeSafetyWindowHours: 12,
    },
  });
  assert.equal(parsed.autoMergeEnabled, true);
  assert.equal(parsed.autoAcceptThreshold, 90);
  assert.equal(parsed.mergeSafetyWindowHours, 12);
  const patched = correlationPolicyPatch({}, { autoMergeEnabled: true });
  assert.equal(
    (patched.correlation as { autoMergeEnabled: boolean }).autoMergeEnabled,
    true,
  );
  console.log("ok: policy defaults off and parses explicitly");
}

console.log("all correlation scoring tests passed");
