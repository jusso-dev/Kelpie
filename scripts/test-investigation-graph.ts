/**
 * Coverage for the interactive investigation graph (issue #65):
 * - edge validation (types, confidence, self-link, observed range, provenance)
 * - derived + stored edge merge without inventing relationships
 * - node-type and min-confidence filtering
 * - access redaction of sensitive evidence (no topology/count leak)
 * - tenant isolation
 * - progressive loading limits
 * - export snapshot + textual provenance list
 * - attack story timing ambiguity flags
 *
 * Calls graph-core against real Postgres (mirrors test-investigations-core).
 */
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { db } from "../src/db";
import {
  alertEntities,
  alerts,
  attachments,
  attackStoryEntries,
  attackTechniqueMappings,
  caseAlerts,
  cases,
  entities,
  evidenceItems,
  investigationGraphEdges,
  organisations,
  timelineEvents,
  users,
} from "../src/db/schema";
import { newId } from "../src/lib/utils";
import {
  evaluateCasePermissions,
  loadCaseAccessContext,
  type AccessActor,
  type AccessPermission,
} from "../src/lib/access";
import {
  InvestigationGraphError,
  buildCaseGraphCore,
  createGraphEdgeCore,
  exportCaseGraphCore,
  filterEdgesByConfidence,
  filterNodesByType,
  mapEntityTypeToGraphNodeType,
  removeGraphEdgeCore,
  validateGraphEdgeInput,
} from "../src/lib/investigations/graph-core";
import {
  resolveEntityCore,
} from "../src/lib/investigations/entities-core";
import {
  getOrCreateAlertSourceCore,
  createOrUpdateAlertFromProviderCore,
  linkAlertToCaseCore,
  linkEntityToAlertCore,
} from "../src/lib/investigations/alerts-core";
import {
  createEvidenceItemCore,
  linkEvidenceRelationshipCore,
} from "../src/lib/investigations/evidence-items-core";

const runId = newId("i65test").slice("i65test_".length).slice(0, 10);
const orgAId = `org_i65a_${runId}`;
const orgBId = `org_i65b_${runId}`;
const userAId = `user_i65a_${runId}`;
const userBId = `user_i65b_${runId}`;
let caseA = "";
let caseB = "";

function actorA(): AccessActor {
  return {
    userId: userAId,
    organisationId: orgAId,
    role: "analyst",
    teamIds: [],
  };
}

function actorB(): AccessActor {
  return {
    userId: userBId,
    organisationId: orgBId,
    role: "analyst",
    teamIds: [],
  };
}

async function permissionsFor(
  organisationId: string,
  caseId: string,
  actor: AccessActor,
) {
  const ctx = await loadCaseAccessContext(organisationId, caseId);
  assert.ok(ctx, "case access context must load");
  return evaluateCasePermissions(ctx, actor);
}

async function setup() {
  await db.insert(organisations).values([
    { id: orgAId, name: "Graph Org A", slug: `i65a-${runId}` },
    { id: orgBId, name: "Graph Org B", slug: `i65b-${runId}` },
  ]);
  await db.insert(users).values([
    {
      id: userAId,
      name: "Graph Analyst A",
      email: `i65a-${runId}@example.com`,
      organisationId: orgAId,
      role: "analyst",
    },
    {
      id: userBId,
      name: "Graph Analyst B",
      email: `i65b-${runId}@example.com`,
      organisationId: orgBId,
      role: "analyst",
    },
  ]);
  caseA = newId("case");
  caseB = newId("case");
  await db.insert(cases).values([
    {
      id: caseA,
      organisationId: orgAId,
      caseNumber: `I65A-${runId}`,
      title: "Graph fixture case A",
    },
    {
      id: caseB,
      organisationId: orgBId,
      caseNumber: `I65B-${runId}`,
      title: "Graph fixture case B",
    },
  ]);
}

async function cleanup() {
  for (const org of [orgAId, orgBId]) {
    const orgCases = await db
      .select({ id: cases.id })
      .from(cases)
      .where(eq(cases.organisationId, org));
    for (const c of orgCases) {
      await db.delete(timelineEvents).where(eq(timelineEvents.caseId, c.id));
      await db
        .delete(investigationGraphEdges)
        .where(eq(investigationGraphEdges.caseId, c.id));
      await db
        .delete(attackStoryEntries)
        .where(eq(attackStoryEntries.caseId, c.id));
      await db
        .delete(attackTechniqueMappings)
        .where(eq(attackTechniqueMappings.caseId, c.id));
    }
    await db.delete(organisations).where(eq(organisations.id, org));
  }
}

