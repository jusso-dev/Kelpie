import { NextResponse } from "next/server";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  ReviewError,
  serializeReview,
  submitReviewCore,
} from "@/lib/post-incident-review";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: Request, context: Params) {
  const auth = await authenticateApiTokenWithScope(req, "reviews:write");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await context.params;
  try {
    const review = await submitReviewCore(
      auth.token.organisationId,
      id,
      auth.token.createdBy,
    );
    return NextResponse.json(
      { review: serializeReview(review) },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (err) {
    if (err instanceof ReviewError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
