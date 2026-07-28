/**
 * Direct-call coverage for issue #60 (integration health, credential lifecycle,
 * bidirectional source synchronisation). Real Postgres; no HTTP server required
 * for the core contract. Covers expiry warnings, rate limits, stale cursors,
 * field-ownership conflicts, idempotent retries, authorization gates, tenant
 * isolation, and secret-free diagnostics.
 */
import assert from "node:assert/strict";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import {
  auditEvents,
  caseSources,
  cases,
  integrationConnectionStates,
  integrationCredentials,
  integrationSyncConflicts,
  integrationSyncPolicies,
  integrationSyncWrites,
  organisations,
  users,
} from "../src/db/schema";
import { newId } from "../src/lib/utils";
import {
  decideInboundField,
  canOutboundWrite,
  defaultFieldPolicies,
} from "../src/lib/integrations/sync-policy";
import {
  computeRotationState,
  upsertCredentialReference,
  credentialWarnings,
  listCredentialsForConnection,
} from "../src/lib/integrations/credentials";
import { classifyHealthError } from "../src/lib/integrations/error-category";
import {
  redactDiagnosticMessage,
  redactDiagnosticObject,
  credentialFingerprint,
} from "../src/lib/integrations/redact";
import {
  recordConnectionHealth,
  touchConnectionFailure,
  touchConnectionSuccess,
} from "../src/lib/integrations/state";
import {
  beginOutboundWrite,
  completeOutboundWrite,
  getWriteByIdempotencyKey,
  OutboundWriteDeniedError,
  retryOutboundWrite,
} from "../src/lib/integrations/writes";
import {
  openSyncConflict,
  listOpenConflicts,
  resolveConflict,
  countOpenConflicts,
} from "../src/lib/integrations/conflicts";
import { applyInboundWithPolicies } from "../src/lib/integrations/apply-inbound";
import {
  getCaseStaleness,
  getConnectionHealth,
  listOrganisationHealth,
  buildWarnings,
  toHealthView,
} from "../src/lib/integrations/health";
import {
  pauseConnection,
  resumeConnection,
  testConnection,
} from "../src/lib/integrations/control";
import {
  diagnosticsContainsSecrets,
  exportDiagnostics,
} from "../src/lib/integrations/diagnostics";
import {
  getOrCreateSyncPolicy,
  updateSyncPolicy,
} from "../src/lib/integrations/sync-policy";
import type { IntegrationConnectionState } from "../src/db/schema";

const runId = newId("i60").slice("i60_".length).slice(0, 10);
const orgAId = `org_i60_a_${runId}`;
const orgBId = `org_i60_b_${runId}`;
const userAId = `user_i60_a_${runId}`;
const userBId = `user_i60_b_${runId}`;
const sourceAId = `src_i60_a_${runId}`;
const sourceBId = `src_i60_b_${runId}`;
const caseAId = `case_i60_a_${runId}`;

async function cleanup() {
  await db
    .delete(organisations)
    .where(inArray(organisations.id, [orgAId, orgBId]));
}

