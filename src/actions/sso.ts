"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import {
  getSsoSettings,
  updateSsoSettings,
  type OidcConfig,
  type SamlConfig,
  type SsoRole,
} from "@/lib/sso/config";
import { assertSafeOutboundUrl } from "@/lib/outbound-request";
import { recordAuditEvent } from "@/lib/audit/events";
import { auditContextFromHeaders } from "@/lib/audit/request-context";

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
  const previous = await getSsoSettings(user.organisationId);
  await updateSsoSettings(user.organisationId, { oidc: config });
  await recordAuditEvent({
    organisationId: user.organisationId,
    actorId: user.id,
    actorType: "user",
    actorLabel: user.email,
    action: "sso.configured",
    targetType: "sso_config",
    targetId: user.organisationId,
    targetLabel: "oidc",
    metadata: { provider: "oidc" },
    before: previous.oidc
      ? {
          issuer: previous.oidc.issuer,
          clientId: previous.oidc.clientId,
          scopes: previous.oidc.scopes,
          roleClaim: previous.oidc.roleClaim,
          roleMap: previous.oidc.roleMap,
        }
      : null,
    after: {
      issuer: config.issuer,
      clientId: config.clientId,
      scopes: config.scopes,
      roleClaim: config.roleClaim,
      roleMap: config.roleMap,
    },
    ...auditContextFromHeaders(await headers()),
  });
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
  const previous = await getSsoSettings(user.organisationId);
  await updateSsoSettings(user.organisationId, { saml: config });
  await recordAuditEvent({
    organisationId: user.organisationId,
    actorId: user.id,
    actorType: "user",
    actorLabel: user.email,
    action: "sso.configured",
    targetType: "sso_config",
    targetId: user.organisationId,
    targetLabel: "saml",
    metadata: { provider: "saml" },
    before: previous.saml
      ? {
          idpEntityId: previous.saml.idpEntityId,
          idpSsoUrl: previous.saml.idpSsoUrl,
          nameAttribute: previous.saml.nameAttribute,
          roleAttribute: previous.saml.roleAttribute,
          roleMap: previous.saml.roleMap,
        }
      : null,
    after: {
      idpEntityId: config.idpEntityId,
      idpSsoUrl: config.idpSsoUrl,
      nameAttribute: config.nameAttribute,
      roleAttribute: config.roleAttribute,
      roleMap: config.roleMap,
    },
    ...auditContextFromHeaders(await headers()),
  });
  revalidatePath("/settings/sso");
}

export async function setForceSso(enabled: boolean) {
  const user = await requireRole(["admin"]);
  const previous = await getSsoSettings(user.organisationId);
  await updateSsoSettings(user.organisationId, { forceSso: enabled });
  await recordAuditEvent({
    organisationId: user.organisationId,
    actorId: user.id,
    actorType: "user",
    actorLabel: user.email,
    action: "sso.updated",
    targetType: "sso_config",
    targetId: user.organisationId,
    targetLabel: "force_sso",
    metadata: { setting: "forceSso" },
    before: { forceSso: previous.forceSso ?? false },
    after: { forceSso: enabled },
    ...auditContextFromHeaders(await headers()),
  });
  revalidatePath("/settings/sso");
}

export async function clearOidcConfig() {
  const user = await requireRole(["admin"]);
  const previous = await getSsoSettings(user.organisationId);
  await updateSsoSettings(user.organisationId, { oidc: undefined });
  await recordAuditEvent({
    organisationId: user.organisationId,
    actorId: user.id,
    actorType: "user",
    actorLabel: user.email,
    action: "sso.disabled",
    targetType: "sso_config",
    targetId: user.organisationId,
    targetLabel: "oidc",
    metadata: { provider: "oidc" },
    before: previous.oidc
      ? { issuer: previous.oidc.issuer, clientId: previous.oidc.clientId }
      : null,
    after: null,
    ...auditContextFromHeaders(await headers()),
  });
  revalidatePath("/settings/sso");
}

export async function clearSamlConfig() {
  const user = await requireRole(["admin"]);
  const previous = await getSsoSettings(user.organisationId);
  await updateSsoSettings(user.organisationId, { saml: undefined });
  await recordAuditEvent({
    organisationId: user.organisationId,
    actorId: user.id,
    actorType: "user",
    actorLabel: user.email,
    action: "sso.disabled",
    targetType: "sso_config",
    targetId: user.organisationId,
    targetLabel: "saml",
    metadata: { provider: "saml" },
    before: previous.saml
      ? { idpEntityId: previous.saml.idpEntityId, idpSsoUrl: previous.saml.idpSsoUrl }
      : null,
    after: null,
    ...auditContextFromHeaders(await headers()),
  });
  revalidatePath("/settings/sso");
}
