import { NextResponse } from "next/server";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import { removeAdditionalAssigneeCore } from "@/lib/case-ownership-core";

export async function DELETE(
  req: Request,
  context: { params: Promise<{ id: string; userId: string }> },
) {
  const auth = await authenticateApiTokenWithScope(req, "watchers:write");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id, userId } = await context.params;
  await removeAdditionalAssigneeCore(auth.token.organisationId, id, userId);
  return NextResponse.json({ ok: true });
}
