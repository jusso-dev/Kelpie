import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import { tokenHasScope } from "@/lib/scopes";
import { CaseVersionConflictError } from "@/lib/cases-errors";
import { closeCaseFullCore } from "@/lib/cases-core";
import {
  CLOSURE_DETERMINATIONS,
  CLOSURE_DISPOSITIONS,
  ClosureOverrideError,
  ClosurePathError,
  ClosureRequirementsError,
} from "@/lib/closure/types";

const bodySchema = z.object({
  disposition: z.enum(CLOSURE_DISPOSITIONS),
  conclusion: z.string().min(1),
  determination: z.enum(CLOSURE_DETERMINATIONS).nullable().optional(),
  rootCause: z.string().nullable().optional(),
  businessImpact: z.string().nullable().optional(),
  lessonsLearned: z.string().nullable().optional(),
  approverId: z.string().nullable().optional(),
  reviewedRelatedCaseIds: z.array(z.string()).optional(),
  postIncidentReviewCompleted: z.boolean().optional(),
  version: z.number().int().optional(),
  override: z.boolean().optional(),
  overrideReason: z.string().nullable().optional(),
});

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiTokenWithScope(req, "cases:write");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await context.params;
  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const actorId = auth.token.createdBy ?? null;
  const canOverride = tokenHasScope(
    (auth.token.scopes as string[]) ?? [],
    "cases:override_closure",
  );

  try {
    const result = await closeCaseFullCore(
      auth.token.organisationId,
      actorId,
      id,
      {
        disposition: parsed.data.disposition,
        conclusion: parsed.data.conclusion,
        determination: parsed.data.determination ?? null,
        rootCause: parsed.data.rootCause ?? null,
        businessImpact: parsed.data.businessImpact ?? null,
        lessonsLearned: parsed.data.lessonsLearned ?? null,
        approverId: parsed.data.approverId ?? null,
        reviewedRelatedCaseIds: parsed.data.reviewedRelatedCaseIds,
        postIncidentReviewCompleted: parsed.data.postIncidentReviewCompleted,
        expectedVersion: parsed.data.version,
        override: parsed.data.override === true,
        overrideReason: parsed.data.overrideReason ?? null,
        canOverride,
      },
    );
    return NextResponse.json({
      ok: true,
      version: result.version,
      snapshot_id: result.snapshotId,
      was_override: result.wasOverride,
      evaluation: result.evaluation,
    });
  } catch (e) {
    if (e instanceof ClosureRequirementsError) {
      return NextResponse.json(
        {
          error: "closure_requirements_not_met",
          evaluation: e.evaluation,
        },
        { status: 422 },
      );
    }
    if (e instanceof CaseVersionConflictError) {
      return NextResponse.json(
        { error: "version_conflict", current: e.current },
        { status: 409 },
      );
    }
    if (e instanceof ClosureOverrideError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    if (e instanceof ClosurePathError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }
}
