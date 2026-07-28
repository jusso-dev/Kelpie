/**
 * Coverage for governed investigation console (issue #62):
 * - schema rejection
 * - injection / SSRF rejection
 * - prohibited command names
 * - scope fail-closed
 * - write approval (dual control)
 * - timeout / cancel
 * - redaction
 * - tenant isolation
 * - save as evidence provenance
 *
 * Uses real Postgres via DATABASE_URL.
 */
import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../src/db";
import {
  attachments,
  cases,
  entities,
  investigationExecutions,
  investigationResultRefs,
  observables,
  organisations,
  users,
} from "../src/db/schema";
import { newId } from "../src/lib/utils";
import { tokenHasScope } from "../src/lib/scopes";
import {
  approveInvestigationExecution,
  cancelInvestigationExecution,
  executeInvestigationCommand,
  filterExecutionsForActor,
  getInvestigationExecution,
  InvestigationConsoleError,
  listInvestigationExecutions,
  listPublicCommands,
  paramsContainRedactedMarker,
  rejectInvestigationExecution,
  resolveInvestigationActor,
  saveExecutionAsEvidence,
} from "../src/lib/investigation-console/core";
import { setCaseVisibility } from "../src/lib/access";
import {
  rejectDangerousParams,
  validateCommandParams,
} from "../src/lib/investigation-console/params";
import {
  __registerHandlerForTests,
  __unregisterHandlerForTests,
  getInvestigationHandler,
  isProhibitedCommandName,
} from "../src/lib/investigation-console/registry";
import { redactParams } from "../src/lib/investigation-console/redaction";
import { virusTotalEndpointFor } from "../src/lib/investigation-console/handlers/virustotal-report";
import { __resetRateLimitWindowsForTests } from "../src/lib/investigation-console/limits";
import type { InvestigationCommandHandler } from "../src/lib/investigation-console/types";

const runId = newId("i62test").slice("i62test_".length).slice(0, 10);
const orgAId = `org_i62a_${runId}`;
const orgBId = `org_i62b_${runId}`;
const userAId = `user_i62a_${runId}`;
const userA2Id = `user_i62a2_${runId}`;
const userAnalystId = `user_i62an_${runId}`;
const userBId = `user_i62b_${runId}`;
let caseA = "";
let caseA2 = "";
let caseRestricted = "";
let caseB = "";
let entityA = "";

const scopesFull = [
  "investigation:read",
  "investigation:execute",
  "evidence:write",
  "cases:read",
] as string[];

async function setup() {
  await db.insert(organisations).values([
    { id: orgAId, name: "I62 Org A", slug: `i62a-${runId}` },
    { id: orgBId, name: "I62 Org B", slug: `i62b-${runId}` },
  ]);
  await db.insert(users).values([
    {
      id: userAId,
      name: "Analyst A",
      email: `i62a-${runId}@example.com`,
      organisationId: orgAId,
      role: "admin",
    },
    {
      id: userA2Id,
      name: "Approver A",
      email: `i62a2-${runId}@example.com`,
      organisationId: orgAId,
      role: "admin",
    },
    {
      id: userAnalystId,
      name: "Analyst limited",
      email: `i62an-${runId}@example.com`,
      organisationId: orgAId,
      role: "analyst",
    },
    {
      id: userBId,
      name: "Analyst B",
      email: `i62b-${runId}@example.com`,
      organisationId: orgBId,
      role: "admin",
    },
  ]);
  caseA = newId("case");
  caseA2 = newId("case");
  caseRestricted = newId("case");
  caseB = newId("case");
  await db.insert(cases).values([
    {
      id: caseA,
      organisationId: orgAId,
      caseNumber: `I62A-${runId}`,
      title: "Current case",
      severity: "high",
    },
    {
      id: caseA2,
      organisationId: orgAId,
      caseNumber: `I62A2-${runId}`,
      title: "Prior case same IP",
      severity: "medium",
    },
    {
      id: caseRestricted,
      organisationId: orgAId,
      caseNumber: `I62AR-${runId}`,
      title: "Restricted prior case",
      severity: "critical",
    },
    {
      id: caseB,
      organisationId: orgBId,
      caseNumber: `I62B-${runId}`,
      title: "Other tenant case",
    },
  ]);
  await db.insert(observables).values([
    {
      id: newId("obs"),
      caseId: caseA,
      type: "ip",
      value: "203.0.113.62",
    },
    {
      id: newId("obs"),
      caseId: caseA2,
      type: "ip",
      value: "203.0.113.62",
    },
    {
      id: newId("obs"),
      caseId: caseRestricted,
      type: "ip",
      value: "203.0.113.62",
    },
    {
      id: newId("obs"),
      caseId: caseB,
      type: "ip",
      value: "203.0.113.62",
    },
  ]);
  // Compartment: restricted prior case invisible to plain analysts.
  await setCaseVisibility(
    orgAId,
    {
      organisationId: orgAId,
      userId: userAId,
      role: "admin",
      teamIds: [],
    },
    caseRestricted,
    {
      visibilityMode: "restricted",
      reason: "Need-to-know investigation console ACL test",
    },
  );
  entityA = newId("ent");
  await db.insert(entities).values({
    id: entityA,
    organisationId: orgAId,
    type: "ip",
    displayName: "203.0.113.62",
    canonicalKey: "ip:203.0.113.62",
  });
}

