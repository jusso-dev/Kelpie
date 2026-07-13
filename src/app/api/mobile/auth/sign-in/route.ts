import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { organisations, sessions, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { issueMobileToken } from "@/lib/mobile-auth";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

function mobileAuthError(message: string): { error: string; status: number } {
  const normalised = message.toLowerCase();
  if (normalised.includes("mfa")) return { error: "mfa_required", status: 403 };
  if (normalised.includes("password reset")) {
    return { error: "password_reset_required", status: 403 };
  }
  if (normalised.includes("onboarding")) return { error: "onboarding_required", status: 403 };
  if (normalised.includes("sso")) return { error: "sso_required", status: 403 };
  if (normalised.includes("locked") || normalised.includes("banned")) {
    return { error: "account_locked", status: 403 };
  }
  return { error: "invalid_credentials", status: 401 };
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const result = await auth.api.signInEmail({
      body: {
        email: parsed.data.email,
        password: parsed.data.password,
      },
    });

    const userId = result.user.id;
    // BetterAuth creates a regular browser session while validating the
    // password. The native app uses its scoped bearer token instead, so do not
    // leave an unbound cookie session behind.
    await db.delete(sessions).where(eq(sessions.token, result.token));
    const { token, expiresAt, scopes } = await issueMobileToken(userId);

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user?.organisationId) {
      return NextResponse.json({ error: "onboarding_required" }, { status: 403 });
    }

    const [org] = await db
      .select()
      .from(organisations)
      .where(eq(organisations.id, user.organisationId))
      .limit(1);

    return NextResponse.json({
      token,
      expiresAt: expiresAt.toISOString(),
      scopes,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        organisationId: user.organisationId,
        organisationName: org?.name ?? "",
        organisationSlug: org?.slug ?? "",
      },
    });
  } catch (e) {
    const mapped = mobileAuthError((e as Error).message);
    return NextResponse.json({ error: mapped.error }, { status: mapped.status });
  }
}
