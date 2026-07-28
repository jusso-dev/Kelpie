import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import { evaluateCorrelationCore } from "@/lib/correlation/evaluate-core";
import { correlationErrorResponse } from "@/lib/correlation/http";

const schema = z.object({
  ruleId: z.string().optional(),
  alertIds: z.array(z.string()).optional(),
  forceDryRun: z.boolean().optional(),
});

export async function POST(req: Request) {
  const auth = await authenticateApiTokenWithScope(req, "correlation:write");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body ?? {});
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
    const results = await evaluateCorrelationCore({
      organisationId: auth.token.organisationId,
      actorId: actor?.id ?? null,
      ...parsed.data,
    });
    return NextResponse.json({ results });
  } catch (err) {
    const res = correlationErrorResponse(err);
    if (res) return res;
    throw err;
  }
}
