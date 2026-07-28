import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import { previewCaseClosure } from "@/lib/closure/close-core";
import {
  CLOSURE_DETERMINATIONS,
  CLOSURE_DISPOSITIONS,
} from "@/lib/closure/types";
import { listClosureSnapshotsCore } from "@/lib/closure/close-core";

const bodySchema = z.object({
  disposition: z.enum(CLOSURE_DISPOSITIONS).optional(),
  conclusion: z.string().optional(),
  determination: z.enum(CLOSURE_DETERMINATIONS).nullable().optional(),
  rootCause: z.string().nullable().optional(),
  businessImpact: z.string().nullable().optional(),
  lessonsLearned: z.string().nullable().optional(),
  approverId: z.string().nullable().optional(),
  reviewedRelatedCaseIds: z.array(z.string()).optional(),
  postIncidentReviewCompleted: z.boolean().optional(),
});

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiTokenWithScope(req, "cases:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await context.params;
  const evaluation = await previewCaseClosure(auth.token.organisationId, id, {
    disposition: "resolved",
    conclusion: "preview",
  });
  if (!evaluation) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const snapshots = await listClosureSnapshotsCore(
    auth.token.organisationId,
    id,
  );
  return NextResponse.json({ evaluation, snapshots });
}

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiTokenWithScope(req, "cases:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await context.params;
  const body = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const evaluation = await previewCaseClosure(auth.token.organisationId, id, {
    disposition: parsed.data.disposition ?? "resolved",
    conclusion: parsed.data.conclusion ?? "",
    determination: parsed.data.determination ?? null,
    rootCause: parsed.data.rootCause ?? null,
    businessImpact: parsed.data.businessImpact ?? null,
    lessonsLearned: parsed.data.lessonsLearned ?? null,
    approverId: parsed.data.approverId ?? null,
    reviewedRelatedCaseIds: parsed.data.reviewedRelatedCaseIds,
    postIncidentReviewCompleted: parsed.data.postIncidentReviewCompleted,
  });
  if (!evaluation) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ evaluation });
}
