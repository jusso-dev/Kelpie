import { NextResponse } from "next/server";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import { auditFiltersFromSource } from "@/lib/audit/filters";
import { searchAuditEvents } from "@/lib/audit/search";

export async function GET(req: Request) {
  const auth = await authenticateApiTokenWithScope(req, "audit:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { searchParams } = new URL(req.url);
  const filters = auditFiltersFromSource(searchParams);
  const limit = Number(searchParams.get("limit") ?? "");
  const cursor = searchParams.get("cursor");
  const { events, nextCursor } = await searchAuditEvents(auth.token.organisationId, filters, {
    limit: Number.isFinite(limit) ? limit : null,
    cursor,
  });
  return NextResponse.json({ events, nextCursor });
}
