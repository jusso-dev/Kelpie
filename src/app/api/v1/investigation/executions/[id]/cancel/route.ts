import { NextResponse } from "next/server";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  cancelInvestigationExecution,
  InvestigationConsoleError,
  toPublicExecution,
} from "@/lib/investigation-console/core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/** POST /api/v1/investigation/executions/:id/cancel */
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
  try {
    const result = await cancelInvestigationExecution({
      organisationId: auth.token.organisationId,
      actorId: auth.token.createdBy,
      executionId: id,
    });
    return NextResponse.json(
      {
        execution: toPublicExecution(result.execution),
        bestEffort: result.bestEffort,
      },
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
