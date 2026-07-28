import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  ImprovementRegisterError,
  reopenImprovementCore,
  serializeImprovement,
} from "@/lib/improvement-register";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const reopenSchema = z.object({
  reason: z.string().trim().max(5_000).nullable().optional(),
});

export async function POST(req: Request, context: Params) {
  const auth = await authenticateApiTokenWithScope(req, "improvements:write");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await context.params;
  let body: unknown = {};
  try {
    const text = await req.text();
    if (text.trim()) body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = reopenSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    );
  }
  try {
    const improvement = await reopenImprovementCore(
      auth.token.organisationId,
      id,
      auth.token.createdBy,
      parsed.data.reason,
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
