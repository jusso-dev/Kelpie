/**
 * HTTP-level acceptance coverage for the teams/queues administration feature
 * (issue #54): tenant isolation, duplicate-name handling, membership
 * management, scope enforcement, and active/inactive filtering — all
 * exercised against the real running routes and a real Postgres instance,
 * mirroring `scripts/test-case-relationships-api.ts`'s structure
 * (two-organisation tenant isolation fixtures, real `fetch()` calls, full
 * teardown with zero-rows-remain assertions at the end).
 *
 * This script assumes a server is already listening at `API_BASE_URL`
 * (default `http://127.0.0.1:3111`) against the same `DATABASE_URL` this
 * process uses, and that migrations have already been applied.
 */
import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import { apiTokens, organisations, teamMembers, teams, users } from "../src/db/schema";
import { generateApiToken } from "../src/lib/api-tokens";
import { newId } from "../src/lib/utils";

const BASE_URL = process.env.API_BASE_URL ?? "http://127.0.0.1:3111";

const runId = newId("teamsapitest").slice("teamsapitest_".length).slice(0, 12);
const orgAId = `org_teamsapi_a_${runId}`;
const orgBId = `org_teamsapi_b_${runId}`;

const FULL_SCOPES = ["teams:read", "teams:write"];

type TeamRow = {
  id: string;
  organisationId: string;
  name: string;
  description: string | null;
  isActive: boolean;
};

type MemberRow = {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: "lead" | "member";
};

async function createOrg(id: string, name: string): Promise<void> {
  await db.insert(organisations).values({ id, name, slug: id.replace(/_/g, "-") });
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

let userCounter = 0;
async function createUser(organisationId: string, name: string): Promise<string> {
  userCounter += 1;
  const id = newId("user");
  await db.insert(users).values({
    id,
    organisationId,
    name,
    email: `teamsapi-${runId}-${userCounter}@example.test`,
  });
  return id;
}

function headers(token: string): Record<string, string> {
  return { "content-type": "application/json", authorization: `Bearer ${token}` };
}

function listTeams(token: string, query?: string): Promise<Response> {
  return fetch(`${BASE_URL}/api/v1/teams${query ? `?${query}` : ""}`, { headers: headers(token) });
}

function createTeam(token: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(`${BASE_URL}/api/v1/teams`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify(body),
  });
}

function getTeam(token: string, teamId: string): Promise<Response> {
  return fetch(`${BASE_URL}/api/v1/teams/${teamId}`, { headers: headers(token) });
}

function patchTeam(token: string, teamId: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(`${BASE_URL}/api/v1/teams/${teamId}`, {
    method: "PATCH",
    headers: headers(token),
    body: JSON.stringify(body),
  });
}

function listMembers(token: string, teamId: string): Promise<Response> {
  return fetch(`${BASE_URL}/api/v1/teams/${teamId}/members`, { headers: headers(token) });
}

function addMember(token: string, teamId: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(`${BASE_URL}/api/v1/teams/${teamId}/members`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify(body),
  });
}

function removeMember(token: string, teamId: string, userId: string): Promise<Response> {
  return fetch(`${BASE_URL}/api/v1/teams/${teamId}/members/${userId}`, {
    method: "DELETE",
    headers: headers(token),
  });
}

