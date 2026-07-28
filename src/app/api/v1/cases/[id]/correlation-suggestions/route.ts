import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { cases } from "@/db/schema";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import { listSuggestionsCore } from "@/lib/correlation/evaluate-core";

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiTokenWithScope(req, "correlation:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await context.params;
  const [c] = await db
    .select({ id: cases.id })
    .from(cases)
    .where(
      and(eq(cases.id, id), eq(cases.organisationId, auth.token.organisationId)),
    )
    .limit(1);
  if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const url = new URL(req.url);
  const status = (url.searchParams.get("status") as
    | "pending"
    | "accepted"
    | "rejected"
    | null) ?? "pending";
  const suggestions = await listSuggestionsCore({
    organisationId: auth.token.organisationId,
    caseId: id,
    status,
  });
  return NextResponse.json({ suggestions });
}
