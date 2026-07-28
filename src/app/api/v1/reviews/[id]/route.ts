import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  ReviewError,
  getReviewCore,
  saveReviewContentCore,
  serializeReviewForActor,
} from "@/lib/post-incident-review";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  content: z.record(z.string(), z.unknown()),
});

export async function GET(req: Request, context: Params) {
  const auth = await authenticateApiTokenWithScope(req, "reviews:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await context.params;
  const review = await getReviewCore(
    auth.token.organisationId,
    id,
    auth.token.createdBy,
  );
  if (!review) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json(
    {
      review: await serializeReviewForActor(
        auth.token.organisationId,
        review,
        auth.token.createdBy,
      ),
    },
    { headers: { "cache-control": "private, no-store" } },
  );
}

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
    const review = await saveReviewContentCore(
      auth.token.organisationId,
      id,
      auth.token.createdBy,
      parsed.data.content,
    );
    return NextResponse.json(
      {
        review: await serializeReviewForActor(
          auth.token.organisationId,
          review,
          auth.token.createdBy,
        ),
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
