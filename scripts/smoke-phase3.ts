/**
 * End-to-end smoke for Phase 3: SIEM connector framework, response actions,
 * threat-intelligence ingestion + lookup, custom fields, presence, and SSO
 * provisioning / session signing. Exercises the real database logic.
 *
 * Run against a live DB:  DATABASE_URL=... tsx scripts/smoke-phase3.ts
 */

import http from "node:http";
import crypto from "node:crypto";

process.env.KELPIE_ALLOW_PRIVATE_NETWORKS ??= "true";
import { db } from "../src/db";
import {
  organisations,
  users,
  cases,
  responseActions,
  responseActionRuns,
  siemConnectors,
  tiFeeds,
  tiIndicators,
  sessions,
  timelineEvents,
} from "../src/db/schema";
import { and, eq } from "drizzle-orm";
import { newId } from "../src/lib/utils";
import { AUTH_SECRET } from "../src/lib/auth";

import { pollFeed, lookupIndicators } from "../src/lib/ti/core";
import { addObservableCore } from "../src/lib/observables-core";
import { createCaseCore } from "../src/lib/cases-core";
import {
  listFieldDefinitions,
  setCustomFieldsByKey,
  customFieldsRecord,
  findEntitiesByFieldValue,
} from "../src/lib/custom-fields";
import { customFieldDefinitions } from "../src/db/schema";
import { runResponseAction, listAvailableActions } from "../src/lib/response-actions/core";
import { pollConnector } from "../src/lib/connectors/core";
import { heartbeat, getRoster } from "../src/lib/presence";
import { provisionSsoUser } from "../src/lib/sso/jit";
import { createSessionCookie } from "../src/lib/sso/session";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  const [org] = await db.select().from(organisations).limit(1);
  if (!org) throw new Error("Seed the database first (npm run db:seed)");
  const [admin] = await db
    .select()
    .from(users)
    .where(eq(users.organisationId, org.id))
    .limit(1);
  if (!admin) throw new Error("No user in org");
  const orgId = org.id;
  const actorId = admin.id;

  console.log("\n[1] Threat intelligence: CSV feed ingestion + lookup");
  // Serve a tiny CSV feed locally.
  const csv = "203.0.113.66,ip\nevil.example.test,domain\n# comment\n44d88612fea8a8f36de82e1278abb02f,md5\n";
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end(csv);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address() as { port: number };
  const feedUrl = `http://127.0.0.1:${addr.port}/feed.csv`;

  const feedId = newId("tif");
  await db.insert(tiFeeds).values({
    id: feedId,
    organisationId: orgId,
    name: "smoke-csv",
    kind: "csv",
    url: feedUrl,
    config: {},
    isActive: true,
    createdBy: actorId,
  });
  const pollResult = await pollFeed(feedId);
  check("CSV feed ingested 3 indicators", pollResult.ingested === 3, JSON.stringify(pollResult));
  const indicators = await db
    .select()
    .from(tiIndicators)
    .where(eq(tiIndicators.feedId, feedId));
  check("indicators stored", indicators.length === 3);
  const ipMatch = await lookupIndicators(orgId, "203.0.113.66");
  check("lookup finds the IP", ipMatch.length === 1 && ipMatch[0].type === "ip");
  server.close();

  console.log("\n[2] Observable creation triggers TI lookup");
  const c = await createCaseCore(orgId, actorId, {
    title: "Smoke phase3 case",
    severity: "high",
  });
  const obs = await addObservableCore(orgId, actorId, c.id, {
    type: "ip",
    value: "203.0.113.66",
  });
  const [obsRow] = await db
    .select()
    .from((await import("../src/db/schema")).observables)
    .where(eq((await import("../src/db/schema")).observables.id, obs.id))
    .limit(1);
  const enrichment = (obsRow.enrichment as Record<string, unknown>) ?? {};
  const ti = enrichment.ti as { data?: { known_bad?: boolean } } | undefined;
  check("observable enrichment.ti.known_bad is true", ti?.data?.known_bad === true);

  console.log("\n[3] Custom fields: define, set, read, search");
  const fieldId = newId("cfd");
  await db.insert(customFieldDefinitions).values({
    id: fieldId,
    organisationId: orgId,
    entity: "case",
    key: "asset_criticality",
    label: "Asset criticality",
    type: "select",
    options: ["low", "high", "crown_jewel"],
    required: false,
    orderIndex: 0,
    isActive: true,
  });
  const defs = await listFieldDefinitions(orgId, { entity: "case", activeOnly: true });
  check("definition listed", defs.some((d) => d.key === "asset_criticality"));
  await setCustomFieldsByKey(orgId, actorId, c.id, { asset_criticality: "crown_jewel" });
  const rec = await customFieldsRecord(orgId, c.id);
  check("custom field value persisted", rec.asset_criticality === "crown_jewel", JSON.stringify(rec));
  const found = await findEntitiesByFieldValue(orgId, fieldId, "crown_jewel");
  check("search by field value returns the case", found.includes(c.id));
  // Reject an invalid select option.
  let rejected = false;
  try {
    await setCustomFieldsByKey(orgId, actorId, c.id, { asset_criticality: "bogus" });
  } catch {
    rejected = true;
  }
  check("invalid select option rejected", rejected);

  console.log("\n[4] Response action framework (records run + timeline)");
  const actionId = newId("ra");
  await db.insert(responseActions).values({
    id: actionId,
    organisationId: orgId,
    name: "Smoke Cloudflare block",
    kind: "cloudflare_block_ip",
    config: { api_token: "invalid", zone_ids: "zone1" },
    isActive: true,
    createdBy: actorId,
  });
  const available = await listAvailableActions(orgId, c.id);
  check("action available (case has an IP observable)", available.some((a) => a.id === actionId));
  const run = await runResponseAction(orgId, actorId, actionId, c.id, {
    ip: "203.0.113.66",
  });
  check("action run completed (expected failure on bad creds)", run.ok === false);
  const [runRow] = await db
    .select()
    .from(responseActionRuns)
    .where(eq(responseActionRuns.id, run.runId))
    .limit(1);
  check("run row recorded with status", runRow.status === "failed" && runRow.target === "203.0.113.66");
  const raEvents = await db
    .select()
    .from(timelineEvents)
    .where(and(eq(timelineEvents.caseId, c.id), eq(timelineEvents.eventType, "response_action")));
  check("timeline records the action run", raEvents.length === 1);

  console.log("\n[5] SIEM connector framework (credential error halts polling)");
  const connId = newId("siem");
  await db.insert(siemConnectors).values({
    id: connId,
    organisationId: orgId,
    kind: "splunk",
    name: "smoke-splunk",
    config: { base_url: "http://127.0.0.1:1/", token: "x", saved_searches: "s1" },
    mapping: {},
    isActive: true,
    createdBy: actorId,
  });
  const connResult = await pollConnector(connId);
  check("connector poll failed gracefully", connResult.error !== null);
  const [connRow] = await db
    .select()
    .from(siemConnectors)
    .where(eq(siemConnectors.id, connId))
    .limit(1);
  check("last_error set on connector (halts future polls)", Boolean(connRow.lastError));

  console.log("\n[6] Presence roster");
  await heartbeat({ caseId: c.id, userId: actorId, userName: admin.name, editingField: "severity" });
  const otherId = newId("user");
  await db.insert(users).values({
    id: otherId,
    name: "Other Analyst",
    email: `other-${otherId}@smoke.local`,
    organisationId: orgId,
    role: "analyst",
  });
  await heartbeat({ caseId: c.id, userId: otherId, userName: "Other Analyst", typing: true });
  const roster = await getRoster(c.id, actorId);
  check("roster excludes self, includes other", roster.length === 1 && roster[0].userId === otherId);
  check("typing flag surfaced", roster[0].typing === true);

  console.log("\n[7] SSO JIT provisioning + session cookie signing");
  const { userId: ssoUserId } = await provisionSsoUser({
    organisationId: orgId,
    email: `sso-${newId("x")}@smoke.local`,
    name: "SSO User",
    role: "analyst",
  });
  const [ssoUser] = await db.select().from(users).where(eq(users.id, ssoUserId)).limit(1);
  check("JIT user created in org with role", ssoUser.organisationId === orgId && ssoUser.role === "analyst");
  const cookie = await createSessionCookie(ssoUserId, new Request("https://example.test/"));
  const cookieVal = decodeURIComponent(cookie.split("=")[1].split(";")[0]);
  const [token, sig] = [cookieVal.slice(0, cookieVal.lastIndexOf(".")), cookieVal.slice(cookieVal.lastIndexOf(".") + 1)];
  const expected = crypto.createHmac("sha256", AUTH_SECRET).update(token).digest("base64");
  check("session cookie signature matches BetterAuth format", sig === expected);
  const [sessRow] = await db.select().from(sessions).where(eq(sessions.token, token)).limit(1);
  check("session row persisted for the token", Boolean(sessRow) && sessRow.userId === ssoUserId);

  // Cleanup the smoke case + side data.
  await db.delete(cases).where(eq(cases.id, c.id));
  await db.delete(tiFeeds).where(eq(tiFeeds.id, feedId));
  await db.delete(siemConnectors).where(eq(siemConnectors.id, connId));
  await db.delete(users).where(eq(users.id, otherId));
  await db.delete(users).where(eq(users.id, ssoUserId));

  console.log(`\nPhase 3 smoke: ${pass} passed, ${fail} failed.`);
  if (fail > 0) process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
