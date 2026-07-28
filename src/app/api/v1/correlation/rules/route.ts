import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  createCorrelationRuleCore,
  listCorrelationRulesCore,
} from "@/lib/correlation/rules-core";
import { correlationErrorResponse } from "@/lib/correlation/http";

const createSchema = z.object({
  ruleKey: z.string().min(1).max(64),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  scoreThreshold: z.number().min(0).max(100).optional(),
  dryRun: z.boolean().optional(),
  activate: z.boolean().optional(),
});

async function actorId(tokenCreatedBy: string | null): Promise<string | null> {
  if (!tokenCreatedBy) return null;
  const [actor] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, tokenCreatedBy))
    .limit(1);
  return actor?.id ?? null;
}

export async function GET(req: Request) {
  const auth = await authenticateApiTokenWithScope(req, "correlation:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const url = new URL(req.url);
  const includeSuperseded = url.searchParams.get("includeSuperseded") === "true";
  const rules = await listCorrelationRulesCore(auth.token.organisationId, {
    includeSuperseded,
  });
  return NextResponse.json({ rules });
}

export async function POST(req: Request) {
  const auth = await authenticateApiTokenWithScope(req, "correlation:write");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  try {
    const rule = await createCorrelationRuleCore({
      organisationId: auth.token.organisationId,
      actorId: await actorId(auth.token.createdBy),
      input: {
        ...parsed.data,
        config: parsed.data.config as never,
      },
    });
    return NextResponse.json({ rule }, { status: 201 });
  } catch (err) {
    const res = correlationErrorResponse(err);
    if (res) return res;
    throw err;
  }
}