async function testEdgeValidation() {
  assert.throws(
    () =>
      validateGraphEdgeInput({
        sourceNodeType: "ip",
        sourceNodeId: "e1",
        targetNodeType: "ip",
        targetNodeId: "e1",
        edgeType: "related_to",
        provenance: "analyst",
        source: "unit",
      }),
    (err: unknown) =>
      err instanceof InvestigationGraphError &&
      err.message.includes("Self-links"),
  );

  assert.throws(
    () =>
      validateGraphEdgeInput({
        sourceNodeType: "ip",
        sourceNodeId: "e1",
        targetNodeType: "domain",
        targetNodeId: "e2",
        edgeType: "related_to",
        provenance: "rule",
        source: "unit",
      }),
    (err: unknown) =>
      err instanceof InvestigationGraphError &&
      err.message.includes("ruleId"),
  );

  assert.throws(
    () =>
      validateGraphEdgeInput({
        sourceNodeType: "ip",
        sourceNodeId: "e1",
        targetNodeType: "domain",
        targetNodeId: "e2",
        edgeType: "related_to",
        provenance: "analyst",
        source: "unit",
        confidence: 150,
      }),
    (err: unknown) =>
      err instanceof InvestigationGraphError &&
      err.message.includes("Confidence"),
  );

  assert.throws(
    () =>
      validateGraphEdgeInput({
        sourceNodeType: "ip",
        sourceNodeId: "e1",
        targetNodeType: "domain",
        targetNodeId: "e2",
        edgeType: "related_to",
        provenance: "analyst",
        source: "unit",
        observedAtStart: "2026-07-02T00:00:00.000Z",
        observedAtEnd: "2026-07-01T00:00:00.000Z",
      }),
    (err: unknown) =>
      err instanceof InvestigationGraphError &&
      err.message.includes("observedAtStart"),
  );

  // Pure filter helpers
  const kept = filterEdgesByConfidence(
    [{ confidence: null }, { confidence: 40 }, { confidence: 80 }],
    50,
  );
  assert.equal(kept.length, 2);
  assert.deepEqual(
    kept.map((e) => e.confidence),
    [null, 80],
  );

  assert.deepEqual(
    filterNodesByType(
      [
        { type: "alert" as const },
        { type: "evidence" as const },
        { type: "ip" as const },
      ],
      ["evidence", "ip"],
    ).map((n) => n.type),
    ["evidence", "ip"],
  );

  assert.equal(mapEntityTypeToGraphNodeType("user_identity"), "identity");
  assert.equal(mapEntityTypeToGraphNodeType("device_endpoint"), "device");
  assert.equal(mapEntityTypeToGraphNodeType("file_hash"), "file");
  console.log("ok: edge validation + pure filters");
}

