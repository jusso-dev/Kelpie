import { NextResponse } from "next/server";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import { listPlaybooksCore } from "@/lib/playbooks-core";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await authenticateApiTokenWithScope(req, "playbooks:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const params = new URL(req.url).searchParams;
  const playbooks = await listPlaybooksCore(auth.token.organisationId, {
    scenario: params.get("scenario")?.trim() || undefined,
    classification: params.get("classification")?.trim() || undefined,
    severity: params.get("severity")?.trim() || undefined,
    tag: params.get("tag")?.trim() || undefined,
    observableType: params.get("observableType")?.trim() || undefined,
    q: params.get("q")?.trim() || undefined,
    includeInactive: params.get("includeInactive") === "true",
  });
  return NextResponse.json(
    { playbooks },
    { headers: { "cache-control": "private, no-store" } },
  );
}
