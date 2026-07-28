import { NextResponse } from "next/server";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  getConnectionHealth,
  listOrganisationHealth,
} from "@/lib/integrations/health";
import { isConnectionKind } from "@/lib/integrations/types";

export async function GET(req: Request) {
  const auth = await authenticateApiTokenWithScope(req, "integrations:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }

  const { searchParams } = new URL(req.url);
  const kind = searchParams.get("kind");
  const id = searchParams.get("id");

  if (kind && id) {
    if (!isConnectionKind(kind)) {
      return NextResponse.json({ error: "Unknown connection kind" }, { status: 400 });
    }
    const health = await getConnectionHealth(
      auth.token.organisationId,
      kind,
      id,
    );
    if (!health) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }
    return NextResponse.json({ health });
  }

  const connections = await listOrganisationHealth(auth.token.organisationId);
  return NextResponse.json({ connections });
}
