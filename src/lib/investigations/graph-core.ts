/**
 * Investigation graph builder and explicit edge mutations (issue #65).
 *
 * Nodes and structural edges are derived from already-stored investigation
 * data (case_alerts, alert_entities, evidence_items + relationships, ATT&CK
 * mappings). Presentation never invents relationships. Analyst/provider/rule
 * edges with full provenance live in `investigation_graph_edges`.
 *
 * Access: callers must already have authorized the case. Restricted /
 * sensitive content is omitted entirely (no count, topology, or label leak).
 */

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
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
  evidenceRelationships,
  investigationGraphEdges,
  type InvestigationGraphEdge,
} from "@/db/schema";
import type { AccessActor, AccessPermission } from "@/lib/access/types";
import {
  canViewSensitiveObject,
  hasPermission,
  loadCaseAccessContext,
} from "@/lib/access";
import { getTechniquesByIds } from "@/lib/attack/catalog-core";
import { ATTACK_TACTICS } from "@/lib/attack/tactics";
import { newId } from "@/lib/utils";
import { writeTimelineEvent } from "@/lib/timeline";

export class InvestigationGraphError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "InvestigationGraphError";
    this.status = status;
  }
}

export const GRAPH_NODE_TYPES = [
  "case",
  "alert",
  "identity",
  "device",
  "mailbox",
  "file",
  "process",
  "ip",
  "domain",
  "url",
  "cloud_resource",
  "evidence",
  "technique",
  "email_message",
  "application",
  "tenant",
  "network",
  "asset",
  "other",
] as const;
export type GraphNodeType = (typeof GRAPH_NODE_TYPES)[number];

export const GRAPH_EDGE_TYPES = [
  "observed_on",
  "communicated_with",
  "executed",
  "downloaded",
  "sent_by",
  "received_by",
  "authenticated_to",
  "resolved_to",
  "parent_process",
  "triggered_alert",
  "belongs_to_case",
  "related_to",
  "derived_from",
  "duplicate_of",
  "maps_to_technique",
] as const;
export type GraphEdgeType = (typeof GRAPH_EDGE_TYPES)[number];

export const GRAPH_PROVENANCES = ["provider", "analyst", "rule"] as const;
export type GraphProvenance = (typeof GRAPH_PROVENANCES)[number];

/** Structural derived edges always pass minConfidence (unknown confidence). */
export const STRUCTURAL_EDGE_TYPES = new Set<GraphEdgeType>([
  "belongs_to_case",
  "triggered_alert",
  "maps_to_technique",
  "related_to",
  "derived_from",
  "duplicate_of",
  "observed_on",
]);

export const DEFAULT_GRAPH_NODE_LIMIT = 200;
export const DEFAULT_GRAPH_EDGE_LIMIT = 500;
export const MAX_GRAPH_NODE_LIMIT = 500;
export const MAX_GRAPH_EDGE_LIMIT = 2000;

export type GraphViewMode = "graph" | "story" | "tactic_lanes" | "evidence";

export type GraphNode = {
  id: string;
  type: GraphNodeType;
  refId: string;
  label: string;
  /** Optional subtype / role / severity / tactic ids for UI lanes. */
  meta: Record<string, unknown>;
  sensitive: boolean;
  redacted: boolean;
};

export type GraphEdge = {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  edgeType: GraphEdgeType;
  confidence: number | null;
  provenance: GraphProvenance;
  source: string;
  observedAtStart: string | null;
  observedAtEnd: string | null;
  creatorId: string | null;
  reason: string | null;
  /** true when edge comes from investigation_graph_edges rather than derivation */
  stored: boolean;
  /** Origin table/key for derived edges (audit / export provenance). */
  derivedFrom: string | null;
};

export type AttackStoryGraphEntry = {
  id: string;
  sequenceIndex: number;
  title: string;
  description: string | null;
  provenance: "analyst" | "provider";
  sourceRef: string | null;
  occurredAt: string | null;
  techniqueId: string | null;
  techniqueName: string | null;
  mappingId: string | null;
  /** True when occurredAt is missing or out of order vs neighbours — clock ambiguity. */
  timingAmbiguous: boolean;
  timingNote: string | null;
};

export type TacticLane = {
  tacticId: string;
  tacticName: string;
  techniques: Array<{
    techniqueId: string;
    techniqueName: string | null;
    mappingIds: string[];
    nodeId: string;
  }>;
};

export type CaseGraphResult = {
  caseId: string;
  view: GraphViewMode;
  nodes: GraphNode[];
  edges: GraphEdge[];
  story: AttackStoryGraphEntry[];
  tacticLanes: TacticLane[];
  limits: {
    nodeLimit: number;
    edgeLimit: number;
    nodesTruncated: boolean;
    edgesTruncated: boolean;
  };
  /** Counts after access redaction + filters (never include restricted items). */
  counts: {
    nodes: number;
    edges: number;
    storyEntries: number;
  };
  filters: {
    nodeTypes: GraphNodeType[] | null;
    minConfidence: number | null;
    evidenceOnly: boolean;
  };
  generatedAt: string;
};

export type GraphEdgeCreateInput = {
  sourceNodeType: GraphNodeType;
  sourceNodeId: string;
  targetNodeType: GraphNodeType;
  targetNodeId: string;
  edgeType: GraphEdgeType;
  confidence?: number | null;
  provenance: GraphProvenance;
  source: string;
  observedAtStart?: string | null;
  observedAtEnd?: string | null;
  ruleId?: string | null;
  ruleVersion?: string | null;
  reason?: string | null;
};

function nodeKey(type: GraphNodeType, refId: string): string {
  return `${type}:${refId}`;
}

