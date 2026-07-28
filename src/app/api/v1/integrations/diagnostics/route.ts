import { NextResponse } from "next/server";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import { recordAuditEvent } from "@/lib/audit/events";
import { auditContextFromRequest } from "@/lib/audit/request-context";
import {
  diagnosticsContainsSecrets,
  exportDiagnostics,
} from "@/lib/integrations/diagnostics";

export async function GET(req: Request) {
  const auth = await authenticateApiTokenWithScope(req, "integrations:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const bundle = await exportDiagnostics(auth.token.organisationId);
  if (diagnosticsContainsSecrets(bundle)) {
    // Hard fail rather than ship a contaminated support export.
    return NextResponse.json(
      { error: "Diagnostics export aborted: secret-shaped content detected" },
      { status: 500 },
    );
  }
  await recordAuditEvent({
    organisationId: auth.token.organisationId,
    actorId: auth.token.id,
    actorType: "api_token",
    actorLabel: auth.token.id,
    action: "integration.diagnostics_exported",
    targetType: "organisation",
    targetId: auth.token.organisationId,
    targetLabel: "integration diagnostics",
    before: null,
    after: {
      connectionCount: bundle.connections.length,
      openConflictCount: bundle.openConflicts.length,
    },
    ...auditContextFromRequest(req),
  });
  return NextResponse.json(bundle);
}
