import { NextResponse } from "next/server";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import { resolveTokenActor } from "@/lib/access";
import {
  approveInvestigationExecution,
  assertExecutionCaseAccess,
  getInvestigationExecution,
  InvestigationConsoleError,
  toPublicExecution,
} from "@/lib/investigation-console/core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/investigation/executions/:id/approve
 * Dual-control gate for write-class investigation commands.
 */
export async function POST(req: Request, { params }: Params) {
  const auth = await authenticateApiTokenWithScope(
    req,
    "investigation:execute",
  );
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  if (!auth.token.createdBy) {
    return NextResponse.json(
      { error: "Token has no associated user for audit attribution" },
      { status: 403 },
    );
  }
  const { id } = await params;
  const existing = await getInvestigationExecution(
    auth.token.organisationId,
    id,
  );
  if (!existing) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const actor = await resolveTokenActor(auth.token);
  try {
    await assertExecutionCaseAccess(
      auth.token.organisationId,
      existing,
      actor,
      "edit",
    );
  } catch (err) {
    if (err instanceof InvestigationConsoleError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }

  try {
    const execution = await approveInvestigationExecution({
      organisationId: auth.token.organisationId,
      approverId: auth.token.createdBy,
      executionId: id,
      tokenScopes: auth.token.scopes,
    });
    return NextResponse.json(
      { execution: toPublicExecution(execution) },
      { headers: { "cache-control": "private, no-store" } },
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
