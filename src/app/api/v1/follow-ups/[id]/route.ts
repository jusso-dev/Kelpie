import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  FOLLOW_UP_STATUSES,
  ReviewError,
  updateFollowUpCore,
} from "@/lib/post-incident-review";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  title: z.string().trim().min(1).max(500).optional(),
  description: z.string().trim().max(10_000).nullable().optional(),
  status: z.enum(FOLLOW_UP_STATUSES).optional(),
  ownerId: z.string().trim().min(1).max(100).nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
  theme: z.string().trim().max(200).nullable().optional(),
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
    const followUp = await updateFollowUpCore(
      auth.token.organisationId,
      id,
      auth.token.createdBy,
      parsed.data,
    );
    return NextResponse.json(
      {
        followUp: {
          id: followUp.id,
          reviewId: followUp.reviewId,
          caseId: followUp.caseId,
          title: followUp.title,
          description: followUp.description,
          status: followUp.status,
          ownerId: followUp.ownerId,
          dueAt: followUp.dueAt?.toISOString() ?? null,
          theme: followUp.theme,
          completedAt: followUp.completedAt?.toISOString() ?? null,
          completedBy: followUp.completedBy,
          externalTicketRef: followUp.externalTicketRef,
          externalTicketUrl: followUp.externalTicketUrl,
          createdAt: followUp.createdAt.toISOString(),
          updatedAt: followUp.updatedAt.toISOString(),
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
