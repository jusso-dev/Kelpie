import { NextResponse } from "next/server";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  getReportExportApprovalCore,
  getReportExportCore,
  toPublicExport,
} from "@/lib/reports/export-core";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ exportId: string }> };

export async function GET(req: Request, { params }: Params) {
  const auth = await authenticateApiTokenWithScope(req, "reports:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { exportId } = await params;
  const exp = await getReportExportCore(auth.token.organisationId, exportId);
  if (!exp) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const approval = await getReportExportApprovalCore(
    auth.token.organisationId,
    exportId,
  );
  return NextResponse.json(
    {
      export: toPublicExport(exp),
      approval: approval
        ? {
            id: approval.id,
            status: approval.status,
            boundTemplateVersionId: approval.boundTemplateVersionId,
            boundDataRevision: approval.boundDataRevision,
            // Fingerprint is non-sensitive (hash); safe to return for clients.
            boundContentFingerprint: approval.boundContentFingerprint,
            createdAt: approval.createdAt.toISOString(),
          }
        : null,
    },
    { headers: { "cache-control": "private, no-store" } },
  );
}
