import { NextResponse } from "next/server";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import { reviewReportingSummaryCore } from "@/lib/post-incident-review";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await authenticateApiTokenWithScope(req, "reviews:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const summary = await reviewReportingSummaryCore(
    auth.token.organisationId,
    auth.token.createdBy,
  );
  return NextResponse.json(
    { summary },
    { headers: { "cache-control": "private, no-store" } },
  );
}
