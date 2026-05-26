import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { db } from "@/db";
import { ssoLoginStates } from "@/db/schema";
import { newId } from "@/lib/utils";
import {
  getOrgBySlug,
  readSsoSettings,
  oidcCallbackUrl,
} from "@/lib/sso/config";
import { buildAuthorizeUrl, discover, pkce } from "@/lib/sso/oidc";

export async function GET(
  _req: Request,
  context: { params: Promise<{ slug: string }> },
) {
  const { slug } = await context.params;
  const org = await getOrgBySlug(slug);
  if (!org) {
    return NextResponse.json({ error: "Unknown organisation" }, { status: 404 });
  }
  const sso = readSsoSettings(org.settings);
  if (!sso.oidc?.issuer || !sso.oidc.clientId) {
    return NextResponse.json(
      { error: "OIDC is not configured for this organisation" },
      { status: 400 },
    );
  }

  try {
    const discovery = await discover(sso.oidc.issuer);
    const { verifier, challenge } = pkce();
    const state = crypto.randomBytes(16).toString("base64url");
    const nonce = crypto.randomBytes(16).toString("base64url");
    await db.insert(ssoLoginStates).values({
      id: state,
      organisationId: org.id,
      kind: "oidc",
      nonce,
      codeVerifier: verifier,
      redirectTo: "/dashboard",
    });
    const url = buildAuthorizeUrl({
      discovery,
      config: sso.oidc,
      redirectUri: oidcCallbackUrl(slug),
      state,
      nonce,
      challenge,
    });
    return NextResponse.redirect(url);
  } catch (e) {
    return NextResponse.json(
      { error: `OIDC start failed: ${(e as Error).message}` },
      { status: 502 },
    );
  }
}
