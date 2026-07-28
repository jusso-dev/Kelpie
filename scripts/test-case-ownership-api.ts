/**
 * HTTP-level acceptance coverage for case ownership (issue #54): queue
 * assignment without an individual owner, tenant isolation on queue/team FK
 * checks, optimistic-locking version conflicts, idempotent acknowledgement,
 * additional assignees, immutable shift hand-offs, and watchers — all
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
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../src/db";
import {
  apiTokens,
  caseAssignees,
  caseHandoffs,
  caseWatchers,
  cases,
  organisations,
  teams,
  timelineEvents,
  users,
} from "../src/db/schema";
import { generateApiToken } from "../src/lib/api-tokens";
import { newId } from "../src/lib/utils";

const BASE_URL = process.env.API_BASE_URL ?? "http://127.0.0.1:3111";

const runId = newId("caseownapitest").slice("caseownapitest_".length).slice(0, 12);
const orgAId = `org_caseownapi_a_${runId}`;
const orgBId = `org_caseownapi_b_${runId}`;

const FULL_SCOPES = ["cases:read", "cases:write", "watchers:read", "watchers:write"];

async function createOrg(id: string, name: string): Promise<void> {
  await db.insert(organisations).values({ id, name, slug: id.replace(/_/g, "-") });
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

let userCounter = 0;
async function createUser(organisationId: string, name: string): Promise<string> {
  userCounter += 1;
  const id = newId("user");
  await db.insert(users).values({
    id,
    organisationId,
    name,
    email: `caseownapi-${runId}-${userCounter}@example.test`,
  });
  return id;
}

async function createTeam(organisationId: string, name: string): Promise<string> {
  const id = newId("team");
  await db.insert(teams).values({ id, organisationId, name });
  return id;
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
    caseNumber: `CASEOWNAPI-${runId}-${String(caseCounter).padStart(3, "0")}`,
    title: `Case ownership fixture ${caseCounter}`,
    ...overrides,
  });
  return id;
}

function headers(token: string): Record<string, string> {
  return { "content-type": "application/json", authorization: `Bearer ${token}` };
}

function getCase(token: string, caseId: string): Promise<Response> {
  return fetch(`${BASE_URL}/api/v1/cases/${caseId}`, { headers: headers(token) });
}

function patchQueue(token: string, caseId: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(`${BASE_URL}/api/v1/cases/${caseId}/queue`, {
    method: "PATCH",
    headers: headers(token),
    body: JSON.stringify(body),
  });
}

function acknowledge(token: string, caseId: string): Promise<Response> {
  return fetch(`${BASE_URL}/api/v1/cases/${caseId}/acknowledge`, {
    method: "POST",
    headers: headers(token),
  });
}

function listAssignees(token: string, caseId: string): Promise<Response> {
  return fetch(`${BASE_URL}/api/v1/cases/${caseId}/assignees`, { headers: headers(token) });
}

function addAssignee(token: string, caseId: string, userId: string): Promise<Response> {
  return fetch(`${BASE_URL}/api/v1/cases/${caseId}/assignees`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({ userId }),
  });
}

function removeAssignee(token: string, caseId: string, userId: string): Promise<Response> {
  return fetch(`${BASE_URL}/api/v1/cases/${caseId}/assignees/${userId}`, {
    method: "DELETE",
    headers: headers(token),
  });
}

function createHandoff(token: string, caseId: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(`${BASE_URL}/api/v1/cases/${caseId}/handoffs`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify(body),
  });
}

function listWatchers(token: string, caseId: string): Promise<Response> {
  return fetch(`${BASE_URL}/api/v1/cases/${caseId}/watchers`, { headers: headers(token) });
}

function addWatcher(token: string, caseId: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(`${BASE_URL}/api/v1/cases/${caseId}/watchers`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify(body),
  });
}

function patchWatcher(
  token: string,
  caseId: string,
  userId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return fetch(`${BASE_URL}/api/v1/cases/${caseId}/watchers/${userId}`, {
    method: "PATCH",
    headers: headers(token),
    body: JSON.stringify(body),
  });
}

async function loadCaseRow(caseId: string) {
  const [row] = await db.select().from(cases).where(eq(cases.id, caseId)).limit(1);
  return row ?? null;
}

async function timelineEventsFor(caseId: string, eventType: string) {
  return db
    .select()
    .from(timelineEvents)
    .where(and(eq(timelineEvents.caseId, caseId), eq(timelineEvents.eventType, eventType)));
}

async function main() {
  await createOrg(orgAId, "Case Ownership API Test Org A");
  await createOrg(orgBId, "Case Ownership API Test Org B");

  const userIds: string[] = [];
  const teamIds: string[] = [];
  const caseIds: string[] = [];

  async function seedUser(org: "A" | "B", name: string) {
    const id = await createUser(org === "A" ? orgAId : orgBId, name);
    userIds.push(id);
    return id;
  }
  async function seedTeam(org: "A" | "B", name: string) {
    const id = await createTeam(org === "A" ? orgAId : orgBId, name);
    teamIds.push(id);
    return id;
  }
  async function seedCase(org: "A" | "B", overrides: Partial<typeof cases.$inferInsert> = {}) {
    const id = await createCase(org === "A" ? orgAId : orgBId, overrides);
    caseIds.push(id);
    return id;
  }

  const actorA = await seedUser("A", "Org A Actor");
  const orgAToken = await createToken(orgAId, "orgA full", FULL_SCOPES, actorA);
  const orgBToken = await createToken(orgBId, "orgB full", FULL_SCOPES, null);

  try {
    // ── 1. Queue assignment with no individual assignee ──────────────────────
    const teamA = await seedTeam("A", `Tier 1 Queue ${runId}`);
    const queueCase = await seedCase("A");

    const queueRes = await patchQueue(orgAToken, queueCase, { queueId: teamA });
    assert.equal(queueRes.status, 200, `queue assignment must return 200, got ${queueRes.status}`);

    const afterQueueAssign = await loadCaseRow(queueCase);
    assert.equal(afterQueueAssign?.queueId, teamA, "queueId must be set to the assigned team");
    assert.equal(
      afterQueueAssign?.assigneeId,
      null,
      "assigneeId must remain null: a case can belong to a team queue without an individual owner",
    );
    assert.ok(afterQueueAssign?.queueAssignedAt, "queueAssignedAt must be stamped when a queue is assigned");
    assert.equal(
      afterQueueAssign?.acknowledgedAt,
      null,
      "acknowledgedAt must still be null: queue assignment must not alias acknowledgement",
    );
    assert.equal(
      afterQueueAssign?.assigneeAssignedAt,
      null,
      "assigneeAssignedAt must still be null: queue assignment must not alias individual-assignee timestamps",
    );

    // ── 2. Cross-org queue assignment rejected ────────────────────────────────
    const teamB = await seedTeam("B", `Cross-org Queue ${runId}`);
    const crossQueueRes = await patchQueue(orgAToken, queueCase, { queueId: teamB });
    assert.equal(
      crossQueueRes.status,
      404,
      `assigning to a queue/team from a different org must return 404, got ${crossQueueRes.status}`,
    );
    const afterCrossAttempt = await loadCaseRow(queueCase);
    assert.equal(
      afterCrossAttempt?.queueId,
      teamA,
      "a rejected cross-org queue assignment must never change the case's queue",
    );

    // ── 3. Version conflict on queue PATCH ────────────────────────────────────
    const currentVersion = afterCrossAttempt!.version;
    const conflictRes = await patchQueue(orgAToken, queueCase, {
      queueId: teamA,
      version: currentVersion - 1,
    });
    assert.equal(conflictRes.status, 409, `stale version must return 409, got ${conflictRes.status}`);
    const conflictJson = (await conflictRes.json()) as { error: string; current: Record<string, unknown> };
    assert.equal(conflictJson.error, "version_conflict");
    assert.ok(conflictJson.current, "409 body must include a current snapshot");
    assert.equal(
      conflictJson.current.version,
      currentVersion,
      "the current snapshot must reflect the actual persisted version, not the stale one sent",
    );

    // ── 4. Acknowledge is idempotent, writes exactly one timeline event ─────
    const ackCase = await seedCase("A");
    const ackRes1 = await acknowledge(orgAToken, ackCase);
    assert.equal(ackRes1.status, 200, `first acknowledge must return 200, got ${ackRes1.status}`);
    const ackJson1 = (await ackRes1.json()) as { acknowledgedAt: string; alreadyAcknowledged: boolean };
    assert.ok(ackJson1.acknowledgedAt, "acknowledgedAt must be set on first acknowledgement");
    assert.equal(ackJson1.alreadyAcknowledged, false, "first acknowledgement must not report alreadyAcknowledged");

    const ackRes2 = await acknowledge(orgAToken, ackCase);
    assert.equal(ackRes2.status, 200, `second acknowledge must still return 200, got ${ackRes2.status}`);
    const ackJson2 = (await ackRes2.json()) as { acknowledgedAt: string; alreadyAcknowledged: boolean };
    assert.equal(
      ackJson2.acknowledgedAt,
      ackJson1.acknowledgedAt,
      "a repeated acknowledgement must return the same acknowledgedAt timestamp",
    );
    assert.equal(ackJson2.alreadyAcknowledged, true, "a repeated acknowledgement must report alreadyAcknowledged:true");

    const ackEvents = await timelineEventsFor(ackCase, "acknowledged");
    assert.equal(
      ackEvents.length,
      1,
      `exactly one "acknowledged" timeline event must exist after two acknowledge calls, found ${ackEvents.length}`,
    );

    // ── 5. Additional assignees: idempotent add/remove ───────────────────────
    const assigneeCase = await seedCase("A");
    const extraUser = await seedUser("A", "Extra Assignee");

    const addAssigneeRes1 = await addAssignee(orgAToken, assigneeCase, extraUser);
    assert.equal(addAssigneeRes1.status, 201, `first add-assignee must return 201, got ${addAssigneeRes1.status}`);

    const listAssigneesRes1 = await listAssignees(orgAToken, assigneeCase);
    const listAssignees1 = (await listAssigneesRes1.json()) as { assignees: Array<{ userId: string }> };
    assert.ok(
      listAssignees1.assignees.some((a) => a.userId === extraUser),
      "newly added additional assignee must appear in the list",
    );

    const addAssigneeRes2 = await addAssignee(orgAToken, assigneeCase, extraUser);
    assert.equal(
      addAssigneeRes2.status,
      201,
      `re-adding the same additional assignee must still succeed, got ${addAssigneeRes2.status}`,
    );
    const rowsForExtra = await db
      .select()
      .from(caseAssignees)
      .where(and(eq(caseAssignees.caseId, assigneeCase), eq(caseAssignees.userId, extraUser)));
    assert.equal(rowsForExtra.length, 1, "re-adding the same additional assignee must not create a duplicate row");

    const removeAssigneeRes1 = await removeAssignee(orgAToken, assigneeCase, extraUser);
    assert.equal(removeAssigneeRes1.status, 200);
    const removeAssigneeJson1 = (await removeAssigneeRes1.json()) as { ok: boolean };
    assert.equal(removeAssigneeJson1.ok, true);

    const removeAssigneeRes2 = await removeAssignee(orgAToken, assigneeCase, extraUser);
    assert.equal(
      removeAssigneeRes2.status,
      200,
      `removing an already-removed additional assignee must still return 200, got ${removeAssigneeRes2.status}`,
    );
    const removeAssigneeJson2 = (await removeAssigneeRes2.json()) as { ok: boolean };
    assert.equal(removeAssigneeJson2.ok, true, "removing an already-removed additional assignee must be idempotent");

    // ── 6. Hand-offs: transfer ownership, immutable snapshot, DB-level immutability ─
    const handoffFromUser = await seedUser("A", "Outgoing Analyst");
    const handoffToUser = await seedUser("A", "Incoming Analyst");
    const handoffCase = await seedCase("A", { assigneeId: handoffFromUser, assigneeAssignedAt: new Date() });

    const handoffNote = "End of shift — please pick up outstanding IOC triage.";
    const handoffRes = await createHandoff(orgAToken, handoffCase, {
      toUserId: handoffToUser,
      note: handoffNote,
    });
    assert.equal(handoffRes.status, 201, `hand-off create must return 201, got ${handoffRes.status}`);
    const handoffJson = (await handoffRes.json()) as { handoff: { id: string } };
    const handoffId = handoffJson.handoff.id;

    const afterHandoffCase = await loadCaseRow(handoffCase);
    assert.equal(
      afterHandoffCase?.assigneeId,
      handoffToUser,
      "a hand-off with toUserId must actually change the case's assigneeId to the target",
    );

    const [handoffRow] = await db.select().from(caseHandoffs).where(eq(caseHandoffs.id, handoffId)).limit(1);
    assert.ok(handoffRow, "a case_handoffs row must exist for the created hand-off");
    assert.equal(handoffRow!.fromUserId, handoffFromUser);
    assert.equal(handoffRow!.toUserId, handoffToUser);
    assert.equal(handoffRow!.note, handoffNote);
    const snapshot = handoffRow!.snapshot as Record<string, unknown>;
    assert.equal(
      snapshot.assigneeId,
      handoffFromUser,
      "the hand-off snapshot must capture the PRE-handoff assignee, not the post-handoff one",
    );

    // Direct proof of DB-level immutability: a raw UPDATE against the note
    // column must be rejected by the append-only trigger.
    let rawUpdateRejected = false;
    try {
      await db.execute(sql`UPDATE case_handoffs SET note = 'tampered note' WHERE id = ${handoffId}`);
    } catch {
      rawUpdateRejected = true;
    }
    assert.equal(
      rawUpdateRejected,
      true,
      "a raw SQL UPDATE against case_handoffs.note must be rejected by the append-only DB trigger",
    );
    const [handoffRowAfterAttempt] = await db
      .select()
      .from(caseHandoffs)
      .where(eq(caseHandoffs.id, handoffId))
      .limit(1);
    assert.equal(
      handoffRowAfterAttempt!.note,
      handoffNote,
      "the hand-off note must be unchanged after the rejected raw UPDATE attempt",
    );

    const emptyNoteRes = await createHandoff(orgAToken, handoffCase, { toUserId: handoffToUser, note: "" });
    assert.equal(emptyNoteRes.status, 400, `hand-off with an empty note must return 400, got ${emptyNoteRes.status}`);

    const noTargetRes = await createHandoff(orgAToken, handoffCase, { note: "Missing a target" });
    assert.equal(
      noTargetRes.status,
      400,
      `hand-off with neither toUserId nor toQueueId must return 400, got ${noTargetRes.status}`,
    );

    // ── 7. Watchers: access is org+role only, preferences update persists ───
    const watcherCase = await seedCase("A");
    const watcherUser = await seedUser("A", "Watching Analyst");
    const nonWatcherUser = await seedUser("A", "Non-watching Analyst");
    const nonWatcherToken = await createToken(orgAId, "orgA non-watcher actor", FULL_SCOPES, nonWatcherUser);

    const addWatcherRes = await addWatcher(orgAToken, watcherCase, { userId: watcherUser });
    assert.equal(addWatcherRes.status, 201, `add watcher must return 201, got ${addWatcherRes.status}`);

    // A same-org user who is NOT a watcher can still read the case: Kelpie's
    // access model is org+role only, watcher status never gates access.
    const nonWatcherReadRes = await getCase(nonWatcherToken, watcherCase);
    assert.equal(
      nonWatcherReadRes.status,
      200,
      `a non-watcher in the same org must still be able to read the case, got ${nonWatcherReadRes.status}`,
    );

    const patchWatcherRes = await patchWatcher(orgAToken, watcherCase, watcherUser, {
      notifyOnComment: false,
      notifyOnEscalation: false,
    });
    assert.equal(patchWatcherRes.status, 200, `watcher preference PATCH must return 200, got ${patchWatcherRes.status}`);

    const watchersListRes = await listWatchers(orgAToken, watcherCase);
    const watchersListJson = (await watchersListRes.json()) as {
      watchers: Array<{
        userId: string;
        notifyOnComment: boolean;
        notifyOnStatusChange: boolean;
        notifyOnAssignment: boolean;
        notifyOnEscalation: boolean;
      }>;
    };
    const watcherEntry = watchersListJson.watchers.find((w) => w.userId === watcherUser);
    assert.ok(watcherEntry, "the watcher must appear in the case's watcher list");
    assert.equal(watcherEntry?.notifyOnComment, false, "notifyOnComment must have been persisted as false");
    assert.equal(watcherEntry?.notifyOnEscalation, false, "notifyOnEscalation must have been persisted as false");
    assert.equal(
      watcherEntry?.notifyOnStatusChange,
      true,
      "notifyOnStatusChange must remain unchanged (true) since it was not part of the PATCH",
    );
    assert.equal(
      watcherEntry?.notifyOnAssignment,
      true,
      "notifyOnAssignment must remain unchanged (true) since it was not part of the PATCH",
    );

    console.log("ok: queue assignment sets queueId/queueAssignedAt with assigneeId staying null");
    console.log("ok: cross-org queue assignment rejected with 404, case unchanged");
    console.log("ok: stale-version queue PATCH returns 409 with an accurate current snapshot");
    console.log("ok: acknowledge is idempotent and writes exactly one timeline event");
    console.log("ok: additional assignee add/list/remove is idempotent");
    console.log("ok: hand-off transfers ownership, snapshot captures pre-handoff state, DB trigger blocks raw UPDATE");
    console.log("ok: hand-off rejects empty note and missing target with 400");
    console.log("ok: watcher status does not gate case access; preference PATCH persists");
    console.log("case ownership api tests passed");
  } finally {
    if (caseIds.length > 0) {
      // case_assignees / case_watchers / case_handoffs all cascade-delete via
      // their case_id FK. case_handoffs additionally has a DB trigger that
      // rejects any *top-level* DELETE against it directly (see migration
      // 0021) — only a cascade nested inside this cases delete is permitted,
      // so we must never issue an explicit `delete(caseHandoffs)` here.
      await db.delete(timelineEvents).where(inArray(timelineEvents.caseId, caseIds));
      await db.delete(cases).where(inArray(cases.id, caseIds));
    }
    if (teamIds.length > 0) {
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

    const remainingCases =
      caseIds.length > 0 ? await db.select({ id: cases.id }).from(cases).where(inArray(cases.id, caseIds)) : [];
    const remainingAssignees =
      caseIds.length > 0
        ? await db.select({ id: caseAssignees.id }).from(caseAssignees).where(inArray(caseAssignees.caseId, caseIds))
        : [];
    const remainingWatchers =
      caseIds.length > 0
        ? await db.select({ id: caseWatchers.id }).from(caseWatchers).where(inArray(caseWatchers.caseId, caseIds))
        : [];
    const remainingHandoffs =
      caseIds.length > 0
        ? await db.select({ id: caseHandoffs.id }).from(caseHandoffs).where(inArray(caseHandoffs.caseId, caseIds))
        : [];
    const remainingTeams =
      teamIds.length > 0 ? await db.select({ id: teams.id }).from(teams).where(inArray(teams.id, teamIds)) : [];
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

    assert.equal(remainingCases.length, 0, "fixture cases must be fully cleaned up");
    assert.equal(remainingAssignees.length, 0, "fixture case_assignees must be fully cleaned up");
    assert.equal(remainingWatchers.length, 0, "fixture case_watchers must be fully cleaned up");
    assert.equal(remainingHandoffs.length, 0, "fixture case_handoffs must be fully cleaned up");
    assert.equal(remainingTeams.length, 0, "fixture teams must be fully cleaned up");
    assert.equal(remainingUsers.length, 0, "fixture users must be fully cleaned up");
    assert.equal(remainingTokens.length, 0, "fixture api tokens must be fully cleaned up");
    assert.equal(remainingOrgs.length, 0, "fixture orgs must be fully cleaned up");
    console.log("case ownership api fixture cleanup verified: no fixture rows remain");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
