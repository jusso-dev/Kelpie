/**
 * Real-Postgres acceptance coverage for Tawny as a first-class inbound case
 * source (issue #50): case creation, timeline provenance, idempotent replay,
 * concurrent duplicate delivery, organisation isolation, and delivery status
 * telemetry.
 *
 * HTTP-level behaviour (201 on create, 200 on duplicate replay, 400 on an
 * invalid payload) lives in `POST /api/v1/cases` and is not exercised here
 * because these scripts do not boot the Next server; that behaviour is
 * covered at the schema/validation-helper level by
 * `scripts/test-tawny-source.ts` (`isApiIngestableSourceSystem`,
 * `safeExternalUrl`), since the route composes its zod schema directly from
 * those helpers.
 */
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { db } from "../src/db";
import { cases, inboundSourceStatus, organisations, timelineEvents } from "../src/db/schema";
import { createCaseCore } from "../src/lib/cases-core";
import {
  getInboundSourceStatus,
  recordInboundSourceDelivery,
  recordInboundSourceError,
} from "../src/lib/inbound-source-status";
import { TAWNY_SOURCE_SYSTEM } from "../src/lib/case-source-identity";
import { newId } from "../src/lib/utils";

const runId = newId("tawnytest").slice("tawnytest_".length).slice(0, 12);
const orgAId = `org_tawnytest_a_${runId}`;
const orgBId = `org_tawnytest_b_${runId}`;

async function createOrg(id: string, name: string) {
  await db.insert(organisations).values({
    id,
    name,
    slug: id.replace(/_/g, "-"),
  });
}

