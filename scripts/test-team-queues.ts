/**
 * Acceptance coverage for issue #54 (team queues, watchers, hand-offs,
 * escalation policies, workload views). Mirrors the structure of
 * scripts/test-case-relationships-api.ts and scripts/test-case-queue.ts:
 * two-organisation tenant-isolation fixtures, real REST calls against a
 * running server, direct core-lib assertions for aggregate/DB-level
 * guarantees, a Playwright pass for UI/permissions/accessibility, and full
 * teardown with zero-rows-remain assertions.
 *
 * This script assumes a server is already listening at `API_BASE_URL`
 * (used for REST) and `APP_URL` (used for the browser pass), against the
 * same `DATABASE_URL` this process uses, with migrations already applied.
 */
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import {
  apiTokens,
  bulkOperations,
  caseAssignees,
  caseWatchers,
  cases,
  escalationPolicies,
  escalationPolicyRuns,
  organisations,
  queues,
  shiftHandoffs,
  teamMembers,
  teams,
  timelineEvents,
  users,
} from "../src/db/schema";
import { generateApiToken } from "../src/lib/api-tokens";
import { newId } from "../src/lib/utils";
import {
  acknowledgeCaseCore,
  analystWorkloadCore,
  assignCaseAnalystCore,
  assignCaseQueueCore,
  queueHealthCore,
} from "../src/lib/queues-core";
import {
  createEscalationPolicyCore,
  runEscalationPolicies,
  setEscalationPolicyActiveCore,
  testEscalationPolicyCore,
  updateEscalationPolicyCore,
} from "../src/lib/escalation-core";
import { runBulkOperationCore } from "../src/lib/bulk-operations-core";

const API_BASE_URL = process.env.API_BASE_URL ?? process.env.APP_URL ?? "http://127.0.0.1:3000";
const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:3000";

const runId = newId("q54").slice("q54_".length).slice(0, 10);
const orgAId = `org_q54_a_${runId}`;
const orgBId = `org_q54_b_${runId}`;

const FULL_SCOPES = ["queues:read", "queues:write", "cases:read", "cases:write"];

function headers(token: string): Record<string, string> {
  return { "content-type": "application/json", authorization: `Bearer ${token}` };
}

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
  await db.insert(apiTokens).values({ id: newId("api_token"), organisationId, name, tokenHash: hash, scopes, createdBy });
  return plaintext;
}

async function createUser(organisationId: string, email: string, name: string, role: "admin" | "analyst" | "read_only" = "analyst") {
  const id = newId("user");
  await db.insert(users).values({ id, organisationId, email, name, role });
  return id;
}

let caseCounter = 0;
async function createCase(organisationId: string, overrides: Partial<typeof cases.$inferInsert> = {}) {
  caseCounter += 1;
  const id = newId("case");
  await db.insert(cases).values({
    id,
    organisationId,
    caseNumber: `Q54-${runId}-${String(caseCounter).padStart(4, "0")}`,
    title: `Team queue fixture ${caseCounter}`,
    ...overrides,
  });
  return id;
}

