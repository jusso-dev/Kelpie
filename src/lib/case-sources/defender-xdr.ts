import { safeFetch } from "@/lib/outbound-request";
import type {
  CaseClassification,
  CaseSeverity,
  CaseStatus,
  CreateCaseInput,
} from "@/lib/cases-core";
import {
  compareSourceCursor,
  isAfterSourceCursor,
  parseSourceCursor,
  serialiseSourceCursor,
  type SourceCursor,
} from "./cursor";

const GRAPH_HOST = "graph.microsoft.com";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type DefenderXdrConfig = {
  tenant_id: string;
  client_id: string;
  client_secret: string;
  include_resolved?: string;
};

type DefenderIncident = {
  id?: string;
  displayName?: string;
  description?: string;
  summary?: string;
  severity?: string;
  status?: string;
  classification?: string;
  determination?: string;
  incidentWebUrl?: string;
  createdDateTime?: string;
  lastUpdateDateTime?: string;
  customTags?: string[];
  systemTags?: string[];
};

type DefenderIncidentList = {
  value?: DefenderIncident[];
  "@odata.nextLink"?: string;
};

export type DefenderXdrCase = {
  reference: string;
  modifiedAt: string;
  input: CreateCaseInput;
};

function required(config: DefenderXdrConfig, key: keyof DefenderXdrConfig): string {
  const value = config[key]?.trim();
  if (!value) throw new Error(`Microsoft Defender XDR ${key} is required`);
  return value;
}

export function validateDefenderXdrConfig(config: DefenderXdrConfig): void {
  const tenantId = required(config, "tenant_id");
  const clientId = required(config, "client_id");
  required(config, "client_secret");
  if (!UUID_PATTERN.test(tenantId)) throw new Error("Tenant ID must be a UUID");
  if (!UUID_PATTERN.test(clientId)) throw new Error("Client ID must be a UUID");
}

async function getAccessToken(config: DefenderXdrConfig): Promise<string> {
  const body = new URLSearchParams({
    client_id: config.client_id,
    client_secret: config.client_secret,
    grant_type: "client_credentials",
    scope: "https://graph.microsoft.com/.default",
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
    case "critical":
      return "critical";
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
    case "inprogress":
      return "in_progress";
    case "resolved":
    case "redirected":
      return "closed";
    default:
      return "open";
  }
}

function mapClassification(value: string | undefined): CaseClassification {
  switch (value?.toLowerCase()) {
    case "phishing":
      return "phishing";
    case "malware":
    case "unwantedsoftware":
    case "multistagedattack":
      return "malware";
    case "compromisedaccount":
    case "malicioususeractivity":
      return "unauthorised_access";
    default:
      return "other";
  }
}

function sourceUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "security.microsoft.com"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function tags(incident: DefenderIncident): string[] {
  return [
    "microsoft-defender-xdr",
    ...(incident.customTags ?? []),
    ...(incident.systemTags ?? []),
  ].filter((tag): tag is string => typeof tag === "string" && Boolean(tag.trim()));
}

export function mapDefenderXdrIncident(
  incident: DefenderIncident,
  sourceSystem: string,
): DefenderXdrCase | null {
  const reference = incident.id?.trim();
  const title = incident.displayName?.trim();
  const modifiedAt = incident.lastUpdateDateTime;
  if (!reference || !title || !modifiedAt || Number.isNaN(Date.parse(modifiedAt))) {
    return null;
  }
  const description = incident.description?.trim() ?? incident.summary?.trim() ?? "";
  return {
    reference,
    modifiedAt,
    input: {
      title,
      summary: description || undefined,
      status: mapStatus(incident.status),
      severity: mapSeverity(incident.severity),
      classification: mapClassification(
        incident.determination ?? incident.classification,
      ),
      tags: tags(incident),
      sourceSystem,
      sourceReference: reference,
      sourceUrl: sourceUrl(incident.incidentWebUrl),
    },
  };
}

function graphPageUrl(nextLink: string): URL {
  let url: URL;
  try {
    url = new URL(nextLink);
  } catch {
    throw new Error("Microsoft Defender XDR returned an invalid pagination URL");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== GRAPH_HOST ||
    (url.port && url.port !== "443")
  ) {
    throw new Error("Microsoft Defender XDR returned an invalid pagination URL");
  }
  return url;
}

export async function fetchDefenderXdrCases(
  config: DefenderXdrConfig,
  sourceSystem: string,
  cursor: string | null,
): Promise<{ cases: DefenderXdrCase[]; cursor: string | null }> {
  validateDefenderXdrConfig(config);
  const parsedCursor = parseSourceCursor(cursor);
  if (cursor && !parsedCursor) throw new Error("Microsoft Defender XDR cursor is invalid");
  const token = await getAccessToken(config);
  const url = new URL(`https://${GRAPH_HOST}/v1.0/security/incidents`);
  url.searchParams.set("$top", "100");
  const found: DefenderXdrCase[] = [];
  let newest: SourceCursor | null = parsedCursor;
  let nextUrl: URL | null = url;
  while (nextUrl) {
    const response = await safeFetch(nextUrl, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new Error(`Microsoft Defender XDR request failed (${response.status})`);
    }
    const payload = (await response.json()) as DefenderIncidentList;
    let reachedOlderTimestamp = false;
    for (const incident of payload.value ?? []) {
      const mapped = mapDefenderXdrIncident(incident, sourceSystem);
      if (!mapped) continue;
      const itemCursor = { timestamp: mapped.modifiedAt, id: mapped.reference };
      if (!isAfterSourceCursor(itemCursor, parsedCursor)) {
        if (
          parsedCursor &&
          Date.parse(itemCursor.timestamp) < Date.parse(parsedCursor.timestamp)
        ) {
          reachedOlderTimestamp = true;
        }
        continue;
      }
      if (!newest || compareSourceCursor(itemCursor, newest) > 0) newest = itemCursor;
      if (config.include_resolved !== "true" && mapped.input.status === "closed") {
        continue;
      }
      found.push(mapped);
    }
    if (reachedOlderTimestamp) break;
    nextUrl = payload["@odata.nextLink"]
      ? graphPageUrl(payload["@odata.nextLink"])
      : null;
  }
  return { cases: found, cursor: serialiseSourceCursor(newest) };
}
