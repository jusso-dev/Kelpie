import { NextResponse } from "next/server";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import { AlertError, listEntitiesForCaseCore } from "@/lib/investigations/alerts-core";

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiTokenWithScope(req, "alerts:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await context.params;
  const { searchParams } = new URL(req.url);
  const limitParam = Number(searchParams.get("limit") ?? "");
  try {
    const { items, nextCursor } = await listEntitiesForCaseCore(
      auth.token.organisationId,
      id,
      {
        limit: Number.isFinite(limitParam) ? limitParam : null,
        cursor: searchParams.get("cursor"),
      },
    );
    return NextResponse.json({ entities: items, nextCursor });
  } catch (err) {
    if (err instanceof AlertError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
