import assert from "node:assert/strict";
import {
  matchesAutomationConditions,
} from "../src/lib/automations/conditions";
import {
  buildMusterTriggerEnvelope,
  signAutomationEnvelope,
} from "../src/lib/automations/envelope";

const snapshot = {
  id: "case_1",
  caseNumber: "KP-2026-0001",
  version: 3,
  status: "in_progress",
  severity: "critical",
  classification: "phishing",
  tlp: "amber",
  pap: "amber",
  tags: ["microsoft-defender", "credential-theft"],
  sourceSystem: "microsoft_defender_xdr:src_1",
};

assert.equal(
  matchesAutomationConditions(snapshot, [
    { field: "severity", operator: "equals", value: "critical" },
    { field: "tag", operator: "contains", value: "defender" },
  ]),
  true,
);
assert.equal(
  matchesAutomationConditions(snapshot, [
    { field: "classification", operator: "not_equals", value: "phishing" },
  ]),
  false,
);

const envelope = buildMusterTriggerEnvelope({
  eventId: "tle_1",
  event: "case.created",
  occurredAt: new Date("2026-07-27T00:00:00.000Z"),
  organisationId: "org_1",
  traceId: "trace_1",
  targetProfile: "triage-agent",
  ruleId: "aut_1",
  ruleRevision: 1,
  snapshot,
});
assert.equal(envelope.version, "kelpie.agent-trigger.v1");
assert.equal(envelope.case.number, snapshot.caseNumber);
assert.equal("summary" in envelope.case, false);
assert.equal("description" in envelope.case, false);
assert.equal(
  signAutomationEnvelope('{"ok":true}', "secret"),
  "sha256=f6b4a2841c93f8bf2fb8f2c13d8fb0b6c8e8019f09ee405d248daa8385fad638",
);

console.log("automation domain tests passed");
