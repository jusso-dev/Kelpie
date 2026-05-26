import { NextResponse } from "next/server";
import { getOrgBySlug, readSsoSettings } from "@/lib/sso/config";
import { loginUrl } from "@/lib/sso/saml";

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
  if (!sso.saml?.idpSsoUrl || !sso.saml.idpCertificate) {
    return NextResponse.json(
      { error: "SAML is not configured for this organisation" },
      { status: 400 },
    );
  }
  try {
    const url = await loginUrl(slug, sso.saml);
    return NextResponse.redirect(url);
  } catch (e) {
    return NextResponse.json(
      { error: `SAML start failed: ${(e as Error).message}` },
      { status: 502 },
    );
  }
}