async function cleanup() {
  const execRows = await db
    .select({ id: investigationExecutions.id })
    .from(investigationExecutions)
    .where(
      inArray(investigationExecutions.organisationId, [orgAId, orgBId]),
    );
  const execIds = execRows.map((r) => r.id);
  if (execIds.length > 0) {
    await db
      .delete(investigationResultRefs)
      .where(inArray(investigationResultRefs.executionId, execIds));
  }
  await db
    .delete(investigationExecutions)
    .where(
      inArray(investigationExecutions.organisationId, [orgAId, orgBId]),
    );
  await db
    .delete(attachments)
    .where(inArray(attachments.organisationId, [orgAId, orgBId]));
  await db
    .delete(observables)
    .where(
      inArray(observables.caseId, [caseA, caseA2, caseRestricted, caseB]),
    );
  await db.delete(entities).where(eq(entities.organisationId, orgAId));
  await db
    .delete(cases)
    .where(inArray(cases.id, [caseA, caseA2, caseRestricted, caseB]));
  await db
    .delete(users)
    .where(
      inArray(users.id, [userAId, userA2Id, userAnalystId, userBId]),
    );
  await db
    .delete(organisations)
    .where(inArray(organisations.id, [orgAId, orgBId]));
}

async function main() {
  __resetRateLimitWindowsForTests();
  await setup();
  try {
    // ── Registry surface ──────────────────────────────────────────────
    const commands = listPublicCommands();
    assert.ok(
      commands.some((c) => c.name === "kelpie.previous_cases"),
      "previous_cases registered",
    );
    assert.ok(
      commands.some((c) => c.name === "virustotal.report"),
      "virustotal.report registered",
    );
    assert.ok(
      commands.some((c) => c.name === "kelpie.flag_entity_reviewed"),
      "flag_entity_reviewed registered",
    );
    for (const c of commands) {
      if (c.accessClass === "write") {
        assert.equal(c.approvalRequired, true, `${c.name} write needs approval`);
      } else {
        assert.equal(c.approvalRequired, false, `${c.name} read no approval`);
      }
    }
    assert.equal(isProhibitedCommandName("shell"), true);
    assert.equal(isProhibitedCommandName("bash"), true);
    assert.equal(isProhibitedCommandName("kelpie.previous_cases"), false);
    console.log("ok: registry + prohibitions");

    // ── Schema rejection ──────────────────────────────────────────────
    const prev = getInvestigationHandler("kelpie.previous_cases")!;
    assert.throws(
      () => validateCommandParams(prev, { value: "" }),
      /Invalid parameters/,
    );
    assert.throws(
      () => validateCommandParams(prev, { notAField: 1 }),
      /Invalid parameters/,
    );
    assert.throws(
      () => validateCommandParams(prev, null),
      InvestigationConsoleError,
    );
    console.log("ok: schema rejection");

    // ── Injection / SSRF ──────────────────────────────────────────────
    assert.throws(
      () => rejectDangerousParams({ value: "; rm -rf /" }),
      /disallowed content/,
    );
    assert.throws(
      () => rejectDangerousParams({ value: "$(whoami)" }),
      /disallowed content/,
    );
    assert.throws(
      () =>
        rejectDangerousParams({
          url: "https://evil.example/steal",
        }),
      /arbitrary destination URL/,
    );
    assert.throws(
      () =>
        rejectDangerousParams({
          target_url: "http://169.254.169.254/latest/meta-data/",
        }),
      /arbitrary destination URL/,
    );
    // Fixed VT path builder never takes a free URL.
    const vtUrl = virusTotalEndpointFor("ip", "1.2.3.4");
    assert.equal(
      vtUrl,
      "https://www.virustotal.com/api/v3/ip_addresses/1.2.3.4",
    );
    assert.equal(virusTotalEndpointFor("hostname", "x"), null);
    console.log("ok: injection/SSRF guards");

    // ── Scopes fail closed ────────────────────────────────────────────
    assert.equal(tokenHasScope([], "investigation:execute"), false);
    assert.equal(
      tokenHasScope(["investigation:read"], "investigation:execute"),
      false,
    );
    await assert.rejects(
      () =>
        executeInvestigationCommand({
          organisationId: orgAId,
          actorId: userAId,
          tokenScopes: [],
          commandName: "kelpie.previous_cases",
          params: { value: "203.0.113.62", type: "ip" },
          caseId: caseA,
        }),
      (err: unknown) =>
        err instanceof InvestigationConsoleError && err.status === 403,
    );
    await assert.rejects(
      () =>
        executeInvestigationCommand({
          organisationId: orgAId,
          actorId: userAId,
          tokenScopes: ["investigation:read"],
          commandName: "kelpie.previous_cases",
          params: { value: "203.0.113.62" },
          caseId: caseA,
        }),
      (err: unknown) =>
        err instanceof InvestigationConsoleError && err.status === 403,
    );
    await assert.rejects(
      () =>
        executeInvestigationCommand({
          organisationId: orgAId,
          actorId: userAId,
          tokenScopes: scopesFull,
          commandName: "shell",
          params: { cmd: "id" },
        }),
      /prohibited/,
    );
    console.log("ok: scopes fail closed + prohibited names");

    // ── Redaction ─────────────────────────────────────────────────────
    const redacted = redactParams(
      { value: "203.0.113.62", api_key: "super-secret-key", note: "ok" },
      ["api_key"],
    );
    assert.equal(redacted.api_key, "[redacted]");
    assert.equal(redacted.value, "203.0.113.62");
    console.log("ok: redaction");

    // ── Read command: previous cases + tenant isolation ───────────────
    const runPrev = await executeInvestigationCommand({
      organisationId: orgAId,
      actorId: userAId,
      tokenScopes: scopesFull,
      commandName: "kelpie.previous_cases",
      params: { value: "203.0.113.62", type: "ip", limit: 20 },
      caseId: caseA,
    });
    assert.equal(runPrev.execution.status, "succeeded");
    assert.equal(runPrev.execution.commandVersion, "1.0.0");
    assert.ok(runPrev.execution.resultSha256);
    const summary = runPrev.execution.resultSummary as {
      data?: { rows?: Array<{ caseId: string; caseNumber: string }> };
    };
    const rows = summary?.data?.rows ?? [];
    assert.ok(
      rows.some((r) => r.caseId === caseA2),
      "finds prior case in same org",
    );
    assert.ok(
      !rows.some((r) => r.caseId === caseB),
      "must not leak other tenant cases",
    );
    assert.ok(
      !rows.some((r) => r.caseId === caseA),
      "excludes current case when case context set",
    );
    // Admin still knows restricted cases exist.
    assert.ok(
      rows.some((r) => r.caseId === caseRestricted),
      "admin sees restricted prior case via know_exists",
    );

    // Analyst without grant must not see restricted prior case.
    const runPrevAnalyst = await executeInvestigationCommand({
      organisationId: orgAId,
      actorId: userAnalystId,
      tokenScopes: scopesFull,
      commandName: "kelpie.previous_cases",
      params: { value: "203.0.113.62", type: "ip", limit: 20 },
      caseId: caseA,
    });
    assert.equal(runPrevAnalyst.execution.status, "succeeded");
    const analystSummary = runPrevAnalyst.execution.resultSummary as {
      data?: { rows?: Array<{ caseId: string }> };
    };
    const analystRows = analystSummary?.data?.rows ?? [];
    assert.ok(
      analystRows.some((r) => r.caseId === caseA2),
      "analyst still sees organisation-visible prior case",
    );
    assert.ok(
      !analystRows.some((r) => r.caseId === caseRestricted),
      "analyst must not leak restricted case via previous_cases",
    );
    console.log("ok: previous_cases + tenant isolation + compartment filter");

    // ── VirusTotal mock path (no key) ─────────────────────────────────
    const runVt = await executeInvestigationCommand({
      organisationId: orgAId,
      actorId: userAId,
      tokenScopes: scopesFull,
      commandName: "virustotal.report",
      params: { value: "203.0.113.62", type: "ip" },
      caseId: caseA,
    });
    assert.equal(runVt.execution.status, "succeeded");
    assert.ok(
      String(runVt.execution.providerRequestId ?? "").startsWith("vt-mock:"),
    );
    console.log("ok: virustotal mock handler");

    // ── Write command: approval dual control ──────────────────────────
    const writeReq = await executeInvestigationCommand({
      organisationId: orgAId,
      actorId: userAId,
      tokenScopes: scopesFull,
      commandName: "kelpie.flag_entity_reviewed",
      params: { entityId: entityA, note: "Reviewed during triage" },
      caseId: caseA,
      entityId: entityA,
    });
    assert.equal(writeReq.execution.status, "awaiting_approval");
    assert.ok(writeReq.execution.expiresAt);

    // Requester cannot self-approve.
    await assert.rejects(
      () =>
        approveInvestigationExecution({
          organisationId: orgAId,
          approverId: userAId,
          executionId: writeReq.execution.id,
          tokenScopes: scopesFull,
        }),
      /cannot approve their own/,
    );

    const approved = await approveInvestigationExecution({
      organisationId: orgAId,
      approverId: userA2Id,
      executionId: writeReq.execution.id,
      tokenScopes: scopesFull,
    });
    assert.equal(approved.status, "succeeded");
    assert.equal(approved.approvedBy, userA2Id);

    const [entityAfter] = await db
      .select()
      .from(entities)
      .where(eq(entities.id, entityA))
      .limit(1);
    assert.ok(
      entityAfter?.notes?.includes("Reviewed during triage"),
      "write applied after approval",
    );

    // Reject path
    const write2 = await executeInvestigationCommand({
      organisationId: orgAId,
      actorId: userAId,
      tokenScopes: scopesFull,
      commandName: "kelpie.flag_entity_reviewed",
      params: { entityId: entityA, note: "Should be rejected" },
      caseId: caseA,
    });
    const rejected = await rejectInvestigationExecution({
      organisationId: orgAId,
      actorId: userA2Id,
      executionId: write2.execution.id,
      reason: "Not needed",
    });
    assert.equal(rejected.status, "rejected");
    console.log("ok: write approval + reject");

    // ── Cancel ────────────────────────────────────────────────────────
    const write3 = await executeInvestigationCommand({
      organisationId: orgAId,
      actorId: userAId,
      tokenScopes: scopesFull,
      commandName: "kelpie.flag_entity_reviewed",
      params: { entityId: entityA, note: "cancel me" },
      caseId: caseA,
    });
    const cancelled = await cancelInvestigationExecution({
      organisationId: orgAId,
      actorId: userAId,
      executionId: write3.execution.id,
    });
    assert.equal(cancelled.execution.status, "cancelled");
    assert.equal(cancelled.bestEffort, false);
    await assert.rejects(
      () =>
        cancelInvestigationExecution({
          organisationId: orgAId,
          actorId: userAId,
          executionId: write3.execution.id,
        }),
      /already terminal/,
    );
    console.log("ok: cancel");

    // ── Timeout ───────────────────────────────────────────────────────
    const slowName = `test.slow_${runId}`;
    const slowHandler: InvestigationCommandHandler = {
      name: slowName,
      version: "0.0.1",
      label: "Slow test",
      description: "Hangs until aborted",
      accessClass: "read",
      requiredScopes: ["investigation:execute"],
      parameters: [],
      paramSchema: z.object({}) as z.ZodType<Record<string, unknown>>,
      resultRenderers: ["json"],
      timeoutMs: 80,
      maxResultBytes: 1024,
      rateLimitPerMinute: 100,
      approvalRequired: false,
      async execute(_params, ctx) {
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(() => resolve(), 30_000);
          ctx.signal.addEventListener("abort", () => {
            clearTimeout(t);
            reject(new Error("aborted"));
          });
        });
        return {
          ok: true,
          renderer: "json",
          data: {},
          summary: "should not finish",
        };
      },
    };
    __registerHandlerForTests(slowHandler);
    try {
      const timed = await executeInvestigationCommand({
        organisationId: orgAId,
        actorId: userAId,
        tokenScopes: scopesFull,
        commandName: slowName,
        params: {},
        caseId: caseA,
      });
      assert.equal(timed.execution.status, "timed_out");
      console.log("ok: timeout");
    } finally {
      __unregisterHandlerForTests(slowName);
    }

    // ── Save as evidence ──────────────────────────────────────────────
    const saved = await saveExecutionAsEvidence({
      organisationId: orgAId,
      actorId: userAId,
      executionId: runPrev.execution.id,
      caseId: caseA,
    });
    assert.ok(saved.evidenceId.startsWith("att_"));
    assert.ok(saved.sha256.length === 64);
    const [att] = await db
      .select()
      .from(attachments)
      .where(eq(attachments.id, saved.evidenceId))
      .limit(1);
    assert.equal(att?.organisationId, orgAId);
    assert.equal(att?.caseId, caseA);
    assert.equal(att?.source, "investigation_console");
    assert.ok(att?.examinerNotes?.includes("kelpie.previous_cases"));
    assert.ok(att?.examinerNotes?.includes("version=1.0.0"));

    const fresh = await getInvestigationExecution(
      orgAId,
      runPrev.execution.id,
    );
    assert.equal(fresh?.savedEvidenceId, saved.evidenceId);

    // Tenant isolation on get
    const cross = await getInvestigationExecution(
      orgBId,
      runPrev.execution.id,
    );
    assert.equal(cross, null);
    console.log("ok: save evidence + tenant isolation on get");

    // Org B cannot execute against org A case
    await assert.rejects(
      () =>
        executeInvestigationCommand({
          organisationId: orgBId,
          actorId: userBId,
          tokenScopes: scopesFull,
          commandName: "kelpie.previous_cases",
          params: { value: "203.0.113.62" },
          caseId: caseA,
        }),
      (err: unknown) =>
        err instanceof InvestigationConsoleError && err.status === 404,
    );
    console.log("ok: cross-tenant case execute rejected");

    // ── save-evidence forbids cross-case body ─────────────────────────
    await assert.rejects(
      () =>
        saveExecutionAsEvidence({
          organisationId: orgAId,
          actorId: userAId,
          executionId: runPrev.execution.id,
          caseId: caseA2,
        }),
      (err: unknown) =>
        err instanceof InvestigationConsoleError &&
        err.status === 400 &&
        /must match the execution case/.test(err.message),
    );
    console.log("ok: save-evidence rejects caseId mismatch");

    // ── list executions filters restricted cases for analyst ──────────
    const allListed = await listInvestigationExecutions({
      organisationId: orgAId,
      limit: 50,
    });
    // Seed a restricted-case execution row the analyst must not see.
    const restrictedExec = await executeInvestigationCommand({
      organisationId: orgAId,
      actorId: userAId,
      tokenScopes: scopesFull,
      commandName: "kelpie.previous_cases",
      params: { value: "203.0.113.62", type: "ip" },
      caseId: caseRestricted,
    });
    assert.equal(restrictedExec.execution.status, "succeeded");
    const analystActor = await resolveInvestigationActor(
      orgAId,
      userAnalystId,
    );
    const filtered = await filterExecutionsForActor(
      orgAId,
      analystActor,
      await listInvestigationExecutions({ organisationId: orgAId, limit: 50 }),
    );
    assert.ok(
      !filtered.some((r) => r.id === restrictedExec.execution.id),
      "list filter omits restricted-case execution for analyst",
    );
    assert.ok(
      filtered.some((r) => r.caseId === caseA),
      "list filter keeps organisation-visible executions",
    );
    assert.ok(allListed.length >= filtered.length);
    console.log("ok: list executions know_exists filter");

    // ── approve refuses redacted placeholders without sealed params ───
    assert.equal(paramsContainRedactedMarker({ note: "ok" }), false);
    assert.equal(
      paramsContainRedactedMarker({ secret: "[redacted]" }),
      true,
    );
    const writeSealed = await executeInvestigationCommand({
      organisationId: orgAId,
      actorId: userAId,
      tokenScopes: scopesFull,
      commandName: "kelpie.flag_entity_reviewed",
      params: { entityId: entityA, note: "sealed params path" },
      caseId: caseA,
    });
    assert.equal(writeSealed.execution.status, "awaiting_approval");
    const [pending] = await db
      .select()
      .from(investigationExecutions)
      .where(eq(investigationExecutions.id, writeSealed.execution.id))
      .limit(1);
    assert.ok(pending?.paramsSealed, "sealed params stored for approval");
    assert.equal(
      (pending?.paramsSealed as { note?: string })?.note,
      "sealed params path",
    );
    // Clear sealed to simulate redacted-only storage, force fail path.
    await db
      .update(investigationExecutions)
      .set({
        paramsSealed: null,
        paramsRedacted: { entityId: entityA, note: "[redacted]" },
      })
      .where(eq(investigationExecutions.id, writeSealed.execution.id));
    await assert.rejects(
      () =>
        approveInvestigationExecution({
          organisationId: orgAId,
          approverId: userA2Id,
          executionId: writeSealed.execution.id,
          tokenScopes: scopesFull,
        }),
      /sealed parameters unavailable/,
    );
    // Restore sealed and approve successfully.
    await db
      .update(investigationExecutions)
      .set({
        paramsSealed: { entityId: entityA, note: "sealed params path" },
        paramsRedacted: { entityId: entityA, note: "sealed params path" },
        status: "awaiting_approval",
      })
      .where(eq(investigationExecutions.id, writeSealed.execution.id));
    const approvedSealed = await approveInvestigationExecution({
      organisationId: orgAId,
      approverId: userA2Id,
      executionId: writeSealed.execution.id,
      tokenScopes: scopesFull,
    });
    assert.equal(approvedSealed.status, "succeeded");
    const [afterApprove] = await db
      .select({ paramsSealed: investigationExecutions.paramsSealed })
      .from(investigationExecutions)
      .where(eq(investigationExecutions.id, writeSealed.execution.id))
      .limit(1);
    assert.equal(afterApprove?.paramsSealed, null, "sealed cleared after run");
    console.log("ok: sealed params approve path + redacted fail-closed");

    console.log("\nAll investigation console tests passed.");
  } finally {
    await cleanup();
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  cleanup().finally(() => process.exit(1));
});
