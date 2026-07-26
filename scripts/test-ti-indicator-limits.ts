import assert from "node:assert/strict";
import {
  MAX_INDICATOR_VALUE_BYTES,
  normaliseIndicatorValue,
} from "../src/lib/ti/indicator-limits";

assert.equal(normaliseIndicatorValue("  example.com  "), "example.com");
assert.equal(normaliseIndicatorValue("   "), null);
assert.equal(
  normaliseIndicatorValue("a".repeat(MAX_INDICATOR_VALUE_BYTES)),
  "a".repeat(MAX_INDICATOR_VALUE_BYTES),
);
assert.equal(
  normaliseIndicatorValue("a".repeat(MAX_INDICATOR_VALUE_BYTES + 1)),
  null,
);
assert.equal(
  normaliseIndicatorValue("🛡".repeat(MAX_INDICATOR_VALUE_BYTES / 4 + 1)),
  null,
);

console.log("TI indicator value limits test passed");
