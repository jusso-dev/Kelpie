import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  createReportTemplateCore,
  listReportTemplatesCore,
  ReportTemplateError,
  seedBaselineReportTemplates,
} from "@/lib/reports/templates-core";
import { REPORT_SECTION_KEYS, REPORT_VARIANTS } from "@/lib/reports/types";

export const dynamic = "force-dynamic";

const sectionSchema = z.object({
  key: z.enum(REPORT_SECTION_KEYS),
  title: z.string().trim().max(200).optional(),
  required: z.boolean(),
  defaultIncluded: z.boolean(),
  order: z.number().int().min(0).max(1000),
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  variant: z.enum(REPORT_VARIANTS),
  sections: z.array(sectionSchema).min(1).max(32),
  inclusionRules: z
    .object({
      maxTlp: z.enum(["clear", "green", "amber", "amber_strict", "red"]).optional(),
      maxPap: z.enum(["clear", "green", "amber", "red"]).optional(),
      maskOverTlp: z.boolean().optional(),
      includeSensitiveBlocks: z.boolean().optional(),
      forceExclude: z.array(z.enum(REPORT_SECTION_KEYS)).optional(),
    })
    .optional(),
  requireApproval: z.boolean().optional(),
  maxTlp: z.enum(["clear", "green", "amber", "amber_strict", "red"]).optional(),
  maxPap: z.enum(["clear", "green", "amber", "red"]).optional(),
});

export async function GET(req: Request) {
  const auth = await authenticateApiTokenWithScope(req, "reports:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  // Ensure defaults exist for orgs that predate this feature.
  await seedBaselineReportTemplates(auth.token.organisationId);
  const includeInactive =
    new URL(req.url).searchParams.get("includeInactive") === "true";
  const templates = await listReportTemplatesCore(auth.token.organisationId, {
    includeInactive,
  });
  return NextResponse.json(
    {
      templates: templates.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        variant: t.variant,
        isActive: t.isActive,
        currentVersion: t.currentVersion,
        catalogueKey: t.catalogueKey,
        requireApproval: t.version.requireApproval,
        maxTlp: t.version.maxTlp,
        maxPap: t.version.maxPap,
        sections: t.sections,
        inclusionRules: t.inclusionRules,
        versionId: t.version.id,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
      })),
    },
    { headers: { "cache-control": "private, no-store" } },
  );
}

export async function POST(req: Request) {
  const auth = await authenticateApiTokenWithScope(req, "reports:admin");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    );
  }
  try {
    const template = await createReportTemplateCore(
      auth.token.organisationId,
      auth.token.createdBy,
      parsed.data,
    );
    return NextResponse.json(
      {
        template: {
          id: template.id,
          name: template.name,
          description: template.description,
          variant: template.variant,
          currentVersion: template.currentVersion,
          versionId: template.version.id,
          sections: template.sections,
          inclusionRules: template.inclusionRules,
          requireApproval: template.version.requireApproval,
          maxTlp: template.version.maxTlp,
          maxPap: template.version.maxPap,
        },
      },
      { status: 201, headers: { "cache-control": "private, no-store" } },
    );
  } catch (err) {
    if (err instanceof ReportTemplateError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
