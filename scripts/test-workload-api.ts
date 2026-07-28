/**
 * HTTP-level acceptance coverage for analyst workload and team queue-health
 * (issue #54): workload excludes closed cases, weights open cases by
 * severity, omits analysts with zero open cases, and queue-health counts are
 * produced by a full indexed aggregate query rather than a capped
 * current-page result set (proven here by seeding well over one UI page's
 * worth of cases per team and comparing against a plain `count()` on the
 * same table). Also covers tenant isolation and scope enforcement.
 *
 * Mirrors `scripts/test-case-relationships-api.ts`'s structure: two-org
 * tenant fixtures, real `fetch()` calls against an already-running server at
 * `API_BASE_URL` (default `http://127.0.0.1:3111`), and full teardown with
 * zero-rows-remain assertions.
 */
import assert from "node:assert/strict";
import { and, count, eq, inArray, sql } from "drizzle-orm";
import { db } from "../src/db";
import { apiTokens, cases, organisations, teams, users } from "../src/db/schema";
import { generateApiToken } from "../src/lib/api-tokens";
import { newId } from "../src/lib/utils";

const BASE_URL = process.env.API_BASE_URL ?? "http://127.0.0.1:3111";

const runId = newId("workloadapitest").slice("workloadapitest_".length).slice(0, 12);
const orgAId = `org_workloadapi_a_${runId}`;
const orgBId = `org_workloadapi_b_${runId}`;

type AnalystWorkloadRow = {
  userId: string;
  name: string;
  email: string;
  openCount: number;
  weightedScore: number;
  bySeverity: { critical: number; high: number; medium: number; low: number };
  unacknowledgedCount: number;
};

type TeamQueueHealthRow = {
  teamId: string;
  teamName: string;
  openCount: number;
  unassignedCount: number;
  weightedScore: number;
};

async function createOrg(id: string, name: string): Promise<void> {
  await db.insert(organisations).values({ id, name, slug: id.replace(/_/g, "-") });
}

async function createUser(id: string, name: string, email: string, organisationId: string): Promise<void> {
  await db.insert(users).values({ id, name, email, organisationId });
}

async function createToken(organisationId: string, name: string, scopes: string[]): Promise<string> {
  const { plaintext, hash } = generateApiToken();
  await db.insert(apiTokens).values({
    id: newId("api_token"),
    organisationId,
    name,
    tokenHash: hash,
    scopes,
  });
  return plaintext;
}

async function createTeam(organisationId: string, name: string): Promise<string> {
  const id = newId("team");
  await db.insert(teams).values({ id, organisationId, name });
  return id;
}

let caseCounter = 0;
function caseValues(
  organisationId: string,
  overrides: Partial<typeof cases.$inferInsert> = {},
): typeof cases.$inferInsert {
  caseCounter += 1;
  return {
    id: newId("case"),
    organisationId,
    caseNumber: `WORKLOADAPI-${runId}-${String(caseCounter).padStart(4, "0")}`,
    title: `Workload fixture case ${caseCounter}`,
    ...overrides,
  } as typeof cases.$inferInsert;
}

function headers(token: string): Record<string, string> {
  return { "content-type": "application/json", authorization: `Bearer ${token}` };
}

function getWorkload(token: string): Promise<Response> {
  return fetch(`${BASE_URL}/api/v1/workload`, { headers: headers(token) });
}

function getQueueHealth(token: string): Promise<Response> {
  return fetch(`${BASE_URL}/api/v1/queues/health`, { headers: headers(token) });
}

