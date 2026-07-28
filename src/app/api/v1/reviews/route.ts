import { NextResponse } from "next/server";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  REVIEW_STATUSES,
  listOrgReviewsCore,
  serializeReviewForActor,
  type ReviewStatus,
} from "@/lib/post-incident-review";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await authenticateApiTokenWithScope(req, "reviews:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const url = new URL(req.url);
  const statusParam = url.searchParams.get("status");
  const overdueOnly = url.searchParams.get("overdue") === "true";
  const limit = Number(url.searchParams.get("limit") ?? "50");
  let status: ReviewStatus | undefined;
  if (statusParam) {
    if (!(REVIEW_STATUSES as readonly string[]).includes(statusParam)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    status = statusParam as ReviewStatus;
  }
  const reviews = await listOrgReviewsCore(
    auth.token.organisationId,
    auth.token.createdBy,
    {
      status,
      overdueOnly,
      limit: Number.isFinite(limit) ? limit : 50,
    },
  );
  const serialized = await Promise.all(
    reviews.map((r) =>
      serializeReviewForActor(
        auth.token.organisationId,
        r,
        auth.token.createdBy,
      ),
    ),
  );
  return NextResponse.json(
    { reviews: serialized },
    { headers: { "cache-control": "private, no-store" } },
  );
}
