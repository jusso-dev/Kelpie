import { NextResponse } from "next/server";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import { getAlertInOrg } from "@/lib/investigations/alerts-core";
import { getProviderPayloadReferenceCore } from "@/lib/investigations/provider-payloads-core";

/**
 * Deliberately separate, sensitive-scoped endpoint: reading a raw provider
 * payload is never possible from the alert list/detail response, only from
 * here, and only with `alerts:raw_payload:read` (an admin-issued-token-only
 * scope, same posture as `evidence:override` and `audit:read`).
 */
export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiTokenWithScope(req, "alerts:raw_payload:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await context.params;
  const alert = await getAlertInOrg(id, auth.token.organisationId);
  if (!alert) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!alert.rawPayloadRefId) {
    return NextResponse.json({ error: "No raw payload reference on this alert" }, { status: 404 });
  }
  const reference = await getProviderPayloadReferenceCore(
    alert.rawPayloadRefId,
    auth.token.organisationId,
  );
  if (!reference) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ payloadReference: reference });
}
