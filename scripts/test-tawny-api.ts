/**
 * HTTP-level acceptance coverage for `POST /api/v1/cases` (issue #50's Tawny
 * source contract): real status codes and response bodies from the running
 * route, as opposed to `scripts/test-tawny-ingest.ts`, which exercises the
 * same behaviour at the `createCaseCore` / DB layer without booting the
 * server.
 *
 * This script assumes a server is already listening at `API_BASE_URL`
 * (default `http://127.0.0.1:3111`) against the same `DATABASE_URL` this
 * process uses, and that migrations have already been applied.
 */
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { db } from "../src/db";
import { apiTokens, cases, inboundSourceStatus, organisations, timelineEvents } from "../src/db/schema";
import { generateApiToken, hashApiToken } from "../src/lib/api-tokens";
import { TAWNY_SOURCE_SYSTEM } from "../src/lib/case-source-identity";
import { newId } from "../src/lib/utils";

const BASE_URL = process.env.API_BASE_URL ?? "http://127.0.0.1:3111";
const CASES_URL = `${BASE_URL}/api/v1/cases`;

const runId = newId("tawnyapitest").slice("tawnyapitest_".length).slice(0, 12);
const orgAId = `org_tawnyapi_a_${runId}`;
const orgBId = `org_tawnyapi_b_${runId}`;

type CreateCaseResponseBody = {
  id?: string;
  caseNumber?: string;
  created?: boolean;
  error?: string;
  details?: unknown;
};

type CaseRow = {
  sourceSystem: string | null;
  sourceReference: string | null;
  organisationId: string;
  id: string;
};

async function createOrg(id: string, name: string): Promise<void> {
  await db.insert(organisations).values({
    id,
    name,
    slug: id.replace(/_/g, "-"),
  });
}

