import { NextResponse } from "next/server";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import { ReviewError, listRevisionsCore } from "@/lib/post-incident-review";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, context: Params) {
  const auth = await authenticateApiTokenWithScope(req, "reviews:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await context.params;
  try {
    const revisions = await listRevisionsCore(
      auth.token.organisationId,
      id,
      auth.token.createdBy,
    );
    return NextResponse.json(
      {
        revisions: revisions.map((r) => ({
          id: r.id,
          revision: r.revision,
          contentFingerprint: r.contentFingerprint,
          isApproved: r.isApproved,
          approvalDecision: r.approvalDecision,
          approvedBy: r.approvedBy,
          approvedAt: r.approvedAt?.toISOString() ?? null,
          boundContentFingerprint: r.boundContentFingerprint,
          approvalNotes: r.approvalNotes,
          createdBy: r.createdBy,
          createdAt: r.createdAt.toISOString(),
          // Content already redacted by listRevisionsCore when actor lacks
          // view_sensitive on the case.
          content: r.content,
        })),
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
