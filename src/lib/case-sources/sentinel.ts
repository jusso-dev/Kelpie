import { safeFetch } from "@/lib/outbound-request";
import type {
  CaseClassification,
  CaseSeverity,
  CaseStatus,
  CreateCaseInput,
} from "@/lib/cases-core";

const API_VERSION = "2025-09-01";
const ARM_HOST = "management.azure.com";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RESOURCE_NAME_PATTERN = /^[A-Za-z0-9_.()-]+$/;
const WORKSPACE_PATTERN =
  /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,88}[A-Za-z0-9])?$/;

export type SentinelConfig = {
  tenant_id: string;
  client_id: string;
  client_secret: string;
  subscription_id: string;
  resource_group: string;
  workspace_name: string;
  include_closed?: string;
};

type SentinelIncident = {
  name?: string;
  properties?: {
    title?: string;
    description?: string;
    severity?: string;
    status?: string;
    incidentUrl?: string;
    incidentNumber?: number;
    lastModifiedTimeUtc?: string;
    createdTimeUtc?: string;
    labels?: Array<{ labelName?: string }>;
    additionalData?: { tactics?: string[] };
  };
};

type SentinelIncidentList = {
  value?: SentinelIncident[];
  nextLink?: string;
};

export type SentinelCase = {
  reference: string;
  modifiedAt: string;
  input: CreateCaseInput;
};

function required(config: SentinelConfig, key: keyof SentinelConfig): string {
  const value = config[key]?.trim();
  if (!value) throw new Error(`Microsoft Sentinel ${key} is required`);
  return value;
}

export function validateSentinelConfig(config: SentinelConfig): void {
  const tenantId = required(config, "tenant_id");
  const clientId = required(config, "client_id");
  const subscriptionId = required(config, "subscription_id");
  required(config, "client_secret");
  const resourceGroup = required(config, "resource_group");
  const workspaceName = required(config, "workspace_name");
  if (!UUID_PATTERN.test(tenantId)) throw new Error("Tenant ID must be a UUID");
  if (!UUID_PATTERN.test(clientId)) throw new Error("Client ID must be a UUID");
  if (!UUID_PATTERN.test(subscriptionId)) {
    throw new Error("Subscription ID must be a UUID");
  }
  if (
    resourceGroup.length > 90 ||
    resourceGroup.endsWith(".") ||
    !RESOURCE_NAME_PATTERN.test(resourceGroup)
  ) {
    throw new Error("Resource group name is invalid");
  }
  if (!WORKSPACE_PATTERN.test(workspaceName)) {
    throw new Error("Workspace name is invalid");
  }
}

async function getAccessToken(config: SentinelConfig): Promise<string> {
  const body = new URLSearchParams({
    client_id: config.client_id,
    client_secret: config.client_secret,
    grant_type: "client_credentials",
    scope: "https://management.azure.com//.default",
  });
  const response = await safeFetch(
    `https://login.microsoftonline.com/${encodeURIComponent(config.tenant_id)}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) {
    throw new Error(`Microsoft identity token request failed (${response.status})`);
  }
  const payload = (await response.json()) as { access_token?: string };
  if (!payload.access_token) {
    throw new Error("Microsoft identity response did not include an access token");
  }
  return payload.access_token;
}

function mapSeverity(value: string | undefined): CaseSeverity {
  switch (value?.toLowerCase()) {
    case "high":
      return "high";
    case "medium":
      return "medium";
    default:
      return "low";
  }
}

function mapStatus(value: string | undefined): CaseStatus {
  switch (value?.toLowerCase()) {
    case "active":
      return "in_progress";
    case "closed":
      return "closed";
    default:
      return "open";
  }
}

function inferClassification(title: string, description: string): CaseClassification {
  const text = `${title} ${description}`.toLowerCase();
  if (text.includes("phish")) return "phishing";
  if (
    text.includes("malware") ||
    text.includes("ransomware") ||
    text.includes("trojan")
  ) {
    return "malware";
  }
  if (
    text.includes("unauthorised") ||
    text.includes("unauthorized") ||
    text.includes("account compromise")
  ) {
    return "unauthorised_access";
  }
  return "other";
}

function sourceUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "portal.azure.com"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export function mapSentinelIncident(
  incident: SentinelIncident,
  sourceSystem: string,
): SentinelCase | null {
  const reference = incident.name?.trim();
  const properties = incident.properties;
  const title = properties?.title?.trim();
  const modifiedAt = properties?.lastModifiedTimeUtc;
  if (!reference || !title || !modifiedAt) return null;
  const description = properties.description?.trim() ?? "";
  const labels =
    properties.labels
      ?.map((label) => label.labelName?.trim())
      .filter((label): label is string => Boolean(label)) ?? [];
  const tactics = properties.additionalData?.tactics ?? [];
  return {
    reference,
    modifiedAt,
    input: {
      title,
      summary: description || undefined,
      status: mapStatus(properties.status),
      severity: mapSeverity(properties.severity),
      classification: inferClassification(title, description),
      tags: ["microsoft-sentinel", ...labels, ...tactics],
      sourceSystem,
      sourceReference: reference,
      sourceUrl: sourceUrl(properties.incidentUrl),
    },
  };
}

export async function fetchSentinelCases(
  config: SentinelConfig,
  sourceSystem: string,
  cursor: string | null,
): Promise<{ cases: SentinelCase[]; cursor: string | null }> {
  validateSentinelConfig(config);
  const token = await getAccessToken(config);
  const path =
    `/subscriptions/${encodeURIComponent(config.subscription_id)}` +
    `/resourceGroups/${encodeURIComponent(config.resource_group)}` +
    "/providers/Microsoft.OperationalInsights" +
    `/workspaces/${encodeURIComponent(config.workspace_name)}` +
    "/providers/Microsoft.SecurityInsights/incidents";
  const url = new URL(`https://${ARM_HOST}${path}`);
  url.searchParams.set("api-version", API_VERSION);
  url.searchParams.set("$orderby", "properties/lastModifiedTimeUtc desc");
  url.searchParams.set("$top", "1000");
  const found: SentinelCase[] = [];
  let nextUrl: URL | null = url;
  let newest = cursor;
  while (nextUrl) {
    if (nextUrl.protocol !== "https:" || nextUrl.hostname !== ARM_HOST) {
      throw new Error("Microsoft Sentinel returned an invalid pagination URL");
    }
    const response = await safeFetch(nextUrl, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new Error(`Microsoft Sentinel request failed (${response.status})`);
    }
    const payload = (await response.json()) as SentinelIncidentList;
    let reachedCursor = false;
    for (const incident of payload.value ?? []) {
      const mapped = mapSentinelIncident(incident, sourceSystem);
      if (!mapped) continue;
      if (cursor && mapped.modifiedAt <= cursor) {
        reachedCursor = true;
        continue;
      }
      if (!newest || mapped.modifiedAt > newest) newest = mapped.modifiedAt;
      if (
        config.include_closed !== "true" &&
        mapped.input.status === "closed"
      ) {
        continue;
      }
      found.push(mapped);
    }
    if (reachedCursor) break;
    nextUrl = payload.nextLink ? new URL(payload.nextLink) : null;
  }
  return { cases: found, cursor: newest };
}
