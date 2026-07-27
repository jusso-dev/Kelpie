import assert from "node:assert/strict";
import {
  isTiIndicatorType,
  TI_INDICATOR_TYPES,
} from "../src/lib/ti/indicator-types";
import {
  guessIndicatorType,
  resolveIndicatorType,
} from "../src/lib/ti/normalise";

assert.deepEqual(TI_INDICATOR_TYPES, ["ip", "url", "file_hash", "domain"]);

assert.equal(isTiIndicatorType("ip"), true);
assert.equal(isTiIndicatorType("url"), true);
assert.equal(isTiIndicatorType("file_hash"), true);
assert.equal(isTiIndicatorType("domain"), true);
assert.equal(isTiIndicatorType("cidr"), false);
assert.equal(isTiIndicatorType("cve"), false);
assert.equal(isTiIndicatorType("email"), false);
assert.equal(isTiIndicatorType("other"), false);
assert.equal(isTiIndicatorType("CIDR"), false);
assert.equal(isTiIndicatorType(""), false);
assert.equal(isTiIndicatorType(123 as unknown), false);

assert.equal(guessIndicatorType("203.0.113.9"), "ip");
assert.equal(
  guessIndicatorType("a".repeat(64)),
  "file_hash",
);
assert.equal(guessIndicatorType("https://evil.example.test/x"), "url");
assert.equal(guessIndicatorType("evil.example.test"), "domain");
assert.equal(guessIndicatorType("10.0.0.0/24"), null);
assert.equal(guessIndicatorType("CVE-2026-12345"), null);
assert.equal(guessIndicatorType("attacker@example.test"), null);

assert.deepEqual(resolveIndicatorType("cidr", "10.0.0.0/24"), {
  ok: false,
  rejectedType: "cidr",
});
assert.deepEqual(resolveIndicatorType("cve", "CVE-2026-12345"), {
  ok: false,
  rejectedType: "cve",
});
assert.deepEqual(resolveIndicatorType("md5", "b".repeat(32)), {
  ok: true,
  type: "file_hash",
});
assert.deepEqual(resolveIndicatorType("", "203.0.113.9"), {
  ok: true,
  type: "ip",
});

console.log("TI indicator type allowlist tests passed");
