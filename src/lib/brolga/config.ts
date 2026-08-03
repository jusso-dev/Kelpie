import { db } from "@/db";
import { organisations } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * Org settings keys (jsonb on organisations.settings):
 * - brolga_base_url: HTTPS origin of Brolga (no trailing path)
 * - brolga_api_token: bearer token (optional until Brolga auth lands)
 * - brolga_enabled: boolean, default false until operator opts in
 * - brolga_timeout_ms: request timeout (default 8000)
 *
 * Env fallbacks (single-tenant / compose):
 * - BROLGA_BASE_URL
 * - BROLGA_API_TOKEN
 * - BROLGA_ENABLED=true
 */

export type BrolgaConfiguration = {
  enabled: boolean;
  configured: boolean;
  baseUrl: string | null;
  hasToken: boolean;
  tokenSource: "organisation" | "environment" | null;
  urlSource: "organisation" | "environment" | null;
  timeoutMs: number;
  /** Health endpoint for connectivity checks. */
  healthPath: string;
  /** Readiness endpoint (store answers). */
  readyPath: string;
  /** Store count endpoint. */
  statsPath: string;
  /** Context pack endpoint. */
  contextPath: string;
};

const DEFAULT_TIMEOUT_MS = 8_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 30_000;

export async function loadOrganisationSettings(
  organisationId: string,
): Promise<Record<string, unknown>> {
  const [row] = await db
    .select({ settings: organisations.settings })
    .from(organisations)
    .where(eq(organisations.id, organisationId))
    .limit(1);
  return (row?.settings as Record<string, unknown>) ?? {};
}

function trimString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function clampTimeout(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.trunc(value)));
  }
  return DEFAULT_TIMEOUT_MS;
}

function normaliseBaseUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    // Origin only — path stripped so we control /v1/...
    return url.origin;
  } catch {
    return null;
  }
}

export function configurationFromSettings(
  settings: Record<string, unknown>,
): BrolgaConfiguration {
  const orgUrl = trimString(settings.brolga_base_url);
  const envUrl = trimString(process.env.BROLGA_BASE_URL);
  const baseRaw = orgUrl ?? envUrl;
  const baseUrl = baseRaw ? normaliseBaseUrl(baseRaw) : null;
  const urlSource = orgUrl
    ? "organisation"
    : envUrl
      ? "environment"
      : null;

  const orgToken = trimString(settings.brolga_api_token);
  const envToken = trimString(process.env.BROLGA_API_TOKEN);
  const token = orgToken ?? envToken;
  const tokenSource = orgToken
    ? "organisation"
    : envToken
      ? "environment"
      : null;

  const envEnabled = process.env.BROLGA_ENABLED === "true";
  const orgEnabled = settings.brolga_enabled === true;
  const enabled =
    (orgEnabled || envEnabled) && Boolean(baseUrl);

  return {
    enabled,
    configured: Boolean(baseUrl),
    baseUrl,
    hasToken: Boolean(token),
    tokenSource,
    urlSource,
    timeoutMs: clampTimeout(settings.brolga_timeout_ms),
    // Brolga versions its routes in the path and serves them under `/api/v1` — see its
    // docs/API.md. The base URL is reduced to an origin above, so the full prefix belongs here.
    healthPath: "/api/v1/health",
    readyPath: "/api/v1/ready",
    statsPath: "/api/v1/stats",
    contextPath: "/api/v1/context",
  };
}

export async function getBrolgaConfiguration(
  organisationId: string,
): Promise<BrolgaConfiguration> {
  const settings = await loadOrganisationSettings(organisationId);
  return configurationFromSettings(settings);
}

export async function getBrolgaApiToken(
  organisationId: string,
): Promise<string | null> {
  const settings = await loadOrganisationSettings(organisationId);
  return (
    trimString(settings.brolga_api_token) ??
    trimString(process.env.BROLGA_API_TOKEN)
  );
}
