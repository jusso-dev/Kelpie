import { NextResponse } from "next/server";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import { queryCyberBriefing } from "@/lib/machine-data";

export const dynamic = "force-dynamic";

function positiveInteger(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export async function GET(req: Request) {
  const auth = await authenticateApiTokenWithScope(req, "briefing:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const params = new URL(req.url).searchParams;
  const rawSort = params.get("sort");
  const sort =
    rawSort === "oldest" || rawSort === "source" ? rawSort : "newest";
  const data = await queryCyberBriefing(auth.token.organisationId, {
    query: params.get("q")?.trim().slice(0, 120) || undefined,
    source: params.get("source")?.trim() || undefined,
    vendor: params.get("vendor")?.trim() || undefined,
    sort,
    page: positiveInteger(params.get("page")),
    pageSize: positiveInteger(params.get("pageSize")),
  });
  return NextResponse.json(data, {
    headers: { "cache-control": "private, no-store" },
  });
}
