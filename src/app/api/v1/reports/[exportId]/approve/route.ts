import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  approveReportExportCore,
  ReportExportError,
  toPublicExport,
} from "@/lib/reports/export-core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ exportId: string }> };

const bodySchema = z.object({
  decision: z.enum(["approve", "reject"]),
});

export async function POST(req: Request, { params }: Params) {
  const auth = await authenticateApiTokenWithScope(req, "reports:admin");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { exportId } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "decision must be approve or reject" },
      { status: 400 },
    );
  }
  const actorId = auth.token.createdBy;
  if (!actorId) {
    return NextResponse.json(
      { error: "Approval requires a token issued by a user" },
      { status: 403 },
    );
  }
  try {
    const exp = await approveReportExportCore({
      organisationId: auth.token.organisationId,
      exportId,
      actorId,
      decision: parsed.data.decision,
    });
    return NextResponse.json(
      { export: toPublicExport(exp) },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (err) {
    if (err instanceof ReportExportError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
