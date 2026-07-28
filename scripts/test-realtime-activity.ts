/**
 * Coverage for issue #49 (live case activity and analyst presence), scoped
 * to the gaps confirmed missing on top of the presence/version-conflict work
 * already shipped in issues #30 and #31:
 *
 *  - Pure unit tests for the activity-envelope fold (dedup, out-of-order,
 *    monotonic cursor) and the reconnect backoff schedule.
 *  - A DB-backed unit test of `getRecentActivity`'s envelope shape/ordering
 *    and of the `CaseVersionConflictError` envelope.
 *  - Playwright integration coverage for: two clients seeing a panel refresh
 *    from a real timeline event without a route reload, reconnect fetching
 *    authoritative state after a simulated outage, cross-organisation
 *    authorization/tenant isolation on the realtime channel, and core UI
 *    (viewing + creating a task) continuing to work with the channel fully
 *    unavailable.
 *
 * This script assumes a server is already listening at `APP_URL` (default
 * `http://127.0.0.1:3000`) against the same `DATABASE_URL` this process
 * uses, migrations applied, and the standard seed (`npm run db:seed`)
 * already run.
 *
 * Note on "server restart": this harness does not own or manage the running
 * app process, so it cannot literally kill and restart it. The reconnect
 * scenario instead severs the transport at the network level (Playwright's
 * `context.setOffline`), which is indistinguishable to the client from a
 * server restart — both present as the SSE connection dropping and needing
 * to reconnect and re-fetch authoritative state.
 */
import assert from "node:assert/strict";
import { execSync, spawn } from "node:child_process";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { and, eq } from "drizzle-orm";
import { db } from "../src/db";
import { cases, organisations, timelineEvents, users } from "../src/db/schema";
import { auth } from "../src/lib/auth";
import { CaseVersionConflictError, patchCaseCore } from "../src/lib/cases-core";
import { createTaskCore } from "../src/lib/tasks-core";
import { getRecentActivity } from "../src/lib/case-activity";
import { foldActivity, reconnectDelayMs } from "../src/lib/case-activity-client";
import { newId } from "../src/lib/utils";

const baseUrl = process.env.APP_URL ?? "http://127.0.0.1:3000";
const appPort = new URL(baseUrl).port || "3000";

/** Kills whatever is listening on the app's port, if anything. */
function killAppServer(): void {
  try {
    const pids = execSync(`lsof -ti tcp:${appPort} -sTCP:LISTEN`).toString().trim();
    for (const pid of pids.split("\n").filter(Boolean)) {
      try {
        process.kill(Number(pid), "SIGTERM");
      } catch {
        // already gone
      }
    }
  } catch {
    // nothing listening
  }
}

