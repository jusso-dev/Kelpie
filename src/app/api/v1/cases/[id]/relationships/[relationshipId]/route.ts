import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { cases, users } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import { CaseRelationshipError, unlinkCaseCore } from "@/lib/case-relationships-core";

const deleteSchema = z.object({ reason: z.string().min(1) });

async function caseInOrg(caseId: string, organisationId: string) {
  const [c] = await db
    .select({ id: cases.id })
    .from(cases)
    .where(and(eq(cases.id, caseId), eq(cases.organisationId, organisationId)))
    .limit(1);
  return c ?? null;
}

export async function DELETE(
  req: Request,
  context: { params: Promise<{ id: string; relationshipId: string }> },
) {
  const auth = await authenticateApiTokenWithScope(req, "case_relationships:write");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id, relationshipId } = await context.params;
  if (!(await caseInOrg(id, auth.token.organisationId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = await req.json().catch(() => null);
  const parsed = deleteSchema.safeParse(body);
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
    await unlinkCaseCore(
      auth.token.organisationId,
      actor?.id ?? null,
      id,
      relationshipId,
      parsed.data.reason,
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof CaseRelationshipError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
