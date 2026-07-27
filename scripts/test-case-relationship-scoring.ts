import assert from "node:assert/strict";
import {
  diceCoefficient,
  normalizeObservableValue,
  scoreCaseRelationship,
  SUGGESTION_SCORE_THRESHOLD,
  type ScoringCaseInput,
} from "../src/lib/case-relationships-scoring";

function caseInput(overrides: Partial<ScoringCaseInput> = {}): ScoringCaseInput {
  return {
    title: "Suspicious PowerShell execution on WKSTN-01",
    summary: "Encoded command detected by EDR",
    tags: ["endpoint", "powershell"],
    observableValues: ["203.0.113.9", "evil.example.test"],
    vendorSlugs: ["microsoft"],
    ...overrides,
  };
}

// ── diceCoefficient ─────────────────────────────────────────────────────────

// Identical titles score exactly 1.0 similarity.
assert.equal(
  diceCoefficient(
    "Suspicious PowerShell execution on WKSTN-01",
    "Suspicious PowerShell execution on WKSTN-01",
  ),
  1,
);

// Completely different titles score low (character-bigram overlap on short strings
// is never exactly 0 for unrelated English text — common letter pairs like "on"/"in"
// still coincide by chance — so assert "low", not "zero").
const dissimilar = diceCoefficient(
  "Suspicious PowerShell execution on WKSTN-01",
  "Quarterly vendor invoice reconciliation report",
);
assert.ok(dissimilar < 0.35, `expected low similarity for unrelated titles, got ${dissimilar}`);

// Reordered-word titles still score reasonably high (robust to phrasing/word order).
const reordered = diceCoefficient(
  "Phishing email targeting finance team",
  "Finance team targeted by phishing email",
);
assert.ok(reordered > 0.5, `expected reasonably high similarity for reordered words, got ${reordered}`);

// Empty strings never crash and never produce NaN.
assert.equal(diceCoefficient("", ""), 0);
assert.equal(diceCoefficient("Some title", ""), 0);
assert.equal(diceCoefficient("", "Some title"), 0);
assert.equal(Number.isNaN(diceCoefficient("", "")), false);

// ── normalizeObservableValue ────────────────────────────────────────────────

assert.equal(normalizeObservableValue("EVIL.EXAMPLE.TEST"), "evil.example.test");
assert.equal(normalizeObservableValue("evil.example.test."), "evil.example.test");
assert.equal(normalizeObservableValue("  Evil.Example.Test.  "), "evil.example.test");
// Only a single trailing dot is stripped, not repeated ones.
assert.equal(normalizeObservableValue("evil.example.test.."), "evil.example.test.");
assert.equal(normalizeObservableValue("203.0.113.9"), "203.0.113.9");

// ── scoreCaseRelationship ────────────────────────────────────────────────────

// Empty observables/tags/vendors on either side contribute 0, not NaN and not a crash.
{
  const a = caseInput({ observableValues: [], tags: [], vendorSlugs: [] });
  const b = caseInput({ observableValues: [], tags: [], vendorSlugs: [] });
  const result = scoreCaseRelationship(a, b);
  assert.equal(Number.isNaN(result.score), false);
  assert.deepEqual(result.matchedSignals.sharedObservables, []);
  assert.deepEqual(result.matchedSignals.sharedTags, []);
  assert.deepEqual(result.matchedSignals.sharedVendors, []);
  // Titles are identical in this fixture, so title contribution alone still applies.
  assert.ok(result.score > 0, "identical titles must still contribute score even with empty other signals");
}

{
  // One side has observables/tags/vendors, the other is fully empty: zero contribution
  // from those signals, no crash, no NaN.
  const a = caseInput();
  const b = caseInput({
    title: "Totally unrelated topic",
    summary: "",
    observableValues: [],
    tags: [],
    vendorSlugs: [],
  });
  const result = scoreCaseRelationship(a, b);
  assert.equal(Number.isNaN(result.score), false);
  assert.deepEqual(result.matchedSignals.sharedObservables, []);
  assert.deepEqual(result.matchedSignals.sharedTags, []);
  assert.deepEqual(result.matchedSignals.sharedVendors, []);
}