async function createToken(
  organisationId: string,
  name: string,
  scopes: string[],
): Promise<string> {
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

function postCase(token: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(CASES_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

async function main() {
  await createOrg(orgAId, "Tawny API Test Org A");
  await createOrg(orgBId, "Tawny API Test Org B");

  const orgAWriteToken = await createToken(orgAId, "orgA write", ["cases:write"]);
  const orgAReadToken = await createToken(orgAId, "orgA read", ["cases:read"]);
  const orgBWriteToken = await createToken(orgBId, "orgB write", ["cases:write"]);

  const allTokens = [orgAWriteToken, orgAReadToken, orgBWriteToken];

  try {
    // ── 1. Create ────────────────────────────────────────────────────────
    const sourceReference = `tawny-alert-${runId}-1`;
    const createBody = {
      title: "Suspicious login flagged by Tawny",
      severity: "high",
      sourceSystem: TAWNY_SOURCE_SYSTEM,
      sourceReference,
      sourceUrl: "https://tawny.example.com/alerts/x",
    };
    const createRes = await postCase(orgAWriteToken, createBody);
    assert.equal(createRes.status, 201, `create must return 201, got ${createRes.status}`);
    const createJson = (await createRes.json()) as CreateCaseResponseBody;
    assert.equal(createJson.created, true, "create response must report created: true");
    assert.ok(createJson.id, "create response must include a non-empty id");
    assert.ok(createJson.caseNumber, "create response must include a non-empty caseNumber");

    // ── 2. Idempotent replay ────────────────────────────────────────────
    const replayRes = await postCase(orgAWriteToken, createBody);
    assert.equal(replayRes.status, 200, `replay must return 200, got ${replayRes.status}`);
    const replayJson = (await replayRes.json()) as CreateCaseResponseBody;
    assert.equal(replayJson.created, false, "replay response must report created: false");
    assert.equal(replayJson.id, createJson.id, "replay must return the same id");
    assert.equal(
      replayJson.caseNumber,
      createJson.caseNumber,
      "replay must return the same caseNumber",
    );

    // ── 3. Concurrent duplicate delivery ────────────────────────────────
    const concurrentReference = `tawny-alert-${runId}-concurrent`;
    const concurrentBody = {
      title: "Concurrent Tawny delivery",
      severity: "high",
      sourceSystem: TAWNY_SOURCE_SYSTEM,
      sourceReference: concurrentReference,
      sourceUrl: "https://tawny.example.com/alerts/x",
    };
    const concurrentResponses = await Promise.all(
      Array.from({ length: 5 }, () => postCase(orgAWriteToken, concurrentBody)),
    );
    const concurrentJsons = (await Promise.all(
      concurrentResponses.map((r) => r.json()),
    )) as CreateCaseResponseBody[];
    const statuses = concurrentResponses.map((r) => r.status);
    const created201 = statuses.filter((s) => s === 201);
    const dup200 = statuses.filter((s) => s === 200);
    assert.equal(created201.length, 1, `expected exactly one 201, got statuses ${statuses}`);
    assert.equal(dup200.length, 4, `expected exactly four 200s, got statuses ${statuses}`);
    const concurrentIds = new Set(concurrentJsons.map((j) => j.id));
    assert.equal(concurrentIds.size, 1, "all concurrent deliveries must return the same id");

    // ── 4. Organisation isolation ───────────────────────────────────────
    const orgBRes = await postCase(orgBWriteToken, createBody);
    assert.equal(orgBRes.status, 201, `orgB create must return 201, got ${orgBRes.status}`);
    const orgBJson = (await orgBRes.json()) as CreateCaseResponseBody;
    assert.equal(orgBJson.created, true, "orgB create response must report created: true");
    assert.notEqual(
      orgBJson.id,
      createJson.id,
      "orgB case must be a distinct case from orgA's case",
    );

    const [orgACaseRow] = await db
      .select({ organisationId: cases.organisationId })
      .from(cases)
      .where(eq(cases.id, createJson.id as string))
      .limit(1);
    const [orgBCaseRow] = await db
      .select({ organisationId: cases.organisationId })
      .from(cases)
      .where(eq(cases.id, orgBJson.id as string))
      .limit(1);
    assert.equal(orgACaseRow?.organisationId, orgAId);
    assert.equal(orgBCaseRow?.organisationId, orgBId);

    // ── 5. Invalid source metadata → 400 ────────────────────────────────
    const invalidPayloads: Record<string, unknown>[] = [
      {
        title: "Bad sourceUrl protocol",
        sourceSystem: TAWNY_SOURCE_SYSTEM,
        sourceReference: `tawny-alert-${runId}-bad-url-1`,
        sourceUrl: "javascript:alert(1)",
      },
      {
        title: "Bad sourceUrl credentials",
        sourceSystem: TAWNY_SOURCE_SYSTEM,
        sourceReference: `tawny-alert-${runId}-bad-url-2`,
        sourceUrl: "https://user:pass@evil.example.com/",
      },
      {
        title: "sourceUrl too long",
        sourceSystem: TAWNY_SOURCE_SYSTEM,
        sourceReference: `tawny-alert-${runId}-bad-url-3`,
        sourceUrl: `https://tawny.example.com/${"a".repeat(2048)}`,
      },
      {
        title: "Reserved managed-connector namespace",
        sourceSystem: "microsoft_sentinel",
        sourceReference: `tawny-alert-${runId}-bad-system-1`,
      },
      {
        title: "Uppercase + colon source system",
        sourceSystem: "Tawny:1",
        sourceReference: `tawny-alert-${runId}-bad-system-2`,
      },
      {
        title: "sourceReference without sourceSystem",
        sourceReference: `tawny-alert-${runId}-no-system`,
      },
      {
        title: "sourceReference too long",
        sourceSystem: TAWNY_SOURCE_SYSTEM,
        sourceReference: "r".repeat(201),
      },
      {
        title: "t".repeat(501),
        sourceSystem: TAWNY_SOURCE_SYSTEM,
        sourceReference: `tawny-alert-${runId}-long-title`,
      },
    ];

    let sawDetails = false;
    for (const payload of invalidPayloads) {
      const res = await postCase(orgAWriteToken, payload);
      const rawBody = await res.text();
      assert.equal(
        res.status,
        400,
        `payload ${JSON.stringify(payload).slice(0, 80)}... must return 400, got ${res.status}: ${rawBody}`,
      );
      let json: CreateCaseResponseBody = {};
      try {
        json = JSON.parse(rawBody) as CreateCaseResponseBody;
      } catch {
        // fall through; rawBody token-leak check below still applies
      }
      if (json.details && typeof json.details === "object") sawDetails = true;
      for (const token of allTokens) {
        assert.ok(
          !rawBody.includes(token),
          "invalid-payload response body must never contain a submitted API token",
        );
      }
    }
    assert.ok(sawDetails, "at least one 400 response must include a details object");

    // ── 6. Scope enforcement ────────────────────────────────────────────
    const forbiddenBody = {
      title: "Should be forbidden",
      sourceSystem: TAWNY_SOURCE_SYSTEM,
      sourceReference: `tawny-alert-${runId}-forbidden`,
    };
    const forbiddenRes = await postCase(orgAReadToken, forbiddenBody);
    assert.equal(
      forbiddenRes.status,
      403,
      `read-only token must get 403, got ${forbiddenRes.status}`,
    );

    const unauthenticatedRes = await postCase("klp_not_a_real_token", forbiddenBody);
    assert.equal(
      unauthenticatedRes.status,
      401,
      `bogus token must get 401, got ${unauthenticatedRes.status}`,
    );

    // ── 7. GET source filter ────────────────────────────────────────────
    const getRes = await fetch(`${CASES_URL}?source=${TAWNY_SOURCE_SYSTEM}`, {
      headers: { authorization: `Bearer ${orgAReadToken}` },
    });
    assert.equal(getRes.status, 200, `GET must return 200, got ${getRes.status}`);
    const getJson = (await getRes.json()) as { cases: CaseRow[] };
    assert.ok(Array.isArray(getJson.cases), "GET response must include a cases array");
    assert.ok(getJson.cases.length > 0, "GET response must include at least one case");
    for (const row of getJson.cases) {
      assert.equal(
        row.sourceSystem,
        TAWNY_SOURCE_SYSTEM,
        "every filtered case must have sourceSystem === tawny",
      );
    }
    const returnedIds = new Set(getJson.cases.map((c) => c.id));
    assert.ok(
      !returnedIds.has(orgBJson.id as string),
      "orgA's filtered case list must not leak orgB's case id",
    );

    // ── 8. Delivery status telemetry ────────────────────────────────────
    const [statusRow] = await db
      .select()
      .from(inboundSourceStatus)
      .where(
        and(
          eq(inboundSourceStatus.organisationId, orgAId),
          eq(inboundSourceStatus.sourceSystem, TAWNY_SOURCE_SYSTEM),
        ),
      )
      .limit(1);
    assert.ok(statusRow, "inbound_source_status row must exist for orgA/tawny");
    assert.ok(
      (statusRow?.deliveryCount ?? 0) >= 2,
      `deliveryCount must be >= 2, got ${statusRow?.deliveryCount}`,
    );
    assert.ok(
      (statusRow?.errorCount ?? 0) >= 1,
      `errorCount must be >= 1, got ${statusRow?.errorCount}`,
    );
    assert.ok(
      !(statusRow?.lastErrorMessage ?? "").includes("klp_"),
      "lastErrorMessage must never contain a raw klp_ token substring",
    );

    console.log("tawny api tests passed");
  } finally {
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
    for (const orgId of [orgAId, orgBId]) {
      await db.delete(inboundSourceStatus).where(eq(inboundSourceStatus.organisationId, orgId));
    }
    for (const orgId of [orgAId, orgBId]) {
      await db.delete(apiTokens).where(eq(apiTokens.organisationId, orgId));
    }
    for (const orgId of [orgAId, orgBId]) {
      await db.delete(organisations).where(eq(organisations.id, orgId));
    }

    const remainingOrgs = await db
      .select({ id: organisations.id })
      .from(organisations)
      .where(eq(organisations.id, orgAId));
    const remainingOrgsB = await db
      .select({ id: organisations.id })
      .from(organisations)
      .where(eq(organisations.id, orgBId));
    const remainingCases = await db
      .select({ id: cases.id })
      .from(cases)
      .where(eq(cases.organisationId, orgAId));
    const remainingTokens = await db
      .select({ id: apiTokens.id })
      .from(apiTokens)
      .where(eq(apiTokens.organisationId, orgAId));
    const remainingStatus = await db
      .select({ id: inboundSourceStatus.id })
      .from(inboundSourceStatus)
      .where(eq(inboundSourceStatus.organisationId, orgAId));
    assert.equal(remainingOrgs.length, 0, "fixture org A must be fully cleaned up");
    assert.equal(remainingOrgsB.length, 0, "fixture org B must be fully cleaned up");
    assert.equal(remainingCases.length, 0, "fixture cases must be fully cleaned up");
    assert.equal(remainingTokens.length, 0, "fixture api tokens must be fully cleaned up");
    assert.equal(remainingStatus.length, 0, "fixture inbound_source_status rows must be fully cleaned up");
    console.log("tawny api fixture cleanup verified: no fixture rows remain");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
