import { NextResponse } from "next/server";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import { getPolicyCore, listRunsCore } from "@/lib/escalation-core";

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiTokenWithScope(req, "escalation_policies:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await context.params;
  const policy = await getPolicyCore(auth.token.organisationId, id);
  if (!policy) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { searchParams } = new URL(req.url);
  const rawLimit = Number(searchParams.get("limit"));
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : undefined;

  const runs = await listRunsCore(auth.token.organisationId, id, limit);
  return NextResponse.json({ runs });
}
