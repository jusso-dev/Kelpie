import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import { CaseOwnershipError, assignCaseQueueCore } from "@/lib/case-ownership-core";
import { CaseVersionConflictError } from "@/lib/cases-core";

const patchSchema = z.object({
  queueId: z.string().min(1).nullable(),
  version: z.number().int().optional(),
});

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  // Queue (re-)assignment is an ownership action, so it reuses the
  // watchers:write scope rather than a bespoke one.
  const auth = await authenticateApiTokenWithScope(req, "watchers:write");
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
    const updated = await assignCaseQueueCore(
      auth.token.organisationId,
      actor?.id ?? null,
      id,
      parsed.data.queueId,
      parsed.data.version,
    );
    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof CaseVersionConflictError) {
      return NextResponse.json(
        { error: "version_conflict", current: err.current },
        { status: 409 },
      );
    }
    if (err instanceof CaseOwnershipError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
