/**
 * HTTP-level acceptance coverage for escalation policies (issue #54): policy
 * CRUD, the version-conflict/disable/enable lifecycle, tenant isolation,
 * scope enforcement, and — most importantly — the security invariant that
 * escalation policies can never carry a destructive action, both at the
 * runtime-validation layer (a 400 on unknown/malformed action types) and
 * structurally (no import of the response-actions/SOAR subsystem anywhere in
 * `escalation-core.ts` or `escalation-runner.ts`). Also exercises the
 * `runEscalationChecks` runner function directly (age_minutes trigger,
 * raise_severity action, cooldown suppression).
 *
 * Mirrors `scripts/test-case-relationships-api.ts`'s structure: two-org
 * tenant fixtures, real `fetch()` calls against an already-running server at
 * `API_BASE_URL` (default `http://127.0.0.1:3111`), and full teardown with
 * zero-rows-remain assertions.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import {
  apiTokens,
  cases,
  escalationPolicies,
  escalationRuns,
  organisations,
  timelineEvents,
  users,
  type EscalationPolicy,
} from "../src/db/schema";
import { generateApiToken } from "../src/lib/api-tokens";
import { newId } from "../src/lib/utils";
import { runEscalationChecks } from "../src/lib/escalation-runner";

const BASE_URL = process.env.API_BASE_URL ?? "http://127.0.0.1:3111";

const runId = newId("escpolapitest").slice("escpolapitest_".length).slice(0, 12);
const orgAId = `org_escpolapi_a_${runId}`;
const orgBId = `org_escpolapi_b_${runId}`;
const orgRId = `org_escpolapi_r_${runId}`;

const FULL_SCOPES = ["escalation_policies:read", "escalation_policies:write"];
const READ_ONLY_SCOPES = ["escalation_policies:read"];

async function createOrg(id: string, name: string): Promise<void> {
  await db.insert(organisations).values({ id, name, slug: id.replace(/_/g, "-") });
}

async function createUser(id: string, name: string, email: string, organisationId: string): Promise<void> {
  await db.insert(users).values({ id, name, email, organisationId });
}

async function createToken(
  organisationId: string,
  name: string,
  scopes: string[],
  createdBy: string | null = null,
): Promise<string> {
  const { plaintext, hash } = generateApiToken();
  await db.insert(apiTokens).values({
    id: newId("api_token"),
    organisationId,
    name,
    tokenHash: hash,
    scopes,
    createdBy,
  });
  return plaintext;
}

let caseCounter = 0;
async function createCase(
  organisationId: string,
  overrides: Partial<typeof cases.$inferInsert> = {},
): Promise<string> {
  caseCounter += 1;
  const id = newId("case");
  await db.insert(cases).values({
    id,
    organisationId,
    caseNumber: `ESCPOLAPI-${runId}-${String(caseCounter).padStart(3, "0")}`,
    title: `Escalation policy fixture case ${caseCounter}`,
    ...overrides,
  });
  return id;
}

function headers(token: string): Record<string, string> {
  return { "content-type": "application/json", authorization: `Bearer ${token}` };
}

function createPolicyReq(token: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(`${BASE_URL}/api/v1/escalation-policies`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify(body),
  });
}

function listPoliciesReq(token: string, includeDisabled = false): Promise<Response> {
  const qs = includeDisabled ? "?include_disabled=true" : "";
  return fetch(`${BASE_URL}/api/v1/escalation-policies${qs}`, { headers: headers(token) });
}

function getPolicyReq(token: string, id: string): Promise<Response> {
  return fetch(`${BASE_URL}/api/v1/escalation-policies/${id}`, { headers: headers(token) });
}

function patchPolicyReq(token: string, id: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(`${BASE_URL}/api/v1/escalation-policies/${id}`, {
    method: "PATCH",
    headers: headers(token),
    body: JSON.stringify(body),
  });
}

async function main() {
  await createOrg(orgAId, "Escalation Policies API Test Org A");
  await createOrg(orgBId, "Escalation Policies API Test Org B");
  await createOrg(orgRId, "Escalation Policies API Test Org Runner");

  const analystAId = newId("user");
  await createUser(analystAId, "Org A Analyst", `escpolapi.analyst.${runId}@example.test`, orgAId);

  const orgAToken = await createToken(orgAId, "orgA full", FULL_SCOPES, analystAId);
  const orgAReadOnlyToken = await createToken(orgAId, "orgA read-only", READ_ONLY_SCOPES);
  const orgBToken = await createToken(orgBId, "orgB full", FULL_SCOPES);

  const orgAPolicyIds: string[] = [];
  const orgBPolicyIds: string[] = [];
  const orgRPolicyIds: string[] = [];
  const orgRCaseIds: string[] = [];

  try {
    // ── 1. Create a policy: 201, version 0 ──────────────────────────────────
    const createRes = await createPolicyReq(orgAToken, {
      name: `Age escalation ${runId}`,
      triggerType: "age_minutes",
      triggerConfig: { ageMinutes: 30 },
      actions: [{ type: "raise_severity" }],
    });
    assert.equal(createRes.status, 201, `create must return 201, got ${createRes.status}: ${await createRes.clone().text()}`);
    const createJson = (await createRes.json()) as { policy: { id: string } };
    const policy1Id = createJson.policy.id;
    orgAPolicyIds.push(policy1Id);
    const policy1FetchedRes = await getPolicyReq(orgAToken, policy1Id);
    assert.equal(policy1FetchedRes.status, 200);
    const policy1Fetched = (await policy1FetchedRes.json()) as { policy: EscalationPolicy };
    assert.equal(policy1Fetched.policy.version, 0, "a freshly created policy must start at version 0");
    console.log("ok: creating a valid age_minutes/raise_severity policy returns 201 with version 0");

    // ── 2. Security invariant: no destructive actions, ever ─────────────────
    const blockIpRes = await createPolicyReq(orgAToken, {
      name: `Malicious policy ${runId}`,
      triggerType: "age_minutes",
      triggerConfig: { ageMinutes: 30 },
      actions: [{ type: "block_ip" }],
    });
    assert.equal(
      blockIpRes.status,
      400,
      `an action type outside notify/reassign/raise_severity must be rejected with 400, got ${blockIpRes.status}`,
    );

    const strictExtraKeyRes = await createPolicyReq(orgAToken, {
      name: `Malicious policy 2 ${runId}`,
      triggerType: "age_minutes",
      triggerConfig: { ageMinutes: 30 },
      actions: [{ type: "notify", command: "rm -rf" }],
    });
    assert.equal(
      strictExtraKeyRes.status,
      400,
      `an otherwise-valid action type with an unrecognised extra key must be rejected by .strict(), got ${strictExtraKeyRes.status}`,
    );
    console.log("ok: actions outside notify/reassign/raise_severity, and unknown keys on a recognised action, are rejected with 400");

    // Static/structural proof: neither escalation-core.ts nor
    // escalation-runner.ts may import the destructive response-actions
    // subsystem, by construction — not merely by runtime validation.
    const here = path.dirname(fileURLToPath(import.meta.url));
    const coreSource = fs.readFileSync(path.join(here, "../src/lib/escalation-core.ts"), "utf8");
    const runnerSource = fs.readFileSync(path.join(here, "../src/lib/escalation-runner.ts"), "utf8");
    const responseActionsImportPattern = /from\s+["'](?:@\/lib\/response-actions|\.\/response-actions|\.\.\/.*response-actions)/;
    const coreImportsResponseActions = responseActionsImportPattern.test(coreSource);
    const runnerImportsResponseActions = responseActionsImportPattern.test(runnerSource);
    assert.equal(
      coreImportsResponseActions,
      false,
      "src/lib/escalation-core.ts must never import from the response-actions/SOAR subsystem",
    );
    assert.equal(
      runnerImportsResponseActions,
      false,
      "src/lib/escalation-runner.ts must never import from the response-actions/SOAR subsystem",
    );
    const totalResponseActionImports =
      (coreSource.match(/from\s+["'][^"']*response-actions[^"']*["']/g)?.length ?? 0) +
      (runnerSource.match(/from\s+["'][^"']*response-actions[^"']*["']/g)?.length ?? 0);
    assert.equal(
      totalResponseActionImports,
      0,
      "the combined count of import statements referencing any response-actions path across escalation-core.ts and escalation-runner.ts must be exactly zero",
    );
    console.log(
      "ok: escalation-core.ts and escalation-runner.ts contain zero imports of the response-actions/SOAR subsystem (structural proof escalation can never execute a destructive action)",
    );

    // ── 3. Version conflict on PATCH ─────────────────────────────────────────
    const staleRes = await patchPolicyReq(orgAToken, policy1Id, {
      version: policy1Fetched.policy.version + 5,
      name: `Renamed ${runId}`,
    });
    assert.equal(staleRes.status, 409, `a stale-version PATCH must return 409, got ${staleRes.status}`);
    const staleJson = (await staleRes.json()) as { error: string; current: EscalationPolicy };
    assert.equal(staleJson.error, "version_conflict");
    assert.equal(staleJson.current.id, policy1Id);
    assert.equal(staleJson.current.version, 0, "the 409 response must include the policy's real current version");
    console.log("ok: PATCH with a stale version returns 409 with the current policy snapshot");

    // ── 4. Disable / re-enable lifecycle, atomic and version-gated ──────────
    const policy4Res = await createPolicyReq(orgAToken, {
      name: `Disable lifecycle policy ${runId}`,
      triggerType: "age_minutes",
      triggerConfig: { ageMinutes: 45 },
      actions: [{ type: "raise_severity" }],
    });
    assert.equal(policy4Res.status, 201);
    const policy4Id = ((await policy4Res.json()) as { policy: { id: string } }).policy.id;
    orgAPolicyIds.push(policy4Id);

    // Stale-version disable must be rejected and must not change anything.
    const staleDisableRes = await patchPolicyReq(orgAToken, policy4Id, {
      version: 99,
      action: "disable",
    });
    assert.equal(staleDisableRes.status, 409, `disabling with a stale version must return 409, got ${staleDisableRes.status}`);
    const afterStaleDisableRes = await getPolicyReq(orgAToken, policy4Id);
    const afterStaleDisableJson = (await afterStaleDisableRes.json()) as { policy: EscalationPolicy };
    assert.equal(afterStaleDisableJson.policy.isActive, true, "a rejected stale-version disable must not disable the policy");
    assert.equal(afterStaleDisableJson.policy.version, 0, "a rejected stale-version disable must not bump the version");
    assert.equal(afterStaleDisableJson.policy.disabledAt, null);

    // Correct-version disable succeeds atomically.
    const disableRes = await patchPolicyReq(orgAToken, policy4Id, { version: 0, action: "disable" });
    assert.equal(disableRes.status, 200, `disable must return 200, got ${disableRes.status}: ${await disableRes.clone().text()}`);
    const disableJson = (await disableRes.json()) as { policy: EscalationPolicy };
    assert.equal(disableJson.policy.isActive, false);
    assert.ok(disableJson.policy.disabledAt, "disabledAt must be set when a policy is disabled");
    assert.equal(disableJson.policy.disabledBy, analystAId, "disabledBy must record the acting user");
    assert.equal(disableJson.policy.version, 1, "disable must bump the version by exactly one");

    // Correct-version re-enable succeeds atomically.
    const enableRes = await patchPolicyReq(orgAToken, policy4Id, { version: 1, action: "enable" });
    assert.equal(enableRes.status, 200, `enable must return 200, got ${enableRes.status}: ${await enableRes.clone().text()}`);
    const enableJson = (await enableRes.json()) as { policy: EscalationPolicy };
    assert.equal(enableJson.policy.isActive, true);
    assert.equal(enableJson.policy.disabledAt, null, "disabledAt must be cleared on re-enable");
    assert.equal(enableJson.policy.disabledBy, null, "disabledBy must be cleared on re-enable");
    assert.equal(enableJson.policy.version, 2, "enable must bump the version by exactly one");
    console.log("ok: disable/re-enable flip isActive/disabledAt/disabledBy atomically, bump version each time, and reject stale-version attempts without side effects");

    // ── 5. Tenant isolation ──────────────────────────────────────────────────
    const crossGetRes = await getPolicyReq(orgBToken, policy1Id);
    assert.equal(crossGetRes.status, 404, `org B reading org A's policy by id must return 404, got ${crossGetRes.status}`);
    const orgBListRes = await listPoliciesReq(orgBToken, true);
    const orgBListJson = (await orgBListRes.json()) as { policies: EscalationPolicy[] };
    assert.ok(
      !orgBListJson.policies.some((p) => p.id === policy1Id),
      "org A's policy must never appear in org B's policy list",
    );
    console.log("ok: escalation policies are tenant-isolated (404 by id, excluded from another org's list)");

    // ── 6. Scope enforcement ─────────────────────────────────────────────────
    const forbiddenCreateRes = await createPolicyReq(orgAReadOnlyToken, {
      name: `Should be forbidden ${runId}`,
      triggerType: "age_minutes",
      triggerConfig: { ageMinutes: 30 },
      actions: [{ type: "raise_severity" }],
    });
    assert.equal(
      forbiddenCreateRes.status,
      403,
      `a read-only-scope token must get 403 on POST, got ${forbiddenCreateRes.status}`,
    );
    console.log("ok: an escalation_policies:read-only token gets 403 on POST");

    // ── 7. Runner smoke test: age_minutes trigger, raise_severity, cooldown ──
    const runnerCaseId = await createCase(orgRId, {
      severity: "medium",
      status: "open",
      openedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      acknowledgedAt: null,
    });
    orgRCaseIds.push(runnerCaseId);

    const runnerPolicyId = newId("escpol");
    await db.insert(escalationPolicies).values({
      id: runnerPolicyId,
      organisationId: orgRId,
      name: `Runner smoke test policy ${runId}`,
      triggerType: "age_minutes",
      triggerConfig: { ageMinutes: 60, cooldownMinutes: 60 },
      actions: [{ type: "raise_severity" }],
    });
    orgRPolicyIds.push(runnerPolicyId);

    await runEscalationChecks();

    const [caseAfterFirstRun] = await db
      .select({ severity: cases.severity })
      .from(cases)
      .where(eq(cases.id, runnerCaseId))
      .limit(1);
    assert.equal(
      caseAfterFirstRun?.severity,
      "high",
      "runEscalationChecks must raise the case's severity by exactly one tier (medium -> high)",
    );

    const runsAfterFirst = await db
      .select()
      .from(escalationRuns)
      .where(and(eq(escalationRuns.policyId, runnerPolicyId), eq(escalationRuns.caseId, runnerCaseId)));
    assert.equal(runsAfterFirst.length, 1, "exactly one escalation_runs row must be inserted for this policy+case");
    assert.equal(runsAfterFirst[0]?.outcome, "applied");

    const escalationTimelineEvents = await db
      .select()
      .from(timelineEvents)
      .where(and(eq(timelineEvents.caseId, runnerCaseId), eq(timelineEvents.eventType, "escalation_triggered")));
    assert.equal(
      escalationTimelineEvents.length,
      1,
      "a timeline_events row with event_type escalation_triggered must exist for the case",
    );

    // Immediately re-running must not re-fire (cooldown suppression).
    await runEscalationChecks();
    const runsAfterSecond = await db
      .select()
      .from(escalationRuns)
      .where(and(eq(escalationRuns.policyId, runnerPolicyId), eq(escalationRuns.caseId, runnerCaseId)));
    assert.equal(
      runsAfterSecond.length,
      1,
      "a second immediate runEscalationChecks() call must NOT insert a second escalation_runs row (cooldown suppression)",
    );
    console.log(
      "ok: runEscalationChecks() applies age_minutes -> raise_severity, records exactly one escalation_runs row and one escalation_triggered timeline event, and suppresses re-firing within the cooldown window",
    );

    console.log("escalation policies api tests passed");
  } finally {
    // `escalation_runs` is append-only at the DB level (see migration 0021):
    // it can only be removed by a nested cascade delete (via its `case_id` or
    // `organisation_id` foreign keys), never by a direct top-level DELETE. So
    // we clean it up here by deleting the owning cases/orgs, not the table
    // itself.
    if (orgRCaseIds.length > 0) {
      await db.delete(timelineEvents).where(inArray(timelineEvents.caseId, orgRCaseIds));
      await db.delete(cases).where(inArray(cases.id, orgRCaseIds));
    }
    const allPolicyIds = [...orgAPolicyIds, ...orgBPolicyIds, ...orgRPolicyIds];
    if (allPolicyIds.length > 0) {
      await db.delete(escalationPolicies).where(inArray(escalationPolicies.id, allPolicyIds));
    }
    for (const orgId of [orgAId, orgBId, orgRId]) {
      await db.delete(apiTokens).where(eq(apiTokens.organisationId, orgId));
    }
    for (const orgId of [orgAId, orgBId, orgRId]) {
      await db.delete(organisations).where(eq(organisations.id, orgId));
    }
    await db.delete(users).where(eq(users.id, analystAId));

    const remainingPolicies = await db
      .select({ id: escalationPolicies.id })
      .from(escalationPolicies)
      .where(inArray(escalationPolicies.id, allPolicyIds.length > 0 ? allPolicyIds : ["__none__"]));
    const remainingRuns =
      orgRCaseIds.length > 0
        ? await db.select({ id: escalationRuns.id }).from(escalationRuns).where(inArray(escalationRuns.caseId, orgRCaseIds))
        : [];
    const remainingCases =
      orgRCaseIds.length > 0
        ? await db.select({ id: cases.id }).from(cases).where(inArray(cases.id, orgRCaseIds))
        : [];
    const remainingTokens = await db
      .select({ id: apiTokens.id })
      .from(apiTokens)
      .where(inArray(apiTokens.organisationId, [orgAId, orgBId, orgRId]));
    const remainingOrgs = await db
      .select({ id: organisations.id })
      .from(organisations)
      .where(inArray(organisations.id, [orgAId, orgBId, orgRId]));
    const remainingUsers = await db.select({ id: users.id }).from(users).where(eq(users.id, analystAId));

    assert.equal(remainingPolicies.length, 0, "fixture escalation_policies rows must be fully cleaned up");
    assert.equal(remainingRuns.length, 0, "fixture escalation_runs rows must be fully cleaned up");
    assert.equal(remainingCases.length, 0, "fixture cases must be fully cleaned up");
    assert.equal(remainingTokens.length, 0, "fixture api tokens must be fully cleaned up");
    assert.equal(remainingOrgs.length, 0, "fixture orgs must be fully cleaned up");
    assert.equal(remainingUsers.length, 0, "fixture users must be fully cleaned up");
    console.log("escalation policies api fixture cleanup verified: no fixture rows remain");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
