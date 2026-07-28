import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  IMPROVEMENT_STATUSES,
  ReviewError,
  updateImprovementCore,
} from "@/lib/post-incident-review";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  title: z.string().trim().min(1).max(500).optional(),
  description: z.string().trim().max(10_000).nullable().optional(),
  status: z.enum(IMPROVEMENT_STATUSES).optional(),
  ownerId: z.string().trim().min(1).max(100).nullable().optional(),
  externalTicketRef: z.string().trim().max(200).nullable().optional(),
  externalTicketUrl: z.string().trim().max(2048).nullable().optional(),
});

export async function PATCH(req: Request, context: Params) {
  const auth = await authenticateApiTokenWithScope(req, "reviews:write");
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
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    );
  }
  try {
    const improvement = await updateImprovementCore(
      auth.token.organisationId,
      id,
      auth.token.createdBy,
      parsed.data,
    );
    return NextResponse.json(
      {
        improvement: {
          id: improvement.id,
          reviewId: improvement.reviewId,
          caseId: improvement.caseId,
          kind: improvement.kind,
          title: improvement.title,
          description: improvement.description,
          status: improvement.status,
          linkedPlaybookId: improvement.linkedPlaybookId,
          externalTicketRef: improvement.externalTicketRef,
          externalTicketUrl: improvement.externalTicketUrl,
          ownerId: improvement.ownerId,
          createdAt: improvement.createdAt.toISOString(),
          updatedAt: improvement.updatedAt.toISOString(),
        },
      },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (err) {
    if (err instanceof ReviewError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
