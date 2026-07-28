/**
 * Coverage for the normalized investigation data model (issue #55): entity
 * deduplication, idempotent alert ingestion with provider/analyst field
 * ownership, alert-to-case and entity-to-alert linking with timeline events,
 * evidence items and their relationships, tenant isolation, backfill
 * idempotency, and bounded/redacted provider payload references. Calls
 * `src/lib/investigations/*` directly against a real Postgres instance, no
 * HTTP server required (mirrors `scripts/test-evidence-core.ts`).
 */
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { db } from "../src/db";
import {
  alertEntities,
  alerts,
  caseAlerts,
  cases,
  entities,
  entityIdentifiers,
  organisations,
  timelineEvents,
  users,
} from "../src/db/schema";
import { newId } from "../src/lib/utils";
import {
  canonicalizeIdentifierValue,
  EntityError,
  resolveEntityCore,
} from "../src/lib/investigations/entities-core";
import {
  AlertError,
  AlertVersionConflictError,
  createOrUpdateAlertFromProviderCore,
  getAlertInOrg,
  getOrCreateAlertSourceCore,
  linkAlertToCaseCore,
  linkEntityToAlertCore,
  listAlertsForCaseCore,
  setAlertDispositionCore,
} from "../src/lib/investigations/alerts-core";
import {
  EvidenceItemError,
  createEvidenceItemCore,
  linkEvidenceRelationshipCore,
  setEvidenceItemRemediationCore,
  setEvidenceItemVerdictCore,
} from "../src/lib/investigations/evidence-items-core";
import {
  getProviderPayloadReferenceCore,
  MAX_PAYLOAD_REFERENCE_BYTES,
  storeProviderPayloadReferenceCore,
} from "../src/lib/investigations/provider-payloads-core";

const runId = newId("i55test").slice("i55test_".length).slice(0, 10);
const orgId = `org_i55_${runId}`;
const orgBId = `org_i55b_${runId}`;
const userId = `user_i55_${runId}`;
let caseId = "";
let caseBId = "";

async function setup() {
  await db.insert(organisations).values([
    { id: orgId, name: "Investigations Test Org", slug: `i55-${runId}` },
    { id: orgBId, name: "Investigations Test Org B", slug: `i55b-${runId}` },
  ]);
  await db.insert(users).values({
    id: userId,
    name: "Investigations Tester",
    email: `i55-${runId}@example.com`,
    organisationId: orgId,
    role: "analyst",
  });
  caseId = newId("case");
  await db.insert(cases).values({
    id: caseId,
    organisationId: orgId,
    caseNumber: `I55TEST-${runId}`,
    title: "Investigation model fixture case",
  });
  caseBId = newId("case");
  await db.insert(cases).values({
    id: caseBId,
    organisationId: orgBId,
    caseNumber: `I55TESTB-${runId}`,
    title: "Investigation model fixture case (org B)",
  });
}

async function cleanup() {
  for (const org of [orgId, orgBId]) {
    const orgCases = await db.select({ id: cases.id }).from(cases).where(eq(cases.organisationId, org));
    const caseIds = orgCases.map((c) => c.id);
    if (caseIds.length) {
      await db.delete(timelineEvents).where(eq(timelineEvents.caseId, caseIds[0]!));
      if (caseIds[1]) await db.delete(timelineEvents).where(eq(timelineEvents.caseId, caseIds[1]!));
    }
  }
  // Deletes cascade from organisations -> cases/alerts/entities/etc.
  await db.delete(organisations).where(eq(organisations.id, orgId));
  await db.delete(organisations).where(eq(organisations.id, orgBId));
  const remaining = await db
    .select({ id: organisations.id })
    .from(organisations)
    .where(eq(organisations.id, orgId));
  assert.equal(remaining.length, 0, "fixture org must be fully cleaned up");
  console.log("investigations core fixture cleanup verified: no fixture rows remain");
}

