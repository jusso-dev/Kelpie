import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  IMPROVEMENT_REGISTER_SEVERITIES,
  IMPROVEMENT_REGISTER_TYPES,
  ImprovementRegisterError,
  createFromProposalCore,
  serializeImprovement,
} from "@/lib/improvement-register";

export const dynamic = "force-dynamic";

const schema = z.object({
  proposalId: z.string().trim().min(1).max(100),
  type: z.enum(IMPROVEMENT_REGISTER_TYPES).optional(),
  title: z.string().trim().min(1).max(500).optional(),
  description: z.string().trim().max(20_000).nullable().optional(),
  severity: z.enum(IMPROVEMENT_REGISTER_SEVERITIES).optional(),
  ownerId: z.string().trim().min(1).max(100).nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
});

/**
 * Promote a post-incident review improvement proposal (#64) into the durable
 * register. Immutable source links are stored; the proposal is accepted but
 * not deleted. Idempotent on proposalId.
 */
export async function POST(req: Request) {
  const auth = await authenticateApiTokenWithScope(req, "improvements:write");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    );
  }
  const { proposalId, ...overrides } = parsed.data;
  try {
    const improvement = await createFromProposalCore(
      auth.token.organisationId,
      auth.token.createdBy,
      proposalId,
      overrides,
    );
    return NextResponse.json(
      { improvement: serializeImprovement(improvement) },
      { status: 201, headers: { "cache-control": "private, no-store" } },
    );
  } catch (err) {
    if (err instanceof ImprovementRegisterError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