async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Server did not become ready at ${url} within ${timeoutMs}ms`);
}

/** Kills the running dev server and starts a fresh instance, simulating a real server restart. */
async function restartAppServer(): Promise<void> {
  killAppServer();
  // Give the socket a moment to release before rebinding.
  await new Promise((r) => setTimeout(r, 500));
  const child = spawn("npm", ["run", "dev"], {
    cwd: process.cwd(),
    env: process.env,
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  await waitForHttp(`${baseUrl}/sign-in`, 45_000);
}

function envelope(id: string, occurredAt: string, type = "comment") {
  return { id, type, occurredAt, actorId: null as string | null };
}

/* ── Pure unit tests: envelope fold and backoff schedule ───────────────── */

function testFoldActivityDedupesAndTracksCursor() {
  const state = { seenIds: new Set<string>(), cursor: null as string | null };
  const first = foldActivity(state, [
    envelope("tle_1", "2026-01-01T00:00:00.000Z"),
    envelope("tle_2", "2026-01-01T00:00:01.000Z"),
  ]);
  assert.equal(first.fresh.length, 2, "both new events are fresh");
  assert.equal(first.cursor, "2026-01-01T00:00:01.000Z");

  // Duplicate delivery (the same batch replayed, as a naive at-least-once
  // channel might do after a reconnect) must not be treated as fresh again.
  const replay = foldActivity(
    { seenIds: first.seenIds, cursor: first.cursor },
    [envelope("tle_1", "2026-01-01T00:00:00.000Z"), envelope("tle_2", "2026-01-01T00:00:01.000Z")],
  );
  assert.equal(replay.fresh.length, 0, "replayed ids are dropped, not corrupting state");
  assert.equal(replay.cursor, first.cursor, "cursor does not move backwards on replay");

  // Out-of-order delivery (an older event arriving after a newer one) must
  // still be recognised as fresh exactly once, and the cursor must never
  // regress even though the event's timestamp precedes the current cursor.
  const outOfOrder = foldActivity(
    { seenIds: replay.seenIds, cursor: replay.cursor },
    [envelope("tle_0_late", "2026-01-01T00:00:00.500Z")],
  );
  assert.equal(outOfOrder.fresh.length, 1);
  assert.equal(outOfOrder.cursor, first.cursor, "cursor stays monotonic for a late, older event");

  console.log("foldActivity: dedup, replay-safety, and monotonic cursor passed.");
}

function testFoldActivityBoundsIdCache() {
  let state = { seenIds: new Set<string>(), cursor: null as string | null };
  const batch = Array.from({ length: 520 }, (_, i) =>
    envelope(`tle_bulk_${i}`, new Date(2026, 0, 1, 0, 0, i).toISOString()),
  );
  const folded = foldActivity(state, batch);
  state = { seenIds: folded.seenIds, cursor: folded.cursor };
  assert.ok(state.seenIds.size <= 500, "id cache is bounded for a long-lived tab");
  // The most recent ids must survive eviction, not the oldest.
  assert.ok(state.seenIds.has("tle_bulk_519"));
  assert.ok(!state.seenIds.has("tle_bulk_0"));
  console.log("foldActivity: bounded id cache passed.");
}

function testReconnectBackoffIsCappedAndIncreasing() {
  const delays = [0, 1, 2, 3, 4, 5, 6, 10].map(reconnectDelayMs);
  for (let i = 1; i < delays.length; i++) {
    assert.ok(delays[i] >= delays[i - 1], "backoff never decreases with more attempts");
  }
  assert.equal(delays[delays.length - 1], 30_000, "backoff is capped at 30s");
  assert.equal(reconnectDelayMs(0), 1000, "first retry is prompt");
  console.log("reconnectDelayMs: increasing and capped passed.");
}

/* ── DB-backed unit tests: activity envelope shape and conflict envelope ─ */

async function loadSeed() {
  const [organisation] = await db
    .select({ id: organisations.id })
    .from(organisations)
    .where(eq(organisations.slug, "acme-soc"))
    .limit(1);
  assert.ok(organisation, "seed the test database first");
  const [record] = await db.select().from(cases).where(eq(cases.organisationId, organisation.id)).limit(1);
  const team = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(eq(users.organisationId, organisation.id));
  const admin = team.find((u) => u.email === "admin@acme.local");
  const analyst = team.find((u) => u.email === "analyst@acme.local");
  assert.ok(record && admin && analyst, "seeded case and users required");
  return { organisation, record, admin, analyst };
}

async function testGetRecentActivityEnvelopeShape() {
  const { record } = await loadSeed();
  const markerA = newId("tle");
  const markerB = newId("tle");
  const t0 = new Date();
  const t1 = new Date(t0.getTime() + 1000);
  await db.insert(timelineEvents).values([
    { id: markerA, caseId: record.id, actorId: null, eventType: "custom", payload: {}, occurredAt: t0 },
    { id: markerB, caseId: record.id, actorId: null, eventType: "custom", payload: {}, occurredAt: t1 },
  ]);
  try {
    const sinceNothing = await getRecentActivity(record.id, {
      occurredAt: new Date(t0.getTime() - 1),
      id: "",
    });
    const ids = sinceNothing.map((e) => e.id);
    assert.ok(ids.includes(markerA) && ids.includes(markerB), "both events are returned");
    const first = sinceNothing.find((e) => e.id === markerA);
    assert.ok(first);
    assert.equal(first.type, "custom");
    assert.equal(typeof first.occurredAt, "string");
    assert.equal(first.actorId, null);

    const sinceT0 = await getRecentActivity(record.id, { occurredAt: t0, id: markerA });
    assert.ok(
      !sinceT0.some((e) => e.id === markerA),
      "events at or before the cursor are excluded, not replayed",
    );
    assert.ok(sinceT0.some((e) => e.id === markerB));
  } finally {
    await db.delete(timelineEvents).where(eq(timelineEvents.id, markerA));
    await db.delete(timelineEvents).where(eq(timelineEvents.id, markerB));
  }
  console.log("getRecentActivity: envelope shape and cursor exclusivity passed.");
}

/**
 * Regression: a single transaction can write several timeline events sharing
 * one `occurredAt` (bulk edits do this). An `occurredAt`-only cursor drops
 * every event tied with the last one it delivered, so the composite
 * `(occurredAt, id)` cursor must still return the rest of the tie.
 */
async function testTiedTimestampsAreNotSkipped() {
  const { record } = await loadSeed();
  const tied = new Date();
  const tieA = "tle_tie_a";
  const tieB = "tle_tie_b";
  await db.insert(timelineEvents).values([
    { id: tieA, caseId: record.id, actorId: null, eventType: "custom", payload: {}, occurredAt: tied },
    { id: tieB, caseId: record.id, actorId: null, eventType: "custom", payload: {}, occurredAt: tied },
  ]);
  try {
    const afterTieA = await getRecentActivity(record.id, { occurredAt: tied, id: tieA });
    const ids = afterTieA.map((e) => e.id);
    assert.ok(
      ids.includes(tieB),
      "an event sharing the cursor's timestamp but ordering after it is still delivered",
    );
    assert.ok(!ids.includes(tieA), "the cursor's own event is not replayed");

    const afterTieB = await getRecentActivity(record.id, { occurredAt: tied, id: tieB });
    assert.ok(
      !afterTieB.some((e) => e.id === tieA || e.id === tieB),
      "the tie is fully consumed once the cursor passes its last id",
    );
  } finally {
    await db.delete(timelineEvents).where(eq(timelineEvents.id, tieA));
    await db.delete(timelineEvents).where(eq(timelineEvents.id, tieB));
  }
  console.log("getRecentActivity: tied timestamps are not skipped at the page boundary.");
}

async function testVersionConflictEnvelope() {
  const { organisation, record, admin, analyst } = await loadSeed();
  const original = { severity: record.severity, version: record.version };
  await patchCaseCore(
    organisation.id,
    admin.id,
    record.id,
    { severity: record.severity === "critical" ? "low" : "critical" },
    record.version,
  );
  try {
    await patchCaseCore(
      organisation.id,
      analyst.id,
      record.id,
      { severity: "medium" },
      record.version, // stale on purpose
    );
    assert.fail("stale version must be rejected");
  } catch (error) {
    assert.ok(error instanceof CaseVersionConflictError);
    assert.equal(error.name, "CaseVersionConflictError");
    assert.equal(error.message, "case_version_conflict");
    assert.ok(error.current, "conflict envelope carries the current record");
    assert.ok(
      typeof error.current.version === "number" && error.current.version > record.version,
      "conflict envelope's version is the new, current one",
    );
  } finally {
    await db
      .update(cases)
      .set({ severity: original.severity, version: original.version })
      .where(and(eq(cases.id, record.id), eq(cases.organisationId, organisation.id)));
  }
  console.log("CaseVersionConflictError: envelope shape passed.");
}

/* ── Playwright integration: two clients, reconnect, authz, degraded UI ── */

async function signIn(context: BrowserContext, email: string, password: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${baseUrl}/sign-in`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/dashboard");
  return page;
}