async function main() {
  await createOrg(orgAId, "Tawny Test Org A");
  await createOrg(orgBId, "Tawny Test Org B");

  try {
    // ── 1. Create ──────────────────────────────────────────────────────────
    const sourceReference = `tawny-alert-${runId}-1`;
    const sourceUrl = "https://tawny.example.com/alerts/1";
    const created = await createCaseCore(orgAId, null, {
      title: "Suspicious login flagged by Tawny",
      sourceSystem: TAWNY_SOURCE_SYSTEM,
      sourceReference,
      sourceUrl,
    });
    assert.equal(created.created, true, "first delivery must create a case");

    const [caseRow] = await db
      .select()
      .from(cases)
      .where(eq(cases.id, created.id))
      .limit(1);
    assert.ok(caseRow, "created case row must be persisted");
    assert.equal(caseRow.sourceSystem, "tawny");
    assert.equal(caseRow.sourceReference, sourceReference);
    assert.equal(caseRow.sourceUrl, sourceUrl);

    // ── 2. Timeline provenance ────────────────────────────────────────────
    const timelineRows = await db
      .select()
      .from(timelineEvents)
      .where(
        and(
          eq(timelineEvents.caseId, created.id),
          eq(timelineEvents.eventType, "case_created"),
        ),
      );
    assert.equal(timelineRows.length, 1, "exactly one case_created timeline event expected");
    const payload = timelineRows[0].payload as Record<string, unknown>;
    assert.equal(payload.source_system, "tawny");
    assert.equal(payload.source_reference, sourceReference);
    assert.equal(
      payload.source_url,
      sourceUrl,
      "case_created timeline payload must carry source_url for provenance",
    );

    // ── 3. Idempotent replay ──────────────────────────────────────────────
    const replay = await createCaseCore(orgAId, null, {
      title: "Suspicious login flagged by Tawny",
      sourceSystem: TAWNY_SOURCE_SYSTEM,
      sourceReference,
      sourceUrl,
    });
    assert.equal(replay.created, false, "replay of identical delivery must not create a case");
    assert.equal(replay.id, created.id);
    assert.equal(replay.caseNumber, created.caseNumber);

    const replayCount = await db
      .select({ id: cases.id })
      .from(cases)
      .where(
        and(
          eq(cases.organisationId, orgAId),
          eq(cases.sourceSystem, TAWNY_SOURCE_SYSTEM),
          eq(cases.sourceReference, sourceReference),
        ),
      );
    assert.equal(replayCount.length, 1, "org/source/reference tuple must map to exactly one case");

    // ── 4. Concurrent duplicate delivery ──────────────────────────────────
    const concurrentReference = `tawny-alert-${runId}-concurrent`;
    const concurrentResults = await Promise.all(
      Array.from({ length: 5 }, () =>
        createCaseCore(orgAId, null, {
          title: "Concurrent Tawny delivery",
          sourceSystem: TAWNY_SOURCE_SYSTEM,
          sourceReference: concurrentReference,
          sourceUrl,
        }),
      ),
    );
    const concurrentIds = new Set(concurrentResults.map((r) => r.id));
    assert.equal(concurrentIds.size, 1, "all concurrent deliveries must resolve to a single case id");
    const createdCount = concurrentResults.filter((r) => r.created).length;
    assert.equal(createdCount, 1, "exactly one concurrent delivery must have created the case");

    const concurrentRows = await db
      .select({ id: cases.id })
      .from(cases)
      .where(
        and(
          eq(cases.organisationId, orgAId),
          eq(cases.sourceSystem, TAWNY_SOURCE_SYSTEM),
          eq(cases.sourceReference, concurrentReference),
        ),
      );
    assert.equal(concurrentRows.length, 1, "exactly one row must exist for the concurrently-delivered reference");

    // ── 5. Organisation isolation ─────────────────────────────────────────
    const orgBCase = await createCaseCore(orgBId, null, {
      title: "Suspicious login flagged by Tawny",
      sourceSystem: TAWNY_SOURCE_SYSTEM,
      sourceReference, // identical reference to org A's first case
      sourceUrl,
    });
    assert.equal(orgBCase.created, true, "same sourceReference in a different org must create a new case");
    assert.notEqual(orgBCase.id, created.id, "orgB case must be a distinct case from orgA's case");

    const [orgACaseRow] = await db
      .select({ organisationId: cases.organisationId })
      .from(cases)
      .where(eq(cases.id, created.id))
      .limit(1);
    const [orgBCaseRow] = await db
      .select({ organisationId: cases.organisationId })
      .from(cases)
      .where(eq(cases.id, orgBCase.id))
      .limit(1);
    assert.equal(orgACaseRow?.organisationId, orgAId);
    assert.equal(orgBCaseRow?.organisationId, orgBId);

    // ── 6. Delivery status telemetry ──────────────────────────────────────
    await recordInboundSourceDelivery({
      organisationId: orgAId,
      sourceSystem: TAWNY_SOURCE_SYSTEM,
      outcome: "created",
    });
    await recordInboundSourceDelivery({
      organisationId: orgAId,
      sourceSystem: TAWNY_SOURCE_SYSTEM,
      outcome: "duplicate",
    });
    await recordInboundSourceError({
      organisationId: orgAId,
      sourceSystem: TAWNY_SOURCE_SYSTEM,
      status: 400,
      message: "rejected token klp_secretvalue123 for Bearer abc.def.ghi",
    });

    const statusA = await getInboundSourceStatus(orgAId, TAWNY_SOURCE_SYSTEM);
    assert.ok(statusA, "status row must exist for orgA after telemetry writes");
    assert.equal(statusA?.deliveryCount, 2);
    assert.equal(statusA?.createdCaseCount, 1);
    assert.equal(statusA?.duplicateCount, 1);
    assert.equal(statusA?.errorCount, 1);
    assert.equal(statusA?.lastErrorStatus, 400);
    assert.ok(statusA?.lastDeliveryAt, "lastDeliveryAt must be set");
    assert.ok(statusA?.lastCaseCreatedAt, "lastCaseCreatedAt must be set");
    assert.ok(statusA?.lastErrorAt, "lastErrorAt must be set");
    assert.ok(statusA?.lastErrorMessage, "lastErrorMessage must be set");
    assert.ok(
      !statusA?.lastErrorMessage?.includes("klp_secretvalue123"),
      "redacted error message must not contain the raw API token",
    );
    assert.ok(
      !/bearer\s+\S+/i.test(statusA?.lastErrorMessage ?? ""),
      "redacted error message must not contain the raw bearer credential",
    );

    // Tenant isolation: orgB's status row must be untouched by orgA's telemetry.
    const statusB = await getInboundSourceStatus(orgBId, TAWNY_SOURCE_SYSTEM);
    assert.equal(statusB, null, "orgB must have no inbound_source_status row from orgA's telemetry");

    console.log("tawny ingest tests passed");
  } finally {
    // Clean up in FK-safe order. `cases` cascade-deletes `timeline_events`,
    // but delete explicitly anyway so cleanup does not silently depend on
    // that cascade continuing to exist.
    const orgIds = [orgAId, orgBId];
    const orgACases = await db
      .select({ id: cases.id })
      .from(cases)
      .where(eq(cases.organisationId, orgAId));
    const orgBCases = await db
      .select({ id: cases.id })
      .from(cases)
      .where(eq(cases.organisationId, orgBId));
    const allCaseIds = [...orgACases, ...orgBCases].map((c) => c.id);
    for (const caseId of allCaseIds) {
      await db.delete(timelineEvents).where(eq(timelineEvents.caseId, caseId));
    }
    for (const caseId of allCaseIds) {
      await db.delete(cases).where(eq(cases.id, caseId));
    }
    for (const orgId of orgIds) {
      await db.delete(inboundSourceStatus).where(eq(inboundSourceStatus.organisationId, orgId));
    }
    for (const orgId of orgIds) {
      await db.delete(organisations).where(eq(organisations.id, orgId));
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
