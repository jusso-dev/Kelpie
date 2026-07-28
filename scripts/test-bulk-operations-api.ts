/**
 * HTTP-level acceptance coverage for bulk case operations (issue #54): a
 * bulk request must produce exactly one `bulk_operations` audit row that
 * accurately reports partial success (never a silent full success/failure),
 * must be idempotent on retry, must reject requests over
 * `MAX_BULK_CASE_IDS`, must enforce the `bulk_operations:write` scope, and
 * the `bulk_operations` audit table itself must be append-only at the
 * database level (mirroring the `audit_events`/`escalation_runs` precedent).
 *
 * Mirrors `scripts/test-case-relationships-api.ts`'s structure: two-org
 * tenant fixtures, real `fetch()` calls against an already-running server at
 * `API_BASE_URL` (default `http://127.0.0.1:3111`), and full teardown with
 * zero-rows-remain assertions.
 */
import assert from "node:assert/strict";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import {
  apiTokens,
  bulkOperations,
  cases,
  organisations,
  timelineEvents,
} from "../src/db/schema";
import { generateApiToken } from "../src/lib/api-tokens";
import { newId } from "../src/lib/utils";
import { MAX_BULK_CASE_IDS } from "../src/lib/bulk-ops-core";

const BASE_URL = process.env.API_BASE_URL ?? "http://127.0.0.1:3111";

const runId = newId("bulkopapitest").slice("bulkopapitest_".length).slice(0, 12);
const orgAId = `org_bulkopapi_a_${runId}`;
const orgBId = `org_bulkopapi_b_${runId}`;

type BulkResult = {
  id: string;
  operationType: string;
  requestedCount: number;
  successCount: number;
  failureCount: number;
  outcomes: { caseId: string; ok: boolean; error?: string }[];
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
    caseNumber: `BULKOPAPI-${runId}-${String(caseCounter).padStart(3, "0")}`,
    title: `Bulk operations fixture case ${caseCounter}`,
    ...overrides,
  });
  return id;
}

function headers(token: string): Record<string, string> {
  return { "content-type": "application/json", authorization: `Bearer ${token}` };
}

function bulkPost(token: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(`${BASE_URL}/api/v1/cases/bulk`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify(body),
  });
}

