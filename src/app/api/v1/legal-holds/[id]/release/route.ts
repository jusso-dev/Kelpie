import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import { LegalHoldError, releaseLegalHoldCore } from "@/lib/evidence/legal-hold";

const releaseSchema = z.object({ releaseReason: z.string().min(1) });

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
  const parsed = releaseSchema.safeParse(body);
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
    const hold = await releaseLegalHoldCore({
      holdId: id,
      organisationId: auth.token.organisationId,
      actorId: actor.id,
      releaseReason: parsed.data.releaseReason,
    });
    return NextResponse.json({ hold });
  } catch (err) {
    if (err instanceof LegalHoldError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
