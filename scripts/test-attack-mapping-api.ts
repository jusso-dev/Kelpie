/**
 * HTTP-level acceptance coverage for ATT&CK technique mapping (issue #48):
 * mapping CRUD, duplicate prevention, tenant isolation, permission scopes,
 * case tactic/technique filtering, attack-story ordering, organisation
 * coverage, playbook coverage gaps, and the MCP tools — all exercised
 * against the real running routes and a real Postgres instance. Mirrors
 * `scripts/test-case-relationships-api.ts`'s structure (two-organisation
 * fixtures, real `fetch()` calls, full teardown with zero-rows-remain
 * assertions).
 *
 * Assumes a server is already listening at `API_BASE_URL` (default
 * `http://127.0.0.1:3111`) against the same `DATABASE_URL` this process
 * uses, and that migrations have already been applied.
 */
import assert from "node:assert/strict";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import {
  alerts,
  apiTokens,
  attackStoryEntries,
  attackTechniqueMappings,
  caseTemplates,
  cases,
  observables,
  organisations,
  playbooks,
  timelineEvents,
  type PlaybookStep,
} from "../src/db/schema";
import { generateApiToken } from "../src/lib/api-tokens";
import { newId } from "../src/lib/utils";
import { ensureCatalogInitialised } from "../src/lib/attack/catalog-core";
import {
  createOrUpdateAlertFromProviderCore,
  getOrCreateAlertSourceCore,
  linkAlertToCaseCore,
} from "../src/lib/investigations/alerts-core";

const BASE_URL = process.env.API_BASE_URL ?? "http://127.0.0.1:3111";

const runId = newId("attackapitest").slice("attackapitest_".length).slice(0, 12);
const orgAId = `org_attackapi_a_${runId}`;
const orgBId = `org_attackapi_b_${runId}`;

const FULL_SCOPES = ["attack:read", "attack:write", "cases:read", "cases:write"];

function headers(token: string): Record<string, string> {
  return { "content-type": "application/json", authorization: `Bearer ${token}` };
}

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
async function createCase(organisationId: string, title: string): Promise<string> {
  caseCounter += 1;
  const id = newId("case");
  await db.insert(cases).values({
    id,
    organisationId,
    caseNumber: `ATTACKAPI-${runId}-${String(caseCounter).padStart(3, "0")}`,
    title,
  });
  return id;
}

async function createObservable(caseId: string, value: string): Promise<string> {
  const id = newId("obs");
  await db.insert(observables).values({ id, caseId, type: "ip", value });
  return id;
}

let alertCounter = 0;
/** Creates an alert (and its source) in the given org, optionally linked to a case as primary. */
async function createAlert(organisationId: string, opts: { caseId?: string } = {}): Promise<string> {
  alertCounter += 1;
  const source = await getOrCreateAlertSourceCore({
    organisationId,
    kind: "test_source",
    name: `Attack mapping test source ${runId}`,
    tenantId: `tenant-${runId}`,
  });
  const { alert } = await createOrUpdateAlertFromProviderCore({
    organisationId,
    sourceId: source.id,
    tenantId: `tenant-${runId}`,
    externalId: `ATTACKAPI-ALERT-${runId}-${alertCounter}`,
    title: `Attack mapping fixture alert ${alertCounter}`,
    severity: "medium",
  });
  if (opts.caseId) {
    await linkAlertToCaseCore({
      organisationId,
      actorId: null,
      caseId: opts.caseId,
      alertId: alert.id,
      isPrimary: true,
    });
  }
  return alert.id;
}

type MappingResponse = {
  id: string;
  entityType: string;
  entityId: string;
  caseId: string | null;
  techniqueId: string;
  confidence: number | null;
  source: string;
  notes: string | null;
  technique: { name: string | null; tactics: Array<{ id: string; name: string }>; deprecated: boolean };
};

function attach(token: string, body: Record<string, unknown>) {
  return fetch(`${BASE_URL}/api/v1/attack/mappings`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify(body),
  });
}

function listMappings(token: string, query: string) {
  return fetch(`${BASE_URL}/api/v1/attack/mappings?${query}`, { headers: headers(token) });
}

function patchMapping(token: string, id: string, body: Record<string, unknown>) {
  return fetch(`${BASE_URL}/api/v1/attack/mappings/${id}`, {
    method: "PATCH",
    headers: headers(token),
    body: JSON.stringify(body),
  });
}

