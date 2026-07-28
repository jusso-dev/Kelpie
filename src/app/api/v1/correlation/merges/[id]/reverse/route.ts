import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import { reverseMergeCore } from "@/lib/correlation/membership-core";
import { correlationErrorResponse } from "@/lib/correlation/http";

const schema = z.object({
  reason: z.string().min(1),
  expectedVersions: z.record(z.string(), z.number()).optional(),
});

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiTokenWithScope(req, "correlation:write");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await context.params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
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
  try {
    const result = await reverseMergeCore({
      organisationId: auth.token.organisationId,
      actorId: actor?.id ?? null,
      mergeId: id,
      ...parsed.data,
    });
    return NextResponse.json(result);
  } catch (err) {
    const res = correlationErrorResponse(err);
    if (res) return res;
    throw err;
  }
}
