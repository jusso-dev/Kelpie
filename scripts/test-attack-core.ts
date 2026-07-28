/**
 * Pure-logic unit tests for the ATT&CK mapping feature (issue #48): catalog
 * versioning/carry-forward merge, tactic-count normalization, playbook
 * coverage-gap calculation, and attack-story reorder. None of these touch
 * the database — they exercise the exported pure functions directly, same
 * style as `scripts/test-team-tags.ts`.
 */
import assert from "node:assert/strict";
import {
  countDistinctTactics,
  mergeCatalogTechniques,
} from "../src/lib/attack/catalog-core";
import {
  computeCoverageGaps,
  computeStepGuidanceIndex,
} from "../src/lib/attack/coverage-core";
import { reorderIds } from "../src/lib/attack/story-core";
import type { RawAttackTechnique } from "../src/lib/attack/types";
import type { PlaybookStep } from "../src/db/schema";

// ── Versioning: technique ids stay stable, deprecated ones are carried forward ──

const previous: RawAttackTechnique[] = [
  { techniqueId: "T1059", name: "Command and Scripting Interpreter", tactics: [{ id: "execution", name: "Execution" }] },
  { techniqueId: "T1086", name: "PowerShell (old)", tactics: [{ id: "execution", name: "Execution" }] },
];
const incoming: RawAttackTechnique[] = [
  { techniqueId: "T1059", name: "Command and Scripting Interpreter", tactics: [{ id: "execution", name: "Execution" }] },
  { techniqueId: "T1059.001", name: "PowerShell", tactics: [{ id: "execution", name: "Execution" }] },
];

const merged = mergeCatalogTechniques(previous, incoming);
assert.equal(merged.length, 3, "merge must keep incoming plus one carried-forward deprecated entry");
const mergedById = new Map(merged.map((t) => [t.techniqueId, t]));
assert.ok(mergedById.has("T1086"), "a technique id absent from the new source must still be present (carried forward)");
assert.equal(mergedById.get("T1086")?.deprecated, true, "a carried-forward technique must be marked deprecated");
assert.equal(mergedById.get("T1086")?.name, "PowerShell (old)", "a carried-forward technique keeps its last-known name");
assert.equal(mergedById.get("T1059")?.deprecated, undefined, "a technique present in both sets must not be marked deprecated by the merge");
assert.ok(mergedById.has("T1059.001"), "a brand-new technique id from the source must be present");

// Re-merging the same "incoming" against itself must not deprecate anything
// still present — technique ids remain stable across a no-op catalog update.
const stableMerge = mergeCatalogTechniques(incoming, incoming);
assert.equal(stableMerge.length, 2);
assert.ok(stableMerge.every((t) => !t.deprecated));

// A technique already deprecated in `previous` and still absent from `incoming`
// stays deprecated across a further update (still readable, never silently dropped).
const secondGenerationPrevious = merged; // includes deprecated T1086
const secondGenerationIncoming: RawAttackTechnique[] = [
  { techniqueId: "T1059", name: "Command and Scripting Interpreter", tactics: [{ id: "execution", name: "Execution" }] },
];
const secondMerge = mergeCatalogTechniques(secondGenerationPrevious, secondGenerationIncoming);
const secondById = new Map(secondMerge.map((t) => [t.techniqueId, t]));
assert.equal(secondById.get("T1086")?.deprecated, true, "an already-deprecated technique must remain readable and deprecated across a further catalog update");
assert.equal(secondById.get("T1059.001")?.deprecated, true, "a technique dropped from a subsequent source must be carried forward as deprecated too");

console.log("catalog carry-forward/deprecation merge tests passed");

// ── Tactic-count normalization ──

assert.equal(countDistinctTactics(incoming), 1, "T1059 and T1059.001 share the 'execution' tactic, so distinct count is 1");
assert.equal(
  countDistinctTactics([
    { techniqueId: "T1566", name: "Phishing", tactics: [{ id: "initial-access", name: "Initial Access" }] },
    { techniqueId: "T1078", name: "Valid Accounts", tactics: [{ id: "initial-access", name: "Initial Access" }, { id: "persistence", name: "Persistence" }] },
  ]),
  2,
  "distinct tactic count must not double-count a shared tactic",
);
assert.equal(countDistinctTactics([]), 0);

console.log("tactic normalization tests passed");

// ── Playbook coverage-gap calculation ──

const steps: PlaybookStep[] = [
  {
    id: "step_1",
    title: "Isolate host",
    offsetMinutes: 0,
    isRequired: true,
    attackTechniqueIds: ["T1059", "T1059.001"],
    guidanceCategories: ["containment"],
  },
  {
    id: "step_2",
    title: "Hunt for related activity",
    offsetMinutes: 30,
    isRequired: true,
    attackTechniqueIds: ["T1059"],
    guidanceCategories: ["investigation", "detection"],
  },
];
const index = computeStepGuidanceIndex(steps);
assert.deepEqual([...index.containment].sort(), ["T1059", "T1059.001"]);
assert.deepEqual([...index.detection].sort(), ["T1059"]);
assert.deepEqual([...index.recovery], [], "a category no step tags must be empty");

const mappedTechniqueIds = ["T1059", "T1059.001", "T1566"];
const gaps = computeCoverageGaps(mappedTechniqueIds, index);
assert.deepEqual(gaps.containment.sort(), ["T1566"], "T1566 is mapped but not documented for containment by any step");
assert.deepEqual(gaps.detection.sort(), ["T1059.001", "T1566"]);
assert.deepEqual(gaps.recovery.sort(), ["T1059", "T1059.001", "T1566"], "with no step documenting recovery, every mapped technique is a gap");

// A step with techniques but no guidance categories (or vice versa) contributes nothing.
const incompleteSteps: PlaybookStep[] = [
  { id: "step_3", title: "Untagged step", offsetMinutes: 0, isRequired: false, attackTechniqueIds: ["T1078"] },
  { id: "step_4", title: "Category with no techniques", offsetMinutes: 0, isRequired: false, guidanceCategories: ["recovery"] },
];
const incompleteIndex = computeStepGuidanceIndex(incompleteSteps);
assert.equal(incompleteIndex.recovery.size, 0, "a category with no attackTechniqueIds on its step documents nothing");

console.log("playbook coverage-gap calculation tests passed");

// ── Attack story ordering (pure reorder helper) ──

const ids = ["a", "b", "c", "d"];
assert.deepEqual(reorderIds(ids, "c", 0), ["c", "a", "b", "d"], "moving 'c' to the front must preserve the relative order of the rest");
assert.deepEqual(reorderIds(ids, "a", 3), ["b", "c", "d", "a"], "moving 'a' to the end must preserve the relative order of the rest");
assert.deepEqual(reorderIds(ids, "b", 1), ids, "moving an entry to its own position must be a no-op");
assert.deepEqual(reorderIds(ids, "b", 99), ["a", "c", "d", "b"], "an out-of-range target index must clamp to the last valid position");
assert.deepEqual(reorderIds(ids, "missing", 0), ids, "reordering an id that is not present must be a no-op, not a throw");

console.log("attack story reorder tests passed");

console.log("attack core unit tests passed");
