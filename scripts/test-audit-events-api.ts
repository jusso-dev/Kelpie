/**
 * HTTP-level acceptance coverage for the organisation-wide audit trail (issue
 * #45): REST v1 search/detail routes exercised against the real running
 * server and a real Postgres instance, plus in-process export/retention/
 * append-only-enforcement coverage that bypasses BullMQ/Redis entirely (the
 * same direct-call trick `scripts/test-ti-feed-health.ts` uses for
 * `pollFeed`). Mirrors `scripts/test-evidence-api.ts` and
 * `scripts/test-case-relationships-api.ts`'s two-organisation tenant-
 * isolation fixture structure, with full teardown and zero-rows-remain
 * assertions at the end.
 *
 * This script assumes a server is already listening at `API_BASE_URL`
 * (default `http://127.0.0.1:3111`) against the same `DATABASE_URL` this
 * process uses, and that migrations have already been applied.
 *
 * `audit_events` is append-only at the database level (see migration 0020): a
 * trigger rejects every direct `UPDATE` (the only exception is the `actor_id`
 * FK's own anonymizing `SET NULL` when a user is deleted), and rejects
 * `DELETE` unless the session-local `kelpie.audit_retention_purge` setting is
 * `'on'` — which only `runAuditRetention()` sets, inside its own transaction
 * (a delete cascading from the owning organisation's `ON DELETE CASCADE` is
 * also allowed). This test's own fixture cleanup therefore has to use that
 * exact same session-local escape hatch to remove the audit event rows it
 * inserts directly; there is no other way to delete a live audit_events row.
 */
import assert from "node:assert/strict";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../src/db";
import { apiTokens, auditEvents, auditExportJobs, organisations, users } from "../src/db/schema";
import { generateApiToken } from "../src/lib/api-tokens";
import { createAuditExportJob, processAuditExportJob } from "../src/lib/audit/export";
import { MIN_AUDIT_RETENTION_DAYS, runAuditRetention } from "../src/lib/audit/retention";
import { searchAuditEvents } from "../src/lib/audit/search";
import { readFile } from "../src/lib/storage";
import { newId } from "../src/lib/utils";

const BASE_URL = process.env.API_BASE_URL ?? "http://127.0.0.1:3111";

const runId = newId("auditapi").slice("auditapi_".length).slice(0, 10);
const orgAId = `org_auditapi_a_${runId}`;
const orgBId = `org_auditapi_b_${runId}`;
const orgRetentionId = `org_auditapi_ret_${runId}`;

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_MS = 60 * 1000;

async function createOrg(id: string, name: string, settings: Record<string, unknown> = {}): Promise<void> {
  await db.insert(organisations).values({ id, name, slug: id.replace(/_/g, "-"), settings });
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

function headers(token: string): Record<string, string> {
  return { "content-type": "application/json", authorization: `Bearer ${token}` };
}

async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Expected JSON (status ${res.status}), got: ${text.slice(0, 300)}`);
  }
}

type AuditEventJson = {
  id: string;
  action: string;
  targetType: string;
  targetId: string | null;
  targetLabel: string | null;
  actorId: string | null;
  actorType: string;
  actorLabel: string | null;
  requestId: string | null;
  sourceIp: string | null;
  userAgent: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
  occurredAt: string;
};

function searchUrl(params: Record<string, string> = {}): string {
  const qs = new URLSearchParams(params).toString();
  return `${BASE_URL}/api/v1/audit-events${qs ? `?${qs}` : ""}`;
}

function search(token: string, params: Record<string, string> = {}): Promise<Response> {
  return fetch(searchUrl(params), { headers: headers(token) });
}

function detail(token: string, id: string): Promise<Response> {
  return fetch(`${BASE_URL}/api/v1/audit-events/${id}`, { headers: headers(token) });
}

/**
 * Directly inserts a fixture `audit_events` row (bypassing `recordAuditEvent`
 * so tests can pin `occurredAt`, `before`, and `after` deterministically for
 * filter/pagination assertions).
 */
async function insertAuditEvent(
  organisationId: string,
  overrides: Partial<typeof auditEvents.$inferInsert> & { occurredAt: Date },
): Promise<string> {
  const id = newId("audit");
  await db.insert(auditEvents).values({
    id,
    organisationId,
    actorType: "user",
    action: "case.updated",
    targetType: "case",
    metadata: {},
    ...overrides,
  });
  return id;
}

/**
 * The only legitimate way to remove an `audit_events` row outside of
 * `runAuditRetention()` itself: set the same session-local escape hatch the
 * retention job uses, for the duration of one transaction, then delete.
 * Used here purely for fixture cleanup, never to simulate an application
 * code path.
 */
async function purgeAuditEventsById(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL kelpie.audit_retention_purge = 'on'`);
    await tx.delete(auditEvents).where(inArray(auditEvents.id, ids));
  });
}