async function main() {
  await cleanup();
  await db.insert(organisations).values([
    { id: orgAId, name: "I60 Org A", slug: orgAId.replace(/_/g, "-") },
    { id: orgBId, name: "I60 Org B", slug: orgBId.replace(/_/g, "-") },
  ]);
  await db.insert(users).values([
    {
      id: userAId,
      organisationId: orgAId,
      name: "Admin A",
      email: `a-${runId}@example.test`,
      role: "admin",
    },
    {
      id: userBId,
      organisationId: orgBId,
      name: "Admin B",
      email: `b-${runId}@example.test`,
      role: "admin",
    },
  ]);
  await db.insert(caseSources).values([
    {
      id: sourceAId,
      organisationId: orgAId,
      name: "Sentinel A",
      kind: "microsoft_sentinel",
      config: {
        tenant_id: "11111111-1111-1111-1111-111111111111",
        client_id: "22222222-2222-2222-2222-222222222222",
        client_secret: "super-secret-value-do-not-leak",
        subscription_id: "33333333-3333-3333-3333-333333333333",
        resource_group: "rg-soc",
        workspace_name: "law-soc",
      },
      isActive: true,
    },
    {
      id: sourceBId,
      organisationId: orgBId,
      name: "Sentinel B",
      kind: "microsoft_sentinel",
      config: { client_secret: "other-org-secret" },
      isActive: true,
    },
  ]);
  await db.insert(cases).values({
    id: caseAId,
    organisationId: orgAId,
    caseNumber: `CASE-I60-${runId}`,
    title: "Analyst title",
    summary: "Analyst narrative — must not be overwritten",
    status: "in_progress",
    severity: "high",
    classification: "malware",
    sourceSystem: `microsoft_sentinel:${sourceAId}`,
    sourceReference: "inc-42",
  });

  try {
    // ── 1. Pure field ownership decisions ───────────────────────────────
    assert.equal(
      decideInboundField({
        ownership: "kelpie_owned",
        kelpieValue: "analyst notes",
        sourceValue: "provider notes",
        sourceIsNewer: true,
      }).action,
      "keep_kelpie",
    );
    assert.equal(
      decideInboundField({
        ownership: "source_owned",
        kelpieValue: "old",
        sourceValue: "new",
        sourceIsNewer: true,
      }).action,
      "apply_source",
    );
    assert.equal(
      decideInboundField({
        ownership: "manual_conflict",
        kelpieValue: "a",
        sourceValue: "b",
        sourceIsNewer: true,
      }).action,
      "conflict",
    );
    assert.equal(
      decideInboundField({
        ownership: "last_write_wins",
        kelpieValue: "a",
        sourceValue: "b",
        sourceIsNewer: false,
      }).action,
      "keep_kelpie",
    );
    assert.equal(
      decideInboundField({
        ownership: "one_way_only",
        kelpieValue: "a",
        sourceValue: "b",
        sourceIsNewer: true,
      }).action,
      "skip_one_way",
    );
    assert.equal(
      canOutboundWrite({
        outboundEnabled: false,
        writeEnabledOnConnection: true,
        outboundScopes: ["SecurityIncident.ReadWrite.All"],
        requiredScope: "SecurityIncident.ReadWrite.All",
        ownership: "kelpie_owned",
      }),
      false,
      "outbound off by default",
    );
    assert.equal(
      canOutboundWrite({
        outboundEnabled: true,
        writeEnabledOnConnection: true,
        outboundScopes: ["SecurityIncident.ReadWrite.All"],
        requiredScope: "SecurityIncident.ReadWrite.All",
        ownership: "kelpie_owned",
      }),
      true,
    );
    console.log("ok: field ownership + outbound defaults");

    // ── 2. Credential expiry / rotation (no plaintext) ──────────────────
    const soon = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    const past = new Date(Date.now() - 60_000);
    assert.equal(computeRotationState(soon), "expiring");
    assert.equal(computeRotationState(past), "expired");
    assert.equal(computeRotationState(null), "active");

    const cred = await upsertCredentialReference({
      organisationId: orgAId,
      connectionKind: "case_source",
      connectionId: sourceAId,
      label: "client_secret",
      reference: "case_sources.config.client_secret",
      secretForFingerprint: "super-secret-value-do-not-leak",
      consentedScopes: ["https://management.azure.com/.default"],
      expiresAt: soon,
    });
    assert.equal(cred.reference, "case_sources.config.client_secret");
    assert.ok(cred.fingerprint);
    assert.equal(cred.rotationState, "expiring");
    assert.notEqual(cred.fingerprint, "super-secret-value-do-not-leak");
    assert.equal(
      credentialFingerprint("super-secret-value-do-not-leak"),
      cred.fingerprint,
    );
    const warnings = credentialWarnings([cred]);
    assert.ok(warnings.some((w) => w.code === "credential_expiring"));

    const listed = await listCredentialsForConnection(
      orgAId,
      "case_source",
      sourceAId,
    );
    assert.equal(listed.length, 1);
    assert.ok(!JSON.stringify(listed).includes("super-secret-value-do-not-leak"));
    console.log("ok: credential references + expiry warnings (no plaintext)");

    // ── 3. Error categories: rate limit, auth, stale cursor ─────────────
    assert.equal(classifyHealthError("HTTP 429 Too Many Requests"), "rate_limit");
    assert.equal(classifyHealthError("invalid_client AADSTS7000215"), "auth");
    assert.equal(classifyHealthError("stale cursor rejected by provider"), "stale_cursor");
    assert.equal(
      classifyHealthError("token expired", { credentialExpired: true }),
      "credential_expired",
    );
    console.log("ok: typed health error categories");

    // ── 4. Health state + rate limit + stale cursor ─────────────────────
    await touchConnectionSuccess({
      organisationId: orgAId,
      connectionKind: "case_source",
      connectionId: sourceAId,
      displayName: "Sentinel A",
      cursor: "2026-07-01T00:00:00Z|42",
    });
    let health = await getConnectionHealth(orgAId, "case_source", sourceAId);
    assert.ok(health);
    assert.equal(health!.status, "healthy");
    assert.equal(health!.lastSourceCursor, "2026-07-01T00:00:00Z|42");
    assert.ok(!JSON.stringify(health).includes("super-secret-value-do-not-leak"));

    await touchConnectionFailure({
      organisationId: orgAId,
      connectionKind: "case_source",
      connectionId: sourceAId,
      displayName: "Sentinel A",
      errorCategory: "rate_limit",
      errorSummary: "HTTP 429 retry-after 60 secret=super-secret-value-do-not-leak",
      rateLimitRemaining: 0,
      rateLimitResetAt: new Date(Date.now() + 60_000),
    });
    health = await getConnectionHealth(orgAId, "case_source", sourceAId);
    assert.equal(health!.status, "rate_limited");
    assert.equal(health!.errorCategory, "rate_limit");
    assert.ok(health!.errorSummary);
    assert.ok(!health!.errorSummary!.includes("super-secret-value-do-not-leak"));
    assert.ok(health!.warnings.some((w) => w.code === "rate_limited"));

    // Force staleness: last success far in the past.
    await recordConnectionHealth({
      organisationId: orgAId,
      connectionKind: "case_source",
      connectionId: sourceAId,
      status: "healthy",
      errorCategory: null,
      errorSummary: null,
      lastSuccessAt: new Date(Date.now() - 5 * 60 * 60 * 1000),
      lastAttemptAt: new Date(Date.now() - 5 * 60 * 60 * 1000),
    });
    await getOrCreateSyncPolicy({
      organisationId: orgAId,
      connectionKind: "case_source",
      connectionId: sourceAId,
    });
    health = await getConnectionHealth(orgAId, "case_source", sourceAId);
    assert.equal(health!.stale, true);
    assert.ok(health!.warnings.some((w) => w.code === "stale_cursor"));

    const staleness = await getCaseStaleness(orgAId, caseAId);
    assert.ok(staleness);
    assert.equal(staleness!.stale, true);
    assert.ok(staleness!.reason);
    console.log("ok: rate limits + stale cursor + case staleness banner data");

    // ── 5. Inbound apply never overwrites Kelpie-owned fields ───────────
    const [caseRow] = await db
      .select()
      .from(cases)
      .where(eq(cases.id, caseAId))
      .limit(1);
    const apply = await applyInboundWithPolicies({
      organisationId: orgAId,
      connectionKind: "case_source",
      connectionId: sourceAId,
      caseRow: caseRow!,
      source: {
        title: "Provider title update",
        summary: "Provider trying to overwrite narrative",
        severity: "critical",
        status: "contained",
        sourceUpdatedAt: new Date(),
      },
      fieldPolicies: {
        title: "source_owned",
        summary: "kelpie_owned",
        severity: "source_owned",
        status: "manual_conflict",
        assigneeId: "kelpie_owned",
        classification: "source_owned",
        closure: "kelpie_owned",
        comments: "one_way_only",
      },
    });
    assert.ok(apply.applied.includes("title"));
    assert.ok(apply.applied.includes("severity"));
    assert.ok(apply.kept.includes("summary") || !apply.applied.includes("summary"));
    assert.ok(apply.conflicts.length >= 1, "status conflict queued");

    const [after] = await db
      .select()
      .from(cases)
      .where(eq(cases.id, caseAId))
      .limit(1);
    assert.equal(after!.title, "Provider title update");
    assert.equal(after!.summary, "Analyst narrative — must not be overwritten");
    assert.equal(after!.severity, "critical");
    assert.equal(after!.status, "in_progress", "manual_conflict must not auto-apply");

    const open = await listOpenConflicts(orgAId, { caseId: caseAId });
    assert.ok(open.some((c) => c.fieldName === "status"));
    console.log("ok: inbound apply respects Kelpie-owned + conflict queue");

    // ── 6. Outbound writes off by default; retries preserve lineage ─────
    await assert.rejects(
      () =>
        beginOutboundWrite({
          organisationId: orgAId,
          connectionKind: "case_source",
          connectionId: sourceAId,
          caseId: caseAId,
          fieldName: "status",
          idempotencyKey: `i60-out-${runId}-1`,
          requiredScope: "SecurityIncident.ReadWrite.All",
          requestSummary: { status: "contained", client_secret: "nope" },
        }),
      (err: unknown) => err instanceof OutboundWriteDeniedError,
    );

    await updateSyncPolicy({
      organisationId: orgAId,
      connectionKind: "case_source",
      connectionId: sourceAId,
      outboundEnabled: true,
      outboundScopes: ["SecurityIncident.ReadWrite.All"],
      fieldPolicies: { status: "kelpie_owned" },
    });
    await recordConnectionHealth({
      organisationId: orgAId,
      connectionKind: "case_source",
      connectionId: sourceAId,
      writeEnabled: true,
    });

    const { write: w1, reused: r1 } = await beginOutboundWrite({
      organisationId: orgAId,
      connectionKind: "case_source",
      connectionId: sourceAId,
      caseId: caseAId,
      fieldName: "status",
      idempotencyKey: `i60-out-${runId}-2`,
      requiredScope: "SecurityIncident.ReadWrite.All",
      requestSummary: { status: "contained", client_secret: "must-redact" },
    });
    assert.equal(r1, false);
    assert.equal(
      (w1.requestSummary as Record<string, unknown>).client_secret,
      "[redacted]",
    );

    // Idempotent re-begin
    const { write: w1b, reused: r1b } = await beginOutboundWrite({
      organisationId: orgAId,
      connectionKind: "case_source",
      connectionId: sourceAId,
      caseId: caseAId,
      fieldName: "status",
      idempotencyKey: `i60-out-${runId}-2`,
      requiredScope: "SecurityIncident.ReadWrite.All",
    });
    assert.equal(r1b, true);
    assert.equal(w1b.id, w1.id);

    await completeOutboundWrite({
      organisationId: orgAId,
      writeId: w1.id,
      status: "failed",
      providerRequestId: "prov-req-1",
      errorCategory: "provider_error",
      errorSummary: "temporary failure",
      responseSummary: { code: 503 },
    });
    // Completion is idempotent
    const again = await completeOutboundWrite({
      organisationId: orgAId,
      writeId: w1.id,
      status: "succeeded",
      providerRequestId: "should-not-overwrite",
    });
    assert.equal(again.status, "failed");
    assert.equal(again.providerRequestId, "prov-req-1");

    const child = await retryOutboundWrite({
      organisationId: orgAId,
      parentWriteId: w1.id,
      requiredScope: "SecurityIncident.ReadWrite.All",
    });
    assert.equal(child.attempt, 2);
    assert.equal(child.parentWriteId, w1.id);
    assert.equal(child.rootWriteId, w1.id);
    assert.notEqual(child.idempotencyKey, w1.idempotencyKey);

    await completeOutboundWrite({
      organisationId: orgAId,
      writeId: child.id,
      status: "succeeded",
      providerRequestId: "prov-req-2",
      sourceVersion: "v9",
      responseSummary: { ok: true },
    });
    const parent = await getWriteByIdempotencyKey(orgAId, w1.idempotencyKey);
    assert.equal(parent!.status, "retrying");
    assert.equal(parent!.providerRequestId, "prov-req-1", "parent history immutable");
    console.log("ok: outbound default-off + idempotent retries with lineage");

    // ── 7. Pause / resume / test audited + tenant isolation ─────────────
    const paused = await pauseConnection({
      organisationId: orgAId,
      connectionKind: "case_source",
      connectionId: sourceAId,
      actorId: userAId,
      actorLabel: "Admin A",
    });
    assert.equal(paused.isPaused, true);
    assert.equal(paused.status, "paused");
    const [srcAfterPause] = await db
      .select({ isActive: caseSources.isActive })
      .from(caseSources)
      .where(eq(caseSources.id, sourceAId));
    assert.equal(srcAfterPause!.isActive, false);

    await assert.rejects(
      () =>
        pauseConnection({
          organisationId: orgAId,
          connectionKind: "case_source",
          connectionId: sourceBId,
          actorId: userAId,
        }),
      (err: unknown) =>
        err instanceof Error && /not found/i.test(err.message),
    );

    const testResult = await testConnection({
      organisationId: orgAId,
      connectionKind: "case_source",
      connectionId: sourceAId,
      actorId: userAId,
      actorLabel: "Admin A",
    });
    // Paused source still has config; lastError may be null → ok true
    assert.equal(typeof testResult.ok, "boolean");

    await resumeConnection({
      organisationId: orgAId,
      connectionKind: "case_source",
      connectionId: sourceAId,
      actorId: userAId,
      actorLabel: "Admin A",
    });
    const [srcAfterResume] = await db
      .select({ isActive: caseSources.isActive })
      .from(caseSources)
      .where(eq(caseSources.id, sourceAId));
    assert.equal(srcAfterResume!.isActive, true);

    const audits = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.organisationId, orgAId));
    const actions = audits.map((a) => a.action);
    assert.ok(actions.includes("integration.paused"));
    assert.ok(actions.includes("integration.resumed"));
    assert.ok(actions.includes("integration.tested"));
    for (const a of audits) {
      assert.ok(!JSON.stringify(a).includes("super-secret-value-do-not-leak"));
    }

    // Org B must not see Org A health/conflicts
    await touchConnectionSuccess({
      organisationId: orgBId,
      connectionKind: "case_source",
      connectionId: sourceBId,
      displayName: "Sentinel B",
    });
    const orgBHealth = await listOrganisationHealth(orgBId);
    assert.ok(orgBHealth.every((h) => h.connectionId !== sourceAId));
    assert.equal(await countOpenConflicts(orgBId), 0);
    const orgAConflicts = await listOpenConflicts(orgAId);
    assert.ok(orgAConflicts.length >= 1);
    console.log("ok: pause/resume/test audited + tenant isolation");

    // ── 8. Resolve conflict + diagnostics export secret-free ────────────
    const conflictId = orgAConflicts.find((c) => c.fieldName === "status")!.id;
    await resolveConflict({
      organisationId: orgAId,
      conflictId,
      resolution: "resolved_keep_kelpie",
      actorId: userAId,
    });
    assert.equal(
      (await listOpenConflicts(orgAId)).some((c) => c.id === conflictId),
      false,
    );

    const bundle = await exportDiagnostics(orgAId);
    assert.ok(bundle.connections.length >= 1);
    assert.equal(diagnosticsContainsSecrets(bundle), false);
    assert.ok(!JSON.stringify(bundle).includes("super-secret-value-do-not-leak"));
    assert.ok(!JSON.stringify(bundle).includes("other-org-secret"));

    // Redaction unit checks
    const redactedAuth = redactDiagnosticMessage(
      "Authorization: Bearer klp_abc123xyz",
    );
    assert.ok(redactedAuth);
    assert.ok(
      !redactedAuth!.includes("klp_abc123xyz"),
      "API tokens must be stripped from diagnostic messages",
    );
    assert.ok(
      !/bearer\s+\S+/i.test(redactedAuth!),
      "bearer tokens must be stripped from diagnostic messages",
    );
    const redacted = redactDiagnosticObject({
      client_secret: "x",
      status: "ok",
      nested: { api_key: "y", count: 1 },
    });
    assert.equal(redacted.client_secret, "[redacted]");
    assert.equal((redacted.nested as Record<string, unknown>).api_key, "[redacted]");
    assert.equal((redacted.nested as Record<string, unknown>).count, 1);

    // Default policies materialise outbound=false
    const defaults = defaultFieldPolicies("case_source");
    assert.equal(defaults.summary, "kelpie_owned");
    assert.equal(defaults.status, "source_owned");
    const policy = await getOrCreateSyncPolicy({
      organisationId: orgAId,
      connectionKind: "case_source",
      connectionId: sourceAId,
    });
    // We enabled outbound earlier for write tests — disable again and prove gate
    await updateSyncPolicy({
      organisationId: orgAId,
      connectionKind: "case_source",
      connectionId: sourceAId,
      outboundEnabled: false,
    });
    await recordConnectionHealth({
      organisationId: orgAId,
      connectionKind: "case_source",
      connectionId: sourceAId,
      writeEnabled: false,
    });
    await assert.rejects(
      () =>
        beginOutboundWrite({
          organisationId: orgAId,
          connectionKind: "case_source",
          connectionId: sourceAId,
          fieldName: "status",
          idempotencyKey: `i60-out-${runId}-3`,
          requiredScope: "SecurityIncident.ReadWrite.All",
        }),
      OutboundWriteDeniedError,
    );
    void policy;

    // Subscription expiry warning via synthetic health row
    const [stateRow] = await db
      .select()
      .from(integrationConnectionStates)
      .where(
        and(
          eq(integrationConnectionStates.organisationId, orgAId),
          eq(integrationConnectionStates.connectionId, sourceAId),
        ),
      )
      .limit(1);
    const fakeState = {
      ...stateRow!,
      webhookSubscriptionExpiresAt: new Date(Date.now() + 60_000),
      isPaused: false,
      rateLimitRemaining: 10,
      status: "healthy",
      lastSuccessAt: new Date(),
    } as IntegrationConnectionState;
    const subWarnings = buildWarnings({
      state: fakeState,
      credentials: listed,
      openConflictCount: 0,
      thresholdMinutes: 60,
    });
    assert.ok(subWarnings.some((w) => w.code === "subscription_expiring"));
    const view = toHealthView(fakeState, {
      credentials: listed,
      openConflictCount: 0,
      outboundEnabled: false,
      freshnessThresholdMinutes: 60,
    });
    assert.equal(view.writeEnabled, fakeState.writeEnabled);

    console.log("ok: diagnostics export + subscription warnings + re-disabled outbound");
    console.log("integration health tests passed");
  } finally {
    await cleanup();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