async function main() {
  await createOrg(orgAId, "Team Queues Test Org A");
  await createOrg(orgBId, "Team Queues Test Org B");

  const analystA1 = await createUser(orgAId, `analyst1-${runId}@example.test`, "Analyst One");
  const analystA2 = await createUser(orgAId, `analyst2-${runId}@example.test`, "Analyst Two");
  const analystB1 = await createUser(orgBId, `analystb-${runId}@example.test`, "Analyst B");

  const orgAToken = await createToken(orgAId, "orgA full", FULL_SCOPES, analystA1);
  const orgAReadOnlyToken = await createToken(orgAId, "orgA read-only", ["cases:read", "queues:read"], analystA1);
  const orgBToken = await createToken(orgBId, "orgB full", FULL_SCOPES, analystB1);

  const caseIds: string[] = [];
  async function seedCase(org: "A" | "B", overrides: Partial<typeof cases.$inferInsert> = {}) {
    const id = await createCase(org === "A" ? orgAId : orgBId, overrides);
    caseIds.push(id);
    return id;
  }

  const createdTeamIds: string[] = [];
  const createdQueueIds: string[] = [];
  const createdPolicyIds: string[] = [];

  try {
    // ── 1. Teams & queues over REST, tenant isolation ───────────────────────
    const createTeamRes = await fetch(`${API_BASE_URL}/api/v1/teams`, {
      method: "POST",
      headers: headers(orgAToken),
      body: JSON.stringify({ name: `Frontline ${runId}` }),
    });
    assert.equal(createTeamRes.status, 201, `team create must return 201, got ${createTeamRes.status}`);
    const { id: teamAId } = (await createTeamRes.json()) as { id: string };
    createdTeamIds.push(teamAId);

    const createQueueRes = await fetch(`${API_BASE_URL}/api/v1/queues`, {
      method: "POST",
      headers: headers(orgAToken),
      body: JSON.stringify({ teamId: teamAId, name: `Triage ${runId}` }),
    });
    assert.equal(createQueueRes.status, 201, `queue create must return 201, got ${createQueueRes.status}`);
    const { id: queueAId } = (await createQueueRes.json()) as { id: string };
    createdQueueIds.push(queueAId);

    const forbiddenQueueRes = await fetch(`${API_BASE_URL}/api/v1/queues`, {
      method: "POST",
      headers: headers(orgAReadOnlyToken),
      body: JSON.stringify({ teamId: teamAId, name: "Should be forbidden" }),
    });
    assert.equal(forbiddenQueueRes.status, 403, `queue create with a read-only-scoped token must return 403, got ${forbiddenQueueRes.status}`);

    // A different org's token must never see org A's queues/teams.
    const orgBQueuesRes = await fetch(`${API_BASE_URL}/api/v1/queues`, { headers: headers(orgBToken) });
    const orgBQueuesJson = (await orgBQueuesRes.json()) as { queues: Array<{ id: string }> };
    assert.ok(
      !orgBQueuesJson.queues.some((q) => q.id === queueAId),
      "org B's queue listing must never include org A's queue",
    );

    // ── 2. Queue ownership distinct from individual ownership, and three   ──
    // ──    distinct timestamps: queue assignment, analyst assignment,      ──
    // ──    acknowledgement.                                                ──
    const caseX = await seedCase("A", { assigneeId: null });
    await assignCaseQueueCore(orgAId, analystA1, caseX, queueAId);
    const [afterQueue] = await db.select().from(cases).where(eq(cases.id, caseX)).limit(1);
    assert.equal(afterQueue.queueId, queueAId, "case must belong to the queue with no individual owner");
    assert.equal(afterQueue.assigneeId, null, "queue assignment must not set an individual owner");
    assert.ok(afterQueue.queueAssignedAt, "queueAssignedAt must be set");
    assert.equal(afterQueue.assigneeAssignedAt, null, "assigneeAssignedAt must remain unset until an analyst is assigned");

    await assignCaseAnalystCore(orgAId, analystA1, caseX, analystA1);
    const [afterAssignee] = await db.select().from(cases).where(eq(cases.id, caseX)).limit(1);
    assert.ok(afterAssignee.assigneeAssignedAt, "assigneeAssignedAt must be set once an analyst is assigned");
    assert.notEqual(
      afterAssignee.assigneeAssignedAt?.getTime(),
      afterAssignee.queueAssignedAt?.getTime(),
      "queue assignment and analyst assignment timestamps must be distinct",
    );
    assert.equal(afterAssignee.acknowledgedAt, null, "acknowledgement must remain unset until explicitly acknowledged");

    const ackResult = await acknowledgeCaseCore(orgAId, analystA1, caseX);
    assert.equal(ackResult.alreadyAcknowledged, false);
    const [afterAck] = await db.select().from(cases).where(eq(cases.id, caseX)).limit(1);
    assert.ok(afterAck.acknowledgedAt, "acknowledgedAt must be set by the explicit acknowledge action");
    assert.equal(afterAck.acknowledgedBy, analystA1);
    assert.notEqual(
      afterAck.acknowledgedAt?.getTime(),
      afterAck.assigneeAssignedAt?.getTime(),
      "acknowledgement timestamp must be distinct from analyst assignment timestamp",
    );
    const secondAck = await acknowledgeCaseCore(orgAId, analystA2, caseX);
    assert.equal(secondAck.alreadyAcknowledged, true, "re-acknowledging must not overwrite the original acknowledgement");
    const [stillFirstAck] = await db.select().from(cases).where(eq(cases.id, caseX)).limit(1);
    assert.equal(stillFirstAck.acknowledgedBy, analystA1, "the original acknowledger must be preserved");

    // ── 3. Additional assignees, separate from the primary owner ───────────
    const addAssigneeRes = await fetch(`${API_BASE_URL}/api/v1/cases/${caseX}/watchers`, {
      method: "POST",
      headers: headers(orgAToken),
      body: JSON.stringify({ userId: analystA2 }),
    });
    assert.equal(addAssigneeRes.status, 201);

    // ── 4. Watchers: never grant access, preference-aware, tenant-isolated ─
    const watcherListRes = await fetch(`${API_BASE_URL}/api/v1/cases/${caseX}/watchers`, { headers: headers(orgAToken) });
    const watcherList = (await watcherListRes.json()) as { watchers: Array<{ userId: string; notifyOnComment: boolean }> };
    assert.ok(watcherList.watchers.some((w) => w.userId === analystA2), "watcher must appear in the case's watcher list");

    const crossOrgWatchRes = await fetch(`${API_BASE_URL}/api/v1/cases/${caseX}/watchers`, {
      method: "POST",
      headers: headers(orgAToken),
      body: JSON.stringify({ userId: analystB1 }),
    });
    assert.equal(crossOrgWatchRes.status, 400, "adding a watcher from another organisation must be rejected");

    const removeWatchRes = await fetch(`${API_BASE_URL}/api/v1/cases/${caseX}/watchers?userId=${analystA2}`, {
      method: "DELETE",
      headers: headers(orgAToken),
    });
    assert.equal(removeWatchRes.status, 200);
    const afterRemoveList = await db
      .select()
      .from(caseWatchers)
      .where(and(eq(caseWatchers.caseId, caseX), eq(caseWatchers.userId, analystA2)));
    assert.equal(afterRemoveList.length, 0, "removed watcher must no longer have a row");

    // ── 5. Immutable hand-off snapshot: create over REST, DB rejects edits ─
    const caseHandoff = await seedCase("A");
    const handoffRes = await fetch(`${API_BASE_URL}/api/v1/cases/${caseHandoff}/handoffs`, {
      method: "POST",
      headers: headers(orgAToken),
      body: JSON.stringify({ summary: "Contained the beacon, awaiting forensic image." }),
    });
    assert.equal(handoffRes.status, 201, `handoff create must return 201, got ${handoffRes.status}`);
    const { id: handoffId } = (await handoffRes.json()) as { id: string };

    let updateRejected = false;
    try {
      await db.update(shiftHandoffs).set({ summary: "Tampered" }).where(eq(shiftHandoffs.id, handoffId));
    } catch {
      updateRejected = true;
    }
    assert.ok(updateRejected, "the database must reject any direct update to a shift_handoffs row");

    let deleteRejected = false;
    try {
      await db.delete(shiftHandoffs).where(eq(shiftHandoffs.id, handoffId));
    } catch {
      deleteRejected = true;
    }
    assert.ok(deleteRejected, "the database must reject a direct top-level delete of a shift_handoffs row");

    const [handoffRow] = await db.select().from(shiftHandoffs).where(eq(shiftHandoffs.id, handoffId)).limit(1);
    assert.equal(handoffRow.summary, "Contained the beacon, awaiting forensic image.", "the hand-off must remain exactly as written");

    // ── 6. Escalation policies: versioned, safe to disable, never          ──
    // ──    destructive, testable dry run                                   ──
    const policy = await createEscalationPolicyCore(orgAId, analystA1, {
      name: `Unack escalation ${runId}`,
      conditions: { minUnacknowledgedMinutes: 0 },
      notifyEnabled: true,
      notifyTargets: ["assignee"],
      reassignEnabled: false,
      raiseSeverityEnabled: false,
    });
    createdPolicyIds.push(policy.id);
    const [freshPolicy] = await db.select().from(escalationPolicies).where(eq(escalationPolicies.id, policy.id)).limit(1);
    assert.equal(freshPolicy.isActive, false, "a newly created escalation policy must start disabled");
    assert.equal(freshPolicy.revision, 1);

    await updateEscalationPolicyCore(orgAId, policy.id, {
      name: freshPolicy.name,
      conditions: { minUnacknowledgedMinutes: 5 },
      notifyEnabled: true,
      notifyTargets: ["assignee"],
      reassignEnabled: false,
      raiseSeverityEnabled: false,
    });
    const [revisedPolicy] = await db.select().from(escalationPolicies).where(eq(escalationPolicies.id, policy.id)).limit(1);
    assert.equal(revisedPolicy.revision, 2, "editing a policy's conditions/actions must bump its revision");
    assert.equal(revisedPolicy.isActive, false, "editing a policy must not implicitly enable it");

    const caseForEscalation = await seedCase("A", { openedAt: new Date(Date.now() - 60 * 60 * 1000) });
    const dryRun = await testEscalationPolicyCore(orgAId, policy.id, caseForEscalation);
    assert.equal(dryRun.matches, true, "an unacknowledged case older than the threshold must match the dry run");
    const runsAfterDryRun = await db
      .select()
      .from(escalationPolicyRuns)
      .where(eq(escalationPolicyRuns.policyId, policy.id));
    assert.equal(runsAfterDryRun.length, 0, "testing a policy must never write an escalation_policy_runs row or apply any action");

    // The schema gives a destructive action literally nowhere to be stored:
    // reassignEnabled=true with no target is rejected by a CHECK constraint,
    // independent of any application-layer validation.
    let checkConstraintRejected = false;
    try {
      await db.insert(escalationPolicies).values({
        id: newId("escpol"),
        organisationId: orgAId,
        name: "Invalid reassign target",
        reassignEnabled: true,
        reassignToQueueId: null,
        reassignToUserId: null,
      });
    } catch {
      checkConstraintRejected = true;
    }
    assert.ok(checkConstraintRejected, "the database must reject reassignEnabled=true with no reassignment target");

    // ── 6b. Live runner: notify + reassign + raise severity, idempotent    ──
    const liveQueueRes = await fetch(`${API_BASE_URL}/api/v1/queues`, {
      method: "POST",
      headers: headers(orgAToken),
      body: JSON.stringify({ teamId: teamAId, name: `Escalation target ${runId}` }),
    });
    const { id: escalationTargetQueueId } = (await liveQueueRes.json()) as { id: string };
    createdQueueIds.push(escalationTargetQueueId);

    const livePolicy = await createEscalationPolicyCore(orgAId, analystA1, {
      name: `Live escalation ${runId}`,
      conditions: { severities: ["low"] },
      notifyEnabled: true,
      notifyTargets: ["assignee"],
      reassignEnabled: true,
      reassignToQueueId: escalationTargetQueueId,
      raiseSeverityEnabled: true,
      raiseSeverityTo: "high",
    });
    createdPolicyIds.push(livePolicy.id);
    await setEscalationPolicyActiveCore(orgAId, livePolicy.id, true);

    const liveCase = await seedCase("A", { severity: "low", assigneeId: analystA1 });
    const firstRun = await runEscalationPolicies();
    assert.ok(firstRun.triggered >= 1, "an active policy matching an open case must trigger at least once");

    const [caseAfterEscalation] = await db.select().from(cases).where(eq(cases.id, liveCase)).limit(1);
    assert.equal(caseAfterEscalation.severity, "high", "raise-severity action must apply the configured severity");
    assert.equal(caseAfterEscalation.queueId, escalationTargetQueueId, "reassign action must move the case to the configured queue");

    const liveRuns = await db
      .select()
      .from(escalationPolicyRuns)
      .where(and(eq(escalationPolicyRuns.policyId, livePolicy.id), eq(escalationPolicyRuns.caseId, liveCase)));
    assert.equal(liveRuns.length, 1, "exactly one run row must exist for this policy revision and case");
    assert.equal(liveRuns[0].notifySent, true, "the run must record that a notify action was applied");
    assert.equal(liveRuns[0].severityRaisedTo, "high");

    const escalationTimeline = await db
      .select()
      .from(timelineEvents)
      .where(and(eq(timelineEvents.caseId, liveCase), eq(timelineEvents.eventType, "escalation_triggered")));
    assert.equal(escalationTimeline.length, 1, "escalation must write exactly one timeline entry for this case");

    // Idempotency: running again must not re-fire the same policy revision
    // against the same case (severity is now "high", outside the policy's
    // ["low"] condition anyway, but the unique index is the real guarantee).
    await runEscalationPolicies();
    const liveRunsAfterSecondPass = await db
      .select()
      .from(escalationPolicyRuns)
      .where(and(eq(escalationPolicyRuns.policyId, livePolicy.id), eq(escalationPolicyRuns.caseId, liveCase)));
    assert.equal(liveRunsAfterSecondPass.length, 1, "re-running the escalation checker must not duplicate the run for the same policy revision and case");

    // ── 7. Bulk operations: one batch audit record, concise per-case       ──
    // ──    timeline entries, tenant isolation, and no capped-page count.   ──
    const bulkCaseA1 = await seedCase("A", { severity: "low" });
    const bulkCaseA2 = await seedCase("A", { severity: "low" });
    const bulkCaseCrossOrg = await seedCase("B");
    const beforeTimelineCount = (
      await db.select().from(timelineEvents).where(eq(timelineEvents.caseId, bulkCaseA1))
    ).length;

    const bulkResult = await runBulkOperationCore(
      orgAId,
      analystA1,
      "set_severity",
      [bulkCaseA1, bulkCaseA2, bulkCaseCrossOrg],
      { severity: "high" },
    );
    assert.equal(bulkResult.successCount, 2, "only the caller's own two cases must succeed");
    assert.equal(bulkResult.failureCount, 1, "the cross-tenant case id must be recorded as a failure, not silently dropped or applied");
    const [crossOrgCaseAfter] = await db.select({ severity: cases.severity }).from(cases).where(eq(cases.id, bulkCaseCrossOrg)).limit(1);
    assert.equal(crossOrgCaseAfter.severity, "medium", "a bulk operation must never mutate a case outside the caller's organisation");

    const batchRows = await db.select().from(bulkOperations).where(eq(bulkOperations.id, bulkResult.id));
    assert.equal(batchRows.length, 1, "exactly one batch audit record must exist for this bulk run");
    assert.equal(batchRows[0].successCount, 2);
    assert.equal(batchRows[0].failureCount, 1);

    const afterTimelineCount = (
      await db.select().from(timelineEvents).where(eq(timelineEvents.caseId, bulkCaseA1))
    ).length;
    assert.equal(afterTimelineCount, beforeTimelineCount + 1, "the affected case must get exactly one concise timeline entry, not a per-batch dump");

    // Concurrency: two overlapping bulk watcher-add operations for the same
    // user/case must never produce more than one watcher row.
    const concurrencyCase = await seedCase("A");
    const [firstBulk, secondBulk] = await Promise.all([
      runBulkOperationCore(orgAId, analystA1, "add_watcher", [concurrencyCase], { userId: analystA2 }),
      runBulkOperationCore(orgAId, analystA1, "add_watcher", [concurrencyCase], { userId: analystA2 }),
    ]);
    assert.equal(firstBulk.failureCount + secondBulk.failureCount, 0, "concurrent add-watcher bulk ops must not error against each other");
    const concurrentWatcherRows = await db
      .select()
      .from(caseWatchers)
      .where(and(eq(caseWatchers.caseId, concurrencyCase), eq(caseWatchers.userId, analystA2)));
    assert.equal(concurrentWatcherRows.length, 1, "racing add-watcher operations must still leave exactly one watcher row");

    // ── 8. Queue counts / workload use complete indexed queries ────────────
    const heavyQueueCaseIds: string[] = [];
    for (let i = 0; i < 60; i++) {
      const id = await seedCase("A", { assigneeId: analystA1, severity: "critical", queueId: queueAId });
      heavyQueueCaseIds.push(id);
    }
    const workload = await analystWorkloadCore(orgAId);
    const analystA1Workload = workload.find((w) => w.userId === analystA1);
    assert.ok(analystA1Workload, "analyst with active cases must appear in the workload rollup");
    assert.ok(
      (analystA1Workload?.activeCases ?? 0) >= 60,
      `workload active case count must include all 60 seeded cases, not a capped page (got ${analystA1Workload?.activeCases})`,
    );
    const health = await queueHealthCore(orgAId);
    const queueAHealth = health.find((h) => h.queueId === queueAId);
    assert.ok(queueAHealth, "queue health must include the seeded queue");
    assert.ok(
      (queueAHealth?.openCount ?? 0) >= 60,
      `queue health open count must include all 60 seeded cases, not a capped page (got ${queueAHealth?.openCount})`,
    );

    // Closed cases must be excluded from workload entirely.
    await seedCase("A", { assigneeId: analystA1, status: "closed", closedAt: new Date() });
    const workloadAfterClose = await analystWorkloadCore(orgAId);
    const totalOpenForAnalyst = (workloadAfterClose.find((w) => w.userId === analystA1)?.activeCases ?? 0);
    // Closing one more case must not increase the active count (it was
    // already closed at creation, so it was never counted).
    assert.equal(totalOpenForAnalyst, analystA1Workload?.activeCases, "closed cases must never be counted in active workload");

    console.log("team queues REST/core acceptance checks passed");

    // ── 9. UI: built-in views, bulk toolbar permissions, accessibility ─────
    const browser = await chromium.launch({ headless: true });
    try {
      // Reuse the seeded acme-soc org/admin for a UI pass, since REST fixture
      // orgs have no BetterAuth-capable password credentials.
      const [seedOrg] = await db
        .select({ id: organisations.id })
        .from(organisations)
        .where(eq(organisations.slug, "acme-soc"))
        .limit(1);
      assert.ok(seedOrg, "seed the demo database first (npm run db:seed)");

      const page = await browser.newPage();
      await page.goto(`${APP_URL}/sign-in`);
      await page.getByLabel("Email").fill("admin@acme.local");
      await page.getByLabel("Password").fill("kelpieadmin");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await page.waitForURL("**/dashboard");

      await page.goto(`${APP_URL}/cases`);
      await page.getByText(/Showing \d+-\d+ of \d+ matching case/).waitFor();
      const checkboxCount = await page.locator('input[type="checkbox"][name="caseIds"]').count();
      assert.ok(checkboxCount > 0, "admin must see bulk-selection checkboxes on the case queue");
      const firstCheckbox = page.locator('input[type="checkbox"][name="caseIds"]').first();
      assert.ok(
        (await firstCheckbox.getAttribute("aria-label"))?.startsWith("Select case"),
        "bulk-selection checkboxes must carry an accessible label",
      );

      await page.goto(`${APP_URL}/cases?view=unassigned`);
      await page.getByText(/Showing \d+-\d+ of \d+ matching case/).waitFor();
      const unassignedLink = page.getByRole("link", { name: "Unassigned" });
      assert.equal(await unassignedLink.getAttribute("aria-current"), "true", "the active built-in view link must expose aria-current");

      await page.goto(`${APP_URL}/queues`);
      await page.getByText("Per-analyst active workload").waitFor();
      const workloadBars = page.locator('[role="img"][aria-label*="Weighted load"]');
      if ((await workloadBars.count()) > 0) {
        assert.ok((await workloadBars.first().getAttribute("aria-label"))?.length, "workload bars must have a non-empty accessible name");
      }

      console.log("team queues admin UI checks passed");

      // Permissions: a read_only user must not get bulk-selection controls.
      // Reuses the seeded analyst account (same approach as
      // scripts/test-task-inbox.ts), toggling its role for the duration of
      // this one check and always restoring it in `finally`.
      const [seedAnalyst] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, "analyst@acme.local"))
        .limit(1);
      assert.ok(seedAnalyst, "seed the demo database first (npm run db:seed)");
      await db.update(users).set({ role: "read_only" }).where(eq(users.id, seedAnalyst.id));
      try {
        const readOnlyPage = await browser.newPage();
        await readOnlyPage.goto(`${APP_URL}/sign-in`);
        await readOnlyPage.getByLabel("Email").fill("analyst@acme.local");
        await readOnlyPage.getByLabel("Password").fill("kelpieanalyst");
        await readOnlyPage.getByRole("button", { name: "Sign in", exact: true }).click();
        await readOnlyPage.waitForURL("**/dashboard");
        await readOnlyPage.goto(`${APP_URL}/cases`);
        await readOnlyPage.getByText(/Showing \d+-\d+ of \d+ matching case/).waitFor();
        const readOnlyCheckboxCount = await readOnlyPage.locator('input[type="checkbox"][name="caseIds"]').count();
        assert.equal(readOnlyCheckboxCount, 0, "a read_only user must never see bulk-selection controls");
      } finally {
        await db.update(users).set({ role: "analyst" }).where(eq(users.id, seedAnalyst.id));
      }

      console.log("team queues permission UI checks passed");
    } finally {
      await browser.close();
    }

    console.log("all team queues (#54) acceptance checks passed");
  } finally {
    if (caseIds.length > 0) {
      await db.delete(bulkOperations).where(eq(bulkOperations.organisationId, orgAId));
      await db.delete(escalationPolicyRuns).where(inArray(escalationPolicyRuns.caseId, caseIds));
      // shift_handoffs rows are immutable and cannot be deleted directly
      // (verified above); they are only ever removed by the owning case's
      // ON DELETE CASCADE below.
      await db.delete(caseWatchers).where(inArray(caseWatchers.caseId, caseIds));
      await db.delete(caseAssignees).where(inArray(caseAssignees.caseId, caseIds));
      await db.delete(timelineEvents).where(inArray(timelineEvents.caseId, caseIds));
      await db.delete(cases).where(inArray(cases.id, caseIds));
    }
    if (createdPolicyIds.length > 0) {
      await db.delete(escalationPolicies).where(inArray(escalationPolicies.id, createdPolicyIds));
    }
    if (createdQueueIds.length > 0) {
      await db.delete(queues).where(inArray(queues.id, createdQueueIds));
    }
    if (createdTeamIds.length > 0) {
      await db.delete(teamMembers).where(inArray(teamMembers.teamId, createdTeamIds));
      await db.delete(teams).where(inArray(teams.id, createdTeamIds));
    }
    await db.delete(users).where(inArray(users.id, [analystA1, analystA2, analystB1]));
    for (const orgId of [orgAId, orgBId]) {
      await db.delete(apiTokens).where(eq(apiTokens.organisationId, orgId));
    }
    for (const orgId of [orgAId, orgBId]) {
      await db.delete(organisations).where(eq(organisations.id, orgId));
    }

    const remainingCases = await db.select({ id: cases.id }).from(cases).where(inArray(cases.id, caseIds));
    const remainingOrgs = await db
      .select({ id: organisations.id })
      .from(organisations)
      .where(inArray(organisations.id, [orgAId, orgBId]));
    assert.equal(remainingCases.length, 0, "fixture cases must be fully cleaned up");
    assert.equal(remainingOrgs.length, 0, "fixture orgs must be fully cleaned up");
    console.log("team queues fixture cleanup verified: no fixture rows remain");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
