import { NextResponse } from "next/server";
import { db } from "@/db";
import { ssoLoginStates } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import {
  getOrgBySlug,
  mapRole,
  oidcCallbackUrl,
  readSsoSettings,
  appBaseUrl,
} from "@/lib/sso/config";
import { claimString, discover, exchangeCode } from "@/lib/sso/oidc";
import { provisionSsoUser } from "@/lib/sso/jit";
import { createSessionCookie } from "@/lib/sso/session";

export async function GET(
  req: Request,
  context: { params: Promise<{ slug: string }> },
) {
  const { slug } = await context.params;
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const err = url.searchParams.get("error");
  if (err) {
    return NextResponse.redirect(`${appBaseUrl()}/sign-in?error=sso_${err}`);
  }
  if (!code || !state) {
    return NextResponse.redirect(`${appBaseUrl()}/sign-in?error=sso_invalid`);
  }

  const org = await getOrgBySlug(slug);
  if (!org) {
    return NextResponse.redirect(`${appBaseUrl()}/sign-in?error=sso_unknown_org`);
  }
  const sso = readSsoSettings(org.settings);
  if (!sso.oidc) {
    return NextResponse.redirect(`${appBaseUrl()}/sign-in?error=sso_not_configured`);
  }

  const [stateRow] = await db
    .select()
    .from(ssoLoginStates)
    .where(
      and(
        eq(ssoLoginStates.id, state),
        eq(ssoLoginStates.organisationId, org.id),
      ),
    )
    .limit(1);
  if (!stateRow || !stateRow.codeVerifier) {
    return NextResponse.redirect(`${appBaseUrl()}/sign-in?error=sso_state`);
  }
  // One-time use.
  await db.delete(ssoLoginStates).where(eq(ssoLoginStates.id, state));

  try {
    const discovery = await discover(sso.oidc.issuer);
    const claims = await exchangeCode({
      discovery,
      config: sso.oidc,
      redirectUri: oidcCallbackUrl(slug),
      code,
      verifier: stateRow.codeVerifier,
    });
    const email =
      claimString(claims, "email") ?? claimString(claims, "preferred_username");
    if (!email) {
      return NextResponse.redirect(`${appBaseUrl()}/sign-in?error=sso_no_email`);
    }
    const name =
      claimString(claims, "name") ??
      ([claimString(claims, "given_name"), claimString(claims, "family_name")]
        .filter(Boolean)
        .join(" ") ||
        email);
    const roleRaw = sso.oidc.roleClaim
      ? claimString(claims, sso.oidc.roleClaim)
      : undefined;
    const role = mapRole(roleRaw, sso.oidc.roleMap);

    const { userId } = await provisionSsoUser({
      organisationId: org.id,
      email,
      name,
      role,
    });
    const cookie = await createSessionCookie(userId, req);
    const res = NextResponse.redirect(
      `${appBaseUrl()}${stateRow.redirectTo || "/dashboard"}`,
    );
    res.headers.append("Set-Cookie", cookie);
    return res;
  } catch (e) {
    return NextResponse.redirect(
      `${appBaseUrl()}/sign-in?error=sso_${encodeURIComponent((e as Error).message)}`,
    );
  }
}
