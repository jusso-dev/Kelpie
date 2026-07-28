/**
 * Direct-call coverage for the run console (issue #67): retry lineage never
 * rewrites prior history, duplicate-retry prevention, destructive-action
 * retry revalidation (approval expiry, requester/approver separation, exact
 * target, current target state), best-effort cancel semantics, kill switches
 * at claim time, redaction before persistence, authorisation, and tenant
 * isolation. Mirrors `scripts/test-automation-runtime.ts` and
 * `scripts/test-response-action-approval.ts`'s direct-call style (no running
 * HTTP server required) against a real Postgres instance.
 */
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { db } from "../src/db";
import {
  automationRules,
  automationRuns,
  auditEvents,
  cases,
  observables,
  organisations,
  responseActions,
  responseActionRuns,
  tiFeeds,
  timelineEvents,
  users,
} from "../src/db/schema";
import { newId } from "../src/lib/utils";
import {
  approveResponseAction,
  requestResponseActionCancel,
  retryResponseAction,
  runResponseAction,
} from "../src/lib/response-actions/core";
import { retryAutomationRun, requestAutomationCancel } from "../src/lib/automations/core";
import { processPendingAutomationRuns } from "../src/lib/automations/dispatch";
import { setKillSwitch, listKillSwitches } from "../src/lib/run-console/kill-switch";
import { buildRunSummary } from "../src/lib/run-console/redact";
import { listRuns, getRun } from "../src/lib/run-console/query";
import { listTiFeedPolls } from "../src/lib/run-console/adapters/ti-feed-polls";
import {
  canControlRuns,
  canManageKillSwitches,
  canObserveRunConsole,
} from "../src/lib/run-console/permissions";
import type { CurrentUser } from "../src/lib/session";

const runId = newId("runconsole").slice("runconsole_".length).slice(0, 10);
const orgAId = `org_rc_a_${runId}`;
const orgBId = `org_rc_b_${runId}`;

function fakeUser(overrides: Partial<CurrentUser>): CurrentUser {
  return {
    id: "u1",
    name: "Test",
    email: "test@example.com",
    role: "analyst",
    organisationId: orgAId,
    organisationName: "Org A",
    organisationSlug: "org-a",
    timezone: "Australia/Sydney",
    banned: false,
    passwordResetRequired: false,
    mfaRequired: false,
    twoFactorEnabled: false,
    ...overrides,
  };
}

async function createUser(organisationId: string, role: "admin" | "analyst" | "read_only" = "analyst") {
  const id = newId("user");
  await db.insert(users).values({
    id,
    name: id,
    email: `${id}@example.com`,
    organisationId,
    role,
  });
  return id;
}

