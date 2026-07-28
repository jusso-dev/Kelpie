import { NextResponse } from "next/server";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import { getRuleMetricsCore } from "@/lib/correlation/rules-core";

export async function GET(req: Request) {
  const auth = await authenticateApiTokenWithScope(req, "correlation:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const url = new URL(req.url);
  const ruleKey = url.searchParams.get("ruleKey") ?? undefined;
  const metrics = await getRuleMetricsCore(
    auth.token.organisationId,
    ruleKey,
  );
  return NextResponse.json({ metrics });
}
