import { NextResponse } from "next/server";
import {
  buildExternalPortalView,
  clientIp,
  recordStakeholderAccess,
  requireStakeholderAuth,
  StakeholderError,
} from "@/lib/stakeholder";

/**
 * External portal home — redacted case view for the authenticated session only.
 * Never returns org/member lists or unrelated case IDs.
 */
export async function GET(req: Request) {
  try {
    const ctx = await requireStakeholderAuth(req);
    const view = await buildExternalPortalView(ctx);
    await recordStakeholderAccess({
      organisationId: ctx.organisationId,
      caseId: ctx.caseId,
      invitationId: ctx.invitation.id,
      collaboratorId: ctx.collaborator.id,
      sessionId: ctx.session.id,
      action: "portal_viewed",
      targetType: "case",
      targetId: ctx.caseId,
      sourceIp: clientIp(req),
      userAgent: req.headers.get("user-agent"),
      actorLabel: ctx.collaborator.email,
    });
    return NextResponse.json(view);
  } catch (e) {
    if (e instanceof StakeholderError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }
}
