import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  CASE_CLASSIFICATIONS,
  CASE_SEVERITIES,
  REVIEW_SECTION_KEYS,
  ReviewTemplateError,
  createReviewTemplateCore,
  listReviewTemplatesCore,
  seedBaselineReviewTemplates,
} from "@/lib/post-incident-review";

export const dynamic = "force-dynamic";

const sectionSchema = z.object({
  key: z.enum(REVIEW_SECTION_KEYS),
  title: z.string().trim().max(200).optional(),
  required: z.boolean(),
  order: z.number().int().min(0).max(1000),
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  sections: z.array(sectionSchema).min(1).max(32).optional(),
  requireApproval: z.boolean().optional(),
  requiredSeverities: z.array(z.enum(CASE_SEVERITIES)).optional(),
  requiredClassifications: z.array(z.enum(CASE_CLASSIFICATIONS)).optional(),
});

export async function GET(req: Request) {
  const auth = await authenticateApiTokenWithScope(req, "reviews:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  await seedBaselineReviewTemplates(auth.token.organisationId, auth.token.createdBy);
  const includeInactive =
    new URL(req.url).searchParams.get("includeInactive") === "true";
  const templates = await listReviewTemplatesCore(auth.token.organisationId, {
    includeInactive,
  });
  return NextResponse.json(
    {
      templates: templates.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        isActive: t.isActive,
        currentVersion: t.currentVersion,
        catalogueKey: t.catalogueKey,
        requiredSeverities: t.requiredSeverities,
        requiredClassifications: t.requiredClassifications,
        requireApproval: t.version.requireApproval,
        sections: t.sections,
        versionId: t.version.id,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
      })),
    },
    { headers: { "cache-control": "private, no-store" } },
  );
}

export async function POST(req: Request) {
  const auth = await authenticateApiTokenWithScope(req, "reviews:admin");
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
    const template = await createReviewTemplateCore(
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
          currentVersion: template.currentVersion,
          versionId: template.version.id,
          sections: template.sections,
          requireApproval: template.version.requireApproval,
          requiredSeverities: template.requiredSeverities,
          requiredClassifications: template.requiredClassifications,
        },
      },
      { status: 201, headers: { "cache-control": "private, no-store" } },
    );
  } catch (err) {
    if (err instanceof ReviewTemplateError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
