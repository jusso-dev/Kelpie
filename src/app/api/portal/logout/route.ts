import { NextResponse } from "next/server";
import {
  clearStakeholderSessionCookieHeader,
  extractStakeholderToken,
  authenticateStakeholderSession,
  revokeStakeholderSession,
} from "@/lib/stakeholder";

export async function POST(req: Request) {
  const token = extractStakeholderToken(req);
  const ctx = await authenticateStakeholderSession(token);
  if (ctx) {
    await revokeStakeholderSession(ctx.session.id, ctx.organisationId);
  }
  const res = NextResponse.json({ ok: true });
  res.headers.set("Set-Cookie", clearStakeholderSessionCookieHeader());
  return res;
}