async function main() {
  await createOrg(orgAId, "Audit API Test Org A");
  await createOrg(orgBId, "Audit API Test Org B");

  const orgAUserId = await createUser(orgAId, "Org A Admin");
  const orgBUserId = await createUser(orgBId, "Org B Admin");

  const orgAToken = await createToken(orgAId, "orgA audit:read", ["audit:read"]);
  const orgANoAuditScopeToken = await createToken(orgAId, "orgA no audit scope", ["cases:read"]);
  const orgBToken = await createToken(orgBId, "orgB audit:read", ["audit:read"]);

  const now = Date.now();
  const auditEventIds: string[] = [];
  const orgRetentionEventIds: string[] = [];

  try {
    // ── Setup: seven orgA fixture events spaced one minute apart, one orgB event ──
    const evCreated = await insertAuditEvent(orgAId, {
      action: "case.created",
      targetType: "case",
      targetId: "case_fixture_1",
      targetLabel: "KP-AUDITAPI-001",
      actorId: orgAUserId,
      actorLabel: "Org A Admin",
      occurredAt: new Date(now - 6 * MIN_MS),
      after: { status: "open" },
    });
    const evUpdated1 = await insertAuditEvent(orgAId, {
      action: "case.updated",
      targetType: "case",
      targetId: "case_fixture_1",
      targetLabel: "KP-AUDITAPI-001",
      actorId: orgAUserId,
      actorLabel: "Org A Admin",
      occurredAt: new Date(now - 5 * MIN_MS),
      before: { status: "open" },
      after: { status: "contained" },
    });
    const evUpdated2 = await insertAuditEvent(orgAId, {
      action: "case.updated",
      targetType: "case",
      targetId: "case_fixture_2",
      targetLabel: "KP-AUDITAPI-002",
      actorId: orgAUserId,
      actorLabel: "Org A Admin",
      occurredAt: new Date(now - 4 * MIN_MS),
    });
    const evTask = await insertAuditEvent(orgAId, {
      action: "task.completed",
      targetType: "task",
      targetId: "task_fixture_1",
      actorId: orgAUserId,
      occurredAt: new Date(now - 3 * MIN_MS),
    });
    const evLogin = await insertAuditEvent(orgAId, {
      action: "user.login",
      targetType: "user",
      targetId: orgAUserId,
      actorId: orgAUserId,
      actorLabel: "Org A Admin",
      occurredAt: new Date(now - 2 * MIN_MS),
    });
    const evUpdated3 = await insertAuditEvent(orgAId, {
      action: "case.updated",
      targetType: "case",
      targetId: "case_fixture_3",
      targetLabel: "KP-AUDITAPI-003",
      occurredAt: new Date(now - 1 * MIN_MS),
    });
    const evDeleted = await insertAuditEvent(orgAId, {
      action: "case.deleted",
      targetType: "case",
      targetId: "case_fixture_4",
      targetLabel: "KP-AUDITAPI-004",
      occurredAt: new Date(now),
    });
    auditEventIds.push(
      evCreated,
      evUpdated1,
      evUpdated2,
      evTask,
      evLogin,
      evUpdated3,
      evDeleted,
    );
    const orgACaseTargetIds = [evCreated, evUpdated1, evUpdated2, evUpdated3, evDeleted];

    const evOrgB = await insertAuditEvent(orgBId, {
      action: "case.created",
      targetType: "case",
      targetId: "case_fixture_orgb_1",
      actorId: orgBUserId,
      occurredAt: new Date(now),
    });
    auditEventIds.push(evOrgB);

    // ── 1. Basic search: orgA's token only ever sees orgA's rows ─────────────
    const listRes = await search(orgAToken, { limit: "50" });
    const listBody = await readJson<{ events: AuditEventJson[]; nextCursor: string | null }>(listRes);
    assert.equal(listRes.status, 200, JSON.stringify(listBody));
    assert.equal(listBody.events.length, 7, "orgA must see exactly its 7 fixture events");
    assert.ok(
      !listBody.events.some((e) => e.id === evOrgB),
      "orgA's search must never include orgB's event",
    );
    console.log("ok: search returns only the caller's organisation's events");

    // ── 2. Stable descending order by occurredAt ──────────────────────────────
    const orderedIds = listBody.events.map((e) => e.id);
    assert.deepEqual(
      orderedIds,
      [evDeleted, evUpdated3, evLogin, evTask, evUpdated2, evUpdated1, evCreated],
      "events must be ordered most-recent-first",
    );
    console.log("ok: search results are ordered by occurredAt descending");

    // ── 3. Filter by action ────────────────────────────────────────────────────
    const actionRes = await search(orgAToken, { action: "case.updated", limit: "50" });
    assert.equal(actionRes.status, 200);
    const actionBody = await readJson<{ events: AuditEventJson[] }>(actionRes);
    assert.deepEqual(
      new Set(actionBody.events.map((e) => e.id)),
      new Set([evUpdated1, evUpdated2, evUpdated3]),
      "action filter must return exactly the three case.updated events",
    );
    console.log("ok: `action` filter narrows to matching events only");

    // ── 4. Filter by targetType ────────────────────────────────────────────────
    const targetTypeRes = await search(orgAToken, { targetType: "task", limit: "50" });
    assert.equal(targetTypeRes.status, 200);
    const targetTypeBody = await readJson<{ events: AuditEventJson[] }>(targetTypeRes);
    assert.deepEqual(targetTypeBody.events.map((e) => e.id), [evTask]);
    console.log("ok: `targetType` filter narrows to matching events only");

    // ── 5. Filter by from/to range ─────────────────────────────────────────────
    const rangeRes = await search(orgAToken, {
      from: new Date(now - 4 * MIN_MS).toISOString(),
      to: new Date(now - 2 * MIN_MS).toISOString(),
      limit: "50",
    });
    assert.equal(rangeRes.status, 200);
    const rangeBody = await readJson<{ events: AuditEventJson[] }>(rangeRes);
    assert.deepEqual(
      new Set(rangeBody.events.map((e) => e.id)),
      new Set([evUpdated2, evTask, evLogin]),
      "from/to must be an inclusive range over occurredAt",
    );
    console.log("ok: `from`/`to` filters narrow to the inclusive occurredAt range");

    // ── 6. Free-text `q` search ────────────────────────────────────────────────
    const qRes = await search(orgAToken, { q: "login", limit: "50" });
    assert.equal(qRes.status, 200);
    const qBody = await readJson<{ events: AuditEventJson[] }>(qRes);
    assert.deepEqual(qBody.events.map((e) => e.id), [evLogin]);
    console.log("ok: `q` free-text search matches on action");

    // ── 7. Pagination via nextCursor covers every fixture row exactly once ───
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    for (;;) {
      const params: Record<string, string> = { limit: "3" };
      if (cursor) params.cursor = cursor;
      const pageRes = await search(orgAToken, params);
      assert.equal(pageRes.status, 200);
      const pageBody = await readJson<{ events: AuditEventJson[]; nextCursor: string | null }>(pageRes);
      seen.push(...pageBody.events.map((e) => e.id));
      pages += 1;
      if (!pageBody.nextCursor) break;
      cursor = pageBody.nextCursor;
      assert.ok(pages < 10, "pagination must terminate well before 10 pages for a 7-row fixture");
    }
    assert.equal(seen.length, 7, "pagination must yield exactly 7 rows total, no duplicates or gaps");
    assert.deepEqual(
      new Set(seen),
      new Set([evCreated, evUpdated1, evUpdated2, evTask, evLogin, evUpdated3, evDeleted]),
      "pagination must surface every fixture row exactly once",
    );
    assert.equal(pages, 3, "limit=3 over 7 rows must take exactly 3 pages (3+3+1)");
    console.log("ok: keyset pagination via nextCursor covers every row exactly once, no duplicates/gaps");

    // ── 8. Tenant isolation: orgB never sees orgA's rows ──────────────────────
    const orgBListRes = await search(orgBToken, { limit: "50" });
    assert.equal(orgBListRes.status, 200);
    const orgBListBody = await readJson<{ events: AuditEventJson[] }>(orgBListRes);
    assert.deepEqual(orgBListBody.events.map((e) => e.id), [evOrgB]);

    const crossTenantDetailRes = await detail(orgBToken, evCreated);
    assert.equal(
      crossTenantDetailRes.status,
      404,
      "requesting orgA's event id with orgB's token must 404, not 403 (no existence leakage)",
    );
    console.log("ok: tenant isolation holds for search and detail; cross-tenant detail is 404, not 403");

    // ── 9. Scope gating ────────────────────────────────────────────────────────
    const noScopeListRes = await search(orgANoAuditScopeToken, {});
    assert.equal(noScopeListRes.status, 403, "a token without audit:read must be forbidden on search");
    const noScopeDetailRes = await detail(orgANoAuditScopeToken, evCreated);
    assert.equal(noScopeDetailRes.status, 403, "a token without audit:read must be forbidden on detail");

    const noAuthListRes = await fetch(searchUrl());
    assert.equal(noAuthListRes.status, 401, "a request with no Authorization header must be 401 on search");
    const noAuthDetailRes = await fetch(`${BASE_URL}/api/v1/audit-events/${evCreated}`);
    assert.equal(noAuthDetailRes.status, 401, "a request with no Authorization header must be 401 on detail");
    console.log("ok: missing audit:read scope is 403, missing Authorization header is 401");

    // ── 10. Detail endpoint returns full row incl. before/after/metadata ─────
    const detailRes = await detail(orgAToken, evUpdated1);
    const detailBody = await readJson<{ event: AuditEventJson }>(detailRes);
    assert.equal(detailRes.status, 200, JSON.stringify(detailBody));
    assert.equal(detailBody.event.id, evUpdated1);
    assert.equal(detailBody.event.action, "case.updated");
    assert.deepEqual(detailBody.event.before, { status: "open" });
    assert.deepEqual(detailBody.event.after, { status: "contained" });
    assert.deepEqual(detailBody.event.metadata, {});
    console.log("ok: detail endpoint returns the full row, including before/after/metadata");

    // ── 11. Export permission parity: same filters as a search call above ────
    for (const format of ["csv", "ndjson"] as const) {
      const filterParams = { targetType: "case" };
      const parityRes = await search(orgAToken, filterParams);
      assert.equal(parityRes.status, 200);
      const parityBody = await readJson<{ events: AuditEventJson[] }>(parityRes);
      assert.equal(parityBody.events.length, orgACaseTargetIds.length);

      const job = await createAuditExportJob({
        organisationId: orgAId,
        requestedBy: orgAUserId,
        format,
        filters: { targetType: "case" },
      });
      await processAuditExportJob(job.id);

      const [jobRow] = await db
        .select()
        .from(auditExportJobs)
        .where(eq(auditExportJobs.id, job.id))
        .limit(1);
      assert.equal(jobRow?.status, "completed", `export job (${format}) must complete`);
      assert.equal(
        jobRow?.rowCount,
        parityBody.events.length,
        `export job (${format}) rowCount must match the equivalent search's result count`,
      );
      assert.ok(jobRow?.storageKey, `export job (${format}) must record a storageKey`);

      const fileBuf = await readFile(jobRow!.storageKey!);
      const fileText = fileBuf.toString("utf8");
      for (const id of orgACaseTargetIds) {
        assert.ok(fileText.includes(id), `export (${format}) must include matching row ${id}`);
      }
      for (const excludedId of [evTask, evLogin, evOrgB]) {
        assert.ok(
          !fileText.includes(excludedId),
          `export (${format}) must not include non-matching row ${excludedId}`,
        );
      }
      console.log(`ok: ${format} export enforces identical filters to search and contains exactly the matching rows`);
    }

    // ── 12. Retention purge + append-only enforcement ─────────────────────────
    await createOrg(orgRetentionId, "Audit Retention Test Org", {
      audit_retention_days: MIN_AUDIT_RETENTION_DAYS,
    });
    const oldEventId = await insertAuditEvent(orgRetentionId, {
      action: "case.created",
      targetType: "case",
      targetId: "case_retention_old",
      occurredAt: new Date(now - 400 * DAY_MS),
    });
    const recentEventId = await insertAuditEvent(orgRetentionId, {
      action: "case.created",
      targetType: "case",
      targetId: "case_retention_recent",
      occurredAt: new Date(now - 10 * DAY_MS),
    });
    orgRetentionEventIds.push(oldEventId, recentEventId);

    const retentionResult = await runAuditRetention();
    assert.ok(retentionResult.purged >= 1, "runAuditRetention must report at least one purged row");

    const remainingRetentionRows = await db
      .select({ id: auditEvents.id })
      .from(auditEvents)
      .where(inArray(auditEvents.id, [oldEventId, recentEventId]));
    const remainingRetentionIds = new Set(remainingRetentionRows.map((r) => r.id));
    assert.ok(
      !remainingRetentionIds.has(oldEventId),
      "an event older than the retention window must be purged by runAuditRetention",
    );
    assert.ok(
      remainingRetentionIds.has(recentEventId),
      "an event within the retention window must survive runAuditRetention",
    );
    console.log("ok: runAuditRetention purges only events older than the organisation's retention window");

    // Append-only enforcement: a still-live fixture row rejects direct UPDATE/DELETE.
    await assert.rejects(
      () =>
        db
          .update(auditEvents)
          .set({ action: "tampered" })
          .where(eq(auditEvents.id, evUpdated1)),
      (error: unknown) => {
        const cause = error instanceof Error ? (error.cause ?? error) : error;
        const message = cause instanceof Error ? cause.message : String(cause);
        return /append-only|cannot be updated/i.test(message);
      },
      "a direct UPDATE against audit_events must be rejected by the append-only trigger",
    );
    await assert.rejects(
      () => db.delete(auditEvents).where(eq(auditEvents.id, evUpdated1)),
      (error: unknown) => {
        const cause = error instanceof Error ? (error.cause ?? error) : error;
        const message = cause instanceof Error ? cause.message : String(cause);
        return /retention purge|append-only/i.test(message);
      },
      "a direct DELETE against audit_events (outside the retention purge transaction) must be rejected",
    );
    console.log("ok: application roles cannot update or delete audit_events rows directly (DB-level enforcement)");

    // ── 13. actor_id anonymization on user delete, and org cascade delete ─────
    // The append-only triggers must not fight the FK actions they sit next to:
    // deleting a user must still anonymize (not block) their past audit
    // events, and deleting the owning organisation must still cascade-remove
    // its audit trail — both without needing the retention purge escape hatch.
    const scratchOrgId = `org_auditapi_scratch_${runId}`;
    await createOrg(scratchOrgId, "Audit API Scratch Org");
    const scratchUserId = await createUser(scratchOrgId, "Scratch User");
    const scratchEventId = await insertAuditEvent(scratchOrgId, {
      action: "case.created",
      targetType: "case",
      targetId: "case_scratch_1",
      actorId: scratchUserId,
      actorLabel: "Scratch User",
      occurredAt: new Date(now),
    });

    await db.delete(users).where(eq(users.id, scratchUserId));
    const [afterUserDelete] = await db
      .select({ actorId: auditEvents.actorId, action: auditEvents.action })
      .from(auditEvents)
      .where(eq(auditEvents.id, scratchEventId));
    assert.ok(afterUserDelete, "the audit event must survive deleting its actor");
    assert.equal(
      afterUserDelete!.actorId,
      null,
      "deleting the actor must anonymize actor_id to null, not delete the row",
    );
    assert.equal(
      afterUserDelete!.action,
      "case.created",
      "anonymizing actor_id must not touch any other column",
    );

    await db.delete(organisations).where(eq(organisations.id, scratchOrgId));
    const [afterOrgDelete] = await db
      .select({ id: auditEvents.id })
      .from(auditEvents)
      .where(eq(auditEvents.id, scratchEventId));
    assert.equal(
      afterOrgDelete,
      undefined,
      "deleting the owning organisation must cascade-delete its audit events",
    );
    console.log("ok: user deletion anonymizes actor_id; organisation deletion cascade-deletes its audit trail");

    // Sanity: searchAuditEvents (the library function itself) agrees with the API's count.
    const libSearch = await searchAuditEvents(orgAId, { targetType: "case" }, { limit: 50 });
    assert.equal(libSearch.events.length, orgACaseTargetIds.length);

    console.log("audit events api tests passed");
  } finally {
    // ── Cleanup: purge audit_events via the same escape hatch retention uses ──
    await purgeAuditEventsById([...auditEventIds, ...orgRetentionEventIds]);

    for (const orgId of [orgAId, orgBId]) {
      await db.delete(auditExportJobs).where(eq(auditExportJobs.organisationId, orgId));
    }
    for (const orgId of [orgAId, orgBId]) {
      await db.delete(apiTokens).where(eq(apiTokens.organisationId, orgId));
    }
    for (const userId of [orgAUserId, orgBUserId]) {
      await db.delete(users).where(eq(users.id, userId));
    }
    for (const orgId of [orgAId, orgBId, orgRetentionId]) {
      await db.delete(organisations).where(eq(organisations.id, orgId));
    }

    const remainingEvents = await db
      .select({ id: auditEvents.id })
      .from(auditEvents)
      .where(inArray(auditEvents.id, [...auditEventIds, ...orgRetentionEventIds]));
    const remainingExportJobs = await db
      .select({ id: auditExportJobs.id })
      .from(auditExportJobs)
      .where(inArray(auditExportJobs.organisationId, [orgAId, orgBId]));
    const remainingTokens = await db
      .select({ id: apiTokens.id })
      .from(apiTokens)
      .where(inArray(apiTokens.organisationId, [orgAId, orgBId]));
    const remainingUsers = await db
      .select({ id: users.id })
      .from(users)
      .where(inArray(users.id, [orgAUserId, orgBUserId]));
    const remainingOrgs = await db
      .select({ id: organisations.id })
      .from(organisations)
      .where(and(inArray(organisations.id, [orgAId, orgBId, orgRetentionId])));

    assert.equal(remainingEvents.length, 0, "fixture audit_events must be fully cleaned up");
    assert.equal(remainingExportJobs.length, 0, "fixture audit_export_jobs must be fully cleaned up");
    assert.equal(remainingTokens.length, 0, "fixture api tokens must be fully cleaned up");
    assert.equal(remainingUsers.length, 0, "fixture users must be fully cleaned up");
    assert.equal(remainingOrgs.length, 0, "fixture orgs must be fully cleaned up");
    console.log("audit events api fixture cleanup verified: no fixture rows remain");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
