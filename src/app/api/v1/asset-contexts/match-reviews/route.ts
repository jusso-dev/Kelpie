import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  listPendingMatchReviews,
  resolveMatchReviewCore,
} from "@/lib/asset-context/context-core";
import { AssetContextError } from "@/lib/asset-context/types";

const resolveSchema = z.discriminatedUnion("action", [
  z.object({
    reviewId: z.string().min(1),
    action: z.literal("link"),
    entityId: z.string().min(1),
  }),
  z.object({
    reviewId: z.string().min(1),
    action: z.literal("dismiss"),
  }),
]);

export async function GET(req: Request) {
  const auth = await authenticateApiTokenWithScope(req, "asset_context:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const reviews = await listPendingMatchReviews(auth.token.organisationId);
  return NextResponse.json({ reviews });
}

export async function POST(req: Request) {
  const auth = await authenticateApiTokenWithScope(req, "asset_context:write");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const body = await req.json().catch(() => null);
  const parsed = resolveSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  try {
    const review = await resolveMatchReviewCore(
      auth.token.organisationId,
      parsed.data.reviewId,
      parsed.data.action === "link"
        ? { action: "link", entityId: parsed.data.entityId }
        : { action: "dismiss" },
      auth.token.createdBy ?? null,
    );
    return NextResponse.json({ review });
  } catch (err) {
    if (err instanceof AssetContextError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
