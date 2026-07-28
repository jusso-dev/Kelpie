import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { organisations, users } from "@/db/schema";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  correlationPolicyPatch,
  parseCorrelationPolicy,
} from "@/lib/correlation/policy";
import { recordAuditEvent } from "@/lib/audit/events";

const patchSchema = z.object({
  autoMergeEnabled: z.boolean().optional(),
  autoAcceptThreshold: z.number().min(0).max(100).nullable().optional(),
  mergeSafetyWindowHours: z.number().min(1).max(24 * 30).optional(),
});

export async function GET(req: Request) {
  const auth = await authenticateApiTokenWithScope(req, "correlation:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const [org] = await db
    .select({ settings: organisations.settings })
    .from(organisations)
    .where(eq(organisations.id, auth.token.organisationId))
    .limit(1);
  return NextResponse.json({
    policy: parseCorrelationPolicy(org?.settings),
  });
}

export async function PATCH(req: Request) {
  // Policy changes are write-scoped; production admins should issue tokens
  // carefully. Session UI still requires admin via server actions.
  const auth = await authenticateApiTokenWithScope(req, "correlation:write");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const [org] = await db
    .select({ settings: organisations.settings })
    .from(organisations)
    .where(eq(organisations.id, auth.token.organisationId))
    .limit(1);
  if (!org) {
    return NextResponse.json({ error: "Organisation not found" }, { status: 404 });
  }
  const current =
    org.settings && typeof org.settings === "object"
      ? (org.settings as Record<string, unknown>)
      : {};
  const next = correlationPolicyPatch(current, parsed.data);
  await db
    .update(organisations)
    .set({ settings: next })
    .where(eq(organisations.id, auth.token.organisationId));

  const [actor] = auth.token.createdBy
    ? await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, auth.token.createdBy))
        .limit(1)
    : [];

  await recordAuditEvent({
    organisationId: auth.token.organisationId,
    actorId: actor?.id ?? null,
    actorType: actor?.id ? "user" : "system",
    action: "correlation.policy_updated",
    targetType: "organisation",
    targetId: auth.token.organisationId,
    metadata: { policy: next.correlation },
  });

  return NextResponse.json({
    policy: parseCorrelationPolicy(next),
  });
}
