import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  IMPROVEMENT_REGISTER_TYPES,
  ImprovementRegisterError,
  suggestSimilarImprovementsCore,
} from "@/lib/improvement-register";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  type: z.enum(IMPROVEMENT_REGISTER_TYPES).optional(),
  title: z.string().trim().min(1).max(500),
  description: z.string().trim().max(20_000).nullable().optional(),
  limit: z.number().int().min(1).max(20).optional(),
});

/**
 * Similarity suggestions before create. Explains matching fields; never
 * auto-merges. Accepts POST body so long titles/descriptions fit.
 */
export async function POST(req: Request) {
  const auth = await authenticateApiTokenWithScope(req, "improvements:read");
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
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    );
  }
  try {
    const suggestions = await suggestSimilarImprovementsCore(
      auth.token.organisationId,
      auth.token.createdBy,
      parsed.data,
    );
    return NextResponse.json(
      {
        suggestions: suggestions.map((s) => ({
          score: Math.round(s.score * 1000) / 1000,
          matchedFields: s.matchedFields,
          improvement: {
            id: s.improvement.id,
            type: s.improvement.type,
            title: s.improvement.title,
            description: s.improvement.description,
            status: s.improvement.status,
            severity: s.improvement.severity,
            recurrenceCount: s.improvement.recurrenceCount,
          },
        })),
        autoMerge: false,
      },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (err) {
    if (err instanceof ImprovementRegisterError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
