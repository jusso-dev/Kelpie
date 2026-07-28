import { NextResponse } from "next/server";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import { searchTechniques } from "@/lib/attack/catalog-core";

export async function GET(req: Request) {
  const auth = await authenticateApiTokenWithScope(req, "attack:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const url = new URL(req.url);
  const query = url.searchParams.get("q") ?? undefined;
  const tactic = url.searchParams.get("tactic") ?? undefined;
  const includeDeprecated = url.searchParams.get("includeDeprecated") === "true";
  const limit = Number(url.searchParams.get("limit") ?? 50);
  const techniques = await searchTechniques({ query, tactic, includeDeprecated, limit });
  return NextResponse.json({ techniques });
}
