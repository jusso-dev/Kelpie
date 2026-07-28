import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import { authorizeCase, resolveTokenActor } from "@/lib/access";
import {
  GRAPH_EDGE_TYPES,
  GRAPH_NODE_TYPES,
  GRAPH_PROVENANCES,
  InvestigationGraphError,
  buildCaseGraphCore,
  createGraphEdgeCore,
  isGraphNodeType,
  type GraphNodeType,
  type GraphViewMode,
} from "@/lib/investigations/graph-core";

type Params = { params: Promise<{ id: string }> };

const createEdgeSchema = z.object({
  sourceNodeType: z.enum(GRAPH_NODE_TYPES),
  sourceNodeId: z.string().min(1).max(128),
  targetNodeType: z.enum(GRAPH_NODE_TYPES),
  targetNodeId: z.string().min(1).max(128),
  edgeType: z.enum(GRAPH_EDGE_TYPES),
  confidence: z.number().min(0).max(100).nullable().optional(),
  provenance: z.enum(GRAPH_PROVENANCES),
  source: z.string().trim().min(1).max(256),
  observedAtStart: z.string().datetime().nullable().optional(),
  observedAtEnd: z.string().datetime().nullable().optional(),
  ruleId: z.string().trim().max(128).nullable().optional(),
  ruleVersion: z.string().trim().max(64).nullable().optional(),
  reason: z.string().trim().max(2000).nullable().optional(),
});

function parseNodeTypes(raw: string | null): GraphNodeType[] | null {
  if (!raw || !raw.trim()) return null;
  const parts = raw
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  const out: GraphNodeType[] = [];
  for (const p of parts) {
    if (!isGraphNodeType(p)) {
      throw new InvestigationGraphError(`Unknown node type filter: ${p}`);
    }
    out.push(p);
  }
  return out.length ? out : null;
}

function parseView(raw: string | null): GraphViewMode {
  if (!raw || raw === "graph") return "graph";
  if (raw === "story" || raw === "tactic_lanes" || raw === "evidence") {
    return raw;
  }
  throw new InvestigationGraphError(
    "view must be one of graph, story, tactic_lanes, evidence",
  );
}

/**
 * GET /api/v1/cases/{id}/graph
 * Query: nodeTypes, minConfidence, view, nodeLimit, edgeLimit
 */
export async function GET(req: Request, { params }: Params) {
  const auth = await authenticateApiTokenWithScope(req, "cases:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await params;
  const actor = await resolveTokenActor(auth.token);
  const gate = await authorizeCase(
    auth.token.organisationId,
    id,
    actor,
    "view_metadata",
  );
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  const { searchParams } = new URL(req.url);
  try {
    const nodeTypes = parseNodeTypes(searchParams.get("nodeTypes"));
    const minRaw = searchParams.get("minConfidence");
    const minConfidence =
      minRaw === null || minRaw === ""
        ? null
        : Number(minRaw);
    if (minConfidence !== null && !Number.isFinite(minConfidence)) {
      throw new InvestigationGraphError("minConfidence must be a number");
    }
    const view = parseView(searchParams.get("view"));
    const nodeLimit = Number(searchParams.get("nodeLimit") ?? "");
    const edgeLimit = Number(searchParams.get("edgeLimit") ?? "");

    const graph = await buildCaseGraphCore({
      organisationId: auth.token.organisationId,
      caseId: id,
      actor,
      permissions: gate.permissions,
      nodeTypes,
      minConfidence,
      view,
      nodeLimit: Number.isFinite(nodeLimit) ? nodeLimit : null,
      edgeLimit: Number.isFinite(edgeLimit) ? edgeLimit : null,
    });
    return NextResponse.json(graph);
  } catch (err) {
    if (err instanceof InvestigationGraphError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}

/**
 * POST /api/v1/cases/{id}/graph
 * Create an explicit provenanced investigation graph edge.
 */
export async function POST(req: Request, { params }: Params) {
  const auth = await authenticateApiTokenWithScope(req, "cases:write");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await params;
  const actor = await resolveTokenActor(auth.token);
  const gate = await authorizeCase(
    auth.token.organisationId,
    id,
    actor,
    "edit",
  );
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  const body = await req.json().catch(() => null);
  const parsed = createEdgeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const [user] = auth.token.createdBy
    ? await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, auth.token.createdBy))
        .limit(1)
    : [];

  try {
    const edge = await createGraphEdgeCore(
      auth.token.organisationId,
      user?.id ?? auth.token.createdBy,
      id,
      parsed.data,
      { actor, permissions: gate.permissions },
    );
    return NextResponse.json({ edge }, { status: 201 });
  } catch (err) {
    if (err instanceof InvestigationGraphError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
