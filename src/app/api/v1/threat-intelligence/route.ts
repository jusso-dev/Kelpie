import { NextResponse } from "next/server";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import { queryThreatIntelligence } from "@/lib/machine-data";

export const dynamic = "force-dynamic";

function positiveInteger(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export async function GET(req: Request) {
  const auth = await authenticateApiTokenWithScope(
    req,
    "threat_intelligence:read",
  );
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const params = new URL(req.url).searchParams;
  const data = await queryThreatIntelligence(auth.token.organisationId, {
    value: params.get("value")?.trim() || undefined,
    exact: params.get("exact") === "true",
    type: params.get("type")?.trim() || undefined,
    feedId: params.get("feedId")?.trim() || undefined,
    tag: params.get("tag")?.trim() || undefined,
    limit: positiveInteger(params.get("limit")),
  });
  return NextResponse.json(data, {
    headers: { "cache-control": "private, no-store" },
  });
}
