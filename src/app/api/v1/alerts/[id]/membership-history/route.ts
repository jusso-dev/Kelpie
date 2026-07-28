import { NextResponse } from "next/server";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import { getAlertInOrg } from "@/lib/investigations/alerts-core";
import { listMembershipHistoryForAlert } from "@/lib/correlation/membership-core";

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiTokenWithScope(req, "correlation:read");
  if (!auth.ok) {
    // Fall back to alerts:read so investigators with alert scope can see lineage.
    const alertAuth = await authenticateApiTokenWithScope(req, "alerts:read");
    if (!alertAuth.ok) {
      return NextResponse.json(
        { error: alertAuth.reason },
        { status: alertAuth.status },
      );
    }
    const { id } = await context.params;
    const alert = await getAlertInOrg(id, alertAuth.token.organisationId);
    if (!alert) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const history = await listMembershipHistoryForAlert({
      organisationId: alertAuth.token.organisationId,
      alertId: id,
    });
    return NextResponse.json({ history });
  }
  const { id } = await context.params;
  const alert = await getAlertInOrg(id, auth.token.organisationId);
  if (!alert) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const history = await listMembershipHistoryForAlert({
    organisationId: auth.token.organisationId,
    alertId: id,
  });
  return NextResponse.json({ history });
}
