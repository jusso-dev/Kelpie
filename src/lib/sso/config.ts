import { db } from "@/db";
import { organisations } from "@/db/schema";
import { eq } from "drizzle-orm";
import { AUTH_BASE_URL } from "@/lib/auth";

export type SsoRole = "admin" | "analyst" | "read_only";

export type OidcConfig = {
  issuer: string;
  clientId: string;
  clientSecret: string;
  scopes?: string;
  roleClaim?: string;
  roleMap?: Record<string, SsoRole>;
};

export type SamlConfig = {
  idpEntityId: string;
  idpSsoUrl: string;
  idpCertificate: string;
  nameAttribute?: string;
  roleAttribute?: string;
  roleMap?: Record<string, SsoRole>;
};

export type SsoSettings = {
  forceSso?: boolean;
  oidc?: OidcConfig;
  saml?: SamlConfig;
};

type OrgRow = {
  id: string;
  slug: string;
  settings: Record<string, unknown>;
};

export function appBaseUrl(): string {
  return (process.env.APP_URL ?? AUTH_BASE_URL).replace(/\/$/, "");
}

export function samlAcsUrl(slug: string): string {
  return `${appBaseUrl()}/api/sso/saml/${slug}/acs`;
}

export function samlEntityId(slug: string): string {
  return `${appBaseUrl()}/api/sso/saml/${slug}/metadata`;
}

export function oidcCallbackUrl(slug: string): string {
  return `${appBaseUrl()}/api/sso/oidc/${slug}/callback`;
}

export async function getOrgBySlug(slug: string): Promise<OrgRow | null> {
  const [row] = await db
    .select({
      id: organisations.id,
      slug: organisations.slug,
      settings: organisations.settings,
    })
    .from(organisations)
    .where(eq(organisations.slug, slug))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    settings: (row.settings as Record<string, unknown>) ?? {},
  };
}

export function readSsoSettings(
  settings: Record<string, unknown>,
): SsoSettings {
  const sso = settings.sso;
  if (sso && typeof sso === "object") return sso as SsoSettings;
  return {};
}

export async function getSsoSettings(orgId: string): Promise<SsoSettings> {
  const [row] = await db
    .select({ settings: organisations.settings })
    .from(organisations)
    .where(eq(organisations.id, orgId))
    .limit(1);
  if (!row) return {};
  return readSsoSettings((row.settings as Record<string, unknown>) ?? {});
}

export async function updateSsoSettings(
  orgId: string,
  patch: Partial<SsoSettings>,
): Promise<void> {
  const [row] = await db
    .select({ settings: organisations.settings })
    .from(organisations)
    .where(eq(organisations.id, orgId))
    .limit(1);
  const settings = (row?.settings as Record<string, unknown>) ?? {};
  const current = readSsoSettings(settings);
  const next: SsoSettings = { ...current, ...patch };
  await db
    .update(organisations)
    .set({ settings: { ...settings, sso: next } })
    .where(eq(organisations.id, orgId));
}

export function mapRole(
  raw: string | undefined,
  roleMap: Record<string, SsoRole> | undefined,
): SsoRole {
  if (raw && roleMap && roleMap[raw]) return roleMap[raw];
  if (raw === "admin" || raw === "analyst" || raw === "read_only") return raw;
  return "analyst";
}
