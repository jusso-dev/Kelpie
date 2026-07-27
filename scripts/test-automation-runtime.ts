import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import {
  automationRules,
  automationRuns,
  cases,
  organisations,
  timelineEvents,
  webhookDeliveries,
  webhooks,
} from "../src/db/schema";
import { processPendingAutomationRuns } from "../src/lib/automations/dispatch";
import { queueAutomationRunsForTimelineEvent } from "../src/lib/automations/core";
import { writeTimelineEvent } from "../src/lib/timeline";
import { newId } from "../src/lib/utils";

const received: Array<{
  body: string;
  signature: string | undefined;
}> = [];

async function main() {
const receiver = http.createServer((request, response) => {
  let body = "";
  request.setEncoding("utf8");
  request.on("data", (chunk) => {
    body += chunk;
  });
  request.on("end", () => {
    received.push({
      body,
      signature: request.headers["x-kelpie-signature"] as string | undefined,
    });
    response.writeHead(202).end("accepted");
  });
});
await new Promise<void>((resolve) => receiver.listen(0, "127.0.0.1", resolve));
const address = receiver.address();
assert.ok(address && typeof address === "object");

const organisationId = newId("org");
const caseId = newId("case");
const ruleId = newId("aut");
const secret = "automation-runtime-test-secret-32-characters";
try {
  await db.insert(organisations).values({
    id: organisationId,
    name: "Automation runtime test",
    slug: `automation-${crypto.randomUUID()}`,
  });
  await db.insert(cases).values({
    id: caseId,
    organisationId,
    caseNumber: "KP-2026-9999",
    title: "Defender critical incident",
    severity: "critical",
    classification: "malware",
    tags: ["microsoft-defender-xdr"],
  });
  await db.insert(automationRules).values({
    id: ruleId,
    organisationId,
    name: "Critical Defender handoff",
    triggerEvent: "case.created",
    conditions: [
      { field: "severity", operator: "equals", value: "critical" },
    ],
    destinationUrl: `http://127.0.0.1:${address.port}/events`,
    secret,
    keyId: "runtime-test",
    targetProfile: "triage-agent",
    isActive: true,
  });
  await db.insert(webhooks).values({
    id: newId("wh"),
    organisationId,
    name: "Canonical event test",
    url: `http://127.0.0.1:${address.port}/webhook`,
    secret,
    events: ["case.created"],
  });

  await writeTimelineEvent({
    caseId,
    actorId: null,
    eventType: "case_created",
    payload: {},
  });
  const [timeline] = await db
    .select()
    .from(timelineEvents)
    .where(eq(timelineEvents.caseId, caseId))
    .limit(1);
  assert.ok(timeline);
  await queueAutomationRunsForTimelineEvent({
    timelineEventId: timeline.id,
    timelineEventType: timeline.eventType,
    caseId,
    occurredAt: timeline.occurredAt,
  });
  const queued = await db
    .select()
    .from(automationRuns)
    .where(eq(automationRuns.caseId, caseId));
  assert.equal(queued.length, 1, "duplicate event must not create a second run");
  const webhookRows = await db
    .select()
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.event, "case.created"));
  assert.equal(
    webhookRows.filter(
      (delivery) =>
        (delivery.payload as { case_id?: string }).case_id === caseId,
    ).length,
    1,
    "core case event must enqueue one webhook",
  );

  const result = await processPendingAutomationRuns();
  assert.equal(result.delivered, 1);
  assert.equal(received.length, 1);
  const expectedSignature = `sha256=${crypto
    .createHmac("sha256", secret)
    .update(received[0].body)
    .digest("hex")}`;
  assert.equal(received[0].signature, expectedSignature);
  const envelope = JSON.parse(received[0].body) as Record<string, unknown>;
  assert.equal(envelope.version, "kelpie.agent-trigger.v1");
  assert.equal("summary" in (envelope.case as Record<string, unknown>), false);
  const [completed] = await db
    .select()
    .from(automationRuns)
    .where(eq(automationRuns.caseId, caseId))
    .limit(1);
  assert.equal(completed.status, "succeeded");
  console.log("automation runtime tests passed");
} finally {
  await db.delete(organisations).where(eq(organisations.id, organisationId));
  await new Promise<void>((resolve, reject) =>
    receiver.close((error) => (error ? reject(error) : resolve())),
  );
}
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
