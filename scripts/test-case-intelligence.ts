import assert from "node:assert/strict";
import { mapSentinelIncident } from "../src/lib/case-sources/sentinel";
import { extractCaseIndicators } from "../src/lib/ti/case-enrichment";

const indicators = extractCaseIndicators(
  "Phishing from attacker@example.test via 203.0.113.9",
  "Visit https://evil.example.test/login. SHA256: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa CVE-2026-12345",
);
assert.deepEqual(indicators, [
  "https://evil.example.test/login",
  "evil.example.test",
  "203.0.113.9",
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
]);
assert.equal(
  indicators.includes("CVE-2026-12345"),
  false,
  "CVE text must never be treated as a TI indicator",
);
assert.equal(
  indicators.includes("attacker@example.test"),
  false,
  "email addresses must never be treated as a TI indicator",
);

const cidrIndicators = extractCaseIndicators(
  "Blocked 198.51.100.0/24 at the edge",
);
assert.equal(
  cidrIndicators.includes("198.51.100.0/24"),
  false,
  "CIDR ranges must never be treated as a TI indicator",
);

const mapped = mapSentinelIncident(
  {
    name: "73e01a99-5cd7-4139-a149-9f2736ff2ab5",
    properties: {
      title: "Suspicious sign-in",
      description: "Account compromise from 203.0.113.9",
      severity: "High",
      status: "Active",
      incidentUrl: "https://portal.azure.com/example",
      lastModifiedTimeUtc: "2026-07-26T00:00:00Z",
      labels: [{ labelName: "identity" }],
      additionalData: { tactics: ["InitialAccess"] },
    },
  },
  "microsoft_sentinel:src_test",
);
assert.ok(mapped);
assert.equal(mapped.input.status, "in_progress");
assert.equal(mapped.input.severity, "high");
assert.equal(mapped.input.classification, "unauthorised_access");
assert.deepEqual(mapped.input.tags, [
  "microsoft-sentinel",
  "identity",
  "InitialAccess",
]);
assert.equal(mapped.input.sourceReference, "73e01a99-5cd7-4139-a149-9f2736ff2ab5");

console.log("case intelligence tests passed");
