import { assertSafeOutboundUrl, safeFetch } from "@/lib/outbound-request";
import {
  getBrolgaApiToken,
  getBrolgaConfiguration,
  type BrolgaConfiguration,
} from "./config";
import {
  BROLGA_CONTEXT_REQUEST_SCHEMA,
  isBrolgaContextPack,
  type BrolgaContextPack,
  type BrolgaContextRequest,
  type BrolgaLookupResult,
} from "./types";

export type { BrolgaConfiguration };

/**
 * Build the absolute URL for a Brolga path under the configured origin.
 */
export function brolgaUrl(config: BrolgaConfiguration, path: string): string {
  if (!config.baseUrl) throw new Error("Brolga base URL is not configured");
  const normalised = path.startsWith("/") ? path : `/${path}`;
  return `${config.baseUrl}${normalised}`;
}

function authHeaders(token: string | null): HeadersInit {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

/**
 * Probe Brolga health. Used by settings "Test connection".
 * Treats connection refused / 404 as unavailable (API not shipped yet).
 */
export async function testBrolgaConnection(
  organisationId: string,
): Promise<{ ok: boolean; message: string; httpStatus?: number }> {
  const config = await getBrolgaConfiguration(organisationId);
  if (!config.configured || !config.baseUrl) {
    return {
      ok: false,
      message: "Set a Brolga base URL before testing.",
    };
  }
  if (!config.enabled) {
    return {
      ok: false,
      message: "Brolga is configured but disabled. Enable it to use context packs.",
    };
  }

  const token = await getBrolgaApiToken(organisationId);
  const url = brolgaUrl(config, config.healthPath);
  try {
    await assertSafeOutboundUrl(url);
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "Brolga URL failed outbound safety checks",
    };
  }

  try {
    const res = await safeFetch(url, {
      method: "GET",
      headers: authHeaders(token),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
    if (res.ok) {
      return { ok: true, message: "Brolga health endpoint responded OK.", httpStatus: res.status };
    }
    if (res.status === 404) {
      return {
        ok: false,
        message:
          "Reached host but /api/v1/health is not there. Check the URL points at Brolga's origin, not a path.",
        httpStatus: 404,
      };
    }
    return {
      ok: false,
      message: `Brolga returned HTTP ${res.status}.`,
      httpStatus: res.status,
    };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? `Could not reach Brolga: ${error.message}`
          : "Could not reach Brolga.",
    };
  }
}

/**
 * Request a context pack for one subject.
 * Never throws for "not ready" — returns structured status for UI/enrichment.
 */
export async function requestBrolgaContext(
  organisationId: string,
  request: Omit<BrolgaContextRequest, "schema_version" | "organisation_id"> & {
    organisation_id?: string;
  },
): Promise<BrolgaLookupResult> {
  const config = await getBrolgaConfiguration(organisationId);
  if (!config.configured || !config.baseUrl) {
    return {
      status: "unconfigured",
      message:
        "Brolga is not configured. Set base URL under Settings → Integrations when the engine is deployed.",
    };
  }
  if (!config.enabled) {
    return {
      status: "unconfigured",
      message: "Brolga integration is disabled for this organisation.",
    };
  }

  const token = await getBrolgaApiToken(organisationId);
  const url = brolgaUrl(config, config.contextPath);
  const body: BrolgaContextRequest = {
    schema_version: BROLGA_CONTEXT_REQUEST_SCHEMA,
    organisation_id: request.organisation_id ?? organisationId,
    subject: request.subject,
    purpose: request.purpose,
    detail_level: request.detail_level,
    budgets: request.budgets,
    case_id: request.case_id,
  };

  try {
    await assertSafeOutboundUrl(url);
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof Error
          ? error.message
          : "Brolga URL failed outbound safety checks",
    };
  }

  const started = Date.now();
  try {
    const res = await safeFetch(url, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
    const latencyMs = Date.now() - started;

    if (res.status === 404 || res.status === 501) {
      return {
        status: "unavailable",
        message:
          "Brolga context API is not available yet (expected until v0.5 Agent interfaces).",
      };
    }
    if (!res.ok) {
      const snippet = (await res.text().catch(() => "")).slice(0, 200);
      return {
        status: "error",
        message: snippet
          ? `Brolga HTTP ${res.status}: ${snippet}`
          : `Brolga HTTP ${res.status}`,
        httpStatus: res.status,
      };
    }

    const json: unknown = await res.json();
    if (!isBrolgaContextPack(json)) {
      return {
        status: "error",
        message: "Brolga returned a body without a schema_version context pack.",
        httpStatus: res.status,
      };
    }
    return { status: "ok", pack: json, latencyMs };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Brolga request failed";
    // Connection refused / DNS → unavailable so enrichment stays quiet.
    if (
      /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|fetch failed|network|timeout/i.test(
        message,
      )
    ) {
      return {
        status: "unavailable",
        message: `Brolga unreachable: ${message}`,
      };
    }
    return { status: "error", message };
  }
}

/** Convenience for tests / UI: extract a short disposition line from a pack. */
export function packDispositionSummary(pack: BrolgaContextPack): string {
  const parts: string[] = [];
  if (pack.disposition) parts.push(String(pack.disposition));
  if (typeof pack.confidence === "number") {
    parts.push(`confidence ${pack.confidence}`);
  }
  if (Array.isArray(pack.claims) && pack.claims.length > 0) {
    parts.push(`${pack.claims.length} claim(s)`);
  }
  return parts.length > 0 ? parts.join(" · ") : "Context pack received";
}

/** Store counts from `GET /api/v1/stats`. */
export type BrolgaStoreStats = {
  schema_version: number;
  entities: number;
  relationships: number;
  claims: number;
  sightings: number;
  sources: number;
  quarantined: number;
};

/** Snapshot for the Threat Intelligence page. */
export type BrolgaStatsSnapshot = {
  status: "ok" | "unconfigured" | "disabled" | "unavailable" | "error";
  message?: string;
  baseUrl: string | null;
  enabled: boolean;
  fetchedAt: string;
  health?: { status: string; version?: string };
  ready?: { status: string; schema_version: number; entities: number };
  stats?: BrolgaStoreStats;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function unwrapEnvelopeData(json: unknown): Record<string, unknown> | null {
  const root = asRecord(json);
  if (!root) return null;
  const data = asRecord(root.data);
  return data ?? root;
}

function parseStoreStats(json: unknown): BrolgaStoreStats | null {
  const data = unwrapEnvelopeData(json);
  if (!data) return null;
  const num = (key: string): number | null => {
    const v = data[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) {
      return Number(v);
    }
    return null;
  };
  const schema_version = num("schema_version");
  const entities = num("entities");
  const relationships = num("relationships");
  const claims = num("claims");
  const sightings = num("sightings");
  const sources = num("sources");
  const quarantined = num("quarantined");
  if (
    schema_version === null ||
    entities === null ||
    relationships === null ||
    claims === null ||
    sightings === null ||
    sources === null ||
    quarantined === null
  ) {
    return null;
  }
  return {
    schema_version,
    entities,
    relationships,
    claims,
    sightings,
    sources,
    quarantined,
  };
}

/**
 * Pull live store stats from Brolga for the TI dashboard.
 * Never throws — always returns a status the UI can render.
 */
export async function fetchBrolgaStats(
  organisationId: string,
): Promise<BrolgaStatsSnapshot> {
  const fetchedAt = new Date().toISOString();
  const config = await getBrolgaConfiguration(organisationId);

  if (!config.configured || !config.baseUrl) {
    return {
      status: "unconfigured",
      message:
        "Brolga is not configured. Set base URL under Settings → Integrations.",
      baseUrl: null,
      enabled: false,
      fetchedAt,
    };
  }
  if (!config.enabled) {
    return {
      status: "disabled",
      message: "Brolga is configured but disabled for this organisation.",
      baseUrl: config.baseUrl,
      enabled: false,
      fetchedAt,
    };
  }

  const token = await getBrolgaApiToken(organisationId);
  const headers = authHeaders(token);

  async function getJson(path: string): Promise<{ ok: boolean; status: number; json: unknown }> {
    const url = brolgaUrl(config, path);
    await assertSafeOutboundUrl(url);
    const res = await safeFetch(url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(config.timeoutMs),
    });
    const json: unknown = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, json };
  }

  try {
    const [healthRes, readyRes, statsRes] = await Promise.all([
      getJson(config.healthPath),
      getJson(config.readyPath),
      getJson(config.statsPath),
    ]);

    if (!healthRes.ok && !statsRes.ok) {
      const networkish = healthRes.status === 0;
      return {
        status: networkish || healthRes.status >= 500 ? "unavailable" : "error",
        message: `Brolga returned HTTP ${healthRes.status || statsRes.status}.`,
        baseUrl: config.baseUrl,
        enabled: true,
        fetchedAt,
      };
    }

    const healthBody = asRecord(healthRes.json);
    const readyBody = asRecord(readyRes.json);
    const stats = parseStoreStats(statsRes.json);

    if (!stats) {
      return {
        status: "error",
        message: statsRes.ok
          ? "Brolga /stats response could not be parsed."
          : `Brolga /stats returned HTTP ${statsRes.status}.`,
        baseUrl: config.baseUrl,
        enabled: true,
        fetchedAt,
        health:
          healthBody && typeof healthBody.status === "string"
            ? {
                status: healthBody.status,
                version:
                  typeof healthBody.version === "string"
                    ? healthBody.version
                    : undefined,
              }
            : undefined,
      };
    }

    return {
      status: "ok",
      baseUrl: config.baseUrl,
      enabled: true,
      fetchedAt,
      health:
        healthBody && typeof healthBody.status === "string"
          ? {
              status: healthBody.status,
              version:
                typeof healthBody.version === "string"
                  ? healthBody.version
                  : undefined,
            }
          : undefined,
      ready:
        readyBody && typeof readyBody.status === "string"
          ? {
              status: readyBody.status,
              schema_version:
                typeof readyBody.schema_version === "number"
                  ? readyBody.schema_version
                  : stats.schema_version,
              entities:
                typeof readyBody.entities === "number"
                  ? readyBody.entities
                  : stats.entities,
            }
          : undefined,
      stats,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Brolga stats failed";
    if (
      /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|fetch failed|network|timeout|non-public/i.test(
        message,
      )
    ) {
      return {
        status: "unavailable",
        message: `Brolga unreachable: ${message}`,
        baseUrl: config.baseUrl,
        enabled: true,
        fetchedAt,
      };
    }
    return {
      status: "error",
      message,
      baseUrl: config.baseUrl,
      enabled: true,
      fetchedAt,
    };
  }
}
