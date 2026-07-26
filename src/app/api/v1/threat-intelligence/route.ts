import { NextResponse } from "next/server";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import { queryThreatIntelligence } from "@/lib/machine-data";

export const dynamic = "force-dynamic";

function positiveInteger(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function boundedInteger(
  value: string | null,
  minimum: number,
  maximum: number,
): number | undefined {
  if (value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : undefined;
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
    minConfidence: boundedInteger(params.get("minConfidence"), 0, 100),
    limit: positiveInteger(params.get("limit")),
    offset: boundedInteger(params.get("offset"), 0, 1_000_000),
  });
  return NextResponse.json(data, {
    headers: { "cache-control": "private, no-store" },
  });
}
