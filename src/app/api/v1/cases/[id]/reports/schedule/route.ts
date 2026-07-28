import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  createReportScheduleCore,
  ReportExportError,
} from "@/lib/reports/export-core";
import { REPORT_EXPORT_FORMATS, REPORT_SECTION_KEYS } from "@/lib/reports/types";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const scheduleSchema = z.object({
  templateId: z.string().min(1),
  format: z.enum(REPORT_EXPORT_FORMATS).default("pdf"),
  intervalMinutes: z.number().int().min(60).max(60 * 24 * 30).optional(),
  sectionOverrides: z
    .record(z.enum(REPORT_SECTION_KEYS), z.boolean())
    .optional(),
});

/**
 * Create a scheduled report for a case. Destination is always organisation
 * export history — arbitrary external destinations are out of scope.
 * Execution re-checks template activity and case membership.
 */
export async function POST(req: Request, { params }: Params) {
  const auth = await authenticateApiTokenWithScope(req, "reports:write");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id: caseId } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = scheduleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    );
  }
  try {
    const schedule = await createReportScheduleCore({
      organisationId: auth.token.organisationId,
      templateId: parsed.data.templateId,
      caseId,
      format: parsed.data.format,
      intervalMinutes: parsed.data.intervalMinutes,
      overrides: parsed.data.sectionOverrides,
      createdBy: auth.token.createdBy,
    });
    return NextResponse.json(
      {
        schedule: {
          id: schedule.id,
          templateId: schedule.templateId,
          caseId: schedule.caseId,
          format: schedule.format,
          intervalMinutes: schedule.intervalMinutes,
          nextRunAt: schedule.nextRunAt.toISOString(),
          destinationPolicy: schedule.destinationPolicy,
          isActive: schedule.isActive,
        },
      },
      { status: 201, headers: { "cache-control": "private, no-store" } },
    );
  } catch (err) {
    if (err instanceof ReportExportError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
