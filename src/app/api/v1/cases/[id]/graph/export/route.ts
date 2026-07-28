import { NextResponse } from "next/server";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import { authorizeCase, resolveTokenActor } from "@/lib/access";
import {
  InvestigationGraphError,
  exportCaseGraphCore,
  isGraphNodeType,
  type GraphNodeType,
  type GraphViewMode,
} from "@/lib/investigations/graph-core";

type Params = { params: Promise<{ id: string }> };

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
 * GET /api/v1/cases/{id}/graph/export
 * Requires compartment `export`. Returns JSON snapshot + textual relationship list.
 * Query: format=json|text (default json), nodeTypes, minConfidence, view
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
    "export",
  );
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  const { searchParams } = new URL(req.url);
  const format = (searchParams.get("format") ?? "json").toLowerCase();

  try {
    const nodeTypes = parseNodeTypes(searchParams.get("nodeTypes"));
    const minRaw = searchParams.get("minConfidence");
    const minConfidence =
      minRaw === null || minRaw === "" ? null : Number(minRaw);
    if (minConfidence !== null && !Number.isFinite(minConfidence)) {
      throw new InvestigationGraphError("minConfidence must be a number");
    }
    const view = parseView(searchParams.get("view"));

    const exported = await exportCaseGraphCore({
      organisationId: auth.token.organisationId,
      caseId: id,
      actor,
      permissions: gate.permissions,
      nodeTypes,
      minConfidence,
      view,
    });

    if (format === "text" || format === "txt") {
      return new NextResponse(exported.text, {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Content-Disposition": `attachment; filename="case-${id}-graph.txt"`,
        },
      });
    }

    return NextResponse.json({
      snapshot: exported.snapshot,
      text: exported.text,
    });
  } catch (err) {
    if (err instanceof InvestigationGraphError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
