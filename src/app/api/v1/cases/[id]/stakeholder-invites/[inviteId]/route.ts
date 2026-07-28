import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  previewExternalView,
  revokeStakeholderInvite,
  StakeholderError,
} from "@/lib/stakeholder";
import { authorizeCase, resolveTokenActor } from "@/lib/access";

const revokeSchema = z.object({
  reason: z.string().max(500).optional().nullable(),
});

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; inviteId: string }> },
) {
  const auth = await authenticateApiTokenWithScope(req, "cases:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id: caseId, inviteId } = await params;
  const actor = await resolveTokenActor(auth.token);
  try {
    const view = await previewExternalView({
      organisationId: auth.token.organisationId,
      invitationId: inviteId,
      caseId,
      actor,
    });
    return NextResponse.json({ preview: view });
  } catch (e) {
    if (e instanceof StakeholderError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; inviteId: string }> },
) {
  const auth = await authenticateApiTokenWithScope(req, "cases:write");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id: caseId, inviteId } = await params;
  const actor = await resolveTokenActor(auth.token);
  const gate = await authorizeCase(
    auth.token.organisationId,
    caseId,
    actor,
    "edit",
  );
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  let reason: string | null = null;
  try {
    const json = await req.json();
    const parsed = revokeSchema.safeParse(json);
    if (parsed.success) reason = parsed.data.reason ?? null;
  } catch {
    // empty body is fine
  }

  try {
    const updated = await revokeStakeholderInvite({
      organisationId: auth.token.organisationId,
      invitationId: inviteId,
      caseId,
      revokedByUserId: auth.token.createdBy ?? "",
      reason,
    });
    return NextResponse.json({
      id: updated.id,
      status: updated.status,
      revokedAt: updated.revokedAt?.toISOString() ?? null,
    });
  } catch (e) {
    if (e instanceof StakeholderError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }
}