export function mapEntityTypeToGraphNodeType(
  entityType: string,
): GraphNodeType {
  switch (entityType) {
    case "user_identity":
      return "identity";
    case "device_endpoint":
      return "device";
    case "mailbox":
      return "mailbox";
    case "email_message":
      return "email_message";
    case "ip":
      return "ip";
    case "domain":
      return "domain";
    case "url":
      return "url";
    case "file":
    case "file_hash":
      return "file";
    case "process":
      return "process";
    case "cloud_resource":
      return "cloud_resource";
    case "application":
      return "application";
    case "tenant":
      return "tenant";
    case "network":
      return "network";
    case "asset":
      return "asset";
    default:
      return "other";
  }
}

export function isGraphNodeType(value: string): value is GraphNodeType {
  return (GRAPH_NODE_TYPES as readonly string[]).includes(value);
}

export function isGraphEdgeType(value: string): value is GraphEdgeType {
  return (GRAPH_EDGE_TYPES as readonly string[]).includes(value);
}

export function isGraphProvenance(value: string): value is GraphProvenance {
  return (GRAPH_PROVENANCES as readonly string[]).includes(value);
}

export function validateGraphEdgeInput(input: GraphEdgeCreateInput): void {
  if (!isGraphNodeType(input.sourceNodeType)) {
    throw new InvestigationGraphError("Unknown source node type");
  }
  if (!isGraphNodeType(input.targetNodeType)) {
    throw new InvestigationGraphError("Unknown target node type");
  }
  if (!isGraphEdgeType(input.edgeType)) {
    throw new InvestigationGraphError("Unknown edge type");
  }
  if (!isGraphProvenance(input.provenance)) {
    throw new InvestigationGraphError("Unknown provenance");
  }
  if (!input.sourceNodeId.trim() || !input.targetNodeId.trim()) {
    throw new InvestigationGraphError("Source and target node ids are required");
  }
  if (
    input.sourceNodeType === input.targetNodeType &&
    input.sourceNodeId === input.targetNodeId
  ) {
    throw new InvestigationGraphError("Self-links are not allowed");
  }
  if (!input.source.trim()) {
    throw new InvestigationGraphError("Edge source is required");
  }
  if (input.source.trim().length > 256) {
    throw new InvestigationGraphError("Edge source must be ≤ 256 characters");
  }
  if (
    input.confidence !== undefined &&
    input.confidence !== null &&
    (input.confidence < 0 || input.confidence > 100 || !Number.isFinite(input.confidence))
  ) {
    throw new InvestigationGraphError("Confidence must be between 0 and 100");
  }
  if (input.provenance === "rule" && !input.ruleId?.trim()) {
    throw new InvestigationGraphError("rule provenance requires ruleId");
  }
  const start = input.observedAtStart ? new Date(input.observedAtStart) : null;
  const end = input.observedAtEnd ? new Date(input.observedAtEnd) : null;
  if (start && Number.isNaN(start.getTime())) {
    throw new InvestigationGraphError("Invalid observedAtStart");
  }
  if (end && Number.isNaN(end.getTime())) {
    throw new InvestigationGraphError("Invalid observedAtEnd");
  }
  if (start && end && start.getTime() > end.getTime()) {
    throw new InvestigationGraphError(
      "observedAtStart must be ≤ observedAtEnd",
    );
  }
}

function clampNodeLimit(n: number | null | undefined): number {
  if (!n || !Number.isFinite(n) || n <= 0) return DEFAULT_GRAPH_NODE_LIMIT;
  return Math.min(Math.floor(n), MAX_GRAPH_NODE_LIMIT);
}

function clampEdgeLimit(n: number | null | undefined): number {
  if (!n || !Number.isFinite(n) || n <= 0) return DEFAULT_GRAPH_EDGE_LIMIT;
  return Math.min(Math.floor(n), MAX_GRAPH_EDGE_LIMIT);
}

function iso(d: Date | null | undefined): string | null {
  if (!d) return null;
  return d.toISOString();
}

async function loadCaseInOrg(caseId: string, organisationId: string) {
  const [row] = await db
    .select({
      id: cases.id,
      caseNumber: cases.caseNumber,
      title: cases.title,
      severity: cases.severity,
      status: cases.status,
    })
    .from(cases)
    .where(and(eq(cases.id, caseId), eq(cases.organisationId, organisationId)))
    .limit(1);
  return row ?? null;
}

/**
 * Confirm that a node reference exists in-org and is linked to the case
 * (or is the case itself / a technique id). Used before inserting stored edges.
 */
export async function assertNodeInCase(
  organisationId: string,
  caseId: string,
  nodeType: GraphNodeType,
  nodeId: string,
): Promise<void> {
  if (nodeType === "case") {
    if (nodeId !== caseId) {
      throw new InvestigationGraphError(
        "Graph edges may only reference the current case as a case node",
        400,
      );
    }
    return;
  }
  if (nodeType === "alert") {
    const [link] = await db
      .select({ id: caseAlerts.id })
      .from(caseAlerts)
      .where(
        and(
          eq(caseAlerts.organisationId, organisationId),
          eq(caseAlerts.caseId, caseId),
          eq(caseAlerts.alertId, nodeId),
        ),
      )
      .limit(1);
    if (!link) throw new InvestigationGraphError("Alert not found on case", 404);
    return;
  }
  if (nodeType === "evidence") {
    const [row] = await db
      .select({ id: evidenceItems.id })
      .from(evidenceItems)
      .where(
        and(
          eq(evidenceItems.organisationId, organisationId),
          eq(evidenceItems.caseId, caseId),
          eq(evidenceItems.id, nodeId),
        ),
      )
      .limit(1);
    if (!row) throw new InvestigationGraphError("Evidence item not found on case", 404);
    return;
  }
  if (nodeType === "technique") {
    // Technique ids are catalog ids (Txxxx); presence is validated loosely.
    if (!/^T\d{4}(\.\d{3})?$/i.test(nodeId)) {
      throw new InvestigationGraphError("Technique id must look like T1059 or T1059.001");
    }
    return;
  }
  // Entity subtypes: entity must be linked via an alert on this case.
  const alertIds = await db
    .select({ alertId: caseAlerts.alertId })
    .from(caseAlerts)
    .where(
      and(
        eq(caseAlerts.organisationId, organisationId),
        eq(caseAlerts.caseId, caseId),
      ),
    );
  if (alertIds.length === 0) {
    throw new InvestigationGraphError("Entity not found on case", 404);
  }
  const [entity] = await db
    .select({ id: entities.id, type: entities.type })
    .from(entities)
    .innerJoin(
      alertEntities,
      and(
        eq(alertEntities.entityId, entities.id),
        eq(alertEntities.organisationId, organisationId),
      ),
    )
    .where(
      and(
        eq(entities.organisationId, organisationId),
        eq(entities.id, nodeId),
        inArray(
          alertEntities.alertId,
          alertIds.map((a) => a.alertId),
        ),
      ),
    )
    .limit(1);
  if (!entity) throw new InvestigationGraphError("Entity not found on case", 404);
  const projected = mapEntityTypeToGraphNodeType(entity.type);
  if (projected !== nodeType && nodeType !== "other") {
    throw new InvestigationGraphError(
      `Entity type ${entity.type} projects to node type ${projected}, not ${nodeType}`,
    );
  }
}

