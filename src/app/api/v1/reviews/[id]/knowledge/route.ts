import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  KNOWLEDGE_STATUSES,
  ReviewError,
  publishKnowledgeFromReviewCore,
  toPublicKnowledgeArticle,
} from "@/lib/post-incident-review";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const createSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  includeSensitive: z.boolean().optional(),
  status: z.enum(KNOWLEDGE_STATUSES).optional(),
});

export async function POST(req: Request, context: Params) {
  const auth = await authenticateApiTokenWithScope(req, "reviews:write");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await context.params;
  let body: unknown = {};
  try {
    const text = await req.text();
    if (text) body = JSON.parse(text);
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
    const article = await publishKnowledgeFromReviewCore(
      auth.token.organisationId,
      id,
      auth.token.createdBy,
      parsed.data,
    );
    const publicArticle = await toPublicKnowledgeArticle(
      auth.token.organisationId,
      article,
      auth.token.createdBy,
    );
    return NextResponse.json(
      { article: publicArticle },
      { status: 201, headers: { "cache-control": "private, no-store" } },
    );
  } catch (err) {
    if (err instanceof ReviewError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
