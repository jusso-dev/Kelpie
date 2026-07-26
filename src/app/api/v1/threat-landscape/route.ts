import { NextResponse } from "next/server";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import { getThreatLandscapeData } from "@/lib/threat-landscape";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await authenticateApiTokenWithScope(
    req,
    "threat_landscape:read",
  );
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const data = await getThreatLandscapeData();
  return NextResponse.json(data, {
    status: data.error ? 502 : 200,
    headers: { "cache-control": "private, no-store" },
  });
}
