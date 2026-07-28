import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  authorizeCase,
  resolveTokenActor,
} from "@/lib/access";
import { tokenHasScope } from "@/lib/scopes";
import {
  getInvestigationExecution,
  InvestigationConsoleError,
  saveExecutionAsEvidence,
} from "@/lib/investigation-console/core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  caseId: z.string().min(1).optional(),
});

/** POST /api/v1/investigation/executions/:id/save-evidence */
export async function POST(req: Request, { params }: Params) {
  const auth = await authenticateApiTokenWithScope(
    req,
    "investigation:execute",
  );
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  if (!tokenHasScope(auth.token.scopes, "evidence:write")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const parsed = bodySchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const { id } = await params;
  const existing = await getInvestigationExecution(
    auth.token.organisationId,
    id,
  );
  if (!existing) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const caseId = parsed.data.caseId ?? existing.caseId;
  if (!caseId) {
    return NextResponse.json(
      { error: "A case id is required to save evidence" },
      { status: 400 },
    );
  }

  const actor = await resolveTokenActor(auth.token);
  const gate = await authorizeCase(
    auth.token.organisationId,
    caseId,
    actor,
    "edit",
  );
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  try {
    const result = await saveExecutionAsEvidence({
      organisationId: auth.token.organisationId,
      actorId: auth.token.createdBy,
      executionId: id,
      caseId,
    });
    return NextResponse.json(
      { evidenceId: result.evidenceId, sha256: result.sha256 },
      {
        status: 201,
        headers: { "cache-control": "private, no-store" },
      },
    );
  } catch (err) {
    if (err instanceof InvestigationConsoleError) {
      return NextResponse.json(
        { error: err.message },
        { status: err.status },
      );
    }
    throw err;
  }
}
