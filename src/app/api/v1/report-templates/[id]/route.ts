import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  getReportTemplateCore,
  listTemplateVersionsCore,
  ReportTemplateError,
  updateReportTemplateCore,
} from "@/lib/reports/templates-core";
import { REPORT_SECTION_KEYS } from "@/lib/reports/types";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const sectionSchema = z.object({
  key: z.enum(REPORT_SECTION_KEYS),
  title: z.string().trim().max(200).optional(),
  required: z.boolean(),
  defaultIncluded: z.boolean(),
  order: z.number().int().min(0).max(1000),
});

const updateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  isActive: z.boolean().optional(),
  sections: z.array(sectionSchema).min(1).max(32).optional(),
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

export async function GET(req: Request, { params }: Params) {
  const auth = await authenticateApiTokenWithScope(req, "reports:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await params;
  const versionParam = new URL(req.url).searchParams.get("version");
  const versionNumber = versionParam ? Number(versionParam) : undefined;
  if (versionParam && (!Number.isInteger(versionNumber) || (versionNumber ?? 0) < 1)) {
    return NextResponse.json({ error: "Invalid version" }, { status: 400 });
  }
  const template = await getReportTemplateCore(
    auth.token.organisationId,
    id,
    versionNumber,
  );
  if (!template) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const versions = await listTemplateVersionsCore(auth.token.organisationId, id);
  return NextResponse.json(
    {
      template: {
        id: template.id,
        name: template.name,
        description: template.description,
        variant: template.variant,
        isActive: template.isActive,
        currentVersion: template.currentVersion,
        catalogueKey: template.catalogueKey,
        requireApproval: template.version.requireApproval,
        maxTlp: template.version.maxTlp,
        maxPap: template.version.maxPap,
        sections: template.sections,
        inclusionRules: template.inclusionRules,
        versionId: template.version.id,
        version: template.version.version,
        versions: versions.map((v) => ({
          id: v.id,
          version: v.version,
          requireApproval: v.requireApproval,
          maxTlp: v.maxTlp,
          maxPap: v.maxPap,
          createdAt: v.createdAt.toISOString(),
        })),
      },
    },
    { headers: { "cache-control": "private, no-store" } },
  );
}

export async function PATCH(req: Request, { params }: Params) {
  const auth = await authenticateApiTokenWithScope(req, "reports:admin");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    );
  }
  try {
    const template = await updateReportTemplateCore(
      auth.token.organisationId,
      auth.token.createdBy,
      id,
      parsed.data,
    );
    return NextResponse.json(
      {
        template: {
          id: template.id,
          name: template.name,
          description: template.description,
          variant: template.variant,
          isActive: template.isActive,
          currentVersion: template.currentVersion,
          versionId: template.version.id,
          sections: template.sections,
          inclusionRules: template.inclusionRules,
          requireApproval: template.version.requireApproval,
          maxTlp: template.version.maxTlp,
          maxPap: template.version.maxPap,
        },
      },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (err) {
    if (err instanceof ReportTemplateError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
