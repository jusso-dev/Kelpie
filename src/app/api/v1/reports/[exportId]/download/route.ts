import { NextResponse } from "next/server";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  downloadReportExportCore,
  ReportExportError,
} from "@/lib/reports/export-core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ exportId: string }> };

export async function GET(req: Request, { params }: Params) {
  const auth = await authenticateApiTokenWithScope(req, "reports:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { exportId } = await params;
  try {
    const result = await downloadReportExportCore(
      auth.token.organisationId,
      exportId,
      auth.token.createdBy,
    );
    return new NextResponse(new Uint8Array(result.buffer), {
      status: 200,
      headers: {
        "content-type": result.contentType,
        "content-disposition": `attachment; filename="${result.filename}"`,
        "x-kelpie-sha256": result.sha256,
        "cache-control": "private, no-store",
      },
    });
  } catch (err) {
    if (err instanceof ReportExportError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
