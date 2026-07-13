"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import {
  updateSsoSettings,
  type OidcConfig,
  type SamlConfig,
  type SsoRole,
} from "@/lib/sso/config";
import { assertSafeOutboundUrl } from "@/lib/outbound-request";

function parseRoleMap(raw: FormDataEntryValue | null): Record<string, SsoRole> {
  if (typeof raw !== "string" || !raw.trim()) return {};
  const out: Record<string, SsoRole> = {};
  // One mapping per line: claimValue=role
  for (const line of raw.split(/\r?\n/)) {
    const [k, v] = line.split("=").map((s) => s.trim());
    if (!k || !v) continue;
    if (v === "admin" || v === "analyst" || v === "read_only") out[k] = v;
  }
  return out;
}

export async function saveOidcConfig(formData: FormData) {
  const user = await requireRole(["admin"]);
  const issuer = String(formData.get("issuer") ?? "").trim();
  const clientId = String(formData.get("clientId") ?? "").trim();
  const clientSecret = String(formData.get("clientSecret") ?? "").trim();
  if (!issuer || !clientId || !clientSecret) {
    throw new Error("Issuer, client id and client secret are required");
  }
  await assertSafeOutboundUrl(issuer);
  const config: OidcConfig = {
    issuer,
    clientId,
    clientSecret,
    scopes: String(formData.get("scopes") ?? "").trim() || undefined,
    roleClaim: String(formData.get("roleClaim") ?? "").trim() || undefined,
    roleMap: parseRoleMap(formData.get("roleMap")),
  };
  await updateSsoSettings(user.organisationId, { oidc: config });
  revalidatePath("/settings/sso");
}

export async function saveSamlConfig(formData: FormData) {
  const user = await requireRole(["admin"]);
  const idpEntityId = String(formData.get("idpEntityId") ?? "").trim();
  const idpSsoUrl = String(formData.get("idpSsoUrl") ?? "").trim();
  const idpCertificate = String(formData.get("idpCertificate") ?? "").trim();
  if (!idpSsoUrl || !idpCertificate) {
    throw new Error("IdP SSO URL and certificate are required");
  }
  const config: SamlConfig = {
    idpEntityId,
    idpSsoUrl,
    idpCertificate,
    nameAttribute: String(formData.get("nameAttribute") ?? "").trim() || undefined,
    roleAttribute: String(formData.get("roleAttribute") ?? "").trim() || undefined,
    roleMap: parseRoleMap(formData.get("roleMap")),
  };
  await updateSsoSettings(user.organisationId, { saml: config });
  revalidatePath("/settings/sso");
}

export async function setForceSso(enabled: boolean) {
  const user = await requireRole(["admin"]);
  await updateSsoSettings(user.organisationId, { forceSso: enabled });
  revalidatePath("/settings/sso");
}

export async function clearOidcConfig() {
  const user = await requireRole(["admin"]);
  await updateSsoSettings(user.organisationId, { oidc: undefined });
  revalidatePath("/settings/sso");
}

export async function clearSamlConfig() {
  const user = await requireRole(["admin"]);
  await updateSsoSettings(user.organisationId, { saml: undefined });
  revalidatePath("/settings/sso");
}