async function seedInvestigationGraph() {
  const source = await getOrCreateAlertSourceCore({
    organisationId: orgAId,
    kind: "manual",
    name: "Graph fixture source",
    tenantId: `t-${runId}`,
  });
  const { alert } = await createOrUpdateAlertFromProviderCore({
    organisationId: orgAId,
    sourceId: source.id,
    tenantId: `t-${runId}`,
    externalId: `alert-ext-${runId}`,
    title: "Suspicious outbound",
    severity: "high",
    detectionSource: "fixture-siem",
    detectedAt: new Date("2026-07-01T10:00:00.000Z"),
  });
  await linkAlertToCaseCore({
    organisationId: orgAId,
    actorId: userAId,
    caseId: caseA,
    alertId: alert.id,
    isPrimary: true,
  });

  const entity = await resolveEntityCore({
    organisationId: orgAId,
    type: "ip",
    displayName: "203.0.113.50",
    identifiers: [{ kind: "ip", value: "203.0.113.50" }],
  });
  await linkEntityToAlertCore({
    organisationId: orgAId,
    actorId: userAId,
    alertId: alert.id,
    entityId: entity.entity.id,
    role: "actor",
  });

  const domain = await resolveEntityCore({
    organisationId: orgAId,
    type: "domain",
    displayName: "evil.example",
    identifiers: [{ kind: "fqdn", value: "evil.example" }],
  });
  await linkEntityToAlertCore({
    organisationId: orgAId,
    actorId: userAId,
    alertId: alert.id,
    entityId: domain.entity.id,
    role: "related",
  });

  const evidenceA = await createEvidenceItemCore({
    organisationId: orgAId,
    actorId: userAId,
    caseId: caseA,
    alertId: alert.id,
    entityId: entity.entity.id,
    type: "network",
    value: "203.0.113.50 → evil.example",
    source: "analyst",
    confidence: 90,
    firstSeenAt: new Date("2026-07-01T10:05:00.000Z"),
  });
  const evidenceB = await createEvidenceItemCore({
    organisationId: orgAId,
    actorId: userAId,
    caseId: caseA,
    type: "dns",
    value: "evil.example",
    source: "provider",
    confidence: 30,
  });
  await linkEvidenceRelationshipCore({
    organisationId: orgAId,
    actorId: userAId,
    sourceEvidenceId: evidenceA.id,
    targetEvidenceId: evidenceB.id,
    relationshipType: "related_to",
    reason: "Same campaign indicator",
  });

  // Stored analyst edge with full provenance
  const seedPerms = await permissionsFor(orgAId, caseA, actorA());
  const stored = await createGraphEdgeCore(
    orgAId,
    userAId,
    caseA,
    {
      sourceNodeType: "ip",
      sourceNodeId: entity.entity.id,
      targetNodeType: "domain",
      targetNodeId: domain.entity.id,
      edgeType: "resolved_to",
      confidence: 75,
      provenance: "analyst",
      source: "manual_investigation",
      observedAtStart: "2026-07-01T10:06:00.000Z",
      reason: "PTR and passive DNS agree",
    },
    { actor: actorA(), permissions: seedPerms },
  );

  // ATT&CK mapping + story entry
  await db.insert(attackTechniqueMappings).values({
    id: newId("amap"),
    organisationId: orgAId,
    entityType: "case",
    entityId: caseA,
    caseId: caseA,
    techniqueId: "T1071.001",
    confidence: 70,
    source: "analyst",
    createdBy: userAId,
  });
  await db.insert(attackStoryEntries).values([
    {
      id: newId("astory"),
      organisationId: orgAId,
      caseId: caseA,
      sequenceIndex: 0,
      title: "Initial beacon",
      provenance: "provider",
      occurredAt: new Date("2026-07-01T12:00:00.000Z"),
      techniqueId: "T1071.001",
      createdBy: userAId,
    },
    {
      id: newId("astory"),
      organisationId: orgAId,
      caseId: caseA,
      sequenceIndex: 1,
      title: "Earlier recon (clock skew)",
      provenance: "analyst",
      // Earlier timestamp than previous — sequenceIndex still wins
      occurredAt: new Date("2026-07-01T09:00:00.000Z"),
      createdBy: userAId,
    },
    {
      id: newId("astory"),
      organisationId: orgAId,
      caseId: caseA,
      sequenceIndex: 2,
      title: "Unknown timing step",
      provenance: "analyst",
      occurredAt: null,
      createdBy: userAId,
    },
  ]);

  return {
    alertId: alert.id,
    entityId: entity.entity.id,
    domainId: domain.entity.id,
    evidenceAId: evidenceA.id,
    evidenceBId: evidenceB.id,
    storedEdgeId: stored.id,
  };
}

