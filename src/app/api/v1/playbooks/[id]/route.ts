import { NextResponse } from "next/server";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import { getPlaybookCore } from "@/lib/playbooks-core";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  const auth = await authenticateApiTokenWithScope(req, "playbooks:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await params;
  const playbook = await getPlaybookCore(auth.token.organisationId, id);
  if (!playbook) {
    return NextResponse.json({ error: "Playbook not found" }, { status: 404 });
  }
  return NextResponse.json(playbook, {
    headers: { "cache-control": "private, no-store" },
  });
}
