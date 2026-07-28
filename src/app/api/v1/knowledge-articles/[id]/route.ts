import { NextResponse } from "next/server";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  getKnowledgeArticleCore,
  toPublicKnowledgeArticle,
} from "@/lib/post-incident-review";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, context: Params) {
  const auth = await authenticateApiTokenWithScope(req, "reviews:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await context.params;
  const article = await getKnowledgeArticleCore(auth.token.organisationId, id);
  if (!article) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const publicArticle = await toPublicKnowledgeArticle(
    auth.token.organisationId,
    article,
    auth.token.createdBy,
  );
  return NextResponse.json(
    { article: publicArticle },
    { headers: { "cache-control": "private, no-store" } },
  );
}