async function testBuildAndFilter(seed: Awaited<ReturnType<typeof seedInvestigationGraph>>) {
  const perms = await permissionsFor(orgAId, caseA, actorA());
  const graph = await buildCaseGraphCore({
    organisationId: orgAId,
    caseId: caseA,
    actor: actorA(),
    permissions: perms,
    view: "graph",
  });

  assert.ok(
    graph.nodes.some((n) => n.type === "case" && n.refId === caseA),
    "case node present",
  );
  assert.ok(
    graph.nodes.some((n) => n.type === "alert" && n.refId === seed.alertId),
    "alert node present",
  );
  assert.ok(
    graph.nodes.some((n) => n.type === "ip" && n.refId === seed.entityId),
    "ip entity node present",
  );
  assert.ok(
    graph.edges.some((e) => e.edgeType === "belongs_to_case" && !e.stored),
    "derived belongs_to_case edge present",
  );
  // One directed case↔alert edge only (belongs_to_case); no invented reverse.
  const alertCaseEdges = graph.edges.filter(
    (e) =>
      !e.stored &&
      e.derivedFrom === "case_alerts" &&
      ((e.sourceNodeId.startsWith("alert:") && e.targetNodeId.startsWith("case:")) ||
        (e.sourceNodeId.startsWith("case:") && e.targetNodeId.startsWith("alert:"))),
  );
  assert.equal(alertCaseEdges.length, 1, "exactly one case↔alert derived edge");
  assert.equal(alertCaseEdges[0]!.edgeType, "belongs_to_case");
  assert.ok(
    !graph.edges.some((e) => e.edgeType === "triggered_alert" && !e.stored),
    "no invented triggered_alert reverse edge",
  );
  // entity_id on evidence is related_to, not typed observed_on.
  assert.ok(
    graph.edges.some(
      (e) =>
        e.derivedFrom === "evidence_items.entity_id" &&
        e.edgeType === "related_to" &&
        e.sourceNodeId === `evidence:${seed.evidenceAId}`,
    ),
    "evidence entity_id derives related_to only",
  );
  assert.ok(
    !graph.edges.some(
      (e) =>
        e.derivedFrom === "evidence_items.entity_id" &&
        e.edgeType === "observed_on",
    ),
    "evidence entity_id does not invent observed_on",
  );
  assert.ok(
    graph.edges.some(
      (e) =>
        e.stored &&
        e.id === seed.storedEdgeId &&
        e.edgeType === "resolved_to" &&
        e.provenance === "analyst" &&
        e.confidence === 75,
    ),
    "stored edge with provenance present",
  );
  assert.ok(
    graph.edges.every((e) => e.provenance && e.source),
    "every edge exposes provenance and source",
  );

  // Timeline must not leak endpoint types/ids (audit side-channel).
  const [createdTl] = await db
    .select()
    .from(timelineEvents)
    .where(
      and(
        eq(timelineEvents.caseId, caseA),
        eq(timelineEvents.eventType, "investigation_graph_edge_created"),
      ),
    )
    .limit(1);
  assert.ok(createdTl, "edge create wrote timeline event");
  const tlPayload = createdTl.payload as Record<string, unknown>;
  assert.equal(tlPayload.edgeId, seed.storedEdgeId);
  assert.equal(tlPayload.edgeType, "resolved_to");
  assert.ok(!("sourceNodeType" in tlPayload), "timeline omits sourceNodeType");
  assert.ok(!("sourceNodeId" in tlPayload), "timeline omits sourceNodeId");
  assert.ok(!("targetNodeType" in tlPayload), "timeline omits targetNodeType");
  assert.ok(!("targetNodeId" in tlPayload), "timeline omits targetNodeId");

  // minConfidence filters known low confidence but keeps null/structural
  const filtered = await buildCaseGraphCore({
    organisationId: orgAId,
    caseId: caseA,
    actor: actorA(),
    permissions: perms,
    minConfidence: 50,
  });
  assert.ok(
    !filtered.edges.some(
      (e) => e.confidence !== null && e.confidence < 50,
    ),
    "no low-confidence edges after minConfidence filter",
  );
  assert.ok(
    filtered.edges.some((e) => e.confidence === null),
    "structural null-confidence edges still visible",
  );

  // node type filter
  const evidenceView = await buildCaseGraphCore({
    organisationId: orgAId,
    caseId: caseA,
    actor: actorA(),
    permissions: perms,
    view: "evidence",
  });
  assert.ok(
    evidenceView.nodes.every((n) => n.type === "evidence" || n.type === "case"),
    "evidence view only evidence (+ case anchor)",
  );
  assert.ok(
    evidenceView.edges.every(
      (e) =>
        e.sourceNodeId.startsWith("evidence:") ||
        e.targetNodeId.startsWith("evidence:"),
    ),
    "evidence view edges touch evidence",
  );

  const typeFiltered = await buildCaseGraphCore({
    organisationId: orgAId,
    caseId: caseA,
    actor: actorA(),
    permissions: perms,
    nodeTypes: ["ip", "domain"],
  });
  assert.ok(
    typeFiltered.nodes.every((n) => n.type === "ip" || n.type === "domain"),
    "nodeTypes filter applied",
  );

  // limits
  const limited = await buildCaseGraphCore({
    organisationId: orgAId,
    caseId: caseA,
    actor: actorA(),
    permissions: perms,
    nodeLimit: 2,
    edgeLimit: 1,
  });
  assert.ok(limited.limits.nodesTruncated || limited.nodes.length <= 2);
  assert.ok(limited.edges.length <= 1);
  assert.ok(limited.limits.edgesTruncated || limited.edges.length <= 1);

  // story timing ambiguity
  assert.equal(graph.story.length, 3);
  assert.equal(graph.story[0]!.sequenceIndex, 0);
  assert.equal(graph.story[1]!.timingAmbiguous, true);
  assert.equal(graph.story[2]!.timingAmbiguous, true);
  assert.ok(graph.story[2]!.timingNote);

  console.log("ok: graph build, filtering, limits, story timing");
}