async function main() {
  await db.insert(organisations).values([
    { id: orgAId, name: "Org A", slug: `rc-a-${runId}` },
    { id: orgBId, name: "Org B", slug: `rc-b-${runId}` },
  ]);
  const requesterId = await createUser(orgAId, "analyst");
  const approverId = await createUser(orgAId, "admin");
  const adminId = await createUser(orgAId, "admin");

  const caseAId = newId("case");
  await db.insert(cases).values({
    id: caseAId,
    organisationId: orgAId,
    caseNumber: "KP-2026-0001",
    title: "Run console test case",
    severity: "high",
    classification: "unauthorised_access",
    tags: [],
  });
  const observableId = newId("obs");
  const blockedIp = "203.0.113.9";
  await db.insert(observables).values({
    id: observableId,
    caseId: caseAId,
    type: "ip",
    value: blockedIp,
  });

  const actionId = newId("ra");
  await db.insert(responseActions).values({
    id: actionId,
    organisationId: orgAId,
    name: "Block on Cloudflare",
    kind: "cloudflare_block_ip",
    config: { api_token: "x", zone_ids: "zone1" },
    isActive: true,
  });

  try {
    // ── 1. Retry creates a child attempt and never rewrites prior history ──
    const created = await runResponseAction(orgAId, requesterId, actionId, caseAId, { ip: blockedIp });
    const [initialRun] = await db
      .select()
      .from(responseActionRuns)
      .where(eq(responseActionRuns.id, created.runId));
    assert.equal(initialRun.attempt, 1);
    assert.equal(initialRun.parentRunId, null);

    // Simulate a completed-but-failed attempt without a real provider call
    // (mirrors what `executeApprovedRun` would have written).
    await db
      .update(responseActionRuns)
      .set({ status: "failed", errorCategory: "provider_error", completedAt: new Date() })
      .where(eq(responseActionRuns.id, created.runId));

    const beforeRetry = await db
      .select()
      .from(responseActionRuns)
      .where(eq(responseActionRuns.id, created.runId));

    const retried = await retryResponseAction(orgAId, requesterId, created.runId);
    assert.equal(retried.status, "awaiting_approval");

    const afterRetry = await db
      .select()
      .from(responseActionRuns)
      .where(eq(responseActionRuns.id, created.runId));
    assert.deepEqual(beforeRetry[0], afterRetry[0], "retry must never rewrite the parent row");

    const [child] = await db
      .select()
      .from(responseActionRuns)
      .where(eq(responseActionRuns.id, retried.runId));
    assert.equal(child.attempt, 2);
    assert.equal(child.parentRunId, created.runId);
    assert.equal(child.rootRunId, created.runId);
    assert.equal(child.target, blockedIp);
    console.log("ok: retry creates a child attempt and never rewrites prior history");

    // ── 2. Duplicate prevention: a second retry of the same parent fails ──
    await assert.rejects(
      () => retryResponseAction(orgAId, requesterId, created.runId),
      /already been requested/,
    );
    console.log("ok: a concurrent/duplicate retry of the same run is rejected");

    // ── 3. Approval expiry revalidation ──
    await db
      .update(responseActionRuns)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(responseActionRuns.id, child.id));
    await assert.rejects(
      () => approveResponseAction(orgAId, approverId, child.id),
      /expired/,
    );
    console.log("ok: retry approval revalidates expiry");

    // ── 4. Requester/approver separation ──
    const selfApprove = await runResponseAction(orgAId, requesterId, actionId, caseAId, { ip: blockedIp });
    await assert.rejects(
      () => approveResponseAction(orgAId, requesterId, selfApprove.runId),
      /cannot approve their own/,
    );
    console.log("ok: requester cannot approve their own response action");

    // ── 5. Exact target / current target state revalidation ──
    const staleTarget = await runResponseAction(orgAId, requesterId, actionId, caseAId, { ip: blockedIp });
    await db.delete(observables).where(eq(observables.id, observableId));
    await assert.rejects(
      () => approveResponseAction(orgAId, approverId, staleTarget.runId),
      /no longer evidence/,
    );
    // restore for later assertions
    await db.insert(observables).values({ id: observableId, caseId: caseAId, type: "ip", value: blockedIp });
    console.log("ok: approval revalidates the target is still evidence on the case");

    // ── 6. Cancellation races ──
    const cancelMe = await runResponseAction(orgAId, requesterId, actionId, caseAId, { ip: blockedIp });
    const firstCancel = await requestResponseActionCancel(orgAId, requesterId, cancelMe.runId);
    assert.equal(firstCancel.status, "cancelled");
    assert.equal(firstCancel.bestEffort, false);
    await assert.rejects(
      () => requestResponseActionCancel(orgAId, requesterId, cancelMe.runId),
      /already terminal/,
    );
    console.log("ok: cancelling an already-terminal run is rejected (no double cancel)");

    // A "running" row (simulating an in-flight provider call) only gets a
    // best-effort marker; it must never be forced to a terminal state or
    // claim the provider effect was reversed.
    const runningRunId = newId("car");
    await db.insert(responseActionRuns).values({
      id: runningRunId,
      organisationId: orgAId,
      actionId,
      caseId: caseAId,
      requestedBy: requesterId,
      status: "running",
      idempotencyKey: newId("rai"),
      target: blockedIp,
      request: { input: { ip: blockedIp }, target: blockedIp },
    });
    const runningCancel = await requestResponseActionCancel(orgAId, requesterId, runningRunId);
    assert.equal(runningCancel.status, "running");
    assert.equal(runningCancel.bestEffort, true);
    const [stillRunning] = await db
      .select()
      .from(responseActionRuns)
      .where(eq(responseActionRuns.id, runningRunId));
    assert.equal(stillRunning.status, "running", "cancel must never fabricate a rollback");
    assert.ok(stillRunning.cancelRequestedAt);
    console.log("ok: cancelling a running run is best-effort and never claims a rollback");

    // ── 7. Kill switch at claim time blocks approval ──
    const killTarget = await runResponseAction(orgAId, requesterId, actionId, caseAId, { ip: blockedIp });
    await setKillSwitch({
      organisationId: orgAId,
      scope: "organisation",
      enabled: true,
      reason: "Incident freeze for testing",
      actorId: adminId,
    });
    await assert.rejects(
      () => approveResponseAction(orgAId, approverId, killTarget.runId),
      /kill switch/,
    );
    const [stillAwaiting] = await db
      .select()
      .from(responseActionRuns)
      .where(eq(responseActionRuns.id, killTarget.runId));
    assert.equal(stillAwaiting.status, "awaiting_approval", "kill switch must not falsely fail the run");
    const switches = await listKillSwitches(orgAId);
    assert.equal(switches.find((s) => s.scope === "organisation")?.enabled, true);
    const auditRows = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.organisationId, orgAId), eq(auditEvents.action, "run_console.kill_switch_enabled")));
    assert.equal(auditRows.length, 1, "arming a kill switch must be audited");
    await setKillSwitch({
      organisationId: orgAId,
      scope: "organisation",
      enabled: false,
      reason: "Freeze lifted",
      actorId: adminId,
    });
    console.log("ok: kill switch blocks claim and is audited");

    // ── 8. Automation retry lineage + duplicate prevention + kill switch ──
    const ruleId = newId("aut");
    await db.insert(automationRules).values({
      id: ruleId,
      organisationId: orgAId,
      name: "Automation retry test",
      triggerEvent: "case.created",
      destinationUrl: "http://127.0.0.1:1/unused",
      secret: "automation-retry-test-secret-32-chars",
      keyId: "retry-test",
      targetProfile: "triage-agent",
      isActive: true,
    });
    const tleId = newId("tle");
    await db.insert(timelineEvents).values({
      id: tleId,
      caseId: caseAId,
      actorId: null,
      eventType: "case_created",
      payload: {},
    });
    const parentAutoRunId = newId("aur");
    await db.insert(automationRuns).values({
      id: parentAutoRunId,
      organisationId: orgAId,
      ruleId,
      caseId: caseAId,
      triggerEventId: tleId,
      triggerEvent: "case.created",
      traceId: newId("trace"),
      status: "failed",
      request: { event: "case.created" },
      lastError: "delivery failed",
      completedAt: new Date(),
    });
    const autoRetried = await retryAutomationRun(orgAId, requesterId, parentAutoRunId);
    const [autoChild] = await db
      .select()
      .from(automationRuns)
      .where(eq(automationRuns.id, autoRetried.runId));
    assert.equal(autoChild.parentRunId, parentAutoRunId);
    assert.equal(autoChild.lineageAttempt, 2);
    assert.equal(autoChild.status, "pending");
    await assert.rejects(
      () => retryAutomationRun(orgAId, requesterId, parentAutoRunId),
      /already been requested/,
    );
    console.log("ok: automation retry creates a child and prevents duplicate retries");

    await setKillSwitch({
      organisationId: orgAId,
      scope: "provider",
      scopeKey: "muster",
      enabled: true,
      reason: "Automation freeze for testing",
      actorId: adminId,
    });
    const dispatchResult = await processPendingAutomationRuns();
    assert.ok(dispatchResult.failed >= 0);
    const [blockedAuto] = await db
      .select()
      .from(automationRuns)
      .where(eq(automationRuns.id, autoRetried.runId));
    assert.equal(blockedAuto.status, "cancelled");
    assert.equal(blockedAuto.errorCategory, "kill_switch");
    await setKillSwitch({
      organisationId: orgAId,
      scope: "provider",
      scopeKey: "muster",
      enabled: false,
      reason: "test cleanup",
      actorId: adminId,
    });
    console.log("ok: provider kill switch blocks automation dispatch at claim time");

    // Automation cancel races
    const pendingAuto = newId("aur");
    const tle2Id = newId("tle");
    await db.insert(timelineEvents).values({
      id: tle2Id,
      caseId: caseAId,
      actorId: null,
      eventType: "case_created",
      payload: {},
    });
    await db.insert(automationRuns).values({
      id: pendingAuto,
      organisationId: orgAId,
      ruleId,
      caseId: caseAId,
      triggerEventId: tle2Id,
      triggerEvent: "case.created",
      traceId: newId("trace"),
      status: "pending",
      request: { event: "case.created" },
    });
    const autoCancel = await requestAutomationCancel(orgAId, requesterId, pendingAuto);
    assert.equal(autoCancel.status, "cancelled");
    await assert.rejects(() => requestAutomationCancel(orgAId, requesterId, pendingAuto), /already terminal/);
    console.log("ok: automation cancel races are rejected on an already-terminal run");

    // ── 9. Redaction happens before persistence/display ──
    const redacted = buildRunSummary({
      token: "super-secret-token",
      nested: { api_key: "abc123" },
      safe: "visible",
    });
    assert.equal(redacted?.token, "[redacted]");
    assert.equal((redacted?.nested as Record<string, unknown>).api_key, "[redacted]");
    assert.equal(redacted?.safe, "visible");
    console.log("ok: run summaries redact credentials before persistence/display");

    // ── 10. Authorisation: observation and control are granted separately ──
    assert.equal(canObserveRunConsole(fakeUser({ role: "read_only" })), true);
    assert.equal(canControlRuns(fakeUser({ role: "read_only" })), false);
    assert.equal(canControlRuns(fakeUser({ role: "analyst" })), true);
    assert.equal(canManageKillSwitches(fakeUser({ role: "analyst" })), false);
    assert.equal(canManageKillSwitches(fakeUser({ role: "admin" })), true);
    console.log("ok: observation and control permissions are granted separately");

    // ── 11. Tenant isolation ──
    const crossOrgRun = await getRun(orgBId, "response_action", created.runId);
    assert.equal(crossOrgRun, null, "a run must never be readable from another organisation");
    await assert.rejects(
      () => retryResponseAction(orgBId, requesterId, created.runId),
      /not found/,
    );
    const orgBRuns = await listRuns(orgBId, {});
    assert.equal(
      orgBRuns.runs.some((r) => r.organisationId === orgAId),
      false,
      "listRuns must never leak another organisation's rows",
    );
    console.log("ok: tenant isolation holds for reads, retries, and list queries");

    // ── 12. Partial success identification (TI feed poll) ──
    const feedId = newId("tif");
    await db.insert(tiFeeds).values({
      id: feedId,
      organisationId: orgAId,
      name: "Partial feed",
      kind: "csv",
      url: "https://example.invalid/feed.csv",
      lastPolledAt: new Date(),
      lastRunIngestedCount: 5,
      lastRunSkippedCount: 3,
    });
    const feedRuns = await listTiFeedPolls(orgAId, {});
    const feedRun = feedRuns.find((r) => r.actionId === feedId);
    assert.equal(feedRun?.state, "partially_succeeded");
    console.log("ok: a feed poll with both ingested and skipped items reports partially_succeeded");

    // ── 13. listRuns filters by run type and case ──
    const filtered = await listRuns(orgAId, { runType: "response_action", caseId: caseAId });
    assert.ok(filtered.runs.length > 0);
    assert.ok(filtered.runs.every((r) => r.runType === "response_action" && r.caseId === caseAId));
    console.log("ok: listRuns filters by run type and case");

    console.log("run console tests passed");
  } finally {
    await db.delete(organisations).where(eq(organisations.id, orgAId));
    await db.delete(organisations).where(eq(organisations.id, orgBId));
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