async function main() {
  await createOrg(orgAId, "Teams API Test Org A");
  await createOrg(orgBId, "Teams API Test Org B");

  const orgAToken = await createToken(orgAId, "orgA full", FULL_SCOPES);
  const orgAReadOnlyToken = await createToken(orgAId, "orgA read-only", ["teams:read"]);
  const orgBToken = await createToken(orgBId, "orgB full", FULL_SCOPES);

  const userIds: string[] = [];
  const teamIds: string[] = [];

  async function seedUser(org: "A" | "B", name: string) {
    const id = await createUser(org === "A" ? orgAId : orgBId, name);
    userIds.push(id);
    return id;
  }

  try {
    // ── 1. Tenant isolation: org B cannot see/patch org A's team ────────────
    const teamName1 = `SOC Tier 1 ${runId}`;
    const createRes1 = await createTeam(orgAToken, { name: teamName1, description: "First-line triage" });
    assert.equal(createRes1.status, 201, `create team must return 201, got ${createRes1.status}`);
    const createJson1 = (await createRes1.json()) as { team: TeamRow };
    const teamAId = createJson1.team.id;
    teamIds.push(teamAId);
    assert.equal(createJson1.team.organisationId, orgAId);

    const crossGetRes = await getTeam(orgBToken, teamAId);
    assert.equal(crossGetRes.status, 404, `org B GET of org A's team must return 404, got ${crossGetRes.status}`);

    const crossPatchRes = await patchTeam(orgBToken, teamAId, { name: "Hijacked name" });
    assert.equal(
      crossPatchRes.status,
      404,
      `org B PATCH of org A's team must return 404, got ${crossPatchRes.status}`,
    );

    const orgBListRes = await listTeams(orgBToken);
    assert.equal(orgBListRes.status, 200);
    const orgBList = (await orgBListRes.json()) as { teams: TeamRow[] };
    assert.ok(
      !orgBList.teams.some((t) => t.id === teamAId),
      "org A's team must never appear in org B's team list",
    );

    // Sanity: org A can see and patch its own team.
    const ownGetRes = await getTeam(orgAToken, teamAId);
    assert.equal(ownGetRes.status, 200, `org A GET of its own team must return 200, got ${ownGetRes.status}`);

    // ── 2. Duplicate name in same org → 409; same name across orgs → both ok ─
    const dupRes = await createTeam(orgAToken, { name: teamName1, description: "Duplicate attempt" });
    assert.equal(
      dupRes.status,
      409,
      `duplicate team name within the same org must return 409, got ${dupRes.status}`,
    );

    const crossOrgSameNameRes = await createTeam(orgBToken, { name: teamName1, description: "Different org" });
    assert.equal(
      crossOrgSameNameRes.status,
      201,
      `the same team name in a different org must succeed (not a global unique constraint), got ${crossOrgSameNameRes.status}`,
    );
    const crossOrgSameNameJson = (await crossOrgSameNameRes.json()) as { team: TeamRow };
    teamIds.push(crossOrgSameNameJson.team.id);
    assert.notEqual(crossOrgSameNameJson.team.id, teamAId);

    // ── 3. Cross-org member add rejected; same-org member add + idempotent remove ─
    const orgBUser = await seedUser("B", "Org B Analyst");
    const crossMemberRes = await addMember(orgAToken, teamAId, { userId: orgBUser });
    assert.equal(
      crossMemberRes.status,
      404,
      `adding an org B user to an org A team must return 404 (not silently succeed), got ${crossMemberRes.status}`,
    );

    const orgAUser = await seedUser("A", "Org A Analyst");
    const memberRes = await addMember(orgAToken, teamAId, { userId: orgAUser, role: "member" });
    assert.equal(memberRes.status, 201, `adding an org A user to an org A team must return 201, got ${memberRes.status}`);

    const membersListRes = await listMembers(orgAToken, teamAId);
    assert.equal(membersListRes.status, 200);
    const membersList = (await membersListRes.json()) as { members: MemberRow[] };
    assert.ok(
      membersList.members.some((m) => m.userId === orgAUser),
      "newly added member must appear in the team's member list",
    );
    assert.ok(
      !membersList.members.some((m) => m.userId === orgBUser),
      "the rejected cross-org add must never have persisted a membership row",
    );

    const removeRes1 = await removeMember(orgAToken, teamAId, orgAUser);
    assert.equal(removeRes1.status, 200);
    const removeJson1 = (await removeRes1.json()) as { ok: boolean };
    assert.equal(removeJson1.ok, true, "first removal must report ok:true");

    const removeRes2 = await removeMember(orgAToken, teamAId, orgAUser);
    assert.equal(removeRes2.status, 200, `removing an already-removed member must still return 200, got ${removeRes2.status}`);
    const removeJson2 = (await removeRes2.json()) as { ok: boolean };
    assert.equal(removeJson2.ok, true, "removing an already-removed member must be idempotent and report ok:true");

    const membersAfterRemoveRes = await listMembers(orgAToken, teamAId);
    const membersAfterRemove = (await membersAfterRemoveRes.json()) as { members: MemberRow[] };
    assert.ok(
      !membersAfterRemove.members.some((m) => m.userId === orgAUser),
      "removed member must no longer appear in the team's member list",
    );

    // ── 4. Scope enforcement: read-only token forbidden on POST/PATCH ───────
    const forbiddenCreateRes = await createTeam(orgAReadOnlyToken, { name: `Should be forbidden ${runId}` });
    assert.equal(
      forbiddenCreateRes.status,
      403,
      `create with a teams:read-only token must return 403, got ${forbiddenCreateRes.status}`,
    );
    const forbiddenPatchRes = await patchTeam(orgAReadOnlyToken, teamAId, { name: "Should be forbidden" });
    assert.equal(
      forbiddenPatchRes.status,
      403,
      `patch with a teams:read-only token must return 403, got ${forbiddenPatchRes.status}`,
    );

    // ── 5. Deactivate → excluded by default, included with include_inactive ─
    const deactivateRes = await patchTeam(orgAToken, teamAId, { isActive: false });
    assert.equal(deactivateRes.status, 200, `deactivate must return 200, got ${deactivateRes.status}`);
    const deactivateJson = (await deactivateRes.json()) as { team: TeamRow };
    assert.equal(deactivateJson.team.isActive, false);

    const defaultListRes = await listTeams(orgAToken);
    const defaultList = (await defaultListRes.json()) as { teams: TeamRow[] };
    assert.ok(
      !defaultList.teams.some((t) => t.id === teamAId),
      "a deactivated team must be excluded from the default team list",
    );

    const includeInactiveListRes = await listTeams(orgAToken, "include_inactive=true");
    const includeInactiveList = (await includeInactiveListRes.json()) as { teams: TeamRow[] };
    assert.ok(
      includeInactiveList.teams.some((t) => t.id === teamAId),
      "a deactivated team must be included when include_inactive=true is passed",
    );

    console.log("ok: tenant isolation on GET/PATCH by id and list exclusion");
    console.log("ok: duplicate name in same org rejected with 409, same name across orgs both succeed");
    console.log("ok: cross-org member add rejected with 404, same-org add/list/idempotent-remove work");
    console.log("ok: teams:read-only token forbidden (403) on POST and PATCH");
    console.log("ok: deactivated team excluded from default list, included with include_inactive=true");
    console.log("teams api tests passed");
  } finally {
    if (teamIds.length > 0) {
      await db.delete(teamMembers).where(inArray(teamMembers.teamId, teamIds));
      await db.delete(teams).where(inArray(teams.id, teamIds));
    }
    if (userIds.length > 0) {
      await db.delete(users).where(inArray(users.id, userIds));
    }
    for (const orgId of [orgAId, orgBId]) {
      await db.delete(apiTokens).where(eq(apiTokens.organisationId, orgId));
    }
    for (const orgId of [orgAId, orgBId]) {
      await db.delete(organisations).where(eq(organisations.id, orgId));
    }

    const remainingTeams =
      teamIds.length > 0 ? await db.select({ id: teams.id }).from(teams).where(inArray(teams.id, teamIds)) : [];
    const remainingMembers =
      teamIds.length > 0
        ? await db.select({ id: teamMembers.id }).from(teamMembers).where(inArray(teamMembers.teamId, teamIds))
        : [];
    const remainingUsers =
      userIds.length > 0 ? await db.select({ id: users.id }).from(users).where(inArray(users.id, userIds)) : [];
    const remainingTokens = await db
      .select({ id: apiTokens.id })
      .from(apiTokens)
      .where(inArray(apiTokens.organisationId, [orgAId, orgBId]));
    const remainingOrgs = await db
      .select({ id: organisations.id })
      .from(organisations)
      .where(inArray(organisations.id, [orgAId, orgBId]));

    assert.equal(remainingTeams.length, 0, "fixture teams must be fully cleaned up");
    assert.equal(remainingMembers.length, 0, "fixture team members must be fully cleaned up");
    assert.equal(remainingUsers.length, 0, "fixture users must be fully cleaned up");
    assert.equal(remainingTokens.length, 0, "fixture api tokens must be fully cleaned up");
    assert.equal(remainingOrgs.length, 0, "fixture orgs must be fully cleaned up");
    console.log("teams api fixture cleanup verified: no fixture rows remain");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