async function testAccessRedaction(seed: Awaited<ReturnType<typeof seedInvestigationGraph>>) {
  // Attach a sensitive binary to evidenceB and mark attachment sensitive.
  const attId = newId("att");
  await db.insert(attachments).values({
    id: attId,
    caseId: caseA,
    organisationId: orgAId,
    filename: "secret.bin",
    originalFilename: "secret.bin",
    contentType: "application/octet-stream",
    sizeBytes: 12,
    storageKey: `test/${attId}`,
    sha256: "a".repeat(64),
    uploadedBy: userAId,
    status: "available",
    sensitive: true,
  });
  await db
    .update(evidenceItems)
    .set({ attachmentId: attId })
    .where(eq(evidenceItems.id, seed.evidenceBId));

  // Simulate actor without view_sensitive (compartment modes strip it).
  const permsNoSensitive = new Set<AccessPermission>([
    "know_exists",
    "view_metadata",
    "edit",
  ]);

  const graph = await buildCaseGraphCore({
    organisationId: orgAId,
    caseId: caseA,
    actor: actorA(),
    permissions: permsNoSensitive,
  });

  assert.ok(
    !graph.nodes.some((n) => n.refId === seed.evidenceBId),
    "sensitive evidence node omitted entirely",
  );
  assert.ok(
    !graph.edges.some(
      (e) =>
        e.sourceNodeId.includes(seed.evidenceBId) ||
        e.targetNodeId.includes(seed.evidenceBId),
    ),
    "sensitive evidence edges omitted",
  );
  // Counts must not include the redacted evidence
  assert.equal(
    graph.counts.nodes,
    graph.nodes.length,
    "counts match visible nodes only",
  );

  // With view_sensitive, the node returns.
  const permsSensitive = new Set<AccessPermission>([
    "know_exists",
    "view_metadata",
    "view_sensitive",
  ]);
  const full = await buildCaseGraphCore({
    organisationId: orgAId,
    caseId: caseA,
    actor: actorA(),
    permissions: permsSensitive,
  });
  assert.ok(
    full.nodes.some((n) => n.refId === seed.evidenceBId),
    "sensitive evidence visible with view_sensitive",
  );

  // createGraphEdgeCore must 404 on sensitive evidence without view_sensitive.
  await assert.rejects(
    () =>
      createGraphEdgeCore(
        orgAId,
        userAId,
        caseA,
        {
          sourceNodeType: "evidence",
          sourceNodeId: seed.evidenceBId,
          targetNodeType: "case",
          targetNodeId: caseA,
          edgeType: "related_to",
          provenance: "analyst",
          source: "sensitive-edge-attempt",
        },
        { actor: actorA(), permissions: permsNoSensitive },
      ),
    (err: unknown) =>
      err instanceof InvestigationGraphError &&
      err.status === 404 &&
      err.message === "Evidence item not found on case",
  );

  // With view_sensitive, create against the same evidence succeeds.
  const allowed = await createGraphEdgeCore(
    orgAId,
    userAId,
    caseA,
    {
      sourceNodeType: "evidence",
      sourceNodeId: seed.evidenceBId,
      targetNodeType: "case",
      targetNodeId: caseA,
      edgeType: "related_to",
      provenance: "analyst",
      source: "sensitive-edge-ok",
    },
    { actor: actorA(), permissions: permsSensitive },
  );
  assert.ok(allowed.id);
  await removeGraphEdgeCore(orgAId, userAId, caseA, allowed.id);

  console.log("ok: access redaction omits sensitive evidence from topology/counts");
}