function deleteMapping(token: string, id: string) {
  return fetch(`${BASE_URL}/api/v1/attack/mappings/${id}`, { method: "DELETE", headers: headers(token) });
}

function listCases(token: string, query: string) {
  return fetch(`${BASE_URL}/api/v1/cases?${query}`, { headers: headers(token) });
}

function getCoverage(token: string) {
  return fetch(`${BASE_URL}/api/v1/attack/coverage`, { headers: headers(token) });
}

function storyList(token: string, caseId: string) {
  return fetch(`${BASE_URL}/api/v1/cases/${caseId}/attack-story`, { headers: headers(token) });
}

function storyAdd(token: string, caseId: string, body: Record<string, unknown>) {
  return fetch(`${BASE_URL}/api/v1/cases/${caseId}/attack-story`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify(body),
  });
}

function storyPatch(token: string, caseId: string, entryId: string, body: Record<string, unknown>) {
  return fetch(`${BASE_URL}/api/v1/cases/${caseId}/attack-story/${entryId}`, {
    method: "PATCH",
    headers: headers(token),
    body: JSON.stringify(body),
  });
}

function storyDelete(token: string, caseId: string, entryId: string) {
  return fetch(`${BASE_URL}/api/v1/cases/${caseId}/attack-story/${entryId}`, {
    method: "DELETE",
    headers: headers(token),
  });
}

let rpcId = 0;
function mcpCall(token: string, method: string, params?: Record<string, unknown>) {
  rpcId += 1;
  return fetch(`${BASE_URL}/api/mcp`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({ jsonrpc: "2.0", id: rpcId, method, params }),
  }).then((res) => res.json() as Promise<{ result?: unknown; error?: { message: string } }>);
}

