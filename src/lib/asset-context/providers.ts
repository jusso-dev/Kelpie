/**
 * Provider adapters for Entra identity inventory, Defender device inventory,
 * and a generic CMDB connector contract (issue #59).
 *
 * Full Microsoft Graph polling is intentionally out of band — these adapters
 * normalise pre-fetched provider payloads into UpsertContextInput rows so
 * REST import endpoints and future background jobs share one path.
 */

import type { UpsertContextInput } from "./context-core";
import type { CriticalityLevel, PrivilegeLevel } from "./types";

/** Generic CMDB connector contract — implementors map CMDB rows to this shape. */
export type CmdbRecord = {
  externalId: string;
  kind: "asset" | "identity" | "application" | "business_service";
  displayName: string;
  identifierKind:
    | "email"
    | "upn"
    | "aad_object_id"
    | "device_id"
    | "hostname"
    | "fqdn"
    | "ip"
    | "cloud_resource_id"
    | "application_id"
    | "other";
  identifierValue: string;
  criticality?: CriticalityLevel;
  privilegeLevel?: PrivilegeLevel;
  exposure?: "internal" | "partner" | "internet_facing" | "public";
  environment?:
    | "production"
    | "staging"
    | "development"
    | "test"
    | "sandbox"
    | "unknown";
  isCrownJewel?: boolean;
  recoveryPriority?: "p1" | "p2" | "p3" | "p4" | "none";
  ownerTeam?: string | null;
  ownerEmail?: string | null;
  businessService?: string | null;
  applicationName?: string | null;
  dataClassifications?: string[];
  regulatoryScope?: string[];
  attributes?: Record<string, unknown>;
};

export function mapCmdbRecords(
  organisationId: string,
  records: CmdbRecord[],
): UpsertContextInput[] {
  return records.map((r) => ({
    organisationId,
    kind: r.kind,
    displayName: r.displayName,
    primaryIdentifierKind: r.identifierKind,
    primaryIdentifierValue: r.identifierValue,
    criticality: r.criticality ?? "medium",
    privilegeLevel: r.privilegeLevel ?? "none",
    exposure: r.exposure ?? "internal",
    environment: r.environment ?? "unknown",
    isCrownJewel: r.isCrownJewel ?? false,
    recoveryPriority: r.recoveryPriority ?? "none",
    ownerTeam: r.ownerTeam ?? null,
    ownerEmail: r.ownerEmail ?? null,
    businessService: r.businessService ?? null,
    applicationName: r.applicationName ?? null,
    dataClassifications: r.dataClassifications ?? [],
    regulatoryScope: r.regulatoryScope ?? [],
    attributes: r.attributes ?? {},
    providerSource: "cmdb",
    providerExternalId: r.externalId,
  }));
}

/**
 * Subset of Microsoft Graph user fields used for identity context.
 * @see https://learn.microsoft.com/en-us/graph/api/resources/user
 */
export type EntraUserPayload = {
  id: string;
  displayName?: string | null;
  userPrincipalName?: string | null;
  mail?: string | null;
  jobTitle?: string | null;
  department?: string | null;
  accountEnabled?: boolean | null;
  /** Custom extension or app role hint — highest wins. */
  privilegeHint?: PrivilegeLevel | null;
};

function privilegeFromEntra(user: EntraUserPayload): PrivilegeLevel {
  if (user.privilegeHint) return user.privilegeHint;
  const title = (user.jobTitle ?? "").toLowerCase();
  if (
    /\b(domain admins?(?:istrator)?|global admins?(?:istrator)?|enterprise admins?(?:istrator)?)\b/.test(
      title,
    )
  ) {
    return "domain_admin";
  }
  if (/\b(admins?(?:istrator)?)\b/.test(title)) return "admin";
  if (/\b(engineer|devops|sre|security)\b/.test(title)) return "elevated";
  return "standard";
}

export function mapEntraUsers(
  organisationId: string,
  users: EntraUserPayload[],
): UpsertContextInput[] {
  const rows: UpsertContextInput[] = [];
  for (const u of users) {
    const upn = u.userPrincipalName?.trim();
    const mail = u.mail?.trim();
    const identValue = upn || mail;
    if (!identValue || !u.id) continue;
    rows.push({
      organisationId,
      kind: "identity",
      displayName: (u.displayName ?? identValue).trim(),
      primaryIdentifierKind: upn ? "upn" : "email",
      primaryIdentifierValue: identValue,
      privilegeLevel: privilegeFromEntra(u),
      criticality: privilegeFromEntra(u) === "domain_admin" ? "critical" : "medium",
      exposure: "internal",
      environment: "production",
      isCrownJewel: privilegeFromEntra(u) === "domain_admin",
      ownerTeam: u.department ?? null,
      attributes: {
        entraObjectId: u.id,
        accountEnabled: u.accountEnabled ?? null,
        jobTitle: u.jobTitle ?? null,
      },
      providerSource: "entra",
      providerExternalId: u.id,
    });
  }
  return rows;
}

/**
 * Subset of Defender / Graph managed device fields.
 * @see https://learn.microsoft.com/en-us/graph/api/resources/manageddevice
 */
export type DefenderDevicePayload = {
  id: string;
  deviceName?: string | null;
  aadDeviceId?: string | null;
  osPlatform?: string | null;
  riskScore?: string | null; // none | informational | low | medium | high
  exposureLevel?: string | null;
  isManaged?: boolean | null;
  healthStatus?: string | null;
};

function criticalityFromDefender(d: DefenderDevicePayload): CriticalityLevel {
  const risk = (d.riskScore ?? "").toLowerCase();
  if (risk === "high") return "high";
  if (risk === "medium") return "medium";
  return "low";
}

function exposureFromDefender(
  d: DefenderDevicePayload,
): "internal" | "internet_facing" {
  const exp = (d.exposureLevel ?? "").toLowerCase();
  if (exp === "high" || exp === "medium") return "internet_facing";
  return "internal";
}

export function mapDefenderDevices(
  organisationId: string,
  devices: DefenderDevicePayload[],
): UpsertContextInput[] {
  const rows: UpsertContextInput[] = [];
  for (const d of devices) {
    if (!d.id) continue;
    const hostname = d.deviceName?.trim();
    const deviceId = d.aadDeviceId?.trim() || d.id;
    rows.push({
      organisationId,
      kind: "asset",
      displayName: hostname || deviceId,
      primaryIdentifierKind: hostname ? "hostname" : "device_id",
      primaryIdentifierValue: hostname || deviceId,
      criticality: criticalityFromDefender(d),
      privilegeLevel: "none",
      exposure: exposureFromDefender(d),
      environment: "production",
      isCrownJewel: false,
      attributes: {
        defenderId: d.id,
        aadDeviceId: d.aadDeviceId ?? null,
        osPlatform: d.osPlatform ?? null,
        riskScore: d.riskScore ?? null,
        exposureLevel: d.exposureLevel ?? null,
        isManaged: d.isManaged ?? null,
        healthStatus: d.healthStatus ?? null,
      },
      providerSource: "defender",
      providerExternalId: d.id,
    });
  }
  return rows;
}
