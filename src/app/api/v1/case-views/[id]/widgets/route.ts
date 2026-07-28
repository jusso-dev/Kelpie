import { NextResponse } from "next/server";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  computeCaseViewWidgetsCore,
  getCaseViewCore,
  type CaseViewActor,
} from "@/lib/case-views/core";
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
 * Bounded SLA/workload summary widgets from the same complete query as the view.
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
  const view = await getCaseViewCore(actor, id);
  if (!view) {
    return NextResponse.json({ error: "View not found" }, { status: 404 });
  }
  const watchedCaseIds =
    actor.id.startsWith("token:")
      ? []
      : await listWatchedCaseIdsCore(actor.organisationId, actor.id);
  const widgets = await computeCaseViewWidgetsCore(
    {
      organisationId: actor.organisationId,
      userId: actor.id,
      watchedCaseIds,
    },
    view.config,
  );
  return NextResponse.json({ widgets });
}
