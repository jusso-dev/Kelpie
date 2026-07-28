import { NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import { authorizeCase, resolveTokenActor } from "@/lib/access";
import {
  InvestigationGraphError,
  removeGraphEdgeCore,
} from "@/lib/investigations/graph-core";

type Params = { params: Promise<{ id: string; edgeId: string }> };

/**
 * DELETE /api/v1/cases/{id}/graph/edges/{edgeId}
 * Removes a stored (non-derived) investigation graph edge.
 */
export async function DELETE(req: Request, { params }: Params) {
  const auth = await authenticateApiTokenWithScope(req, "cases:write");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id, edgeId } = await params;
  const actor = await resolveTokenActor(auth.token);
  const gate = await authorizeCase(
    auth.token.organisationId,
    id,
    actor,
    "edit",
  );
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  const [user] = auth.token.createdBy
    ? await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, auth.token.createdBy))
        .limit(1)
    : [];

  try {
    await removeGraphEdgeCore(
      auth.token.organisationId,
      user?.id ?? auth.token.createdBy,
      id,
      edgeId,
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof InvestigationGraphError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
