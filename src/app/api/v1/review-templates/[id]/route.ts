import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  CASE_CLASSIFICATIONS,
  CASE_SEVERITIES,
  REVIEW_SECTION_KEYS,
  ReviewTemplateError,
  getReviewTemplateCore,
  updateReviewTemplateCore,
} from "@/lib/post-incident-review";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const sectionSchema = z.object({
  key: z.enum(REVIEW_SECTION_KEYS),
  title: z.string().trim().max(200).optional(),
  required: z.boolean(),
  order: z.number().int().min(0).max(1000),
});

const updateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  isActive: z.boolean().optional(),
  sections: z.array(sectionSchema).min(1).max(32).optional(),
  requireApproval: z.boolean().optional(),
  requiredSeverities: z.array(z.enum(CASE_SEVERITIES)).optional(),
  requiredClassifications: z.array(z.enum(CASE_CLASSIFICATIONS)).optional(),
});

export async function GET(req: Request, context: Params) {
  const auth = await authenticateApiTokenWithScope(req, "reviews:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await context.params;
  const template = await getReviewTemplateCore(auth.token.organisationId, id);
  if (!template) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json(
    {
      template: {
        id: template.id,
        name: template.name,
        description: template.description,
        isActive: template.isActive,
        currentVersion: template.currentVersion,
        catalogueKey: template.catalogueKey,
        requiredSeverities: template.requiredSeverities,
        requiredClassifications: template.requiredClassifications,
        requireApproval: template.version.requireApproval,
        sections: template.sections,
        versionId: template.version.id,
        createdAt: template.createdAt.toISOString(),
        updatedAt: template.updatedAt.toISOString(),
      },
    },
    { headers: { "cache-control": "private, no-store" } },
  );
}

export async function PATCH(req: Request, context: Params) {
  const auth = await authenticateApiTokenWithScope(req, "reviews:admin");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await context.params;
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
    const template = await updateReviewTemplateCore(
      auth.token.organisationId,
      id,
      auth.token.createdBy,
      parsed.data,
    );
    return NextResponse.json(
      {
        template: {
          id: template.id,
          name: template.name,
          description: template.description,
          isActive: template.isActive,
          currentVersion: template.currentVersion,
          versionId: template.version.id,
          sections: template.sections,
          requireApproval: template.version.requireApproval,
          requiredSeverities: template.requiredSeverities,
          requiredClassifications: template.requiredClassifications,
        },
      },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (err) {
    if (err instanceof ReviewTemplateError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
