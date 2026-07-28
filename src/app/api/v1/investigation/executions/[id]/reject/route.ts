import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  InvestigationConsoleError,
  rejectInvestigationExecution,
  toPublicExecution,
} from "@/lib/investigation-console/core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  reason: z.string().max(500).optional(),
});

/** POST /api/v1/investigation/executions/:id/reject */
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
  try {
    const execution = await rejectInvestigationExecution({
      organisationId: auth.token.organisationId,
      actorId: auth.token.createdBy,
      executionId: id,
      reason: parsed.data.reason,
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
