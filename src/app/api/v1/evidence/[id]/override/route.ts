import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import { EvidenceError, overrideQuarantineCore } from "@/lib/evidence/core";

const overrideSchema = z.object({ reason: z.string().min(1) });

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiTokenWithScope(req, "evidence:override");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await context.params;
  const body = await req.json().catch(() => null);
  const parsed = overrideSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const [actor] = auth.token.createdBy
    ? await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, auth.token.createdBy))
        .limit(1)
    : [];
  if (!actor) {
    return NextResponse.json(
      { error: "This action requires a token created by a user" },
      { status: 400 },
    );
  }
  try {
    const evidence = await overrideQuarantineCore({
      evidenceId: id,
      organisationId: auth.token.organisationId,
      actorId: actor.id,
      reason: parsed.data.reason,
    });
    const { storageKey: _storageKey, ...safe } = evidence;
    return NextResponse.json({ evidence: safe });
  } catch (err) {
    if (err instanceof EvidenceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
