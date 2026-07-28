import { NextResponse } from "next/server";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  authorizeCase,
  listAccessHistory,
  resolveTokenActor,
} from "@/lib/access";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/v1/cases/:id/access/history
 * Append-only access history. Requires administer_access.
 */
export async function GET(req: Request, context: Params) {
  const auth = await authenticateApiTokenWithScope(req, "cases:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await context.params;
  const actor = await resolveTokenActor(auth.token);
  const gate = await authorizeCase(
    auth.token.organisationId,
    id,
    actor,
    "administer_access",
  );
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const limit = Math.min(
    Number(new URL(req.url).searchParams.get("limit") ?? 100),
    500,
  );
  const events = await listAccessHistory(auth.token.organisationId, id, {
    limit,
  });
  return NextResponse.json({ events });
}
