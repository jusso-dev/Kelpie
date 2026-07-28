import { NextResponse } from "next/server";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import { getTeamQueueHealthCore } from "@/lib/workload-core";

export async function GET(req: Request) {
  const auth = await authenticateApiTokenWithScope(req, "workload:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const teams = await getTeamQueueHealthCore(auth.token.organisationId);
  return NextResponse.json({ teams });
}
