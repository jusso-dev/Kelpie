import { NextResponse } from "next/server";
import {
  clearStakeholderSessionCookieHeaders,
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
  for (const cookie of clearStakeholderSessionCookieHeaders()) {
    res.headers.append("Set-Cookie", cookie);
  }
  return res;
}
