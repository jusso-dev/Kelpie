import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  InvestigationConsoleError,
  linkExecutionTargets,
  toPublicExecution,
} from "@/lib/investigation-console/core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  entityIds: z.array(z.string().min(1)).max(50).optional(),
  alertIds: z.array(z.string().min(1)).max(50).optional(),
});

/** POST /api/v1/investigation/executions/:id/links — link entities/alerts. */
export async function POST(req: Request, { params }: Params) {
  const auth = await authenticateApiTokenWithScope(
    req,
    "investigation:execute",
  );
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  if (
    (!parsed.data.entityIds || parsed.data.entityIds.length === 0) &&
    (!parsed.data.alertIds || parsed.data.alertIds.length === 0)
  ) {
    return NextResponse.json(
      { error: "Provide entityIds and/or alertIds" },
      { status: 400 },
    );
  }

  const { id } = await params;
  try {
    const execution = await linkExecutionTargets({
      organisationId: auth.token.organisationId,
      executionId: id,
      entityIds: parsed.data.entityIds,
      alertIds: parsed.data.alertIds,
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
