import { NextResponse } from "next/server";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import { TeamError, removeTeamMemberCore } from "@/lib/teams-core";

export async function DELETE(
  req: Request,
  context: { params: Promise<{ id: string; userId: string }> },
) {
  const auth = await authenticateApiTokenWithScope(req, "teams:write");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id, userId } = await context.params;
  try {
    await removeTeamMemberCore(auth.token.organisationId, id, userId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof TeamError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