// Fully overlapping observables between two cases with dissimilar titles still
// produces a non-trivial score (observable overlap is a strong signal on its own).
{
  const a = caseInput({
    title: "Ransomware detonation on file server FS-02",
    summary: "Mass file encryption observed",
    tags: [],
    vendorSlugs: [],
    observableValues: ["203.0.113.9", "evil.example.test", "44d88612fea8a8f36de82e1278abb02f"],
  });
  const b = caseInput({
    title: "Unrelated phishing report from HR mailbox",
    summary: "User forwarded a suspicious email",
    tags: [],
    vendorSlugs: [],
    observableValues: ["203.0.113.9", "evil.example.test", "44d88612fea8a8f36de82e1278abb02f"],
  });
  const result = scoreCaseRelationship(a, b);
  assert.ok(
    result.score >= SUGGESTION_SCORE_THRESHOLD,
    `expected non-trivial score from full observable overlap, got ${result.score}`,
  );
  assert.deepEqual(
    [...result.matchedSignals.sharedObservables].sort(),
    ["203.0.113.9", "44d88612fea8a8f36de82e1278abb02f", "evil.example.test"],
  );
}

// score is never outside [0, 100], across a spread of fuzzed inputs.
{
  const titles = [
    "",
    "a",
    "Suspicious PowerShell execution on WKSTN-01",
    "Suspicious PowerShell execution on WKSTN-01".repeat(20),
    "!!! $$$ %%% ??? ***",
    "同じ タイトル テスト",
  ];
  const observableSets = [[], ["1.1.1.1"], ["1.1.1.1", "2.2.2.2", "evil.example.test"]];
  const tagSets = [[], ["a"], ["a", "b", "c"]];
  const vendorSets = [[], ["microsoft"], ["microsoft", "crowdstrike"]];

  for (const titleA of titles) {
    for (const titleB of titles) {
      for (const observablesA of observableSets) {
        for (const observablesB of observableSets) {
          for (const tagsA of tagSets) {
            for (const vendorsA of vendorSets) {
              const result = scoreCaseRelationship(
                {
                  title: titleA,
                  summary: null,
                  tags: tagsA,
                  observableValues: observablesA,
                  vendorSlugs: vendorsA,
                },
                {
                  title: titleB,
                  summary: null,
                  tags: tagsA,
                  observableValues: observablesB,
                  vendorSlugs: vendorsA,
                },
              );
              assert.ok(
                result.score >= 0 && result.score <= 100,
                `score out of [0,100] range: ${result.score} for titles "${titleA}" / "${titleB}"`,
              );
              assert.equal(Number.isNaN(result.score), false);
              assert.equal(
                result.suggestedType,
                result.score >= 70 ? "duplicate_of" : "related_to",
                `suggestedType must match the 70-point threshold for score ${result.score}`,
              );
            }
          }
        }
      }
    }
  }
}

// score >= 70 yields "duplicate_of", otherwise "related_to".
{
  const identical = caseInput();
  const identicalResult = scoreCaseRelationship(identical, caseInput());
  assert.equal(identicalResult.score, 100);
  assert.equal(identicalResult.suggestedType, "duplicate_of");

  const dissimilarResult = scoreCaseRelationship(
    caseInput(),
    caseInput({
      title: "Totally unrelated topic",
      summary: "",
      observableValues: [],
      tags: [],
      vendorSlugs: [],
    }),
  );
  assert.ok(dissimilarResult.score < 70, `expected score < 70, got ${dissimilarResult.score}`);
  assert.equal(dissimilarResult.suggestedType, "related_to");
}

console.log("case relationship scoring tests passed");