async function testTenantIsolation(seed: Awaited<ReturnType<typeof seedInvestigationGraph>>) {
  const permsB = await permissionsFor(orgBId, caseB, actorB());
  const graphB = await buildCaseGraphCore({
    organisationId: orgBId,
    caseId: caseB,
    actor: actorB(),
    permissions: permsB,
  });
  assert.ok(
    !graphB.nodes.some((n) => n.refId === seed.alertId || n.refId === seed.entityId),
    "org B graph does not see org A nodes",
  );
  assert.ok(
    !graphB.edges.some((e) => e.id === seed.storedEdgeId),
    "org B graph does not see org A stored edges",
  );

  // Cross-tenant create must fail
  await assert.rejects(
    () =>
      createGraphEdgeCore(
        orgBId,
        userBId,
        caseB,
        {
          sourceNodeType: "case",
          sourceNodeId: caseB,
          targetNodeType: "ip",
          targetNodeId: seed.entityId,
          edgeType: "related_to",
          provenance: "analyst",
          source: "cross-tenant-attempt",
        },
        { actor: actorB(), permissions: permsB },
      ),
    (err: unknown) =>
      err instanceof InvestigationGraphError && err.status === 404,
  );

  // Org A cannot load case B
  await assert.rejects(
    () =>
      buildCaseGraphCore({
        organisationId: orgAId,
        caseId: caseB,
        actor: actorA(),
        permissions: new Set(["view_metadata", "know_exists"]),
      }),
    (err: unknown) =>
      err instanceof InvestigationGraphError && err.status === 404,
  );

  console.log("ok: tenant isolation");
}

async function testExportAndRemove(seed: Awaited<ReturnType<typeof seedInvestigationGraph>>) {
  const perms = await permissionsFor(orgAId, caseA, actorA());
  perms.add("export");
  const exported = await exportCaseGraphCore({
    organisationId: orgAId,
    caseId: caseA,
    actor: actorA(),
    permissions: perms,
  });
  assert.ok(exported.snapshot.edges.length > 0);
  assert.match(exported.text, /Investigation graph export/);
  assert.match(exported.text, /Relationships/);
  assert.match(exported.text, /provenance=analyst/);
  assert.match(exported.text, /resolved_to|belongs_to_case|related_to/);

  // Export denied without export permission
  const noExport = new Set(
    [...perms].filter((p) => p !== "export"),
  ) as typeof perms;
  noExport.add("view_metadata");
  await assert.rejects(
    () =>
      exportCaseGraphCore({
        organisationId: orgAId,
        caseId: caseA,
        actor: actorA(),
        permissions: noExport,
      }),
    (err: unknown) =>
      err instanceof InvestigationGraphError && err.status === 404,
  );

  await removeGraphEdgeCore(orgAId, userAId, caseA, seed.storedEdgeId);
  const after = await buildCaseGraphCore({
    organisationId: orgAId,
    caseId: caseA,
    actor: actorA(),
    permissions: await permissionsFor(orgAId, caseA, actorA()),
  });
  assert.ok(
    !after.edges.some((e) => e.id === seed.storedEdgeId),
    "removed stored edge gone",
  );

  console.log("ok: export + edge removal");
}

async function testNoInventedEdges() {
  // Empty case — only case node, no invented entity/edges
  const emptyCase = newId("case");
  await db.insert(cases).values({
    id: emptyCase,
    organisationId: orgAId,
    caseNumber: `I65EMPTY-${runId}`,
    title: "Empty graph case",
  });
  const perms = await permissionsFor(orgAId, emptyCase, actorA());
  const graph = await buildCaseGraphCore({
    organisationId: orgAId,
    caseId: emptyCase,
    actor: actorA(),
    permissions: perms,
  });
  assert.equal(graph.nodes.length, 1);
  assert.equal(graph.nodes[0]!.type, "case");
  assert.equal(graph.edges.length, 0);
  console.log("ok: empty case invents no edges");
}

async function main() {
  await setup();
  try {
    await testEdgeValidation();
    const seed = await seedInvestigationGraph();
    await testBuildAndFilter(seed);
    await testAccessRedaction(seed);
    await testTenantIsolation(seed);
    await testExportAndRemove(seed);
    await testNoInventedEdges();
    console.log("\nAll investigation graph tests passed.");
  } finally {
    await cleanup();
  }
}

main()
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error(err);
    try {
      await cleanup();
    } catch (cleanupError) {
      console.error("cleanup also failed:", cleanupError);
    }
    process.exit(1);
  });