export async function createGraphEdgeCore(
  organisationId: string,
  actorId: string | null,
  caseId: string,
  input: GraphEdgeCreateInput,
): Promise<InvestigationGraphEdge> {
  validateGraphEdgeInput(input);
  const caseRow = await loadCaseInOrg(caseId, organisationId);
  if (!caseRow) throw new InvestigationGraphError("Case not found", 404);

  await assertNodeInCase(
    organisationId,
    caseId,
    input.sourceNodeType,
    input.sourceNodeId,
  );
  await assertNodeInCase(
    organisationId,
    caseId,
    input.targetNodeType,
    input.targetNodeId,
  );

  const id = newId("igedge");
  try {
    const [row] = await db
      .insert(investigationGraphEdges)
      .values({
        id,
        organisationId,
        caseId,
        sourceNodeType: input.sourceNodeType,
        sourceNodeId: input.sourceNodeId,
        targetNodeType: input.targetNodeType,
        targetNodeId: input.targetNodeId,
        edgeType: input.edgeType,
        confidence:
          input.confidence === undefined ? null : input.confidence,
        provenance: input.provenance,
        source: input.source.trim(),
        observedAtStart: input.observedAtStart
          ? new Date(input.observedAtStart)
          : null,
        observedAtEnd: input.observedAtEnd
          ? new Date(input.observedAtEnd)
          : null,
        creatorId: actorId,
        ruleId: input.ruleId ?? null,
        ruleVersion: input.ruleVersion ?? null,
        reason: input.reason?.trim() || null,
      })
      .returning();
    if (!row) throw new InvestigationGraphError("Failed to create edge", 500);

    await writeTimelineEvent({
      caseId,
      actorId,
      eventType: "investigation_graph_edge_created",
      payload: {
        edgeId: row.id,
        edgeType: row.edgeType,
        provenance: row.provenance,
        source: row.source,
        sourceNodeType: row.sourceNodeType,
        sourceNodeId: row.sourceNodeId,
        targetNodeType: row.targetNodeType,
        targetNodeId: row.targetNodeId,
        confidence: row.confidence,
      },
    });
    return row;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("investigation_graph_edges_unique_idx") || msg.includes("unique")) {
      throw new InvestigationGraphError("Edge already exists", 409);
    }
    throw err;
  }
}

export async function removeGraphEdgeCore(
  organisationId: string,
  actorId: string | null,
  caseId: string,
  edgeId: string,
): Promise<void> {
  const [row] = await db
    .select()
    .from(investigationGraphEdges)
    .where(
      and(
        eq(investigationGraphEdges.id, edgeId),
        eq(investigationGraphEdges.organisationId, organisationId),
        eq(investigationGraphEdges.caseId, caseId),
      ),
    )
    .limit(1);
  if (!row) throw new InvestigationGraphError("Edge not found", 404);

  await db
    .delete(investigationGraphEdges)
    .where(eq(investigationGraphEdges.id, edgeId));

  await writeTimelineEvent({
    caseId,
    actorId,
    eventType: "investigation_graph_edge_removed",
    payload: {
      edgeId: row.id,
      edgeType: row.edgeType,
      provenance: row.provenance,
      source: row.source,
    },
  });
}

function passesConfidence(
  confidence: number | null,
  minConfidence: number | null,
): boolean {
  if (minConfidence === null || minConfidence === undefined) return true;
  // Unknown confidence is kept — only filter known low-confidence edges.
  if (confidence === null) return true;
  return confidence >= minConfidence;
}

function passesNodeTypeFilter(
  type: GraphNodeType,
  allowed: Set<GraphNodeType> | null,
): boolean {
  if (!allowed) return true;
  return allowed.has(type);
}

/**
 * Build the access-safe case investigation graph from stored + derived edges.
 */
