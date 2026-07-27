import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import { CaseRelationshipError, scoreDraftCandidatesCore } from "@/lib/case-relationships-core";

const draftSchema = z.object({
  title: z.string().min(1),
  summary: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export async function POST(req: Request) {
  const auth = await authenticateApiTokenWithScope(req, "case_relationships:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const body = await req.json().catch(() => null);
  const parsed = draftSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  try {
    const suggestions = await scoreDraftCandidatesCore(
      auth.token.organisationId,
      parsed.data,
    );
    return NextResponse.json({ suggestions });
  } catch (err) {
    if (err instanceof CaseRelationshipError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
