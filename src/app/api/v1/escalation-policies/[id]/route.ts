import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  EscalationError,
  EscalationVersionConflictError,
  disablePolicyCore,
  enablePolicyCore,
  getPolicyCore,
  updatePolicyCore,
} from "@/lib/escalation-core";

const patchSchema = z.object({
  version: z.number().int(),
  action: z.enum(["disable", "enable"]).optional(),
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  triggerConfig: z.record(z.string(), z.unknown()).optional(),
  actions: z.array(z.record(z.string(), z.unknown())).optional(),
});

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiTokenWithScope(req, "escalation_policies:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await context.params;
  const policy = await getPolicyCore(auth.token.organisationId, id);
  if (!policy) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ policy });
}

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiTokenWithScope(req, "escalation_policies:write");
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
  const actorId = actor?.id ?? null;
  const { version, action, ...patch } = parsed.data;

  try {
    let policy;
    if (action === "disable") {
      policy = await disablePolicyCore(auth.token.organisationId, actorId, id, version);
    } else if (action === "enable") {
      policy = await enablePolicyCore(auth.token.organisationId, actorId, id, version);
    } else {
      policy = await updatePolicyCore(
        auth.token.organisationId,
        actorId,
        id,
        patch,
        version,
      );
    }
    return NextResponse.json({ policy });
  } catch (err) {
    if (err instanceof EscalationVersionConflictError) {
      return NextResponse.json(
        { error: "version_conflict", current: err.current },
        { status: 409 },
      );
    }
    if (err instanceof EscalationError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