export async function buildCaseGraphCore(opts: {
  organisationId: string;
  caseId: string;
  actor: AccessActor;
  /** Permissions already evaluated for the case (from authorizeCase). */
  permissions: Set<AccessPermission>;
  nodeTypes?: GraphNodeType[] | null;
  minConfidence?: number | null;
  view?: GraphViewMode;
  nodeLimit?: number | null;
  edgeLimit?: number | null;
}): Promise<CaseGraphResult> {
  const {
    organisationId,
    caseId,
    actor,
    permissions,
  } = opts;
  const view: GraphViewMode = opts.view ?? "graph";
  const nodeLimit = clampNodeLimit(opts.nodeLimit);
  const edgeLimit = clampEdgeLimit(opts.edgeLimit);
  const minConfidence =
    opts.minConfidence === undefined || opts.minConfidence === null
      ? null
      : opts.minConfidence;
  if (
    minConfidence !== null &&
    (minConfidence < 0 || minConfidence > 100 || !Number.isFinite(minConfidence))
  ) {
    throw new InvestigationGraphError("minConfidence must be between 0 and 100");
  }
  const allowedTypes =
    opts.nodeTypes && opts.nodeTypes.length > 0
      ? new Set(opts.nodeTypes)
      : null;
  const evidenceOnly = view === "evidence";

  if (!hasPermission(permissions, "view_metadata")) {
    // Caller should have gated with authorizeCase; fail closed.
    throw new InvestigationGraphError("Case not found", 404);
  }

  const caseRow = await loadCaseInOrg(caseId, organisationId);
  if (!caseRow) throw new InvestigationGraphError("Case not found", 404);

  const canViewSensitive = hasPermission(permissions, "view_sensitive");

  // ── Load source rows (org + case scoped) ──────────────────────────────
  const caseAlertRows = await db
    .select({
      linkId: caseAlerts.id,
      alertId: caseAlerts.alertId,
      isPrimary: caseAlerts.isPrimary,
      addedBy: caseAlerts.addedBy,
      linkedAt: caseAlerts.createdAt,
      title: alerts.title,
      severity: alerts.severity,
      status: alerts.status,
      detectionSource: alerts.detectionSource,
      detectedAt: alerts.detectedAt,
      createdAt: alerts.createdAt,
    })
    .from(caseAlerts)
    .innerJoin(alerts, eq(alerts.id, caseAlerts.alertId))
    .where(
      and(
        eq(caseAlerts.organisationId, organisationId),
        eq(caseAlerts.caseId, caseId),
        eq(alerts.organisationId, organisationId),
      ),
    );

  const alertIds = caseAlertRows.map((r) => r.alertId);

  const alertEntityRows =
    alertIds.length === 0
      ? []
      : await db
          .select({
            linkId: alertEntities.id,
            alertId: alertEntities.alertId,
            entityId: alertEntities.entityId,
            role: alertEntities.role,
            addedBy: alertEntities.addedBy,
            createdAt: alertEntities.createdAt,
            entityType: entities.type,
            displayName: entities.displayName,
            lastSeenAt: entities.lastSeenAt,
            firstSeenAt: entities.firstSeenAt,
          })
          .from(alertEntities)
          .innerJoin(entities, eq(entities.id, alertEntities.entityId))
          .where(
            and(
              eq(alertEntities.organisationId, organisationId),
              eq(entities.organisationId, organisationId),
              inArray(alertEntities.alertId, alertIds),
            ),
          );

  const evidenceRows = await db
    .select({
      item: evidenceItems,
      attachmentSensitive: attachments.sensitive,
      attachmentId: attachments.id,
    })
    .from(evidenceItems)
    .leftJoin(attachments, eq(attachments.id, evidenceItems.attachmentId))
    .where(
      and(
        eq(evidenceItems.organisationId, organisationId),
        eq(evidenceItems.caseId, caseId),
      ),
    );

  const evidenceIds = evidenceRows.map((r) => r.item.id);
  const evidenceRelRows =
    evidenceIds.length === 0
      ? []
      : await db
          .select()
          .from(evidenceRelationships)
          .where(
            and(
              eq(evidenceRelationships.organisationId, organisationId),
              inArray(evidenceRelationships.sourceEvidenceId, evidenceIds),
            ),
          );

  const mappingRows = await db
    .select()
    .from(attackTechniqueMappings)
    .where(
      and(
        eq(attackTechniqueMappings.organisationId, organisationId),
        eq(attackTechniqueMappings.caseId, caseId),
      ),
    );

  const storyRows = await db
    .select()
    .from(attackStoryEntries)
    .where(
      and(
        eq(attackStoryEntries.organisationId, organisationId),
        eq(attackStoryEntries.caseId, caseId),
      ),
    )
    .orderBy(asc(attackStoryEntries.sequenceIndex));

  const storedEdges = await db
    .select()
    .from(investigationGraphEdges)
    .where(
      and(
        eq(investigationGraphEdges.organisationId, organisationId),
        eq(investigationGraphEdges.caseId, caseId),
      ),
    );

  const techniqueIds = [
    ...new Set([
      ...mappingRows.map((m) => m.techniqueId),
      ...storyRows
        .map((s) => s.techniqueId)
        .filter((id): id is string => Boolean(id)),
    ]),
  ];
  const techniques = await getTechniquesByIds(techniqueIds);
  const techniqueById = new Map(
    techniques.map((t) => [t.techniqueId, t]),
  );

  // ── Build nodes ───────────────────────────────────────────────────────
  const nodesByKey = new Map<string, GraphNode>();

  const addNode = (node: GraphNode) => {
    if (!passesNodeTypeFilter(node.type, allowedTypes)) return;
    // evidence view: evidence nodes (+ case anchor when not filtered out)
    if (evidenceOnly && node.type !== "evidence" && node.type !== "case") {
      return;
    }
    if (!nodesByKey.has(node.id)) nodesByKey.set(node.id, node);
  };

  if (!evidenceOnly || passesNodeTypeFilter("case", allowedTypes)) {
    if (passesNodeTypeFilter("case", allowedTypes)) {
      addNode({
        id: nodeKey("case", caseRow.id),
        type: "case",
        refId: caseRow.id,
        label: caseRow.caseNumber,
        meta: {
          title: caseRow.title,
          severity: caseRow.severity,
          status: caseRow.status,
        },
        sensitive: false,
        redacted: false,
      });
    }
  }

  if (!evidenceOnly) {
    for (const a of caseAlertRows) {
      addNode({
        id: nodeKey("alert", a.alertId),
        type: "alert",
        refId: a.alertId,
        label: a.title,
        meta: {
          severity: a.severity,
          status: a.status,
          isPrimary: a.isPrimary,
          detectionSource: a.detectionSource,
          detectedAt: iso(a.detectedAt),
        },
        sensitive: false,
        redacted: false,
      });
    }

    for (const e of alertEntityRows) {
      const gType = mapEntityTypeToGraphNodeType(e.entityType);
      addNode({
        id: nodeKey(gType, e.entityId),
        type: gType,
        refId: e.entityId,
        label: e.displayName,
        meta: {
          entityType: e.entityType,
          firstSeenAt: iso(e.firstSeenAt),
          lastSeenAt: iso(e.lastSeenAt),
        },
        sensitive: false,
        redacted: false,
      });
    }
  }

  // Evidence with attachment sensitivity redaction — omit entirely if no access.
  const accessCtx = await loadCaseAccessContext(organisationId, caseId);
  const grants = accessCtx?.grants ?? [];
  const visibleEvidenceIds = new Set<string>();
  for (const row of evidenceRows) {
    const sensitive = Boolean(row.attachmentSensitive);
    if (sensitive) {
      const canSee = canViewSensitiveObject(permissions, {
        sensitive: true,
        objectType: "evidence",
        objectId: row.attachmentId ?? row.item.id,
        grants,
        actor,
      });
      if (!canSee) {
        // Omit node completely — no topology / count leak.
        continue;
      }
    }
    visibleEvidenceIds.add(row.item.id);
    addNode({
      id: nodeKey("evidence", row.item.id),
      type: "evidence",
      refId: row.item.id,
      label:
        row.item.value?.trim() ||
        row.item.description?.trim() ||
        row.item.type,
      meta: {
        evidenceType: row.item.type,
        verdict: row.item.verdict,
        confidence: row.item.confidence,
        source: row.item.source,
        firstSeenAt: iso(row.item.firstSeenAt),
        lastSeenAt: iso(row.item.lastSeenAt),
        alertId: row.item.alertId,
        entityId: row.item.entityId,
      },
      sensitive,
      redacted: false,
    });
  }

  if (!evidenceOnly) {
    for (const m of mappingRows) {
      const tech = techniqueById.get(m.techniqueId);
      addNode({
        id: nodeKey("technique", m.techniqueId),
        type: "technique",
        refId: m.techniqueId,
        label: tech?.name
          ? `${m.techniqueId} — ${tech.name}`
          : m.techniqueId,
        meta: {
          techniqueId: m.techniqueId,
          tactics: tech?.tactics ?? [],
          deprecated: tech?.deprecated ?? false,
        },
        sensitive: false,
        redacted: false,
      });
    }
  }

  // ── Build edges ───────────────────────────────────────────────────────
  const edges: GraphEdge[] = [];
  const edgeIdSeen = new Set<string>();

  const pushEdge = (edge: GraphEdge) => {
    if (edgeIdSeen.has(edge.id)) return;
    if (!passesConfidence(edge.confidence, minConfidence)) return;
    // Both endpoints must be present after access + type filters.
    if (!nodesByKey.has(edge.sourceNodeId) || !nodesByKey.has(edge.targetNodeId)) {
      return;
    }
    edgeIdSeen.add(edge.id);
    edges.push(edge);
  };

  // case_alerts → belongs_to_case (alert → case) + triggered_alert inverse concept as belongs
  if (!evidenceOnly) {
    for (const a of caseAlertRows) {
      const alertNodeId = nodeKey("alert", a.alertId);
      const caseNodeId = nodeKey("case", caseRow.id);
      const provenance: GraphProvenance = a.addedBy ? "analyst" : "provider";
      pushEdge({
        id: `derived:case_alert:${a.linkId}`,
        sourceNodeId: alertNodeId,
        targetNodeId: caseNodeId,
        edgeType: "belongs_to_case",
        confidence: null,
        provenance,
        source: a.detectionSource || "case_alerts",
        observedAtStart: iso(a.detectedAt ?? a.linkedAt),
        observedAtEnd: null,
        creatorId: a.addedBy,
        reason: a.isPrimary ? "primary alert" : null,
        stored: false,
        derivedFrom: "case_alerts",
      });
      pushEdge({
        id: `derived:triggered_alert:${a.linkId}`,
        sourceNodeId: caseNodeId,
        targetNodeId: alertNodeId,
        edgeType: "triggered_alert",
        confidence: null,
        provenance,
        source: a.detectionSource || "case_alerts",
        observedAtStart: iso(a.detectedAt ?? a.linkedAt),
        observedAtEnd: null,
        creatorId: a.addedBy,
        reason: null,
        stored: false,
        derivedFrom: "case_alerts",
      });
    }

    // alert_entities → related_to (role kept in meta via reason; do not invent stronger types)
    for (const link of alertEntityRows) {
      const gType = mapEntityTypeToGraphNodeType(link.entityType);
      const entityNodeId = nodeKey(gType, link.entityId);
      const alertNodeId = nodeKey("alert", link.alertId);
      const provenance: GraphProvenance = link.addedBy ? "analyst" : "provider";
      pushEdge({
        id: `derived:alert_entity:${link.linkId}`,
        sourceNodeId: entityNodeId,
        targetNodeId: alertNodeId,
        edgeType: "related_to",
        confidence: null,
        provenance,
        source: "alert_entities",
        observedAtStart: iso(link.firstSeenAt ?? link.createdAt),
        observedAtEnd: iso(link.lastSeenAt),
        creatorId: link.addedBy,
        reason: `role:${link.role}`,
        stored: false,
        derivedFrom: "alert_entities",
      });
    }
  }

  // evidence structural links
  for (const row of evidenceRows) {
    if (!visibleEvidenceIds.has(row.item.id)) continue;
    const eNode = nodeKey("evidence", row.item.id);
    const provenance: GraphProvenance =
      row.item.source === "analyst" || row.item.createdBy
        ? "analyst"
        : "provider";
    // evidence → case
    pushEdge({
      id: `derived:evidence_case:${row.item.id}`,
      sourceNodeId: eNode,
      targetNodeId: nodeKey("case", caseRow.id),
      edgeType: "belongs_to_case",
      confidence: row.item.confidence,
      provenance,
      source: row.item.source || "evidence_items",
      observedAtStart: iso(row.item.firstSeenAt ?? row.item.createdAt),
      observedAtEnd: iso(row.item.lastSeenAt),
      creatorId: row.item.createdBy,
      reason: null,
      stored: false,
      derivedFrom: "evidence_items",
    });
    if (!evidenceOnly && row.item.alertId) {
      pushEdge({
        id: `derived:evidence_alert:${row.item.id}`,
        sourceNodeId: eNode,
        targetNodeId: nodeKey("alert", row.item.alertId),
        edgeType: "related_to",
        confidence: row.item.confidence,
        provenance,
        source: row.item.source || "evidence_items",
        observedAtStart: iso(row.item.firstSeenAt ?? row.item.createdAt),
        observedAtEnd: iso(row.item.lastSeenAt),
        creatorId: row.item.createdBy,
        reason: null,
        stored: false,
        derivedFrom: "evidence_items.alert_id",
      });
    }
    if (!evidenceOnly && row.item.entityId) {
      // Find projected type from alertEntityRows or entities load
      const entityLink = alertEntityRows.find(
        (ae) => ae.entityId === row.item.entityId,
      );
      const gType = entityLink
        ? mapEntityTypeToGraphNodeType(entityLink.entityType)
        : "other";
      // Ensure entity node exists for evidence link even if not on an alert
      // (only if we already have it; do not invent nodes for unlinked entities)
      const targetId = nodeKey(gType, row.item.entityId);
      if (nodesByKey.has(targetId) || gType === "other") {
        if (!nodesByKey.has(targetId) && entityLink) {
          // already added above
        }
        pushEdge({
          id: `derived:evidence_entity:${row.item.id}`,
          sourceNodeId: eNode,
          targetNodeId: targetId,
          edgeType: "observed_on",
          confidence: row.item.confidence,
          provenance,
          source: row.item.source || "evidence_items",
          observedAtStart: iso(row.item.firstSeenAt ?? row.item.createdAt),
          observedAtEnd: iso(row.item.lastSeenAt),
          creatorId: row.item.createdBy,
          reason: null,
          stored: false,
          derivedFrom: "evidence_items.entity_id",
        });
      }
    }
  }

  // evidence_relationships
  for (const rel of evidenceRelRows) {
    if (
      !visibleEvidenceIds.has(rel.sourceEvidenceId) ||
      !visibleEvidenceIds.has(rel.targetEvidenceId)
    ) {
      continue;
    }
    const edgeType = rel.relationshipType as GraphEdgeType;
    if (!isGraphEdgeType(edgeType)) continue;
    pushEdge({
      id: `derived:evidence_rel:${rel.id}`,
      sourceNodeId: nodeKey("evidence", rel.sourceEvidenceId),
      targetNodeId: nodeKey("evidence", rel.targetEvidenceId),
      edgeType,
      confidence: null,
      provenance: rel.createdBy ? "analyst" : "provider",
      source: "evidence_relationships",
      observedAtStart: iso(rel.createdAt),
      observedAtEnd: null,
      creatorId: rel.createdBy,
      reason: rel.reason,
      stored: false,
      derivedFrom: "evidence_relationships",
    });
  }

  // ATT&CK mappings → maps_to_technique
  if (!evidenceOnly) {
    for (const m of mappingRows) {
      const techNode = nodeKey("technique", m.techniqueId);
      let sourceNodeId: string | null = null;
      if (m.entityType === "case" && m.entityId === caseId) {
        sourceNodeId = nodeKey("case", caseId);
      } else if (m.entityType === "alert") {
        sourceNodeId = nodeKey("alert", m.entityId);
      } else if (m.entityType === "evidence") {
        sourceNodeId = nodeKey("evidence", m.entityId);
      } else if (m.entityType === "observable" || m.entityType === "task") {
        // Observables/tasks are not investigation-graph nodes; skip rather than invent.
        sourceNodeId = null;
      } else {
        sourceNodeId = null;
      }
      // Try entity mapping when entityId is an entity
      if (!sourceNodeId) {
        const ent = alertEntityRows.find((ae) => ae.entityId === m.entityId);
        if (ent) {
          sourceNodeId = nodeKey(
            mapEntityTypeToGraphNodeType(ent.entityType),
            ent.entityId,
          );
        }
      }
      if (!sourceNodeId) continue;
      const provenance: GraphProvenance =
        m.source === "rule" || m.source?.startsWith("rule")
          ? "rule"
          : m.source === "provider" || m.source?.includes("provider")
            ? "provider"
            : "analyst";
      pushEdge({
        id: `derived:attack_mapping:${m.id}`,
        sourceNodeId,
        targetNodeId: techNode,
        edgeType: "maps_to_technique",
        confidence: m.confidence,
        provenance,
        source: m.source || "attack_technique_mappings",
        observedAtStart: iso(m.createdAt),
        observedAtEnd: null,
        creatorId: m.createdBy,
        reason: m.notes,
        stored: false,
        derivedFrom: "attack_technique_mappings",
      });
    }
  }

  // Stored explicit edges
  for (const se of storedEdges) {
    // Redact if either endpoint is restricted evidence
    if (
      se.sourceNodeType === "evidence" &&
      !visibleEvidenceIds.has(se.sourceNodeId)
    ) {
      continue;
    }
    if (
      se.targetNodeType === "evidence" &&
      !visibleEvidenceIds.has(se.targetNodeId)
    ) {
      continue;
    }
    // Ensure endpoint nodes exist for stored edges (may reference technique etc.)
    const sKey = nodeKey(se.sourceNodeType as GraphNodeType, se.sourceNodeId);
    const tKey = nodeKey(se.targetNodeType as GraphNodeType, se.targetNodeId);
    if (!nodesByKey.has(sKey) && passesNodeTypeFilter(se.sourceNodeType as GraphNodeType, allowedTypes)) {
      // Only materialise technique nodes if referenced; other missing nodes mean fail closed
      if (se.sourceNodeType === "technique") {
        const tech = techniqueById.get(se.sourceNodeId);
        addNode({
          id: sKey,
          type: "technique",
          refId: se.sourceNodeId,
          label: tech?.name
            ? `${se.sourceNodeId} — ${tech.name}`
            : se.sourceNodeId,
          meta: { techniqueId: se.sourceNodeId },
          sensitive: false,
          redacted: false,
        });
      }
    }
    if (!nodesByKey.has(tKey) && passesNodeTypeFilter(se.targetNodeType as GraphNodeType, allowedTypes)) {
      if (se.targetNodeType === "technique") {
        const tech = techniqueById.get(se.targetNodeId);
        addNode({
          id: tKey,
          type: "technique",
          refId: se.targetNodeId,
          label: tech?.name
            ? `${se.targetNodeId} — ${tech.name}`
            : se.targetNodeId,
          meta: { techniqueId: se.targetNodeId },
          sensitive: false,
          redacted: false,
        });
      }
    }
    pushEdge({
      id: se.id,
      sourceNodeId: sKey,
      targetNodeId: tKey,
      edgeType: se.edgeType as GraphEdgeType,
      confidence: se.confidence,
      provenance: se.provenance as GraphProvenance,
      source: se.source,
      observedAtStart: iso(se.observedAtStart),
      observedAtEnd: iso(se.observedAtEnd),
      creatorId: se.creatorId,
      reason: se.reason,
      stored: true,
      derivedFrom: null,
    });
  }

  // ── Attack story (sequenceIndex order; never claim causality from timestamps) ──
  const story: AttackStoryGraphEntry[] = storyRows.map((entry, index) => {
    let timingAmbiguous = false;
    let timingNote: string | null = null;
    if (!entry.occurredAt) {
      timingAmbiguous = true;
      timingNote =
        "No occurredAt; order is sequenceIndex only (not timestamp-derived).";
    } else {
      const prev = storyRows[index - 1];
      if (
        prev?.occurredAt &&
        entry.occurredAt.getTime() < prev.occurredAt.getTime()
      ) {
        timingAmbiguous = true;
        timingNote =
          "occurredAt is earlier than previous entry; sequenceIndex takes precedence.";
      }
    }
    const tech = entry.techniqueId
      ? techniqueById.get(entry.techniqueId)
      : null;
    return {
      id: entry.id,
      sequenceIndex: entry.sequenceIndex,
      title: entry.title,
      description: entry.description,
      provenance: entry.provenance as "analyst" | "provider",
      sourceRef: entry.sourceRef,
      occurredAt: iso(entry.occurredAt),
      techniqueId: entry.techniqueId,
      techniqueName: tech?.name ?? null,
      mappingId: entry.mappingId,
      timingAmbiguous,
      timingNote,
    };
  });

  // ── ATT&CK tactic lanes ───────────────────────────────────────────────
  const tacticLanes: TacticLane[] = [];
  if (!evidenceOnly) {
    const byTactic = new Map<
      string,
      Map<
        string,
        { techniqueName: string | null; mappingIds: string[]; nodeId: string }
      >
    >();
    for (const m of mappingRows) {
      const tech = techniqueById.get(m.techniqueId);
      const tactics =
        (tech?.tactics as Array<{ id?: string; name?: string } | string> | undefined) ??
        [];
      const tacticIds =
        tactics.length === 0
          ? ["unknown"]
          : tactics.map((t) =>
              typeof t === "string" ? t : (t.id ?? "unknown"),
            );
      for (const tacticId of tacticIds) {
        if (!byTactic.has(tacticId)) byTactic.set(tacticId, new Map());
        const bucket = byTactic.get(tacticId)!;
        const existing = bucket.get(m.techniqueId);
        if (existing) {
          existing.mappingIds.push(m.id);
        } else {
          bucket.set(m.techniqueId, {
            techniqueName: tech?.name ?? null,
            mappingIds: [m.id],
            nodeId: nodeKey("technique", m.techniqueId),
          });
        }
      }
    }
    const orderedTacticIds = [
      ...ATTACK_TACTICS.map((t) => t.id),
      ...[...byTactic.keys()].filter(
        (id) => !ATTACK_TACTICS.some((t) => t.id === id),
      ),
    ];
    for (const tacticId of orderedTacticIds) {
      const bucket = byTactic.get(tacticId);
      if (!bucket || bucket.size === 0) continue;
      const known = ATTACK_TACTICS.find((t) => t.id === tacticId);
      tacticLanes.push({
        tacticId,
        tacticName: known?.name ?? tacticId,
        techniques: [...bucket.entries()].map(([techniqueId, v]) => ({
          techniqueId,
          techniqueName: v.techniqueName,
          mappingIds: v.mappingIds,
          nodeId: v.nodeId,
        })),
      });
    }
  }

  // ── Progressive limits ────────────────────────────────────────────────
  let nodes = [...nodesByKey.values()];
  // Prefer case + alerts + evidence order for progressive loading
  const typePriority: Record<string, number> = {
    case: 0,
    alert: 1,
    evidence: 2,
    technique: 3,
  };
  nodes.sort((a, b) => {
    const pa = typePriority[a.type] ?? 10;
    const pb = typePriority[b.type] ?? 10;
    if (pa !== pb) return pa - pb;
    return a.id.localeCompare(b.id);
  });
  const nodesTruncated = nodes.length > nodeLimit;
  if (nodesTruncated) nodes = nodes.slice(0, nodeLimit);
  const keptNodeIds = new Set(nodes.map((n) => n.id));

  // Sort edges by observed time then id for stable progressive page
  edges.sort((a, b) => {
    const ta = a.observedAtStart ?? "";
    const tb = b.observedAtStart ?? "";
    if (ta !== tb) return ta < tb ? -1 : 1;
    return a.id.localeCompare(b.id);
  });
  let limitedEdges = edges.filter(
    (e) => keptNodeIds.has(e.sourceNodeId) && keptNodeIds.has(e.targetNodeId),
  );
  const edgesTruncated = limitedEdges.length > edgeLimit;
  if (edgesTruncated) limitedEdges = limitedEdges.slice(0, edgeLimit);

  // Drop orphan nodes that lost all edges only for non-case nodes when truncated?
  // Keep all limited nodes — progressive loading shows nodes first.

  const resultNodes =
    view === "story"
      ? nodes.filter((n) => n.type === "case" || n.type === "technique")
      : view === "tactic_lanes"
        ? nodes.filter((n) => n.type === "technique" || n.type === "case")
        : nodes;

  const resultEdges =
    view === "story" || view === "tactic_lanes"
      ? limitedEdges.filter((e) => e.edgeType === "maps_to_technique")
      : limitedEdges;

  return {
    caseId,
    view,
    nodes: resultNodes,
    edges: resultEdges,
    story: view === "graph" || view === "story" ? story : [],
    tacticLanes:
      view === "graph" || view === "tactic_lanes" ? tacticLanes : [],
    limits: {
      nodeLimit,
      edgeLimit,
      nodesTruncated,
      edgesTruncated,
    },
    counts: {
      nodes: resultNodes.length,
      edges: resultEdges.length,
      storyEntries: story.length,
    },
    filters: {
      nodeTypes: allowedTypes ? [...allowedTypes] : null,
      minConfidence,
      evidenceOnly,
    },
    generatedAt: new Date().toISOString(),
  };
}

