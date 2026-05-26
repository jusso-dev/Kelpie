import { NextResponse } from "next/server";
import { generateServiceProviderMetadata } from "@node-saml/node-saml";
import { getOrgBySlug, samlAcsUrl, samlEntityId } from "@/lib/sso/config";

export async function GET(
  _req: Request,
  context: { params: Promise<{ slug: string }> },
) {
  const { slug } = await context.params;
  const org = await getOrgBySlug(slug);
  if (!org) {
    return NextResponse.json({ error: "Unknown organisation" }, { status: 404 });
  }
  const xml = generateServiceProviderMetadata({
    issuer: samlEntityId(slug),
    callbackUrl: samlAcsUrl(slug),
    wantAssertionsSigned: true,
  });
  return new NextResponse(xml, {
    headers: { "Content-Type": "application/xml" },
  });
}
