import { SAML, type Profile } from "@node-saml/node-saml";
import type { SamlConfig } from "./config";
import { samlAcsUrl, samlEntityId } from "./config";

function normaliseCert(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.includes("BEGIN CERTIFICATE")) return trimmed;
  // Bare base64 body → wrap as PEM.
  return `-----BEGIN CERTIFICATE-----\n${trimmed.replace(/\s+/g, "")}\n-----END CERTIFICATE-----`;
}

export function buildSaml(slug: string, config: SamlConfig): SAML {
  return new SAML({
    idpCert: normaliseCert(config.idpCertificate),
    issuer: samlEntityId(slug),
    callbackUrl: samlAcsUrl(slug),
    entryPoint: config.idpSsoUrl,
    audience: samlEntityId(slug),
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: false,
    acceptedClockSkewMs: 30000,
    disableRequestedAuthnContext: true,
    identifierFormat: null,
  });
}

export async function loginUrl(slug: string, config: SamlConfig): Promise<string> {
  const saml = buildSaml(slug, config);
  return saml.getAuthorizeUrlAsync("", undefined, {});
}

export async function validateResponse(
  slug: string,
  config: SamlConfig,
  samlResponse: string,
): Promise<Profile> {
  const saml = buildSaml(slug, config);
  const { profile } = await saml.validatePostResponseAsync({
    SAMLResponse: samlResponse,
  });
  if (!profile) throw new Error("SAML response did not contain a profile");
  return profile;
}

function attr(profile: Profile, key: string | undefined): string | undefined {
  if (!key) return undefined;
  const v = profile[key];
  if (typeof v === "string") return v;
  if (Array.isArray(v) && typeof v[0] === "string") return v[0] as string;
  return undefined;
}

export function extractIdentity(
  profile: Profile,
  config: SamlConfig,
): { email: string; name: string; roleRaw?: string } {
  const email =
    profile.email ||
    profile.mail ||
    attr(profile, "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress") ||
    profile.nameID;
  const name =
    attr(profile, config.nameAttribute) ||
    attr(profile, "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name") ||
    (profile.displayName as string | undefined) ||
    email;
  const roleRaw = attr(profile, config.roleAttribute);
  return { email: email ?? "", name: name ?? email ?? "", roleRaw };
}
