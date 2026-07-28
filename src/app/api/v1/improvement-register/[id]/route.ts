import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  IMPROVEMENT_REGISTER_SEVERITIES,
  IMPROVEMENT_REGISTER_STATUSES,
  ImprovementRegisterError,
  getImprovementCore,
  serializeImprovement,
  updateImprovementCore,
} from "@/lib/improvement-register";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  title: z.string().trim().min(1).max(500).optional(),
  description: z.string().trim().max(20_000).nullable().optional(),
  evidence: z.record(z.string(), z.unknown()).nullable().optional(),
  sensitiveEvidence: z.record(z.string(), z.unknown()).nullable().optional(),
  severity: z.enum(IMPROVEMENT_REGISTER_SEVERITIES).optional(),
  residualRisk: z.string().trim().max(5_000).nullable().optional(),
  status: z
    .enum(
      IMPROVEMENT_REGISTER_STATUSES.filter(
        (s) => s !== "closed" && s !== "reopened",
      ) as [
        "open",
        "in_review",
        "accepted",
        "in_progress",
        "validated",
        "rejected",
        "deferred",
      ],
    )
    .optional(),
  ownerId: z.string().trim().min(1).max(100).nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
  linkedPlaybookId: z.string().trim().min(1).max(100).nullable().optional(),
});

export async function GET(req: Request, context: Params) {
  const auth = await authenticateApiTokenWithScope(req, "improvements:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await context.params;
  try {
    const improvement = await getImprovementCore(
      auth.token.organisationId,
      id,
      auth.token.createdBy,
    );
    if (!improvement) {
      return NextResponse.json({ error: "Improvement not found" }, { status: 404 });
    }
    return NextResponse.json(
      { improvement: serializeImprovement(improvement) },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (err) {
    if (err instanceof ImprovementRegisterError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}

export async function PATCH(req: Request, context: Params) {
  const auth = await authenticateApiTokenWithScope(req, "improvements:write");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await context.params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    );
  }
  try {
    const improvement = await updateImprovementCore(
      auth.token.organisationId,
      id,
      auth.token.createdBy,
      parsed.data,
    );
    return NextResponse.json(
      { improvement: serializeImprovement(improvement) },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (err) {
    if (err instanceof ImprovementRegisterError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
