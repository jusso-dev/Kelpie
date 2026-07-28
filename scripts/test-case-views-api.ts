/**
 * Integration coverage for issue #46 (saved case views).
 * Requires DATABASE_URL with migrations applied. REST tests need a running
 * server at API_BASE_URL when RUN_HTTP=1.
 */
import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import {
  apiTokens,
  caseViewDefaults,
  caseViews,
  cases,
  organisations,
  teamMembers,
  teams,
  users,
} from "../src/db/schema";
import { generateApiToken } from "../src/lib/api-tokens";
import { newId } from "../src/lib/utils";
import {
  CaseViewError,
  countCasesForConfigCore,
  createCaseViewCore,
  deleteCaseViewCore,
  getCaseViewCore,
  listCaseViewsCore,
  resolveDefaultCaseViewCore,
  setCaseViewDefaultCore,
  updateCaseViewCore,
  type CaseViewActor,
} from "../src/lib/case-views/core";
import { parseCaseViewConfig } from "../src/lib/case-views/config";
import { createTeamCore } from "../src/lib/queues-core";

const API_BASE_URL = process.env.API_BASE_URL ?? process.env.APP_URL ?? "http://127.0.0.1:3000";
const RUN_HTTP = process.env.RUN_HTTP === "1";

const runId = newId("cv46").slice("cv46_".length).slice(0, 10);
const orgAId = `org_cv46_a_${runId}`;
const orgBId = `org_cv46_b_${runId}`;

const SCOPES = ["case_views:read", "case_views:write", "cases:read", "cases:write"];

function headers(token: string): Record<string, string> {
  return { "content-type": "application/json", authorization: `Bearer ${token}` };
}

async function createOrg(id: string, name: string) {
  await db.insert(organisations).values({ id, name, slug: id.replace(/_/g, "-") });
}

async function createUser(
  organisationId: string,
  email: string,
  name: string,
  role: "admin" | "analyst" | "read_only" = "analyst",
) {
  const id = newId("user");
  await db.insert(users).values({ id, organisationId, email, name, role });
  return id;
}