async function main() {
  await ensureCatalogInitialised();
  await createOrg(orgAId, "Attack Mapping API Test Org A");
  await createOrg(orgBId, "Attack Mapping API Test Org B");

  const orgAToken = await createToken(orgAId, "orgA full", FULL_SCOPES);
  const orgAReadOnlyToken = await createToken(orgAId, "orgA read-only", ["attack:read", "cases:read"]);
  const orgANoAttackToken = await createToken(orgAId, "orgA no-attack-scope", ["cases:read", "cases:write"]);
  const orgBToken = await createToken(orgBId, "orgB full", FULL_SCOPES);

  const createdMappingIds: string[] = [];
  const createdStoryCaseId = { value: "" };
  const orgACaseIds: string[] = [];
  const orgBCaseIds: string[] = [];
  const createdPlaybookIds: string[] = [];
  const createdTemplateIds: string[] = [];

  try {
    // ── 1. Attach a mapping, dedupe rejected, unknown technique rejected ────
    const caseA = await createCase(orgAId, "Phishing wave against finance team");
    orgACaseIds.push(caseA);
    const observableA = await createObservable(caseA, "203.0.113.20");

    const attachRes = await attach(orgAToken, {
      entityType: "case",
      entityId: caseA,
      techniqueId: "T1566.001",
      confidence: 80,
      source: "analyst",
      notes: "Matches the phishing lure",
      detectionNotes: "Flagged by mail gateway sandbox",
      responseNotes: "Blocked sender domain",
      actorAttribution: "Unattributed commodity phishing kit",
    });
    if (attachRes.status !== 201) {
      throw new Error(`attach must return 201, got ${attachRes.status}: ${await attachRes.text()}`);
    }
    const attachJson = (await attachRes.json()) as { mapping: MappingResponse };
    assert.ok(attachJson.mapping.id);
    assert.equal(attachJson.mapping.technique.name, "Spearphishing Attachment");
    assert.deepEqual(attachJson.mapping.technique.tactics.map((t) => t.id), ["initial-access"]);
    createdMappingIds.push(attachJson.mapping.id);

    const dupRes = await attach(orgAToken, {
      entityType: "case",
      entityId: caseA,
      techniqueId: "T1566.001",
    });
    assert.equal(dupRes.status, 409, `duplicate mapping must return 409, got ${dupRes.status}`);

    const unknownRes = await attach(orgAToken, {
      entityType: "case",
      entityId: caseA,
      techniqueId: "T9999",
    });
    assert.equal(unknownRes.status, 404, `unknown technique id must return 404, got ${unknownRes.status}`);

    const observableAttachRes = await attach(orgAToken, {
      entityType: "observable",
      entityId: observableA,
      techniqueId: "T1071",
      source: "detection_rule",
    });
    assert.equal(observableAttachRes.status, 201);
    const observableAttachJson = (await observableAttachRes.json()) as { mapping: MappingResponse };
    createdMappingIds.push(observableAttachJson.mapping.id);

    // ── 2. List by caseId returns both the case and its observable's mapping ──
    const listRes = await listMappings(orgAToken, `caseId=${caseA}`);
    assert.equal(listRes.status, 200);
    const listJson = (await listRes.json()) as { mappings: MappingResponse[] };
    assert.equal(listJson.mappings.length, 2, "listing by caseId must include the case's own mapping plus its observable's mapping");

    // ── 3. Update and remove ─────────────────────────────────────────────────
    const patchRes = await patchMapping(orgAToken, attachJson.mapping.id, { confidence: 95, notes: "Updated after review" });
    assert.equal(patchRes.status, 200, `patch must return 200, got ${patchRes.status}`);
    const patchJson = (await patchRes.json()) as { mapping: MappingResponse };
    assert.equal(patchJson.mapping.confidence, 95);
    assert.equal(patchJson.mapping.notes, "Updated after review");

    const removeRes = await deleteMapping(orgAToken, observableAttachJson.mapping.id);
    assert.equal(removeRes.status, 200);
    createdMappingIds.splice(createdMappingIds.indexOf(observableAttachJson.mapping.id), 1);
    const afterRemoveList = await listMappings(orgAToken, `caseId=${caseA}`);
    const afterRemoveJson = (await afterRemoveList.json()) as { mappings: MappingResponse[] };
    assert.equal(afterRemoveJson.mappings.length, 1, "removed mapping must no longer be listed");

    // Every create/update/remove must be recorded on the case timeline.
    const timelineRows = await db
      .select({ eventType: timelineEvents.eventType })
      .from(timelineEvents)
      .where(and(eq(timelineEvents.caseId, caseA), eq(timelineEvents.eventType, "attack_mapping_changed")));
    assert.ok(timelineRows.length >= 3, "create/update/remove must each write an attack_mapping_changed timeline event");

    // ── 4. Tenant isolation: org B cannot attach against org A's case ───────
    const crossTenantRes = await attach(orgBToken, {
      entityType: "case",
      entityId: caseA,
      techniqueId: "T1078",
    });
    assert.equal(crossTenantRes.status, 404, `cross-tenant attach must return 404, got ${crossTenantRes.status}`);

    // ── 5. Permissions: read-only / no-attack-scope tokens are forbidden on writes ──
    const forbiddenAttachRes = await attach(orgAReadOnlyToken, {
      entityType: "case",
      entityId: caseA,
      techniqueId: "T1078",
    });
    assert.equal(forbiddenAttachRes.status, 403, `attack:read-only token must be forbidden from POST, got ${forbiddenAttachRes.status}`);
    const noScopeAttachRes = await attach(orgANoAttackToken, {
      entityType: "case",
      entityId: caseA,
      techniqueId: "T1078",
    });
    assert.equal(noScopeAttachRes.status, 403, `token without any attack:* scope must be forbidden, got ${noScopeAttachRes.status}`);
    const readOnlyListRes = await listMappings(orgAReadOnlyToken, `caseId=${caseA}`);
    assert.equal(readOnlyListRes.status, 200, "attack:read scope must still permit reads");

    // ── 6. Case tactic/technique filtering ───────────────────────────────────
    const caseB = await createCase(orgAId, "Unrelated case with no mappings");
    orgACaseIds.push(caseB);

    const byTechniqueRes = await listCases(orgAToken, `technique=T1566.001&limit=200`);
    const byTechniqueJson = (await byTechniqueRes.json()) as { cases: Array<{ id: string }> };
    assert.ok(byTechniqueJson.cases.some((c) => c.id === caseA), "technique filter must include the mapped case");
    assert.ok(!byTechniqueJson.cases.some((c) => c.id === caseB), "technique filter must exclude an unmapped case");

    const byTacticRes = await listCases(orgAToken, `tactic=initial-access&limit=200`);
    const byTacticJson = (await byTacticRes.json()) as { cases: Array<{ id: string }> };
    assert.ok(byTacticJson.cases.some((c) => c.id === caseA), "tactic filter must include a case with a mapped technique in that tactic");
    assert.ok(!byTacticJson.cases.some((c) => c.id === caseB), "tactic filter must exclude a case with no mapping in that tactic");

    // ── 7. Attack story: add, list ordered, reorder, delete ──────────────────
    createdStoryCaseId.value = caseA;
    const story1Res = await storyAdd(orgAToken, caseA, { title: "Initial phishing click", provenance: "analyst" });
    assert.equal(story1Res.status, 201);
    const story1 = (await story1Res.json()) as { entry: { id: string; sequenceIndex: number } };
    const story2Res = await storyAdd(orgAToken, caseA, { title: "Credential harvested", provenance: "analyst" });
    assert.equal(story2Res.status, 201);
    const story2 = (await story2Res.json()) as { entry: { id: string; sequenceIndex: number } };
    assert.equal(story1.entry.sequenceIndex, 0);
    assert.equal(story2.entry.sequenceIndex, 1);

    const storyListRes = await storyList(orgAToken, caseA);
    const storyListJson = (await storyListRes.json()) as { entries: Array<{ id: string; sequenceIndex: number }> };
    assert.deepEqual(storyListJson.entries.map((e) => e.id), [story1.entry.id, story2.entry.id]);

    const reorderRes = await storyPatch(orgAToken, caseA, story2.entry.id, { targetIndex: 0 });
    assert.equal(reorderRes.status, 200, `reorder must return 200, got ${reorderRes.status}`);
    const afterReorderListRes = await storyList(orgAToken, caseA);
    const afterReorderJson = (await afterReorderListRes.json()) as { entries: Array<{ id: string; sequenceIndex: number }> };
    assert.deepEqual(
      afterReorderJson.entries.map((e) => e.id),
      [story2.entry.id, story1.entry.id],
      "reordering must move the entry to its new position while preserving relative order of the rest",
    );

    const storyDeleteRes = await storyDelete(orgAToken, caseA, story1.entry.id);
    assert.equal(storyDeleteRes.status, 200);
    const afterDeleteListRes = await storyList(orgAToken, caseA);
    const afterDeleteJson = (await afterDeleteListRes.json()) as { entries: Array<{ id: string }> };
    assert.equal(afterDeleteJson.entries.length, 1, "deleted story entry must no longer be listed");

    console.log("attack mapping + story API tests passed");

    // ── 8. Organisation coverage ──────────────────────────────────────────────
    const coverageRes = await getCoverage(orgAToken);
    assert.equal(coverageRes.status, 200);
    const coverageJson = (await coverageRes.json()) as {
      stats: { totalMappedTechniques: number; byTactic: Array<{ tacticId: string }> };
    };
    assert.ok(coverageJson.stats.totalMappedTechniques >= 1);
    assert.ok(coverageJson.stats.byTactic.some((t) => t.tacticId === "initial-access"));

    console.log("attack coverage API test passed");

    // ── 9. Playbook / case-template coverage gaps ────────────────────────────
    const playbookId = newId("pb");
    createdPlaybookIds.push(playbookId);
    const documentedStep: PlaybookStep = {
      id: newId("step"),
      title: "Block sender domain",
      offsetMinutes: 0,
      isRequired: true,
      attackTechniqueIds: ["T1566.001"],
      guidanceCategories: ["containment"],
    };
    await db.insert(playbooks).values({
      id: playbookId,
      organisationId: orgAId,
      name: `Attack coverage fixture playbook ${runId}`,
      steps: [documentedStep],
    });

    const templateId = newId("tpl");
    createdTemplateIds.push(templateId);
    await db.insert(caseTemplates).values({
      id: templateId,
      organisationId: orgAId,
      name: `Attack coverage fixture template ${runId}`,
      defaultPlaybookId: playbookId,
    });

    const coverageAfterPlaybookRes = await getCoverage(orgAToken);
    const coverageAfterPlaybookJson = (await coverageAfterPlaybookRes.json()) as {
      playbookCoverage: Array<{ playbookId: string; gaps: Record<string, string[]> }>;
      templateCoverage: Array<{ templateId: string; gaps: Record<string, string[]> }>;
    };
    const playbookEntry = coverageAfterPlaybookJson.playbookCoverage.find((p) => p.playbookId === playbookId);
    assert.ok(playbookEntry, "playbook coverage must include the fixture playbook");
    assert.ok(!playbookEntry!.gaps.containment.includes("T1566.001"), "T1566.001 is documented for containment by the fixture step, so it must not be a gap");
    assert.ok(playbookEntry!.gaps.detection.includes("T1566.001"), "T1566.001 is not documented for detection by any step, so it must be a gap");
    assert.ok(playbookEntry!.gaps.investigation.includes("T1566.001"));
    assert.ok(playbookEntry!.gaps.recovery.includes("T1566.001"));

    const templateEntry = coverageAfterPlaybookJson.templateCoverage.find((t) => t.templateId === templateId);
    assert.ok(templateEntry, "case template coverage must include the fixture template");
    assert.ok(!templateEntry!.gaps.containment.includes("T1566.001"), "template coverage must reflect its linked playbook's documented guidance");

    console.log("playbook/case-template coverage gap API test passed");

    // ── 9b. Optional D3FEND countermeasure mappings ──────────────────────────
    const d3fendNoTargetRes = await fetch(`${BASE_URL}/api/v1/attack/d3fend-mappings`, {
      method: "POST",
      headers: headers(orgAToken),
      body: JSON.stringify({ d3fendTechniqueId: "D3-NTA", d3fendTechniqueName: "Network Traffic Analysis" }),
    });
    assert.equal(d3fendNoTargetRes.status, 400, "a D3FEND mapping with neither playbookId nor responseActionId must be rejected");

    const d3fendCreateRes = await fetch(`${BASE_URL}/api/v1/attack/d3fend-mappings`, {
      method: "POST",
      headers: headers(orgAToken),
      body: JSON.stringify({
        d3fendTechniqueId: "D3-NTA",
        d3fendTechniqueName: "Network Traffic Analysis",
        attackTechniqueIds: ["T1071"],
        playbookId,
      }),
    });
    assert.equal(d3fendCreateRes.status, 201, `D3FEND mapping create must return 201, got ${d3fendCreateRes.status}`);
    const d3fendCreateJson = (await d3fendCreateRes.json()) as {
      mapping: { id: string; catalogVersion: string; playbookId: string | null };
    };
    assert.ok(d3fendCreateJson.mapping.catalogVersion.length > 0, "a D3FEND mapping must identify a catalog version even when not explicitly supplied");
    assert.equal(d3fendCreateJson.mapping.playbookId, playbookId);

    const d3fendListRes = await fetch(`${BASE_URL}/api/v1/attack/d3fend-mappings?playbookId=${playbookId}`, {
      headers: headers(orgAToken),
    });
    const d3fendListJson = (await d3fendListRes.json()) as { mappings: Array<{ id: string }> };
    assert.ok(d3fendListJson.mappings.some((m) => m.id === d3fendCreateJson.mapping.id));

    const d3fendDeleteRes = await fetch(
      `${BASE_URL}/api/v1/attack/d3fend-mappings?id=${d3fendCreateJson.mapping.id}`,
      { method: "DELETE", headers: headers(orgAToken) },
    );
    assert.equal(d3fendDeleteRes.status, 200);

    console.log("D3FEND mapping API test passed");

    // ── 10. MCP tools ─────────────────────────────────────────────────────────
    const toolsListResult = await mcpCall(orgAToken, "tools/list");
    const toolsList = (toolsListResult.result as { tools: Array<{ name: string; annotations: { readOnlyHint: boolean } }> }).tools;
    const searchTool = toolsList.find((t) => t.name === "attack_techniques_search");
    assert.ok(searchTool, "attack_techniques_search must be listed for a token with attack:read");
    assert.equal(searchTool!.annotations.readOnlyHint, true);
    const attachTool = toolsList.find((t) => t.name === "attack_technique_attach");
    assert.ok(attachTool, "attack_technique_attach must be listed for a token with attack:write");
    assert.equal(attachTool!.annotations.readOnlyHint, false, "attack_technique_attach must be marked non-read-only");

    const readOnlyToolsListResult = await mcpCall(orgAReadOnlyToken, "tools/list");
    const readOnlyToolsList = (readOnlyToolsListResult.result as { tools: Array<{ name: string }> }).tools;
    assert.ok(
      !readOnlyToolsList.some((t) => t.name === "attack_technique_attach"),
      "a token without attack:write must not see the write tool",
    );

    const mcpSearchResult = await mcpCall(orgAToken, "tools/call", {
      name: "attack_techniques_search",
      arguments: { query: "phishing" },
    });
    const mcpSearchContent = mcpSearchResult.result as { structuredContent: { techniques: Array<{ techniqueId: string }> } };
    assert.ok(mcpSearchContent.structuredContent.techniques.some((t) => t.techniqueId === "T1566"));

    const mcpMappingsListResult = await mcpCall(orgAToken, "tools/call", {
      name: "attack_mappings_list",
      arguments: { caseId: caseA },
    });
    const mcpMappingsContent = mcpMappingsListResult.result as { structuredContent: { mappings: MappingResponse[] } };
    assert.equal(mcpMappingsContent.structuredContent.mappings.length, 1);

    const mcpAttachResult = await mcpCall(orgAToken, "tools/call", {
      name: "attack_technique_attach",
      arguments: { entityType: "case", entityId: caseB, techniqueId: "T1078" },
    });
    const mcpAttachContent = mcpAttachResult.result as { structuredContent: { mapping: MappingResponse } };
    assert.ok(mcpAttachContent.structuredContent.mapping.id, "MCP write tool must create a mapping");
    createdMappingIds.push(mcpAttachContent.structuredContent.mapping.id);

    const mcpDuplicateResult = await mcpCall(orgAToken, "tools/call", {
      name: "attack_technique_attach",
      arguments: { entityType: "case", entityId: caseB, techniqueId: "T1078" },
    });
    const mcpDuplicateAsError = mcpDuplicateResult.result as { isError?: boolean };
    assert.equal(mcpDuplicateAsError.isError, true, "a duplicate mapping via MCP must surface as a tool-level error, not a transport error");

    const mcpCoverageResult = await mcpCall(orgAToken, "tools/call", { name: "attack_coverage_get", arguments: {} });
    const mcpCoverageContent = mcpCoverageResult.result as { structuredContent: { stats: { totalMappedTechniques: number } } };
    assert.ok(mcpCoverageContent.structuredContent.stats.totalMappedTechniques >= 1);

    console.log("attack MCP tool tests passed");

    // ── 11. Alert entity type: success path + cross-tenant rejection ────────
    const alertLinkedToCaseA = await createAlert(orgAId, { caseId: caseA });
    const alertAttachRes = await attach(orgAToken, {
      entityType: "alert",
      entityId: alertLinkedToCaseA,
      techniqueId: "T1078",
      source: "detection_rule",
    });
    assert.equal(alertAttachRes.status, 201, `attaching to an alert must return 201, got ${alertAttachRes.status}`);
    const alertAttachJson = (await alertAttachRes.json()) as { mapping: MappingResponse };
    assert.equal(alertAttachJson.mapping.entityType, "alert");
    assert.equal(
      alertAttachJson.mapping.caseId,
      caseA,
      "an alert mapping must resolve caseId from its primary case_alerts link for timeline/audit purposes",
    );
    createdMappingIds.push(alertAttachJson.mapping.id);

    // The alert's mapping must surface alongside the case's own mappings.
    const caseAWithAlertMappingRes = await listMappings(orgAToken, `caseId=${caseA}`);
    const caseAWithAlertMappingJson = (await caseAWithAlertMappingRes.json()) as { mappings: MappingResponse[] };
    assert.ok(
      caseAWithAlertMappingJson.mappings.some((m) => m.id === alertAttachJson.mapping.id),
      "listing mappings by caseId must include a mapping attached to one of the case's linked alerts",
    );

    // It must also be recorded on the case timeline (same as any other entity type).
    const alertTimelineRows = await db
      .select({ eventType: timelineEvents.eventType, payload: timelineEvents.payload })
      .from(timelineEvents)
      .where(and(eq(timelineEvents.caseId, caseA), eq(timelineEvents.eventType, "attack_mapping_changed")));
    assert.ok(
      alertTimelineRows.some((r) => (r.payload as { entity_type?: string }).entity_type === "alert"),
      "attaching a technique to an alert must write an attack_mapping_changed timeline event on its linked case",
    );

    // An alert not linked to any case yet still succeeds, with a null caseId (audited, no case timeline entry).
    const unlinkedAlert = await createAlert(orgAId);
    const unlinkedAlertAttachRes = await attach(orgAToken, {
      entityType: "alert",
      entityId: unlinkedAlert,
      techniqueId: "T1027",
    });
    assert.equal(unlinkedAlertAttachRes.status, 201);
    const unlinkedAlertAttachJson = (await unlinkedAlertAttachRes.json()) as { mapping: MappingResponse };
    assert.equal(unlinkedAlertAttachJson.mapping.caseId, null, "a mapping on an alert with no case link must have a null caseId, not fail");
    createdMappingIds.push(unlinkedAlertAttachJson.mapping.id);

    // Cross-tenant: org A cannot attach a technique to org B's alert.
    const orgBAlert = await createAlert(orgBId);
    const crossTenantAlertRes = await attach(orgAToken, {
      entityType: "alert",
      entityId: orgBAlert,
      techniqueId: "T1053",
    });
    assert.equal(
      crossTenantAlertRes.status,
      404,
      `attaching to another organisation's alert must return 404, got ${crossTenantAlertRes.status}`,
    );
    const crossTenantMappingRows = await db
      .select({ id: attackTechniqueMappings.id })
      .from(attackTechniqueMappings)
      .where(and(eq(attackTechniqueMappings.entityType, "alert"), eq(attackTechniqueMappings.entityId, orgBAlert)));
    assert.equal(crossTenantMappingRows.length, 0, "no mapping row may ever be created for a cross-tenant alert attach attempt");

    console.log("attack alert entity-type API test passed (success path + cross-tenant rejection)");
  } finally {
    await db.delete(attackTechniqueMappings).where(inArray(attackTechniqueMappings.organisationId, [orgAId, orgBId]));
    await db.delete(attackStoryEntries).where(inArray(attackStoryEntries.organisationId, [orgAId, orgBId]));
    if (createdTemplateIds.length > 0) {
      await db.delete(caseTemplates).where(inArray(caseTemplates.id, createdTemplateIds));
    }
    if (createdPlaybookIds.length > 0) {
      await db.delete(playbooks).where(inArray(playbooks.id, createdPlaybookIds));
    }
    const allCaseIds = [...orgACaseIds, ...orgBCaseIds];
    if (allCaseIds.length > 0) {
      await db.delete(timelineEvents).where(inArray(timelineEvents.caseId, allCaseIds));
      await db.delete(observables).where(inArray(observables.caseId, allCaseIds));
      await db.delete(cases).where(inArray(cases.id, allCaseIds));
    }
    for (const orgId of [orgAId, orgBId]) {
      await db.delete(apiTokens).where(eq(apiTokens.organisationId, orgId));
    }
    for (const orgId of [orgAId, orgBId]) {
      await db.delete(organisations).where(eq(organisations.id, orgId));
    }

    const remainingMappings = await db
      .select({ id: attackTechniqueMappings.id })
      .from(attackTechniqueMappings)
      .where(inArray(attackTechniqueMappings.organisationId, [orgAId, orgBId]));
    const remainingCases = await db.select({ id: cases.id }).from(cases).where(inArray(cases.id, allCaseIds));
    const remainingTokens = await db
      .select({ id: apiTokens.id })
      .from(apiTokens)
      .where(inArray(apiTokens.organisationId, [orgAId, orgBId]));
    const remainingOrgs = await db
      .select({ id: organisations.id })
      .from(organisations)
      .where(inArray(organisations.id, [orgAId, orgBId]));
    // Alerts/alert sources/case_alerts are not deleted explicitly above —
    // their `organisationId` foreign key cascades on organisation delete,
    // same as every other org-scoped table here. This just confirms that.
    const remainingAlerts = await db
      .select({ id: alerts.id })
      .from(alerts)
      .where(inArray(alerts.organisationId, [orgAId, orgBId]));
    assert.equal(remainingMappings.length, 0, "fixture mappings must be fully cleaned up");
    assert.equal(remainingCases.length, 0, "fixture cases must be fully cleaned up");
    assert.equal(remainingTokens.length, 0, "fixture api tokens must be fully cleaned up");
    assert.equal(remainingOrgs.length, 0, "fixture orgs must be fully cleaned up");
    assert.equal(remainingAlerts.length, 0, "fixture alerts must be fully cleaned up (cascaded via organisation delete)");
    console.log("attack mapping api fixture cleanup verified: no fixture rows remain");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
