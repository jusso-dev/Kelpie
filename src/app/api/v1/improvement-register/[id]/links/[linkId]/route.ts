import { NextResponse } from "next/server";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  ImprovementRegisterError,
  serializeImprovement,
  unlinkImprovementCore,
} from "@/lib/improvement-register";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; linkId: string }> };

export async function DELETE(req: Request, context: Params) {
  const auth = await authenticateApiTokenWithScope(req, "improvements:write");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id, linkId } = await context.params;
  try {
    const improvement = await unlinkImprovementCore(
      auth.token.organisationId,
      id,
      auth.token.createdBy,
      linkId,
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
