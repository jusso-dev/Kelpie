import { NextResponse } from "next/server";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  authorizeCase,
  resolveTokenActor,
} from "@/lib/access";
import {
  getInvestigationExecution,
  toPublicExecution,
} from "@/lib/investigation-console/core";
import { loadFullResultPayload } from "@/lib/investigation-console/result-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/** GET /api/v1/investigation/executions/:id */
export async function GET(req: Request, { params }: Params) {
  const auth = await authenticateApiTokenWithScope(req, "investigation:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await params;
  const row = await getInvestigationExecution(auth.token.organisationId, id);
  if (!row) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  if (row.caseId) {
    const actor = await resolveTokenActor(auth.token);
    const gate = await authorizeCase(
      auth.token.organisationId,
      row.caseId,
      actor,
      "view_metadata",
    );
    if (!gate.ok) {
      return NextResponse.json({ error: gate.error }, { status: gate.status });
    }
  }

  const includeFull =
    new URL(req.url).searchParams.get("includeResult") === "1";
  const publicRow = toPublicExecution(row);
  if (includeFull) {
    const fullResult = await loadFullResultPayload({
      resultSummary: row.resultSummary,
      resultStorageKey: row.resultStorageKey,
    });
    return NextResponse.json(
      { execution: { ...publicRow, fullResult } },
      { headers: { "cache-control": "private, no-store" } },
    );
  }
  return NextResponse.json(
    { execution: publicRow },
    { headers: { "cache-control": "private, no-store" } },
  );
}
