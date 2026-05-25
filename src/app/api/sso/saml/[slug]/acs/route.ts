import { NextResponse } from "next/server";
import {
  appBaseUrl,
  getOrgBySlug,
  mapRole,
  readSsoSettings,
} from "@/lib/sso/config";
import { extractIdentity, validateResponse } from "@/lib/sso/saml";
import { provisionSsoUser } from "@/lib/sso/jit";
import { createSessionCookie } from "@/lib/sso/session";

export async function POST(
  req: Request,
  context: { params: Promise<{ slug: string }> },
) {
  const { slug } = await context.params;
  const org = await getOrgBySlug(slug);
  if (!org) {
    return NextResponse.redirect(`${appBaseUrl()}/sign-in?error=sso_unknown_org`);
  }
  const sso = readSsoSettings(org.settings);
  if (!sso.saml) {
    return NextResponse.redirect(`${appBaseUrl()}/sign-in?error=sso_not_configured`);
  }

  let samlResponse = "";
  try {
    const form = await req.formData();
    samlResponse = String(form.get("SAMLResponse") ?? "");
  } catch {
    return NextResponse.redirect(`${appBaseUrl()}/sign-in?error=sso_invalid`);
  }
  if (!samlResponse) {
    return NextResponse.redirect(`${appBaseUrl()}/sign-in?error=sso_no_response`);
  }

  try {
    const profile = await validateResponse(slug, sso.saml, samlResponse);
    const { email, name, roleRaw } = extractIdentity(profile, sso.saml);
    if (!email) {
      return NextResponse.redirect(`${appBaseUrl()}/sign-in?error=sso_no_email`);
    }
    const role = mapRole(roleRaw, sso.saml.roleMap);
    const { userId } = await provisionSsoUser({
      organisationId: org.id,
      email,
      name,
      role,
    });
    const cookie = await createSessionCookie(userId, req);
    const res = NextResponse.redirect(`${appBaseUrl()}/dashboard`);
    res.headers.append("Set-Cookie", cookie);
    return res;
  } catch (e) {
    return NextResponse.redirect(
      `${appBaseUrl()}/sign-in?error=sso_${encodeURIComponent((e as Error).message)}`,
    );
  }
}
