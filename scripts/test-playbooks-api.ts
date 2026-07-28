/**
 * REST and MCP wiring coverage for the playbook catalogue (issue #52):
 * scope enforcement, organisation isolation, and filter query parameters,
 * exercised directly against the route handlers (no running server
 * required) — same approach as `scripts/test-mobile.ts`.
 */
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { apiTokens, organisations } from "../src/db/schema";
import { generateApiToken } from "../src/lib/api-tokens";
import { seedBaselineOrganisationData } from "../src/lib/baseline-data";
import { newId } from "../src/lib/utils";
import { GET as listPlaybooksRoute } from "../src/app/api/v1/playbooks/route";
import { GET as getPlaybookRoute } from "../src/app/api/v1/playbooks/[id]/route";
import { POST as mcpPost } from "../src/app/api/mcp/route";

type PlaybookSummary = { id: string; catalogueKey: string | null; isBaseline: boolean };

async function createToken(organisationId: string, scopes: string[]): Promise<string> {
  const { plaintext, hash } = generateApiToken();
  await db.insert(apiTokens).values({
    id: newId("api_token"),
    organisationId,
    name: "playbooks test token",
    tokenHash: hash,
    scopes,
  });
  return plaintext;
}

async function main() {
  const orgAId = newId("org");
  const orgBId = newId("org");
  await db.insert(organisations).values([
    { id: orgAId, name: "Playbooks API test org A", slug: `pbapi-a-${Date.now()}` },
    { id: orgBId, name: "Playbooks API test org B", slug: `pbapi-b-${Date.now()}` },
  ]);

  try {
    await seedBaselineOrganisationData(orgAId);
    await seedBaselineOrganisationData(orgBId);

    const scopedToken = await createToken(orgAId, ["playbooks:read"]);
    const unscopedToken = await createToken(orgAId, ["cases:read"]);
    const orgBToken = await createToken(orgBId, ["playbooks:read"]);

    // ── REST: GET /api/v1/playbooks ─────────────────────────────────────────

    const missingAuth = await listPlaybooksRoute(
      new Request("http://localhost/api/v1/playbooks"),
    );
    assert.equal(missingAuth.status, 401);

    const forbidden = await listPlaybooksRoute(
      new Request("http://localhost/api/v1/playbooks", {
        headers: { authorization: `Bearer ${unscopedToken}` },
      }),
    );
    assert.equal(forbidden.status, 403, "a token without playbooks:read must be rejected");

    const okResponse = await listPlaybooksRoute(
      new Request("http://localhost/api/v1/playbooks", {
        headers: { authorization: `Bearer ${scopedToken}` },
      }),
    );
    assert.equal(okResponse.status, 200);
    const okBody = (await okResponse.json()) as { playbooks: PlaybookSummary[] };
    assert.equal(okBody.playbooks.length, 16);
    assert.ok(okBody.playbooks.every((p) => p.isBaseline));

    const filteredResponse = await listPlaybooksRoute(
      new Request("http://localhost/api/v1/playbooks?scenario=malware_ransomware", {
        headers: { authorization: `Bearer ${scopedToken}` },
      }),
    );
    const filteredBody = (await filteredResponse.json()) as { playbooks: PlaybookSummary[] };
    assert.equal(filteredBody.playbooks.length, 1);
    assert.equal(filteredBody.playbooks[0].catalogueKey, "malware_ransomware");

    // Organisation isolation: org B's token never sees org A's playbooks.
    const orgBResponse = await listPlaybooksRoute(
      new Request("http://localhost/api/v1/playbooks", {
        headers: { authorization: `Bearer ${orgBToken}` },
      }),
    );
    const orgBBody = (await orgBResponse.json()) as { playbooks: PlaybookSummary[] };
    assert.equal(orgBBody.playbooks.length, 16);
    const orgAIds = new Set(okBody.playbooks.map((p) => p.id));
    assert.ok(orgBBody.playbooks.every((p) => !orgAIds.has(p.id)), "org B must never see org A's playbook ids");

    console.log("REST GET /api/v1/playbooks scope enforcement, filtering, and org isolation verified.");

    // ── REST: GET /api/v1/playbooks/{id} ────────────────────────────────────

    const targetId = okBody.playbooks[0].id;
    const detailResponse = await getPlaybookRoute(
      new Request(`http://localhost/api/v1/playbooks/${targetId}`, {
        headers: { authorization: `Bearer ${scopedToken}` },
      }),
      { params: Promise.resolve({ id: targetId }) },
    );
    assert.equal(detailResponse.status, 200);
    const detailBody = (await detailResponse.json()) as {
      id: string;
      steps: unknown[];
      content: Record<string, unknown>;
    };
    assert.equal(detailBody.id, targetId);
    assert.ok(Array.isArray(detailBody.steps) && detailBody.steps.length > 0);
    assert.ok(detailBody.content && typeof detailBody.content === "object");

    // Cross-tenant lookup returns 404, not another organisation's playbook.
    const crossTenant = await getPlaybookRoute(
      new Request(`http://localhost/api/v1/playbooks/${targetId}`, {
        headers: { authorization: `Bearer ${orgBToken}` },
      }),
      { params: Promise.resolve({ id: targetId }) },
    );
    assert.equal(crossTenant.status, 404, "org B must not be able to fetch org A's playbook by id");

    console.log("REST GET /api/v1/playbooks/{id} tenancy and detail shape verified.");

    // ── MCP: tools/list scope gating ────────────────────────────────────────

    async function toolsList(token: string) {
      const req = new Request("http://localhost/api/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
      });
      const res = await mcpPost(req);
      const json = (await res.json()) as { result?: { tools: Array<{ name: string }> } };
      return json.result?.tools.map((t) => t.name) ?? [];
    }

    const scopedTools = await toolsList(scopedToken);
    assert.ok(scopedTools.includes("playbooks_list"));
    assert.ok(scopedTools.includes("playbooks_get"));

    const unscopedTools = await toolsList(unscopedToken);
    assert.ok(!unscopedTools.includes("playbooks_list"), "tool discovery must hide playbooks_list without the scope");
    assert.ok(!unscopedTools.includes("playbooks_get"), "tool discovery must hide playbooks_get without the scope");

    // ── MCP: tools/call ──────────────────────────────────────────────────────

    async function toolsCall(token: string, name: string, args: unknown) {
      const req = new Request("http://localhost/api/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name, arguments: args },
        }),
      });
      return mcpPost(req);
    }

    const listRes = await toolsCall(scopedToken, "playbooks_list", {
      classification: "unauthorised_access",
    });
    const listJson = (await listRes.json()) as {
      result?: { structuredContent?: { playbooks: PlaybookSummary[] } };
    };
    const mcpPlaybooks = listJson.result?.structuredContent?.playbooks ?? [];
    assert.ok(mcpPlaybooks.length > 0);
    assert.ok(
      mcpPlaybooks.every((p) => (p as unknown as { classification: string }).classification === "unauthorised_access"),
    );

    const getRes = await toolsCall(scopedToken, "playbooks_get", { playbookId: targetId });
    const getJson = (await getRes.json()) as { result?: { structuredContent?: { id: string } } };
    assert.equal(getJson.result?.structuredContent?.id, targetId);

    // Missing scope on tools/call must be rejected with a JSON-RPC error, not silently succeed.
    const deniedRes = await toolsCall(unscopedToken, "playbooks_list", {});
    const deniedJson = (await deniedRes.json()) as { error?: { code: number; message: string } };
    assert.equal(deniedJson.error?.code, -32003);
    assert.ok(deniedJson.error?.message.includes("playbooks:read"));

    // Cross-tenant get via MCP must not leak org A's playbook to org B's token.
    const crossTenantMcp = await toolsCall(orgBToken, "playbooks_get", { playbookId: targetId });
    const crossTenantJson = (await crossTenantMcp.json()) as {
      result?: { isError?: boolean; content?: Array<{ text: string }> };
    };
    assert.equal(crossTenantJson.result?.isError, true, "org B's token must not be able to fetch org A's playbook via MCP");

    console.log("MCP playbooks_list/playbooks_get scope gating and org isolation verified.");
  } finally {
    await db.delete(organisations).where(eq(organisations.id, orgAId));
    await db.delete(organisations).where(eq(organisations.id, orgBId));
  }

  console.log("All playbooks REST/MCP tests passed.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
