import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  IMPROVEMENT_VALIDATION_METHODS,
  ImprovementRegisterError,
  closeImprovementCore,
  serializeImprovement,
} from "@/lib/improvement-register";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const closeSchema = z.object({
  validationMethod: z.enum(IMPROVEMENT_VALIDATION_METHODS),
  validationEvidence: z.string().trim().min(1).max(10_000),
});

export async function POST(req: Request, context: Params) {
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
  const parsed = closeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    );
  }
  try {
    const improvement = await closeImprovementCore(
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
