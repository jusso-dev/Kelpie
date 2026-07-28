/**
 * HTTP-level acceptance coverage for evidence hardening (issue #44): REST v1
 * routes exercised against the real running server and a real Postgres
 * instance, mirroring `scripts/test-case-relationships-api.ts`'s structure
 * (two-organisation tenant isolation fixtures, real `fetch()` calls, full
 * teardown with zero-rows-remain assertions at the end).
 *
 * This script assumes a server is already listening at `API_BASE_URL`
 * (default `http://127.0.0.1:3111`) against the same `DATABASE_URL` this
 * process uses, and that migrations have already been applied.
 */
import assert from "node:assert/strict";
import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "../src/db";
import {
  apiTokens,
  attachments,
  cases,
  evidenceCollections,
  evidenceCustodyEvents,
  evidenceLegalHolds,
  organisations,
  users,
} from "../src/db/schema";
import { generateApiToken } from "../src/lib/api-tokens";
import { newId } from "../src/lib/utils";

const BASE_URL = process.env.API_BASE_URL ?? "http://127.0.0.1:3111";

const runId = newId("evapi").slice("evapi_".length).slice(0, 10);
const orgAId = `org_evapi_a_${runId}`;
const orgBId = `org_evapi_b_${runId}`;

const FULL_SCOPES = ["evidence:read", "evidence:write", "evidence:override"];
const READ_ONLY_SCOPES = ["evidence:read"];

async function createOrg(id: string, name: string): Promise<void> {
  await db.insert(organisations).values({ id, name, slug: id.replace(/_/g, "-") });
}

async function createUser(organisationId: string, name: string): Promise<string> {
  const id = newId("user");
  await db.insert(users).values({
    id,
    name,
    email: `${id}@example.com`,
    organisationId,
    role: "admin",
  });
  return id;
}

async function createToken(
  organisationId: string,
  name: string,
  scopes: string[],
  createdBy: string | null,
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
    caseNumber: `EVAPI-${runId}-${String(caseCounter).padStart(3, "0")}`,
    title: `Evidence API fixture case ${caseCounter}`,
    ...overrides,
  });
  return id;
}

function headers(token: string, contentType = "application/json"): Record<string, string> {
  const h: Record<string, string> = { authorization: `Bearer ${token}` };
  if (contentType) h["content-type"] = contentType;
  return h;
}

