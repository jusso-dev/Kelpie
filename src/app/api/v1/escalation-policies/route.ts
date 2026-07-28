import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  EscalationError,
  ESCALATION_TRIGGER_TYPES,
  createPolicyCore,
  listPoliciesCore,
} from "@/lib/escalation-core";

const createSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  triggerType: z.enum(ESCALATION_TRIGGER_TYPES),
  triggerConfig: z.record(z.string(), z.unknown()),
  actions: z.array(z.record(z.string(), z.unknown())),
});

export async function GET(req: Request) {
  const auth = await authenticateApiTokenWithScope(req, "escalation_policies:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { searchParams } = new URL(req.url);
  const includeDisabled = searchParams.get("include_disabled") === "true";
  const policies = await listPoliciesCore(auth.token.organisationId, {
    includeDisabled,
  });
  return NextResponse.json({ policies });
}

export async function POST(req: Request) {
  const auth = await authenticateApiTokenWithScope(req, "escalation_policies:write");
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
  const [actor] = auth.token.createdBy
    ? await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, auth.token.createdBy))
        .limit(1)
    : [];
  try {
    const policy = await createPolicyCore(
      auth.token.organisationId,
      actor?.id ?? null,
      parsed.data,
    );
    return NextResponse.json({ policy }, { status: 201 });
  } catch (err) {
    if (err instanceof EscalationError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
