import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  authorizeCase,
  resolveTokenActor,
} from "@/lib/access";
import { enqueueKelpieJob } from "@/lib/jobs/enqueue";
import {
  createReportExportCore,
  listReportExportsCore,
  ReportExportError,
  toPublicExport,
} from "@/lib/reports/export-core";
import { REPORT_EXPORT_FORMATS, REPORT_SECTION_KEYS } from "@/lib/reports/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

const generateSchema = z.object({
  templateId: z.string().min(1),
  templateVersion: z.number().int().min(1).optional(),
  format: z.enum(REPORT_EXPORT_FORMATS),
  sectionOverrides: z
    .record(z.enum(REPORT_SECTION_KEYS), z.boolean())
    .optional(),
  /** When true, process in-request (tests / environments without a worker). */
  processInline: z.boolean().optional(),
});

export async function GET(req: Request, { params }: Params) {
  const auth = await authenticateApiTokenWithScope(req, "reports:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id: caseId } = await params;
  const actor = await resolveTokenActor(auth.token);
  const gate = await authorizeCase(
    auth.token.organisationId,
    caseId,
    actor,
    "view_metadata",
  );
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const limit = Number(new URL(req.url).searchParams.get("limit") ?? 50);
  const exports = await listReportExportsCore(
    auth.token.organisationId,
    caseId,
    limit,
  );
  return NextResponse.json(
    { exports: exports.map(toPublicExport) },
    { headers: { "cache-control": "private, no-store" } },
  );
}

export async function POST(req: Request, { params }: Params) {
  const auth = await authenticateApiTokenWithScope(req, "reports:write");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id: caseId } = await params;
  const actor = await resolveTokenActor(auth.token);
  const gate = await authorizeCase(
    auth.token.organisationId,
    caseId,
    actor,
    "export",
  );
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = generateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    );
  }
  try {
    const exp = await createReportExportCore({
      organisationId: auth.token.organisationId,
      caseId,
      templateId: parsed.data.templateId,
      templateVersion: parsed.data.templateVersion,
      format: parsed.data.format,
      overrides: parsed.data.sectionOverrides,
      requestedBy: auth.token.createdBy,
      processInline: parsed.data.processInline === true,
    });
    if (parsed.data.processInline !== true) {
      try {
        await enqueueKelpieJob("generate-case-report", {
          reportExportId: exp.id,
        });
      } catch {
        // Worker/redis may be unavailable; leave pending for later pickup.
      }
    }
    // Re-read after possible inline processing.
    const { getReportExportCore } = await import("@/lib/reports/export-core");
    const fresh =
      (await getReportExportCore(auth.token.organisationId, exp.id)) ?? exp;
    return NextResponse.json(
      { export: toPublicExport(fresh) },
      {
        status: 201,
        headers: { "cache-control": "private, no-store" },
      },
    );
  } catch (err) {
    if (err instanceof ReportExportError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
