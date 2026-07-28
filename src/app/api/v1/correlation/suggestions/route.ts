import { NextResponse } from "next/server";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import { listSuggestionsCore } from "@/lib/correlation/evaluate-core";

export async function GET(req: Request) {
  const auth = await authenticateApiTokenWithScope(req, "correlation:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const url = new URL(req.url);
  const status = url.searchParams.get("status") as
    | "pending"
    | "accepted"
    | "rejected"
    | "expired"
    | "auto_applied"
    | null;
  const caseId = url.searchParams.get("caseId");
  const limit = url.searchParams.get("limit");
  const suggestions = await listSuggestionsCore({
    organisationId: auth.token.organisationId,
    status: status ?? "pending",
    caseId: caseId ?? undefined,
    limit: limit ? Number(limit) : undefined,
  });
  return NextResponse.json({ suggestions });
}
