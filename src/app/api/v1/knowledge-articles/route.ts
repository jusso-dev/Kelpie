import { NextResponse } from "next/server";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  KNOWLEDGE_STATUSES,
  listKnowledgeArticlesCore,
  toPublicKnowledgeArticle,
  type KnowledgeStatus,
} from "@/lib/post-incident-review";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await authenticateApiTokenWithScope(req, "reviews:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const url = new URL(req.url);
  const statusParam = url.searchParams.get("status");
  const limit = Number(url.searchParams.get("limit") ?? "50");
  let status: KnowledgeStatus | undefined;
  if (statusParam) {
    if (!(KNOWLEDGE_STATUSES as readonly string[]).includes(statusParam)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    status = statusParam as KnowledgeStatus;
  }
  const rows = await listKnowledgeArticlesCore(
    auth.token.organisationId,
    auth.token.createdBy,
    {
      status,
      limit: Number.isFinite(limit) ? limit : 50,
    },
  );
  const articles = await Promise.all(
    rows.map((a) =>
      toPublicKnowledgeArticle(
        auth.token.organisationId,
        a,
        auth.token.createdBy,
      ),
    ),
  );
  return NextResponse.json(
    { articles },
    { headers: { "cache-control": "private, no-store" } },
  );
}
