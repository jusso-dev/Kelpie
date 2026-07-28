import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  getCorrelationRuleCore,
  updateCorrelationRuleCore,
} from "@/lib/correlation/rules-core";
import { correlationErrorResponse } from "@/lib/correlation/http";

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  scoreThreshold: z.number().min(0).max(100).optional(),
  dryRun: z.boolean().optional(),
  status: z.enum(["draft", "active", "disabled"]).optional(),
});

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiTokenWithScope(req, "correlation:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await context.params;
  const rule = await getCorrelationRuleCore(auth.token.organisationId, id);
  if (!rule) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ rule });
}

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiTokenWithScope(req, "correlation:write");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await context.params;
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
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
    const rule = await updateCorrelationRuleCore({
      organisationId: auth.token.organisationId,
      actorId: actor?.id ?? null,
      ruleId: id,
      input: {
        ...parsed.data,
        config: parsed.data.config as never,
      },
    });
    return NextResponse.json({ rule });
  } catch (err) {
    const res = correlationErrorResponse(err);
    if (res) return res;
    throw err;
  }
}