async function createOutsiderOrgAdmin(): Promise<{ email: string; password: string }> {
  const orgId = newId("org");
  const runId = orgId.slice("org_".length).slice(0, 10);
  await db.insert(organisations).values({ id: orgId, name: `Outsider ${runId}`, slug: `outsider-${runId}` });
  const email = `outsider_${runId}@example.com`;
  const password = "outsiderpass123";
  const signUp = await auth.api.signUpEmail({ body: { email, password, name: "Outsider Admin" } });
  await db.update(users).set({ organisationId: orgId, role: "admin" }).where(eq(users.id, signUp.user.id));
  return { email, password };
}

async function testTwoClientsAndAuthorization(browser: Browser) {
  const { record, admin, analyst } = await loadSeed();
  const outsider = await createOutsiderOrgAdmin();

  const adminContext = await browser.newContext();
  const analystContext = await browser.newContext();
  const outsiderContext = await browser.newContext();
  try {
    const adminPage = await signIn(adminContext, "admin@acme.local", "kelpieadmin");
    const analystPage = await signIn(analystContext, "analyst@acme.local", "kelpieanalyst");
    const outsiderPage = await signIn(outsiderContext, outsider.email, outsider.password);

    // ── Authorization / tenant isolation ──────────────────────────────
    // A user from a different organisation must not be able to subscribe to
    // (or otherwise read) this case's realtime channel, even knowing its id.
    const outsiderResponse = await outsiderPage.request.get(`${baseUrl}/api/cases/${record.id}/presence`);
    assert.equal(outsiderResponse.status(), 401, "cross-organisation access to the channel is rejected");

    // ── Two clients: panel refresh on a real event, not a route reload ──
    await Promise.all([
      adminPage.goto(`${baseUrl}/cases/${record.id}/tasks`),
      analystPage.goto(`${baseUrl}/cases/${record.id}/tasks`),
    ]);
    // Note: a plain "networkidle" wait never resolves here, because the
    // open EventSource connection to the realtime channel is itself a
    // long-lived network connection by design.
    await analystPage.waitForTimeout(1_000);
    // A real document reload/navigation resets the window's JS globals; a
    // Next.js `router.refresh()` re-renders server components in place over
    // the same document and preserves them. Planting a marker here and
    // checking it survives is a direct way to prove the panel updated via
    // the realtime channel's soft refresh, not a hard route reload.
    await analystPage.evaluate(() => {
      (window as unknown as { __kelpieNoReload?: string }).__kelpieNoReload = "still-here";
    });

    const taskTitle = `Realtime activity check ${newId("t").slice(-8)}`;
    await adminPage.getByLabel("Title").fill(taskTitle);
    await adminPage.getByRole("button", { name: "Add task" }).click();
    await adminPage.getByText(taskTitle).waitFor({ timeout: 5_000 });

    await analystPage.getByText(taskTitle).waitFor({ timeout: 8_000 });
    const marker = await analystPage.evaluate(
      () => (window as unknown as { __kelpieNoReload?: string }).__kelpieNoReload,
    );
    assert.equal(
      marker,
      "still-here",
      "the affected panel refreshed via the realtime channel, not a full route reload",
    );

    console.log("Two clients (panel refresh, not a route reload) and authorization passed.");
  } finally {
    await outsiderContext.close();
    await analystContext.close();
    await adminContext.close();
    void admin;
    void analyst;
  }
}