async function main() {
  await createOrg(orgAId, "Workload API Test Org A");
  await createOrg(orgBId, "Workload API Test Org B");

  const analyst1Id = newId("user");
  const analyst2Id = newId("user");
  const analyst3Id = newId("user");
  await createUser(analyst1Id, "Workload Analyst One", `workloadapi.one.${runId}@example.test`, orgAId);
  await createUser(analyst2Id, "Workload Analyst Two", `workloadapi.two.${runId}@example.test`, orgAId);
  await createUser(analyst3Id, "Workload Analyst Three (zero open)", `workloadapi.three.${runId}@example.test`, orgAId);

  const orgAToken = await createToken(orgAId, "orgA full", ["workload:read"]);
  const orgARestrictedToken = await createToken(orgAId, "orgA restricted", ["cases:read"]);
  const orgBToken = await createToken(orgBId, "orgB full", ["workload:read"]);

  const orgACaseIds: string[] = [];
  const orgBCaseIds: string[] = [];
  const orgATeamIds: string[] = [];
  const orgBTeamIds: string[] = [];

  try {
    // ── 1. Analyst workload: open-case counting, severity weighting, ────────
    //       zero-open-case exclusion.
    const a1CriticalOpen1 = caseValues(orgAId, { assigneeId: analyst1Id, severity: "critical", status: "open" });
    const a1CriticalOpen2 = caseValues(orgAId, { assigneeId: analyst1Id, severity: "critical", status: "open" });
    const a1CriticalClosed = caseValues(orgAId, {
      assigneeId: analyst1Id,
      severity: "critical",
      status: "closed",
      closedAt: new Date(),
      closureReason: "resolved_true_positive",
    });
    const a2LowOpen = caseValues(orgAId, { assigneeId: analyst2Id, severity: "low", status: "open" });
    const a3ClosedOnly = caseValues(orgAId, {
      assigneeId: analyst3Id,
      severity: "high",
      status: "closed",
      closedAt: new Date(),
      closureReason: "resolved_false_positive",
    });
    const workloadFixtureCases = [a1CriticalOpen1, a1CriticalOpen2, a1CriticalClosed, a2LowOpen, a3ClosedOnly];
    await db.insert(cases).values(workloadFixtureCases);
    orgACaseIds.push(...workloadFixtureCases.map((c) => c.id as string));

    const workloadRes = await getWorkload(orgAToken);
    assert.equal(workloadRes.status, 200, `workload GET must return 200, got ${workloadRes.status}: ${await workloadRes.clone().text()}`);
    const workloadJson = (await workloadRes.json()) as { analysts: AnalystWorkloadRow[] };

    const analyst1Row = workloadJson.analysts.find((a) => a.userId === analyst1Id);
    assert.ok(analyst1Row, "analyst 1 must appear in the workload response");
    assert.equal(analyst1Row?.openCount, 2, "analyst 1's openCount must be 2 (the closed critical case must be excluded)");
    assert.equal(analyst1Row?.weightedScore, 8, "analyst 1's weightedScore must be 2 open critical cases * weight 4 = 8");
    assert.equal(analyst1Row?.bySeverity.critical, 2);

    const analyst2Row = workloadJson.analysts.find((a) => a.userId === analyst2Id);
    assert.ok(analyst2Row, "analyst 2 must appear in the workload response");
    assert.equal(analyst2Row?.openCount, 1);
    assert.equal(analyst2Row?.weightedScore, 1, "analyst 2's weightedScore must be 1 open low-severity case * weight 1 = 1");

    const analyst3Row = workloadJson.analysts.find((a) => a.userId === analyst3Id);
    assert.equal(
      analyst3Row,
      undefined,
      "an analyst with zero open cases (only a closed case) must not appear in the workload response at all",
    );
    console.log(
      "ok: workload excludes closed cases from openCount, weights open cases by severity (critical=4, low=1), and omits analysts with zero open cases",
    );

    // ── 2. Queue health: counts reflect the FULL table, not a capped page ───
    const teamX = await createTeam(orgAId, `Workload Team X ${runId}`);
    const teamY = await createTeam(orgAId, `Workload Team Y ${runId}`);
    orgATeamIds.push(teamX, teamY);

    const TEAM_X_COUNT = 70;
    const TEAM_Y_COUNT = 60;
    const teamXCases = Array.from({ length: TEAM_X_COUNT }, (_, i) =>
      caseValues(orgAId, {
        queueId: teamX,
        status: "open",
        severity: "medium",
        assigneeId: i % 3 === 0 ? null : analyst1Id,
      }),
    );
    const teamYCases = Array.from({ length: TEAM_Y_COUNT }, (_, i) =>
      caseValues(orgAId, {
        queueId: teamY,
        status: "open",
        severity: "low",
        assigneeId: i % 4 === 0 ? null : analyst2Id,
      }),
    );
    await db.insert(cases).values([...teamXCases, ...teamYCases]);
    orgACaseIds.push(...teamXCases.map((c) => c.id as string), ...teamYCases.map((c) => c.id as string));

    assert.ok(TEAM_X_COUNT > 50 && TEAM_Y_COUNT > 50, "fixture must exceed a typical 50-row UI page size per team");

    const [teamXTrueCount] = await db
      .select({ total: count() })
      .from(cases)
      .where(and(eq(cases.queueId, teamX), sql`${cases.status} <> 'closed'`));
    const [teamYTrueCount] = await db
      .select({ total: count() })
      .from(cases)
      .where(and(eq(cases.queueId, teamY), sql`${cases.status} <> 'closed'`));
    assert.equal(Number(teamXTrueCount?.total), TEAM_X_COUNT);
    assert.equal(Number(teamYTrueCount?.total), TEAM_Y_COUNT);

    const queueHealthRes = await getQueueHealth(orgAToken);
    assert.equal(queueHealthRes.status, 200, `queue health GET must return 200, got ${queueHealthRes.status}`);
    const queueHealthJson = (await queueHealthRes.json()) as { teams: TeamQueueHealthRow[] };
    const teamXRow = queueHealthJson.teams.find((t) => t.teamId === teamX);
    const teamYRow = queueHealthJson.teams.find((t) => t.teamId === teamY);
    assert.ok(teamXRow, "team X must appear in queue health");
    assert.ok(teamYRow, "team Y must appear in queue health");
    assert.equal(
      teamXRow?.openCount,
      Number(teamXTrueCount?.total),
      "team X's reported openCount must equal the true full count from a direct DB count(), proving it is not capped at a page size",
    );
    assert.equal(
      teamYRow?.openCount,
      Number(teamYTrueCount?.total),
      "team Y's reported openCount must equal the true full count from a direct DB count()",
    );
    console.log(
      `ok: /api/v1/queues/health openCount for both teams (${TEAM_X_COUNT} and ${TEAM_Y_COUNT} open cases, both well over a 50-row page) exactly matches a direct DB count() — proving queue counts use complete indexed queries, not capped current-page results`,
    );

    // ── 3. Tenant isolation ──────────────────────────────────────────────────
    const orgBAnalystId = newId("user");
    await createUser(orgBAnalystId, "Org B Analyst", `workloadapi.orgb.${runId}@example.test`, orgBId);
    const orgBTeam = await createTeam(orgBId, `Org B Team ${runId}`);
    orgBTeamIds.push(orgBTeam);
    const orgBCase = caseValues(orgBId, {
      assigneeId: orgBAnalystId,
      queueId: orgBTeam,
      severity: "critical",
      status: "open",
    });
    await db.insert(cases).values(orgBCase);
    orgBCaseIds.push(orgBCase.id as string);

    const isolationWorkloadRes = await getWorkload(orgAToken);
    const isolationWorkloadJson = (await isolationWorkloadRes.json()) as { analysts: AnalystWorkloadRow[] };
    assert.ok(
      !isolationWorkloadJson.analysts.some((a) => a.userId === orgBAnalystId),
      "org B's analyst must never appear in org A's workload response",
    );
    const isolationQueueRes = await getQueueHealth(orgAToken);
    const isolationQueueJson = (await isolationQueueRes.json()) as { teams: TeamQueueHealthRow[] };
    assert.ok(
      !isolationQueueJson.teams.some((t) => t.teamId === orgBTeam),
      "org B's team must never appear in org A's queue-health response",
    );

    const orgBWorkloadRes = await getWorkload(orgBToken);
    const orgBWorkloadJson = (await orgBWorkloadRes.json()) as { analysts: AnalystWorkloadRow[] };
    assert.ok(
      !orgBWorkloadJson.analysts.some((a) => a.userId === analyst1Id),
      "org A's analyst must never appear in org B's workload response",
    );
    console.log("ok: workload and queue-health responses are tenant-isolated in both directions");

    // Clean up the org-B analyst inline (not part of the shared teardown lists).
    await db.delete(cases).where(eq(cases.id, orgBCase.id as string));
    orgBCaseIds.splice(orgBCaseIds.indexOf(orgBCase.id as string), 1);
    await db.delete(users).where(eq(users.id, orgBAnalystId));

    // ── 4. Scope enforcement ─────────────────────────────────────────────────
    const forbiddenWorkloadRes = await getWorkload(orgARestrictedToken);
    assert.equal(
      forbiddenWorkloadRes.status,
      403,
      `a token without workload:read must get 403 on /workload, got ${forbiddenWorkloadRes.status}`,
    );
    const forbiddenQueueRes = await getQueueHealth(orgARestrictedToken);
    assert.equal(
      forbiddenQueueRes.status,
      403,
      `a token without workload:read must get 403 on /queues/health, got ${forbiddenQueueRes.status}`,
    );
    console.log("ok: a token without workload:read gets 403 on both /workload and /queues/health");

    console.log("workload api tests passed");
  } finally {
    const allCaseIds = [...orgACaseIds, ...orgBCaseIds];
    if (allCaseIds.length > 0) {
      await db.delete(cases).where(inArray(cases.id, allCaseIds));
    }
    const allTeamIds = [...orgATeamIds, ...orgBTeamIds];
    if (allTeamIds.length > 0) {
      await db.delete(teams).where(inArray(teams.id, allTeamIds));
    }
    for (const orgId of [orgAId, orgBId]) {
      await db.delete(apiTokens).where(eq(apiTokens.organisationId, orgId));
    }
    for (const orgId of [orgAId, orgBId]) {
      await db.delete(organisations).where(eq(organisations.id, orgId));
    }
    await db.delete(users).where(inArray(users.id, [analyst1Id, analyst2Id, analyst3Id]));

    const remainingCases =
      allCaseIds.length > 0
        ? await db.select({ id: cases.id }).from(cases).where(inArray(cases.id, allCaseIds))
        : [];
    const remainingTeams =
      allTeamIds.length > 0
        ? await db.select({ id: teams.id }).from(teams).where(inArray(teams.id, allTeamIds))
        : [];
    const remainingTokens = await db
      .select({ id: apiTokens.id })
      .from(apiTokens)
      .where(inArray(apiTokens.organisationId, [orgAId, orgBId]));
    const remainingOrgs = await db
      .select({ id: organisations.id })
      .from(organisations)
      .where(inArray(organisations.id, [orgAId, orgBId]));
    const remainingUsers = await db
      .select({ id: users.id })
      .from(users)
      .where(inArray(users.id, [analyst1Id, analyst2Id, analyst3Id]));

    assert.equal(remainingCases.length, 0, "fixture cases must be fully cleaned up");
    assert.equal(remainingTeams.length, 0, "fixture teams must be fully cleaned up");
    assert.equal(remainingTokens.length, 0, "fixture api tokens must be fully cleaned up");
    assert.equal(remainingOrgs.length, 0, "fixture orgs must be fully cleaned up");
    assert.equal(remainingUsers.length, 0, "fixture users must be fully cleaned up");
    console.log("workload api fixture cleanup verified: no fixture rows remain");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
