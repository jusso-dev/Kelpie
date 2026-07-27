import assert from "node:assert/strict";
import {
  compareSourceCursor,
  parseSourceCursor,
  serialiseSourceCursor,
} from "../src/lib/case-sources/cursor";
import { mapDefenderXdrIncident } from "../src/lib/case-sources/defender-xdr";
import { mapSentinelIncident } from "../src/lib/case-sources/sentinel";

const legacy = parseSourceCursor("2026-07-26T00:00:00Z");
assert.deepEqual(legacy, { timestamp: "2026-07-26T00:00:00Z", id: "\uffff" });
const composite = { timestamp: "2026-07-26T00:00:00Z", id: "42" };
assert.deepEqual(parseSourceCursor(serialiseSourceCursor(composite)), composite);
assert.ok(compareSourceCursor(
  { timestamp: "2026-07-26T00:00:01Z", id: "1" },
  composite,
) > 0);
assert.ok(compareSourceCursor(
  { timestamp: "2026-07-26T00:00:00.100Z", id: "1" },
  composite,
) > 0);

const sentinel = mapSentinelIncident(
  {
    name: "73e01a99-5cd7-4139-a149-9f2736ff2ab5",
    properties: {
      title: "Suspicious sign-in",
      lastModifiedTimeUtc: "2026-07-26T00:00:00Z",
    },
  },
  "microsoft_sentinel:src_test",
);
assert.equal(sentinel?.input.sourceReference, "73e01a99-5cd7-4139-a149-9f2736ff2ab5");

const defender = mapDefenderXdrIncident(
  {
    id: "42",
    displayName: "Ransomware on endpoint",
    description: "Defender detected ransomware activity.",
    severity: "critical",
    status: "active",
    classification: "truePositive",
    determination: "malware",
    incidentWebUrl: "https://security.microsoft.com/incident2/42/overview",
    lastUpdateDateTime: "2026-07-26T00:00:01Z",
    customTags: ["Containment"],
    systemTags: ["DefenderForEndpoint"],
  },
  "microsoft_defender_xdr:src_test",
);
assert.ok(defender);
assert.equal(defender.input.severity, "critical");
assert.equal(defender.input.status, "in_progress");
assert.equal(defender.input.classification, "malware");
assert.equal(defender.input.sourceUrl, "https://security.microsoft.com/incident2/42/overview");
assert.deepEqual(defender.input.tags, [
  "microsoft-defender-xdr",
  "Containment",
  "DefenderForEndpoint",
]);

console.log("case source tests passed");