async function main() {
  await setup();

  // ── canonicalization ──────────────────────────────────────────────────
  assert.equal(canonicalizeIdentifierValue("email", "Sam.Analyst@EXAMPLE.com"), "sam.analyst@example.com");
  assert.equal(canonicalizeIdentifierValue("sid", " s-1-5-21-1 "), "S-1-5-21-1");
  assert.equal(canonicalizeIdentifierValue("fqdn", "Host.Example.COM."), "host.example.com");
  assert.equal(canonicalizeIdentifierValue("url", "https://Example.com/Path"), "https://Example.com/Path");
  console.log("ok: identifier canonicalization is type-aware");

  // ── entity dedup ──────────────────────────────────────────────────────
  const first = await resolveEntityCore({
    organisationId: orgId,
    type: "user_identity",
    displayName: "Sam Analyst",
    identifiers: [{ kind: "email", value: "Sam.Analyst@EXAMPLE.com" }],
  });
  assert.equal(first.created, true);

  const second = await resolveEntityCore({
    organisationId: orgId,
    type: "user_identity",
    displayName: "Sam Analyst",
    identifiers: [
      { kind: "email", value: "sam.analyst@example.com" },
      { kind: "upn", value: "sam.analyst@example.com" },
    ],
  });
  assert.equal(second.created, false);
  assert.equal(second.entity.id, first.entity.id, "same normalised email resolves to same entity");

  const entityRows = await db
    .select()
    .from(entities)
    .where(and(eq(entities.organisationId, orgId), eq(entities.type, "user_identity")));
  assert.equal(entityRows.length, 1, "no duplicate entity row created");
  const identifierRows = await db
    .select()
    .from(entityIdentifiers)
    .where(eq(entityIdentifiers.entityId, first.entity.id));
  assert.equal(identifierRows.length, 2, "email + upn identifiers both recorded against one entity");
  console.log("ok: entities deduplicate per organisation via type-aware canonical identifiers");

  await assert.rejects(
    () =>
      resolveEntityCore({
        organisationId: orgId,
        type: "ip",
        displayName: "",
        identifiers: [{ kind: "ip", value: "203.0.113.5" }],
      }),
    (err: unknown) => err instanceof EntityError,
  );
  console.log("ok: entity resolution rejects a blank display name");

  // ── idempotent alert ingestion + field ownership ─────────────────────
  const sourceA = await getOrCreateAlertSourceCore({
    organisationId: orgId,
    kind: "microsoft_sentinel",
    name: "Sentinel workspace",
    tenantId: "tenant-1",
  });
  const sourceAAgain = await getOrCreateAlertSourceCore({
    organisationId: orgId,
    kind: "microsoft_sentinel",
    name: "Sentinel workspace",
    tenantId: "tenant-1",
  });
  assert.equal(sourceA.id, sourceAAgain.id, "alert source registration is deduplicated");

  const { alert: created, created: wasCreated } = await createOrUpdateAlertFromProviderCore({
    organisationId: orgId,
    sourceId: sourceA.id,
    tenantId: "tenant-1",
    externalId: "INC-1",
    title: "Suspicious sign-in",
    severity: "high",
  });
  assert.equal(wasCreated, true);
  assert.equal(created.status, "new");
  assert.equal(created.determination, "unknown");

  const { alert: repolled, created: repolledCreated } = await createOrUpdateAlertFromProviderCore({
    organisationId: orgId,
    sourceId: sourceA.id,
    tenantId: "tenant-1",
    externalId: "INC-1",
    title: "Suspicious sign-in (updated)",
    severity: "critical",
  });
  assert.equal(repolledCreated, false, "re-polling the same externalId never creates a duplicate alert");
  assert.equal(repolled.id, created.id);
  assert.equal(repolled.severity, "critical", "provider-owned severity refreshes before any analyst override");
  assert.equal(repolled.title, "Suspicious sign-in (updated)", "provider-owned title refreshes on poll");

  const disposed = await setAlertDispositionCore({
    organisationId: orgId,
    actorId: userId,
    alertId: created.id,
    patch: { severity: "low", status: "in_progress" },
  });
  assert.equal(disposed.severity, "low");
  assert.equal(disposed.severityOverriddenByAnalyst, true);
  assert.equal(disposed.status, "in_progress");

  const { alert: repolledAfterOverride } = await createOrUpdateAlertFromProviderCore({
    organisationId: orgId,
    sourceId: sourceA.id,
    tenantId: "tenant-1",
    externalId: "INC-1",
    title: "Suspicious sign-in (updated again)",
    severity: "critical",
  });
  assert.equal(
    repolledAfterOverride.severity,
    "low",
    "provider poll never overwrites an analyst-overridden severity",
  );
  assert.equal(
    repolledAfterOverride.title,
    "Suspicious sign-in (updated again)",
    "provider poll still refreshes provider-owned title after an analyst severity override",
  );
  assert.equal(repolledAfterOverride.status, "in_progress", "provider poll never touches analyst-owned status");
  console.log("ok: provider re-polls refresh provider-owned fields without overwriting analyst-owned fields");

  await assert.rejects(
    () =>
      setAlertDispositionCore({
        organisationId: orgId,
        actorId: userId,
        alertId: created.id,
        patch: { status: "closed" },
        expectedVersion: 0,
      }),
    (err: unknown) => err instanceof AlertVersionConflictError,
  );
  console.log("ok: stale version on alert disposition update is rejected");

  // ── alert <-> case linking is idempotent and timelined ───────────────
  await linkAlertToCaseCore({ organisationId: orgId, actorId: userId, caseId, alertId: created.id, isPrimary: true });
  await linkAlertToCaseCore({ organisationId: orgId, actorId: userId, caseId, alertId: created.id, isPrimary: true });
  const caseAlertRows = await db
    .select()
    .from(caseAlerts)
    .where(and(eq(caseAlerts.caseId, caseId), eq(caseAlerts.alertId, created.id)));
  assert.equal(caseAlertRows.length, 1, "linking the same alert twice does not duplicate the link");
  const linkEvents = await db
    .select()
    .from(timelineEvents)
    .where(and(eq(timelineEvents.caseId, caseId), eq(timelineEvents.eventType, "alert_linked_to_case")));
  assert.equal(linkEvents.length, 1, "linking is idempotent: exactly one timeline event, not two");
  console.log("ok: linking an alert into a case is idempotent and writes exactly one timeline event");

  const pagedAlerts = await listAlertsForCaseCore(orgId, caseId, { limit: 10 });
  assert.equal(pagedAlerts.items.length, 1);
  assert.equal(pagedAlerts.items[0]!.isPrimary, true);

  // ── entity <-> alert linking ───────────────────────────────────────────
  await linkEntityToAlertCore({
    organisationId: orgId,
    actorId: userId,
    alertId: created.id,
    entityId: first.entity.id,
    role: "actor",
  });
  await linkEntityToAlertCore({
    organisationId: orgId,
    actorId: userId,
    alertId: created.id,
    entityId: first.entity.id,
    role: "actor",
  });
  const entityLinkRows = await db
    .select()
    .from(alertEntities)
    .where(and(eq(alertEntities.alertId, created.id), eq(alertEntities.entityId, first.entity.id)));
  assert.equal(entityLinkRows.length, 1, "linking the same entity+role twice does not duplicate the link");
  const entityLinkEvents = await db
    .select()
    .from(timelineEvents)
    .where(and(eq(timelineEvents.caseId, caseId), eq(timelineEvents.eventType, "alert_entity_linked")));
  assert.equal(entityLinkEvents.length, 1);
  console.log("ok: entity-to-alert linking is idempotent and writes a timeline event");

  // ── evidence items ─────────────────────────────────────────────────────
  await assert.rejects(
    () =>
      createEvidenceItemCore({
        organisationId: orgId,
        actorId: userId,
        caseId,
        type: "observable",
        confidence: 150,
      }),
    (err: unknown) => err instanceof EvidenceItemError,
  );

  const evidenceA = await createEvidenceItemCore({
    organisationId: orgId,
    actorId: userId,
    caseId,
    alertId: created.id,
    type: "observable",
    value: "203.0.113.9",
    source: "provider",
    confidence: 80,
  });
  const evidenceB = await createEvidenceItemCore({
    organisationId: orgId,
    actorId: userId,
    caseId,
    type: "finding",
    description: "Correlated with known campaign",
  });

  const verdicted = await setEvidenceItemVerdictCore({
    organisationId: orgId,
    actorId: userId,
    evidenceItemId: evidenceA.id,
    verdict: "malicious",
  });
  assert.equal(verdicted.verdict, "malicious");
  const remediated = await setEvidenceItemRemediationCore({
    organisationId: orgId,
    actorId: userId,
    evidenceItemId: evidenceA.id,
    remediationState: "remediated",
  });
  assert.equal(remediated.remediationState, "remediated");
  const evidenceEvents = await db
    .select({ eventType: timelineEvents.eventType })
    .from(timelineEvents)
    .where(eq(timelineEvents.caseId, caseId));
  const eventTypes = evidenceEvents.map((e) => e.eventType);
  assert.ok(eventTypes.includes("evidence_item_created"));
  assert.ok(eventTypes.includes("evidence_item_verdict_changed"));
  assert.ok(eventTypes.includes("evidence_item_remediation_changed"));
  console.log("ok: evidence verdict/remediation changes are analyst-owned and timelined");

  // ── evidence relationships: canonicalization + directional type ──────
  await linkEvidenceRelationshipCore({
    organisationId: orgId,
    actorId: userId,
    sourceEvidenceId: evidenceA.id,
    targetEvidenceId: evidenceB.id,
    relationshipType: "related_to",
    reason: "Same campaign",
  });
  await assert.rejects(
    () =>
      linkEvidenceRelationshipCore({
        organisationId: orgId,
        actorId: userId,
        sourceEvidenceId: evidenceB.id,
        targetEvidenceId: evidenceA.id,
        relationshipType: "related_to",
        reason: "Same campaign, reversed order",
      }),
    (err: unknown) => err instanceof EvidenceItemError && err.status === 409,
  );
  console.log("ok: symmetric evidence relationship edge cannot be stored twice regardless of argument order");

  await linkEvidenceRelationshipCore({
    organisationId: orgId,
    actorId: userId,
    sourceEvidenceId: evidenceA.id,
    targetEvidenceId: evidenceB.id,
    relationshipType: "derived_from",
    reason: "A derived from B",
  });
  await linkEvidenceRelationshipCore({
    organisationId: orgId,
    actorId: userId,
    sourceEvidenceId: evidenceB.id,
    targetEvidenceId: evidenceA.id,
    relationshipType: "derived_from",
    reason: "B derived from A (different direction, allowed)",
  });
  console.log("ok: directional evidence relationship type stores both directions independently");

  await assert.rejects(
    () =>
      linkEvidenceRelationshipCore({
        organisationId: orgId,
        actorId: userId,
        sourceEvidenceId: evidenceA.id,
        targetEvidenceId: evidenceA.id,
        relationshipType: "related_to",
        reason: "self link",
      }),
    (err: unknown) => err instanceof EvidenceItemError && err.status === 400,
  );
  console.log("ok: evidence cannot be linked to itself");

  // ── tenant isolation ───────────────────────────────────────────────────
  assert.equal(await getAlertInOrg(created.id, orgBId), null, "alert is invisible from another organisation");
  await assert.rejects(
    () => listAlertsForCaseCore(orgBId, caseId, {}),
    (err: unknown) => err instanceof AlertError && err.status === 404,
  );
  console.log("ok: alerts and their case links are organisation-isolated");

  // Regression: `alertId`/`entityId` reach `createEvidenceItemCore` straight
  // from the REST body. Before they were org-checked, an org-A caller could
  // create an evidence item in their own case that referenced org B's alert
  // or entity purely by guessing an opaque id.
  const orgBSource = await getOrCreateAlertSourceCore({
    organisationId: orgBId,
    kind: "microsoft_sentinel",
    name: "Org B workspace",
    tenantId: "tenant-b",
  });
  const { alert: orgBAlert } = await createOrUpdateAlertFromProviderCore({
    organisationId: orgBId,
    sourceId: orgBSource.id,
    externalId: `orgb-ext-${runId}`,
    title: "Org B alert",
  });
  const { entity: orgBEntity } = await resolveEntityCore({
    organisationId: orgBId,
    type: "ip",
    displayName: "198.51.100.7",
    identifiers: [{ kind: "ip", value: "198.51.100.7" }],
  });

  await assert.rejects(
    () =>
      createEvidenceItemCore({
        organisationId: orgId,
        actorId: userId,
        caseId,
        alertId: orgBAlert.id,
        type: "ip",
        value: "198.51.100.7",
      }),
    (err: unknown) => err instanceof EvidenceItemError && err.status === 404,
    "evidence cannot reference another organisation's alert",
  );
  await assert.rejects(
    () =>
      createEvidenceItemCore({
        organisationId: orgId,
        actorId: userId,
        caseId,
        entityId: orgBEntity.id,
        type: "ip",
        value: "198.51.100.7",
      }),
    (err: unknown) => err instanceof EvidenceItemError && err.status === 404,
    "evidence cannot reference another organisation's entity",
  );
  console.log("ok: evidence items cannot reference another organisation's alert or entity");

  // Regression: the alerts FK only proves the source exists somewhere, so
  // provider ingestion verifies the source belongs to the ingesting org.
  await assert.rejects(
    () =>
      createOrUpdateAlertFromProviderCore({
        organisationId: orgId,
        sourceId: orgBSource.id,
        externalId: `cross-org-ext-${runId}`,
        title: "Alert ingested against another organisation's source",
      }),
    (err: unknown) => err instanceof AlertError && err.status === 404,
    "provider ingestion rejects a source from another organisation",
  );
  console.log("ok: provider alert ingestion rejects a cross-organisation source");

  // ── backfill idempotency (same flow as scripts/backfill-case-source-alerts.ts) ──
  const legacyCaseId = newId("case");
  await db.insert(cases).values({
    id: legacyCaseId,
    organisationId: orgId,
    caseNumber: `I55LEGACY-${runId}`,
    title: "Legacy source-backed case",
    sourceSystem: "microsoft_defender_xdr",
    sourceReference: `legacy-ref-${runId}`,
  });
  async function runBackfillStep() {
    const source = await getOrCreateAlertSourceCore({
      organisationId: orgId,
      kind: "microsoft_defender_xdr",
      name: "microsoft_defender_xdr",
    });
    const { alert } = await createOrUpdateAlertFromProviderCore({
      organisationId: orgId,
      sourceId: source.id,
      externalId: `legacy-ref-${runId}`,
      title: "Legacy source-backed case",
      detectionSource: "microsoft_defender_xdr",
    });
    await linkAlertToCaseCore({
      organisationId: orgId,
      actorId: null,
      caseId: legacyCaseId,
      alertId: alert.id,
      isPrimary: true,
    });
    return alert.id;
  }
  const firstRunAlertId = await runBackfillStep();
  const secondRunAlertId = await runBackfillStep();
  assert.equal(firstRunAlertId, secondRunAlertId, "re-running the backfill flow does not create a duplicate alert");
  const legacyLinks = await db
    .select()
    .from(caseAlerts)
    .where(eq(caseAlerts.caseId, legacyCaseId));
  assert.equal(legacyLinks.length, 1, "re-running the backfill flow does not duplicate the case-alert link");
  const [legacyAlert] = await db.select().from(alerts).where(eq(alerts.id, firstRunAlertId)).limit(1);
  assert.equal(legacyAlert?.externalId, `legacy-ref-${runId}`, "backfilled alert preserves the original source reference");
  assert.equal(legacyAlert?.detectionSource, "microsoft_defender_xdr", "backfilled alert preserves the original source system");
  console.log("ok: backfilling a legacy source-backed case is idempotent and preserves provenance");

  // ── provider payload references: bounded + redacted ──────────────────
  const smallRef = await storeProviderPayloadReferenceCore({
    organisationId: orgId,
    externalRef: "INC-1",
    payload: { api_key: "super-secret-value", detail: "ok", nested: { password: "hunter2" } },
  });
  const storedSmall = smallRef.payload as Record<string, unknown>;
  assert.equal(storedSmall.api_key, "[redacted]");
  assert.equal((storedSmall.nested as Record<string, unknown>).password, "[redacted]");
  assert.equal(storedSmall.detail, "ok");
  console.log("ok: provider payload references redact secret-shaped keys before storage");

  const oversizedPayload = { blob: "x".repeat(MAX_PAYLOAD_REFERENCE_BYTES + 1024) };
  const oversizedRef = await storeProviderPayloadReferenceCore({
    organisationId: orgId,
    externalRef: "INC-1",
    payload: oversizedPayload,
  });
  const storedOversized = oversizedRef.payload as Record<string, unknown>;
  assert.equal(storedOversized.truncated, true, "oversized payload is replaced with a bounded marker, not stored in full");
  assert.ok(oversizedRef.sizeBytes > MAX_PAYLOAD_REFERENCE_BYTES);
  console.log("ok: provider payload references are bounded to a fixed maximum size");

  assert.equal(
    await getProviderPayloadReferenceCore(smallRef.id, orgBId),
    null,
    "a provider payload reference is invisible from another organisation",
  );
  const readBack = await getProviderPayloadReferenceCore(smallRef.id, orgId);
  assert.ok(readBack);
  console.log("ok: provider payload references are organisation-isolated");
}

main()
  .then(() => cleanup())
  .then(() => process.exit(0))
  .catch(async (error) => {
    console.error(error);
    try {
      await cleanup();
    } catch (cleanupError) {
      console.error("cleanup also failed:", cleanupError);
    }
    process.exit(1);
  });
