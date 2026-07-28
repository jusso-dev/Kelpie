import { NextResponse } from "next/server";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import { countCaseViewCore, type CaseViewActor } from "@/lib/case-views/core";
import { listWatchedCaseIdsCore } from "@/lib/watchers-core";

function actorFromAuth(token: {
  organisationId: string;
  createdBy: string | null;
}): CaseViewActor {
  return {
    id: token.createdBy ?? `token:${token.organisationId}`,
    organisationId: token.organisationId,
    role: "analyst",
  };
}

/**
 * Complete inbox-style count for a saved view. Uses a full organisation-
 * scoped aggregate query — never the current page of rows.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiTokenWithScope(req, "case_views:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await params;
  const actor = actorFromAuth(auth.token);
  const watchedCaseIds =
    actor.id.startsWith("token:")
      ? []
      : await listWatchedCaseIdsCore(actor.organisationId, actor.id);
  const result = await countCaseViewCore(actor, id, watchedCaseIds);
  if (!result) {
    return NextResponse.json({ error: "View not found" }, { status: 404 });
  }
  return NextResponse.json({ count: result });
}