/**
 * Reconnect-after-outage, exercised via an actual kill and restart of the app
 * server process (not a simulated network blip), so this also stands as the
 * "server restart" integration scenario. Postgres itself (a separate
 * container) stays up throughout, so a task can be created directly against
 * it while the app server is down, mirroring what `createTask`'s server
 * action does.
 */
async function testReconnectAfterServerRestart(browser: Browser) {
  const { organisation, record, admin } = await loadSeed();
  const context = await browser.newContext();
  try {
    const page = await signIn(context, "admin@acme.local", "kelpieadmin");
    await page.goto(`${baseUrl}/cases/${record.id}/tasks`);
    await page.waitForTimeout(1_000);

    killAppServer();
    await page.getByText(/Reconnecting…|Updates paused/).waitFor({ timeout: 20_000 });

    const offlineTaskTitle = `Created during server restart ${newId("t").slice(-8)}`;
    await createTaskCore(organisation.id, admin.id, record.id, {
      title: offlineTaskTitle,
      description: null,
      dueAt: null,
    });

    await restartAppServer();

    await page
      .getByText(/Reconnecting…|Updates paused/)
      .waitFor({ state: "detached", timeout: 30_000 });
    // This task was created entirely while the server process was down, so
    // it can only appear via the reconnect's own authoritative refetch on
    // reopen, never via a live event the client happened to receive.
    await page.getByText(offlineTaskTitle).waitFor({ timeout: 10_000 });

    console.log("Reconnect after a real server restart fetches authoritative state passed.");
  } finally {
    await context.close();
  }
}

async function testDegradedTransportStillWorks(browser: Browser) {
  const { record } = await loadSeed();
  const context = await browser.newContext();
  try {
    // Block the realtime channel entirely, from the very first request, to
    // simulate the transport being fully unavailable (proxy misconfigured,
    // blocked, etc).
    await context.route("**/presence", (route) => route.abort());
    const page = await signIn(context, "admin@acme.local", "kelpieadmin");
    await page.goto(`${baseUrl}/cases/${record.id}/tasks`);

    const taskTitle = `Works without realtime ${newId("t").slice(-8)}`;
    await page.getByLabel("Title").fill(taskTitle);
    await page.getByRole("button", { name: "Add task" }).click();
    await page.getByText(taskTitle).waitFor({ timeout: 5_000 });
    console.log("Core UI still works with the realtime transport fully unavailable.");
  } finally {
    await context.close();
  }
}

async function main() {
  testFoldActivityDedupesAndTracksCursor();
  testFoldActivityBoundsIdCache();
  testReconnectBackoffIsCappedAndIncreasing();
  await testGetRecentActivityEnvelopeShape();
  await testTiedTimestampsAreNotSkipped();
  await testVersionConflictEnvelope();

  const browser = await chromium.launch({ headless: true });
  try {
    await testTwoClientsAndAuthorization(browser);
    await testReconnectAfterServerRestart(browser);
    await testDegradedTransportStillWorks(browser);
  } finally {
    await browser.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
