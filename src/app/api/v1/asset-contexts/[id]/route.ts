import { NextResponse } from "next/server";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  getContextInOrg,
  serialiseContext,
} from "@/lib/asset-context/context-core";
import { getPriorityScoringSettings } from "@/lib/asset-context/settings";

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiTokenWithScope(req, "asset_context:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await context.params;
  const row = await getContextInOrg(id, auth.token.organisationId);
  if (!row) {
    return NextResponse.json({ error: "Context not found" }, { status: 404 });
  }
  const settings = await getPriorityScoringSettings(auth.token.organisationId);
  return NextResponse.json({
    context: serialiseContext(row, {
      staleAfterHours: settings.staleAfterHours,
    }),
  });
}
