import { NextResponse } from "next/server";
import { z } from "zod";
import {
  acceptStakeholderInvite,
  clientIp,
  StakeholderError,
  stakeholderSessionCookieHeaders,
} from "@/lib/stakeholder";

const bodySchema = z.object({
  token: z.string().min(20).max(200),
});

/**
 * Exchange an invite token for an external session. Does not use BetterAuth.
 * Identical 401 for invalid/expired/revoked/replayed tokens.
 *
 * Response omits raw caseId (internal UUID) — clients use /api/portal/me for
 * the redacted case view (caseNumber, purpose, role).
 */
export async function POST(req: Request) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid or expired invitation" }, { status: 401 });
  }

  try {
    const { sessionToken, context } = await acceptStakeholderInvite({
      inviteToken: parsed.data.token,
      sourceIp: clientIp(req),
      userAgent: req.headers.get("user-agent"),
    });
    const res = NextResponse.json({
      ok: true,
      role: context.role,
      expiresAt: context.session.expiresAt.toISOString(),
      sessionToken,
    });
    for (const cookie of stakeholderSessionCookieHeaders(
      sessionToken,
      context.session.expiresAt,
    )) {
      res.headers.append("Set-Cookie", cookie);
    }
    return res;
  } catch (e) {
    if (e instanceof StakeholderError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }
}