async function createToken(
  organisationId: string,
  name: string,
  scopes: string[],
  createdBy: string | null,
) {
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
async function createCase(organisationId: string, overrides: Partial<typeof cases.$inferInsert> = {}) {
  caseCounter += 1;
  const id = newId("case");
  await db.insert(cases).values({
    id,
    organisationId,
    caseNumber: `CV46-${runId}-${String(caseCounter).padStart(4, "0")}`,
    title: `Saved view fixture ${caseCounter}`,
    severity: "medium",
    status: "open",
    ...overrides,
  });
  return id;
}

async function teardown() {
  await db.delete(caseViewDefaults).where(
    inArray(caseViewDefaults.organisationId, [orgAId, orgBId]),
  );
  await db.delete(caseViews).where(inArray(caseViews.organisationId, [orgAId, orgBId]));
  await db.delete(cases).where(inArray(cases.organisationId, [orgAId, orgBId]));
  await db.delete(apiTokens).where(inArray(apiTokens.organisationId, [orgAId, orgBId]));
  await db.delete(teamMembers).where(inArray(teamMembers.organisationId, [orgAId, orgBId]));
  await db.delete(teams).where(inArray(teams.organisationId, [orgAId, orgBId]));
  await db.delete(users).where(inArray(users.organisationId, [orgAId, orgBId]));
  await db.delete(organisations).where(inArray(organisations.id, [orgAId, orgBId]));
}

async function main() {
  await createOrg(orgAId, `CV46 Org A ${runId}`);
  await createOrg(orgBId, `CV46 Org B ${runId}`);

  const adminA = await createUser(orgAId, `admin-a-${runId}@test.local`, "Admin A", "admin");
  const analystA1 = await createUser(orgAId, `a1-${runId}@test.local`, "Analyst A1", "analyst");
  const analystA2 = await createUser(orgAId, `a2-${runId}@test.local`, "Analyst A2", "analyst");
  const readOnlyA = await createUser(orgAId, `ro-${runId}@test.local`, "RO A", "read_only");
  const adminB = await createUser(orgBId, `admin-b-${runId}@test.local`, "Admin B", "admin");

  const tokenA = await createToken(orgAId, "cv46-a", SCOPES, analystA1);
  const tokenB = await createToken(orgBId, "cv46-b", SCOPES, adminB);
  const tokenReadOnly = await createToken(orgAId, "cv46-ro", ["case_views:read"], readOnlyA);

  const team = await createTeamCore(orgAId, adminA, `Triage ${runId}`);
  await db.insert(teamMembers).values({
    id: newId("tmem"),
    organisationId: orgAId,
    teamId: team.id,
    userId: analystA1,
    addedBy: adminA,
  });

  // Seed cases for count parity
  await createCase(orgAId, { severity: "critical", status: "open" });
  await createCase(orgAId, { severity: "critical", status: "open" });
  await createCase(orgAId, { severity: "high", status: "closed" });
  await createCase(orgAId, { severity: "low", status: "open" });
  await createCase(orgBId, { severity: "critical", status: "open" });

  const actorAdminA: CaseViewActor = {
    id: adminA,
    organisationId: orgAId,
    role: "admin",
  };
  const actorA1: CaseViewActor = {
    id: analystA1,
    organisationId: orgAId,
    role: "analyst",
  };
  const actorA2: CaseViewActor = {
    id: analystA2,
    organisationId: orgAId,
    role: "analyst",
  };
  const actorRO: CaseViewActor = {
    id: readOnlyA,
    organisationId: orgAId,
    role: "read_only",
  };
  const actorB: CaseViewActor = {
    id: adminB,
    organisationId: orgBId,
    role: "admin",
  };

  try {
    // ── Ownership & visibility ──────────────────────────────────────────
    const personal = await createCaseViewCore(actorA1, {
      name: "My critical",
      visibility: "personal",
      config: { severity: "critical", widgets: ["severity_breakdown"] },
    });
    assert.equal(personal.ownerUserId, analystA1);

    const listedA2 = await listCaseViewsCore(actorA2);
    assert.equal(
      listedA2.some((v) => v.id === personal.id),
      false,
      "other analyst must not see personal views",
    );

    const teamView = await createCaseViewCore(actorA1, {
      name: "Team open",
      visibility: "team",
      teamId: team.id,
      config: { status: "open" },
    });
    assert.equal(teamView.teamId, team.id);

    await assert.rejects(
      () =>
        createCaseViewCore(actorA2, {
          name: "Not my team",
          visibility: "team",
          teamId: team.id,
          config: {},
        }),
      (err: unknown) => err instanceof CaseViewError && err.status === 403,
    );

    const orgView = await createCaseViewCore(actorAdminA, {
      name: "Org all open",
      visibility: "organisation",
      config: { status: "open", pageSize: 25 },
    });

    await assert.rejects(
      () =>
        createCaseViewCore(actorA1, {
          name: "No org for analyst",
          visibility: "organisation",
          config: {},
        }),
      (err: unknown) => err instanceof CaseViewError && err.status === 403,
    );

    const listedRO = await listCaseViewsCore(actorRO);
    assert.equal(
      listedRO.some((v) => v.id === orgView.id),
      true,
      "read_only can see org views",
    );
    assert.equal(
      listedRO.some((v) => v.id === personal.id),
      false,
    );

    // Tenant isolation
    const listedB = await listCaseViewsCore(actorB);
    assert.equal(
      listedB.some((v) => v.id === orgView.id || v.id === personal.id),
      false,
      "org B must not see org A views",
    );
    assert.equal(await getCaseViewCore(actorB, orgView.id), null);

    // Update / rename / delete permissions
    await updateCaseViewCore(actorA1, personal.id, { name: "My criticals" });
    await assert.rejects(
      () => updateCaseViewCore(actorA2, personal.id, { name: "Hijack" }),
      (err: unknown) => err instanceof CaseViewError && err.status === 403,
    );

    // Unknown config fields rejected
    await assert.rejects(
      () =>
        updateCaseViewCore(actorA1, personal.id, {
          config: { status: "open", notAField: 1 },
        }),
      CaseViewError,
    );

    // ── Defaults ────────────────────────────────────────────────────────
    await setCaseViewDefaultCore(actorA1, {
      scope: "personal",
      viewId: personal.id,
    });
    const resolved = await resolveDefaultCaseViewCore(actorA1);
    assert.equal(resolved?.id, personal.id);

    await setCaseViewDefaultCore(actorAdminA, {
      scope: "role",
      role: "analyst",
      viewId: orgView.id,
    });
    // A2 has no personal default → role default
    const resolvedA2 = await resolveDefaultCaseViewCore(actorA2);
    assert.equal(resolvedA2?.id, orgView.id);

    await assert.rejects(
      () =>
        setCaseViewDefaultCore(actorA1, {
          scope: "role",
          role: "analyst",
          viewId: orgView.id,
        }),
      (err: unknown) => err instanceof CaseViewError && err.status === 403,
    );

    // ── Count parity (complete query, not page) ─────────────────────────
    const countCfg = parseCaseViewConfig({ severity: "critical" });
    const count = await countCasesForConfigCore(
      { organisationId: orgAId, userId: analystA1, watchedCaseIds: [] },
      countCfg,
    );
    assert.equal(count.total, 2, "exactly two critical cases in org A");
    assert.equal(count.critical, 2);

    const countB = await countCasesForConfigCore(
      { organisationId: orgBId, userId: adminB, watchedCaseIds: [] },
      countCfg,
    );
    assert.equal(countB.total, 1, "org B critical count isolated");

    // Missing view falls back
    assert.equal(await getCaseViewCore(actorA1, "cview_missing"), null);

    // Delete team view as non-member fails; member succeeds
    await assert.rejects(
      () => deleteCaseViewCore(actorA2, teamView.id),
      (err: unknown) => err instanceof CaseViewError && err.status === 403,
    );
    await deleteCaseViewCore(actorA1, teamView.id);

    // ── HTTP surface (optional) ─────────────────────────────────────────
    if (RUN_HTTP) {
      const listRes = await fetch(`${API_BASE_URL}/api/v1/case-views`, {
        headers: headers(tokenA),
      });
      assert.equal(listRes.status, 200);
      const listJson = (await listRes.json()) as { views: Array<{ id: string }> };
      assert.ok(listJson.views.some((v) => v.id === personal.id));

      const createRes = await fetch(`${API_BASE_URL}/api/v1/case-views`, {
        method: "POST",
        headers: headers(tokenA),
        body: JSON.stringify({
          name: `HTTP view ${runId}`,
          visibility: "personal",
          config: { status: "open", bulkPresets: [] },
        }),
      });
      assert.equal(createRes.status, 201);
      const created = (await createRes.json()) as { id: string };

      const countRes = await fetch(
        `${API_BASE_URL}/api/v1/case-views/${created.id}/count`,
        { headers: headers(tokenA) },
      );
      assert.equal(countRes.status, 200);
      const countJson = (await countRes.json()) as {
        count: { total: number };
      };
      assert.equal(typeof countJson.count.total, "number");

      // Cross-tenant 404
      const cross = await fetch(`${API_BASE_URL}/api/v1/case-views/${created.id}`, {
        headers: headers(tokenB),
      });
      assert.equal(cross.status, 404);

      // Unknown field rejected
      const bad = await fetch(`${API_BASE_URL}/api/v1/case-views`, {
        method: "POST",
        headers: headers(tokenA),
        body: JSON.stringify({
          name: "bad",
          visibility: "personal",
          config: { nope: true },
        }),
      });
      assert.equal(bad.status, 400);

      // Read-only token cannot write
      const roWrite = await fetch(`${API_BASE_URL}/api/v1/case-views`, {
        method: "POST",
        headers: headers(tokenReadOnly),
        body: JSON.stringify({ name: "x", visibility: "personal", config: {} }),
      });
      assert.equal(roWrite.status, 403);

      // Stale preset preview
      const presetView = await createCaseViewCore(actorA1, {
        name: `Preset ${runId}`,
        visibility: "personal",
        config: {
          bulkPresets: [
            {
              id: "mark",
              name: "Mark high",
              operationType: "set_severity",
              params: { severity: "high" },
            },
          ],
        },
      });
      const previewRes = await fetch(
        `${API_BASE_URL}/api/v1/case-views/${presetView.id}/presets/preview`,
        {
          method: "POST",
          headers: headers(tokenA),
          body: JSON.stringify({
            presetId: "gone",
            caseIds: [],
          }),
        },
      );
      assert.equal(previewRes.status, 400);

      await fetch(`${API_BASE_URL}/api/v1/case-views/${created.id}`, {
        method: "DELETE",
        headers: headers(tokenA),
      });
    }

    console.log("test-case-views-api: ok");
  } finally {
    await teardown();
    // Zero rows remain
    const [left] = await db
      .select()
      .from(caseViews)
      .where(eq(caseViews.organisationId, orgAId))
      .limit(1);
    assert.equal(left, undefined, "teardown must remove case_views");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
