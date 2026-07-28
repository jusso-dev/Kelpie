import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  authorizeCase,
  resolveTokenActor,
} from "@/lib/access";
import {
  previewReportCore,
  ReportExportError,
} from "@/lib/reports/export-core";
import { REPORT_EXPORT_FORMATS, REPORT_SECTION_KEYS } from "@/lib/reports/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

const previewSchema = z.object({
  templateId: z.string().min(1),
  templateVersion: z.number().int().min(1).optional(),
  format: z.enum(REPORT_EXPORT_FORMATS).optional(),
  sectionOverrides: z
    .record(z.enum(REPORT_SECTION_KEYS), z.boolean())
    .optional(),
});

export async function POST(req: Request, { params }: Params) {
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
  const parsed = previewSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    );
  }
  try {
    const preview = await previewReportCore({
      organisationId: auth.token.organisationId,
      caseId,
      templateId: parsed.data.templateId,
      templateVersion: parsed.data.templateVersion,
      overrides: parsed.data.sectionOverrides,
      format: parsed.data.format,
      actorUserId: auth.token.createdBy,
    });
    return NextResponse.json(
      { preview },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (err) {
    if (err instanceof ReportExportError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