async function main() {
  await createOrg(orgAId, "Bulk Operations API Test Org A");
  await createOrg(orgBId, "Bulk Operations API Test Org B");

  const orgAToken = await createToken(orgAId, "orgA full", ["bulk_operations:write"]);
  const orgARestrictedToken = await createToken(orgAId, "orgA restricted", ["cases:read"]);
  const orgBToken = await createToken(orgBId, "orgB full", ["bulk_operations:write"]);

  const orgACaseIds: string[] = [];
  const orgBCaseIds: string[] = [];
  const bulkOperationIds: string[] = [];

  try {
    // ── 1. tag_add across 3 cases: full success, tags actually persisted ────
    const caseA1 = await createCase(orgAId);
    const caseA2 = await createCase(orgAId);
    const caseA3 = await createCase(orgAId);
    orgACaseIds.push(caseA1, caseA2, caseA3);

    const tagKey = newId("idem");
    const tagRes = await bulkPost(orgAToken, {
      operationType: "tag_add",
      caseIds: [caseA1, caseA2, caseA3],
      idempotencyKey: tagKey,
      payload: { tag: "triaged" },
    });
    assert.equal(tagRes.status, 200, `bulk tag_add must return 200, got ${tagRes.status}: ${await tagRes.clone().text()}`);
    const tagJson = (await tagRes.json()) as BulkResult;
    bulkOperationIds.push(tagJson.id);
    assert.equal(tagJson.successCount, 3);
    assert.equal(tagJson.failureCount, 0);
    assert.equal(tagJson.outcomes.length, 3);

    const taggedRows = await db
      .select({ id: cases.id, tags: cases.tags })
      .from(cases)
      .where(inArray(cases.id, [caseA1, caseA2, caseA3]));
    for (const row of taggedRows) {
      assert.ok(
        Array.isArray(row.tags) && (row.tags as string[]).includes("triaged"),
        `case ${row.id} must actually carry the "triaged" tag after the bulk operation`,
      );
    }
    console.log("ok: bulk tag_add on 3 cases reports successCount:3/failureCount:0 and the tag is actually persisted on every case");

    // ── 2. Partial success: one cross-tenant id in the same request ─────────
    const caseA4 = await createCase(orgAId);
    const caseA5 = await createCase(orgAId);
    const caseB1 = await createCase(orgBId);
    orgACaseIds.push(caseA4, caseA5);
    orgBCaseIds.push(caseB1);

    const partialKey = newId("idem");
    const partialRes = await bulkPost(orgAToken, {
      operationType: "tag_add",
      caseIds: [caseA4, caseA5, caseB1],
      idempotencyKey: partialKey,
      payload: { tag: "cross-tenant-attempt" },
    });
    assert.equal(partialRes.status, 200, `partial-success bulk op must still return 200, got ${partialRes.status}`);
    const partialJson = (await partialRes.json()) as BulkResult;
    bulkOperationIds.push(partialJson.id);
    assert.equal(partialJson.successCount, 2, "the two in-tenant cases must succeed");
    assert.equal(partialJson.failureCount, 1, "the cross-tenant case must be reported as a failure, not silently dropped");
    const crossOutcome = partialJson.outcomes.find((o) => o.caseId === caseB1);
    assert.ok(crossOutcome, "the cross-tenant case id must still appear in outcomes");
    assert.deepEqual(crossOutcome, { caseId: caseB1, ok: false, error: "not_found" });
    const successOutcomes = partialJson.outcomes.filter((o) => o.caseId === caseA4 || o.caseId === caseA5);
    assert.equal(successOutcomes.length, 2);
    assert.ok(successOutcomes.every((o) => o.ok === true), "the two valid org-A cases must still report success");
    console.log("ok: a cross-tenant case id in the same bulk request reports {ok:false, error:not_found} for that case while the other cases still succeed (no silent partial success)");

    // ── 3. Exactly one bulk_operations audit row for that request ───────────
    const partialRows = await db
      .select()
      .from(bulkOperations)
      .where(and(eq(bulkOperations.organisationId, orgAId), eq(bulkOperations.idempotencyKey, partialKey)));
    assert.equal(partialRows.length, 1, "exactly one bulk_operations row must exist for this idempotency key");
    assert.equal(partialRows[0]?.requestedCount, 3);
    assert.equal(partialRows[0]?.successCount, 2);
    assert.equal(partialRows[0]?.failureCount, 1);
    console.log("ok: exactly one bulk_operations row was inserted, with requestedCount/successCount/failureCount matching the outcomes");

    // ── 4. Idempotency: identical retry returns the same summary, no dup row ─
    const retryRes = await bulkPost(orgAToken, {
      operationType: "tag_add",
      caseIds: [caseA4, caseA5, caseB1],
      idempotencyKey: partialKey,
      payload: { tag: "cross-tenant-attempt" },
    });
    assert.equal(retryRes.status, 200);
    const retryJson = (await retryRes.json()) as BulkResult;
    assert.deepEqual(retryJson, partialJson, "a retried request with the same idempotencyKey must return byte-for-byte the same summary");
    assert.equal(retryJson.id, partialJson.id);

    const partialRowsAfterRetry = await db
      .select({ id: bulkOperations.id })
      .from(bulkOperations)
      .where(and(eq(bulkOperations.organisationId, orgAId), eq(bulkOperations.idempotencyKey, partialKey)));
    assert.equal(partialRowsAfterRetry.length, 1, "retrying the same idempotencyKey must not create a duplicate bulk_operations row");
    console.log("ok: retrying the exact same request with the same idempotencyKey returns an identical summary and the bulk_operations row count stays at exactly 1");

    // ── 5. bulk_operations is append-only at the DB level ───────────────────
    await assert.rejects(
      () =>
        db
          .update(bulkOperations)
          .set({ successCount: 999 })
          .where(eq(bulkOperations.id, partialJson.id)),
      (error: unknown) => {
        const cause = error instanceof Error ? (error.cause ?? error) : error;
        const message = cause instanceof Error ? cause.message : String(cause);
        return /append-only|cannot be updated/i.test(message);
      },
      "a direct UPDATE against bulk_operations must be rejected by the append-only trigger",
    );
    await assert.rejects(
      () => db.delete(bulkOperations).where(eq(bulkOperations.id, partialJson.id)),
      (error: unknown) => {
        const cause = error instanceof Error ? (error.cause ?? error) : error;
        const message = cause instanceof Error ? cause.message : String(cause);
        return /append-only|cannot be deleted/i.test(message);
      },
      "a direct DELETE against bulk_operations must be rejected by the append-only trigger",
    );
    console.log("ok: bulk_operations rows cannot be directly UPDATEd or DELETEd, even through the app's own db import (DB-level append-only enforcement)");

    // ── 6. acknowledge is idempotent: no duplicate timeline event ───────────
    const caseA6 = await createCase(orgAId);
    const caseA7 = await createCase(orgAId);
    orgACaseIds.push(caseA6, caseA7);

    const preAckKey = newId("idem");
    const preAckRes = await bulkPost(orgAToken, {
      operationType: "acknowledge",
      caseIds: [caseA6],
      idempotencyKey: preAckKey,
      payload: {},
    });
    assert.equal(preAckRes.status, 200);
    const preAckJson = (await preAckRes.json()) as BulkResult;
    bulkOperationIds.push(preAckJson.id);
    assert.equal(preAckJson.successCount, 1, "the initial acknowledge must succeed");

    const ackKey = newId("idem");
    const ackRes = await bulkPost(orgAToken, {
      operationType: "acknowledge",
      caseIds: [caseA6, caseA7],
      idempotencyKey: ackKey,
      payload: {},
    });
    assert.equal(ackRes.status, 200);
    const ackJson = (await ackRes.json()) as BulkResult;
    bulkOperationIds.push(ackJson.id);
    assert.equal(ackJson.successCount, 2, "acknowledging an already-acknowledged case alongside a fresh one must report both as success");
    assert.equal(ackJson.failureCount, 0);

    const ackEvents = await db
      .select()
      .from(timelineEvents)
      .where(and(eq(timelineEvents.caseId, caseA6), eq(timelineEvents.eventType, "acknowledged")));
    assert.equal(ackEvents.length, 1, "an already-acknowledged case must not get a duplicate acknowledged timeline event from a redundant bulk acknowledge");
    console.log("ok: bulk acknowledge on an already-acknowledged case still reports success and writes no duplicate acknowledged timeline event");

    // ── 7. Exceeding MAX_BULK_CASE_IDS ───────────────────────────────────────
    const tooManyIds = Array.from({ length: MAX_BULK_CASE_IDS + 1 }, (_, i) => `case_bulkopapi_overflow_${i}`);
    const overflowRes = await bulkPost(orgAToken, {
      operationType: "tag_add",
      caseIds: tooManyIds,
      idempotencyKey: newId("idem"),
      payload: { tag: "overflow" },
    });
    assert.equal(
      overflowRes.status,
      400,
      `a request with more than MAX_BULK_CASE_IDS (${MAX_BULK_CASE_IDS}) case ids must return 400, got ${overflowRes.status}`,
    );
    console.log("ok: a bulk request exceeding MAX_BULK_CASE_IDS is rejected with 400");

    // ── 8. Scope enforcement ─────────────────────────────────────────────────
    const forbiddenRes = await bulkPost(orgARestrictedToken, {
      operationType: "tag_add",
      caseIds: [caseA1],
      idempotencyKey: newId("idem"),
      payload: { tag: "should-be-forbidden" },
    });
    assert.equal(
      forbiddenRes.status,
      403,
      `a token without bulk_operations:write must get 403, got ${forbiddenRes.status}`,
    );
    console.log("ok: a token without bulk_operations:write gets 403");

    console.log("bulk operations api tests passed");
  } finally {
    const allCaseIds = [...orgACaseIds, ...orgBCaseIds];
    if (allCaseIds.length > 0) {
      await db.delete(timelineEvents).where(inArray(timelineEvents.caseId, allCaseIds));
      await db.delete(cases).where(inArray(cases.id, allCaseIds));
    }
    for (const orgId of [orgAId, orgBId]) {
      await db.delete(apiTokens).where(eq(apiTokens.organisationId, orgId));
    }
    // `bulk_operations` is append-only at the DB level (see migration 0021):
    // it can only be removed by a nested cascade delete via its
    // `organisation_id` foreign key, never by a direct top-level DELETE. So
    // deleting the owning organisations below is what actually cleans these
    // rows up.
    for (const orgId of [orgAId, orgBId]) {
      await db.delete(organisations).where(eq(organisations.id, orgId));
    }

    const remainingCases =
      allCaseIds.length > 0
        ? await db.select({ id: cases.id }).from(cases).where(inArray(cases.id, allCaseIds))
        : [];
    const remainingBulkOps = await db
      .select({ id: bulkOperations.id })
      .from(bulkOperations)
      .where(inArray(bulkOperations.organisationId, [orgAId, orgBId]));
    const remainingTokens = await db
      .select({ id: apiTokens.id })
      .from(apiTokens)
      .where(inArray(apiTokens.organisationId, [orgAId, orgBId]));
    const remainingOrgs = await db
      .select({ id: organisations.id })
      .from(organisations)
      .where(inArray(organisations.id, [orgAId, orgBId]));

    assert.equal(remainingCases.length, 0, "fixture cases must be fully cleaned up");
    assert.equal(remainingBulkOps.length, 0, "fixture bulk_operations rows must be fully cleaned up");
    assert.equal(remainingTokens.length, 0, "fixture api tokens must be fully cleaned up");
    assert.equal(remainingOrgs.length, 0, "fixture orgs must be fully cleaned up");
    console.log("bulk operations api fixture cleanup verified: no fixture rows remain");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