async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Expected JSON (status ${res.status}), got: ${text.slice(0, 300)}`);
  }
}

function uploadFile(
  token: string,
  caseId: string,
  filename: string,
  content: Buffer,
  contentType = "text/plain",
): Promise<Response> {
  const form = new FormData();
  form.set("file", new Blob([new Uint8Array(content)], { type: contentType }), filename);
  return fetch(`${BASE_URL}/api/v1/cases/${caseId}/evidence`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
}

async function main() {
  await createOrg(orgAId, "Evidence API Test Org A");
  await createOrg(orgBId, "Evidence API Test Org B");
  const orgAUserId = await createUser(orgAId, "Org A Admin");
  const orgBUserId = await createUser(orgBId, "Org B Admin");

  const orgAToken = await createToken(orgAId, "orgA full", FULL_SCOPES, orgAUserId);
  const orgAReadOnlyToken = await createToken(
    orgAId,
    "orgA read-only",
    READ_ONLY_SCOPES,
    orgAUserId,
  );
  const orgAWriteNoOverrideToken = await createToken(
    orgAId,
    "orgA write-only",
    ["evidence:read", "evidence:write"],
    orgAUserId,
  );
  const orgBToken = await createToken(orgBId, "orgB full", FULL_SCOPES, orgBUserId);

  const orgACaseIds: string[] = [];
  const orgBCaseIds: string[] = [];

  try {
    // ── 1. Upload, list, get metadata (never leaks storageKey) ───────────
    const caseA = await createCase(orgAId);
    orgACaseIds.push(caseA);

    const cleanContent = Buffer.from(`clean evidence content ${runId}`);
    const uploadRes = await uploadFile(orgAToken, caseA, "notes.txt", cleanContent);
    const uploadBody = await readJson<{ evidence: Record<string, unknown> }>(uploadRes);
    assert.equal(uploadRes.status, 201, JSON.stringify(uploadBody));
    assert.equal(uploadBody.evidence.status, "pending_scan");
    assert.equal(uploadBody.evidence.storageKey, undefined, "storageKey must never be in API responses");
    const evidenceId = uploadBody.evidence.id as string;

    const listRes = await fetch(`${BASE_URL}/api/v1/cases/${caseA}/evidence`, {
      headers: headers(orgAToken, ""),
    });
    assert.equal(listRes.status, 200);
    const listBody = (await listRes.json()) as { evidence: Array<Record<string, unknown>> };
    assert.equal(listBody.evidence.length, 1);
    assert.equal(listBody.evidence[0].storageKey, undefined);
    console.log("ok: upload/list return safe metadata only, no storageKey leak");

    // ── 2. Oversized upload rejected over HTTP ────────────────────────────
    const oversized = Buffer.alloc(25 * 1024 * 1024 + 1);
    const oversizedRes = await uploadFile(orgAToken, caseA, "huge.bin", oversized, "application/octet-stream");
    assert.equal(oversizedRes.status, 413, await oversizedRes.text());
    console.log("ok: oversized upload rejected over HTTP with 413");

    // ── 3. Download blocked while pending_scan, then quarantine override ──
    const downloadPendingRes = await fetch(
      `${BASE_URL}/api/v1/evidence/${evidenceId}/download`,
      { headers: headers(orgAToken, "") },
    );
    assert.equal(downloadPendingRes.status, 423);
    console.log("ok: download blocked (423) while scan is pending");

    // Force the row to quarantined directly (unit/scanner-path coverage
    // already exercises the scanner pipeline in scripts/test-evidence-scanner.ts;
    // this test focuses on the HTTP-layer authorization/tenancy contract).
    await db
      .update(attachments)
      .set({ status: "quarantined", scanVerdict: "malicious", scanDetail: "EICAR-Test-Signature" })
      .where(eq(attachments.id, evidenceId));

    const overrideNoScopeRes = await fetch(`${BASE_URL}/api/v1/evidence/${evidenceId}/override`, {
      method: "POST",
      headers: headers(orgAWriteNoOverrideToken),
      body: JSON.stringify({ reason: "Verified by hand" }),
    });
    assert.equal(overrideNoScopeRes.status, 403, "evidence:write must not be able to override quarantine");
    console.log("ok: override requires evidence:override scope, not just evidence:write");

    const overrideNoReasonRes = await fetch(`${BASE_URL}/api/v1/evidence/${evidenceId}/override`, {
      method: "POST",
      headers: headers(orgAToken),
      body: JSON.stringify({ reason: "" }),
    });
    assert.equal(overrideNoReasonRes.status, 400);
    console.log("ok: override rejects an empty reason");

    const overrideRes = await fetch(`${BASE_URL}/api/v1/evidence/${evidenceId}/override`, {
      method: "POST",
      headers: headers(orgAToken),
      body: JSON.stringify({ reason: "Verified as a false positive by hand" }),
    });
    assert.equal(overrideRes.status, 200, await overrideRes.text());
    console.log("ok: admin-scoped override succeeds with a reason and unblocks download");

    const downloadRes = await fetch(`${BASE_URL}/api/v1/evidence/${evidenceId}/download`, {
      headers: headers(orgAToken, ""),
    });
    assert.equal(downloadRes.status, 200);
    assert.equal(downloadRes.headers.get("x-evidence-sha256")?.length, 64);
    const downloadedBuf = Buffer.from(await downloadRes.arrayBuffer());
    assert.ok(downloadedBuf.equals(cleanContent));
    console.log("ok: download succeeds post-override and returns correct bytes + hash header");

    // ── 4. Custody events are visible and append-only in shape ───────────
    const custodyRes = await fetch(`${BASE_URL}/api/v1/evidence/${evidenceId}/custody`, {
      headers: headers(orgAToken, ""),
    });
    assert.equal(custodyRes.status, 200);
    const custodyBody = (await custodyRes.json()) as { events: Array<{ eventType: string }> };
    const eventTypes = custodyBody.events.map((e) => e.eventType);
    assert.ok(eventTypes.includes("uploaded"));
    assert.ok(eventTypes.includes("override_granted"));
    assert.ok(eventTypes.includes("downloaded"));
    console.log("ok: custody log records upload, override, and download events");

    // ── 5. Cross-tenant isolation: org B cannot see or act on org A's evidence ──
    const crossTenantGetRes = await fetch(`${BASE_URL}/api/v1/evidence/${evidenceId}`, {
      headers: headers(orgBToken, ""),
    });
    assert.equal(crossTenantGetRes.status, 404);

    const crossTenantDownloadRes = await fetch(
      `${BASE_URL}/api/v1/evidence/${evidenceId}/download`,
      { headers: headers(orgBToken, "") },
    );
    assert.equal(crossTenantDownloadRes.status, 404);

    const crossTenantListRes = await fetch(`${BASE_URL}/api/v1/cases/${caseA}/evidence`, {
      headers: headers(orgBToken, ""),
    });
    assert.equal(crossTenantListRes.status, 404, "org B must not be able to list org A's case evidence");

    const crossTenantDeleteRes = await fetch(`${BASE_URL}/api/v1/evidence/${evidenceId}`, {
      method: "DELETE",
      headers: headers(orgBToken),
      body: JSON.stringify({ reason: "trying to delete someone else's evidence" }),
    });
    assert.equal(crossTenantDeleteRes.status, 404);
    console.log("ok: cross-tenant reads/writes on evidence all 404, no leakage");

    // ── 6. Unauthorized: missing/invalid token ────────────────────────────
    const noAuthRes = await fetch(`${BASE_URL}/api/v1/evidence/${evidenceId}`);
    assert.equal(noAuthRes.status, 401);
    const badScopeRes = await fetch(`${BASE_URL}/api/v1/evidence/${evidenceId}/override`, {
      method: "POST",
      headers: headers(orgAReadOnlyToken),
      body: JSON.stringify({ reason: "nope" }),
    });
    assert.equal(badScopeRes.status, 403);
    console.log("ok: missing token is 401, insufficient scope is 403");

    // ── 7. Legal hold blocks deletion via API ─────────────────────────────
    const holdRes = await fetch(`${BASE_URL}/api/v1/cases/${caseA}/legal-holds`, {
      method: "POST",
      headers: headers(orgAToken),
      body: JSON.stringify({ reason: "Pending litigation review", evidenceId }),
    });
    const holdBody = await readJson<{ hold: { id: string } }>(holdRes);
    assert.equal(holdRes.status, 201, JSON.stringify(holdBody));

    const deleteHeldRes = await fetch(`${BASE_URL}/api/v1/evidence/${evidenceId}`, {
      method: "DELETE",
      headers: headers(orgAToken),
      body: JSON.stringify({ reason: "no longer needed" }),
    });
    assert.equal(deleteHeldRes.status, 409, "active legal hold must block deletion");
    console.log("ok: active legal hold blocks deletion via API (409)");

    const releaseRes = await fetch(
      `${BASE_URL}/api/v1/legal-holds/${holdBody.hold.id}/release`,
      {
        method: "POST",
        headers: headers(orgAToken),
        body: JSON.stringify({ releaseReason: "Litigation concluded" }),
      },
    );
    assert.equal(releaseRes.status, 200, await releaseRes.text());

    const deleteAfterReleaseRes = await fetch(`${BASE_URL}/api/v1/evidence/${evidenceId}`, {
      method: "DELETE",
      headers: headers(orgAToken),
      body: JSON.stringify({ reason: "no longer needed" }),
    });
    assert.equal(deleteAfterReleaseRes.status, 200, await deleteAfterReleaseRes.text());
    console.log("ok: releasing the hold allows deletion via API");

    // ── 8. Export/disclosure ceiling: TLP-restricted download ────────────
    const restrictedCase = await createCase(orgAId, { tlp: "red", pap: "red" });
    orgACaseIds.push(restrictedCase);
    const restrictedUploadRes = await uploadFile(
      orgAToken,
      restrictedCase,
      "sensitive.txt",
      Buffer.from("sensitive content"),
    );
    const restrictedBody = await readJson<{ evidence: { id: string } }>(restrictedUploadRes);
    assert.equal(restrictedUploadRes.status, 201, JSON.stringify(restrictedBody));
    const restrictedId = restrictedBody.evidence.id;
    await db
      .update(attachments)
      .set({ status: "available", scanVerdict: "clean" })
      .where(eq(attachments.id, restrictedId));

    const restrictedDownloadRes = await fetch(
      `${BASE_URL}/api/v1/evidence/${restrictedId}/download?max_tlp=green`,
      { headers: headers(orgAToken, "") },
    );
    assert.equal(restrictedDownloadRes.status, 403, await restrictedDownloadRes.text());
    console.log("ok: TLP:RED evidence rejected by a TLP:GREEN export ceiling (403)");

    const permittedDownloadRes = await fetch(
      `${BASE_URL}/api/v1/evidence/${restrictedId}/download?max_tlp=red`,
      { headers: headers(orgAToken, "") },
    );
    assert.equal(permittedDownloadRes.status, 200);
    console.log("ok: TLP:RED evidence permitted by a TLP:RED export ceiling");

    // ── 9. Collections ─────────────────────────────────────────────────
    const createCollectionRes = await fetch(
      `${BASE_URL}/api/v1/cases/${caseA}/evidence/collections`,
      {
        method: "POST",
        headers: headers(orgAToken),
        body: JSON.stringify({ name: "Host triage" }),
      },
    );
    const collectionBody = await readJson<{ collection: { id: string } }>(createCollectionRes);
    assert.equal(createCollectionRes.status, 201, JSON.stringify(collectionBody));

    const uploadForCollectionRes = await uploadFile(
      orgAToken,
      caseA,
      "triage.log",
      Buffer.from("triage log content"),
    );
    const collectionEvidence = await readJson<{ evidence: { id: string } }>(uploadForCollectionRes);
    assert.equal(uploadForCollectionRes.status, 201, JSON.stringify(collectionEvidence));

    const addToCollectionRes = await fetch(
      `${BASE_URL}/api/v1/evidence/${collectionEvidence.evidence.id}/collection`,
      {
        method: "POST",
        headers: headers(orgAToken),
        body: JSON.stringify({ collectionId: collectionBody.collection.id }),
      },
    );
    const addedBody = await readJson<{ evidence: { collectionId: string } }>(addToCollectionRes);
    assert.equal(addToCollectionRes.status, 200, JSON.stringify(addedBody));
    assert.equal(addedBody.evidence.collectionId, collectionBody.collection.id);
    console.log("ok: evidence collections can be created and evidence assigned to them");

    // ── 10. MCP evidence tools are scope-gated and return safe metadata ──
    const mcpListRes = await fetch(`${BASE_URL}/api/mcp`, {
      method: "POST",
      headers: headers(orgAReadOnlyToken),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "evidence_list", arguments: { caseId: caseA } },
      }),
    });
    assert.equal(mcpListRes.status, 200);
    const mcpListBody = (await mcpListRes.json()) as {
      result: { structuredContent: { evidence: Array<Record<string, unknown>> } };
    };
    assert.ok(mcpListBody.result.structuredContent.evidence.length >= 1);
    assert.equal(
      mcpListBody.result.structuredContent.evidence[0].storageKey,
      undefined,
      "MCP evidence_list must never return storageKey",
    );
    console.log("ok: MCP evidence_list returns safe metadata only");
  } finally {
    // ── Cleanup: FK-safe order, then assert zero rows remain ────────────
    const allCaseIds = [...orgACaseIds, ...orgBCaseIds];
    if (allCaseIds.length > 0) {
      const evidenceRows = await db
        .select({ id: attachments.id })
        .from(attachments)
        .where(inArray(attachments.caseId, allCaseIds));
      const evidenceIds = evidenceRows.map((r) => r.id);
      if (evidenceIds.length > 0) {
        await db
          .delete(evidenceCustodyEvents)
          .where(inArray(evidenceCustodyEvents.evidenceId, evidenceIds));
      }
      await db
        .delete(evidenceLegalHolds)
        .where(
          or(
            inArray(evidenceLegalHolds.caseId, allCaseIds),
            evidenceIds.length > 0
              ? inArray(evidenceLegalHolds.evidenceId, evidenceIds)
              : undefined,
          ),
        );
      // parent_evidence_id is ON DELETE RESTRICT; none created here, but
      // clear collectionId references before dropping collections.
      await db
        .update(attachments)
        .set({ collectionId: null })
        .where(inArray(attachments.caseId, allCaseIds));
      await db.delete(attachments).where(inArray(attachments.caseId, allCaseIds));
      await db.delete(evidenceCollections).where(inArray(evidenceCollections.caseId, allCaseIds));
      await db.delete(cases).where(inArray(cases.id, allCaseIds));
    }
    for (const orgId of [orgAId, orgBId]) {
      await db.delete(apiTokens).where(eq(apiTokens.organisationId, orgId));
    }
    for (const userId of [orgAUserId, orgBUserId]) {
      await db.delete(users).where(eq(users.id, userId));
    }
    for (const orgId of [orgAId, orgBId]) {
      await db.delete(organisations).where(eq(organisations.id, orgId));
    }

    const remainingEvidence =
      allCaseIds.length > 0
        ? await db.select({ id: attachments.id }).from(attachments).where(inArray(attachments.caseId, allCaseIds))
        : [];
    const remainingCases = await db.select({ id: cases.id }).from(cases).where(inArray(cases.id, allCaseIds));
    const remainingOrgs = await db
      .select({ id: organisations.id })
      .from(organisations)
      .where(and(inArray(organisations.id, [orgAId, orgBId])));
    assert.equal(remainingEvidence.length, 0, "fixture evidence must be fully cleaned up");
    assert.equal(remainingCases.length, 0, "fixture cases must be fully cleaned up");
    assert.equal(remainingOrgs.length, 0, "fixture orgs must be fully cleaned up");
    console.log("evidence api fixture cleanup verified: no fixture rows remain");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