export type GraphExportResult = {
  snapshot: CaseGraphResult;
  text: string;
};

/**
 * Static snapshot + textual relationship list with provenance.
 * Caller must authorize `export` on the case.
 */
export async function exportCaseGraphCore(opts: {
  organisationId: string;
  caseId: string;
  actor: AccessActor;
  permissions: Set<AccessPermission>;
  nodeTypes?: GraphNodeType[] | null;
  minConfidence?: number | null;
  view?: GraphViewMode;
}): Promise<GraphExportResult> {
  if (!hasPermission(opts.permissions, "export")) {
    throw new InvestigationGraphError("Case not found", 404);
  }
  // Export also needs view_metadata content; if missing, fail closed.
  if (!hasPermission(opts.permissions, "view_metadata")) {
    throw new InvestigationGraphError("Case not found", 404);
  }

  const snapshot = await buildCaseGraphCore({
    ...opts,
    nodeLimit: MAX_GRAPH_NODE_LIMIT,
    edgeLimit: MAX_GRAPH_EDGE_LIMIT,
  });

  const lines: string[] = [];
  lines.push(`# Investigation graph export`);
  lines.push(`Case: ${snapshot.caseId}`);
  lines.push(`Generated: ${snapshot.generatedAt}`);
  lines.push(`View: ${snapshot.view}`);
  lines.push("");
  lines.push("## Nodes");
  for (const n of snapshot.nodes) {
    const sens = n.sensitive ? " [sensitive]" : "";
    const red = n.redacted ? " [redacted]" : "";
    lines.push(`- (${n.type}) ${n.label}${sens}${red}  id=${n.id}`);
  }
  lines.push("");
  lines.push("## Relationships");
  for (const e of snapshot.edges) {
    const src = snapshot.nodes.find((n) => n.id === e.sourceNodeId);
    const tgt = snapshot.nodes.find((n) => n.id === e.targetNodeId);
    const conf =
      e.confidence === null ? "confidence=unknown" : `confidence=${e.confidence}`;
    const when = e.observedAtStart
      ? e.observedAtEnd
        ? ` observed=${e.observedAtStart}..${e.observedAtEnd}`
        : ` observed=${e.observedAtStart}`
      : "";
    const stored = e.stored ? "stored" : `derived:${e.derivedFrom ?? "unknown"}`;
    lines.push(
      `- ${src?.label ?? e.sourceNodeId} --[${e.edgeType}]--> ${tgt?.label ?? e.targetNodeId}  (${conf}, provenance=${e.provenance}, source=${e.source}, ${stored}${when})`,
    );
    if (e.reason) lines.push(`    reason: ${e.reason}`);
  }
  if (snapshot.story.length > 0) {
    lines.push("");
    lines.push("## Attack story (sequence order)");
    for (const s of snapshot.story) {
      const amb = s.timingAmbiguous ? " [timing ambiguous]" : "";
      lines.push(
        `- #${s.sequenceIndex} ${s.title}${amb}  provenance=${s.provenance}${s.occurredAt ? ` occurredAt=${s.occurredAt}` : ""}`,
      );
      if (s.timingNote) lines.push(`    note: ${s.timingNote}`);
    }
  }
  if (snapshot.tacticLanes.length > 0) {
    lines.push("");
    lines.push("## ATT&CK tactic lanes");
    for (const lane of snapshot.tacticLanes) {
      lines.push(`### ${lane.tacticName} (${lane.tacticId})`);
      for (const t of lane.techniques) {
        lines.push(
          `- ${t.techniqueId}${t.techniqueName ? ` — ${t.techniqueName}` : ""}`,
        );
      }
    }
  }
  lines.push("");

  return { snapshot, text: lines.join("\n") };
}

/** Pure helpers exported for unit tests without DB. */
export function filterEdgesByConfidence(
  edges: Array<{ confidence: number | null }>,
  minConfidence: number | null,
): Array<{ confidence: number | null }> {
  return edges.filter((e) => passesConfidence(e.confidence, minConfidence));
}

export function filterNodesByType<T extends { type: GraphNodeType }>(
  nodes: T[],
  allowed: GraphNodeType[] | null,
): T[] {
  if (!allowed || allowed.length === 0) return nodes;
  const set = new Set(allowed);
  return nodes.filter((n) => set.has(n.type));
}
