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
          "Reached host but /v1/health is not implemented yet (expected until Brolga v0.5). URL is reachable.",
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
