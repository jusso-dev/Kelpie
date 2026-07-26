import { db } from "@/db";
import { organisations } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { EnrichmentProvider } from "../types";

const RATE_LIMIT_PER_MIN = 4; // VT free tier default; configurable below.
const windowMs = 60 * 1000;
type Window = { count: number; resetAt: number };
const windowsByOrg = new Map<string, Window>();

type VirusTotalSettings = Record<string, unknown>;

export type VirusTotalConfiguration = {
  configured: boolean;
  source: "organisation" | "environment" | null;
  rateLimitPerMinute: number;
};

export type VirusTotalConnectionTest = {
  malicious: number;
  suspicious: number;
  harmless: number;
  undetected: number;
};

async function getSettings(organisationId: string): Promise<VirusTotalSettings> {
  const [org] = await db
    .select({ settings: organisations.settings })
    .from(organisations)
    .where(eq(organisations.id, organisationId))
    .limit(1);
  return (org?.settings as VirusTotalSettings) ?? {};
}

async function getApiKey(organisationId: string): Promise<string | null> {
  const settings = await getSettings(organisationId);
  const key = settings.vt_api_key;
  if (typeof key === "string" && key.trim()) return key.trim();
  return process.env.VIRUSTOTAL_API_KEY?.trim() || null;
}

async function getCap(organisationId: string): Promise<number> {
  const settings = await getSettings(organisationId);
  const cap = settings.vt_rate_per_min;
  if (typeof cap === "number" && cap > 0) return cap;
  return RATE_LIMIT_PER_MIN;
}

export async function getVirusTotalConfiguration(
  organisationId: string,
): Promise<VirusTotalConfiguration> {
  const settings = await getSettings(organisationId);
  const organisationKey =
    typeof settings.vt_api_key === "string" && settings.vt_api_key.trim()
      ? settings.vt_api_key.trim()
      : null;
  const environmentKey = process.env.VIRUSTOTAL_API_KEY?.trim() || null;
  const rateLimit =
    typeof settings.vt_rate_per_min === "number" &&
    Number.isInteger(settings.vt_rate_per_min) &&
    settings.vt_rate_per_min > 0
      ? settings.vt_rate_per_min
      : RATE_LIMIT_PER_MIN;
  return {
    configured: Boolean(organisationKey || environmentKey),
    source: organisationKey
      ? "organisation"
      : environmentKey
        ? "environment"
        : null,
    rateLimitPerMinute: rateLimit,
  };
}

export async function testVirusTotalConnection(
  apiKey: string,
): Promise<VirusTotalConnectionTest> {
  const response = await fetch(
    "https://www.virustotal.com/api/v3/ip_addresses/1.1.1.1",
    {
      headers: { "x-apikey": apiKey, accept: "application/json" },
      signal: AbortSignal.timeout(15000),
      cache: "no-store",
    },
  );
  if (response.status === 401 || response.status === 403) {
    throw new Error("VirusTotal rejected this API key.");
  }
  if (response.status === 429) {
    throw new Error("VirusTotal rate limit reached. Try again later.");
  }
  if (!response.ok) {
    throw new Error(`VirusTotal connection failed with HTTP ${response.status}.`);
  }
  const summary = summariseStats(
    (await response.json()) as Record<string, unknown>,
  );
  return {
    malicious: Number(summary.malicious ?? 0),
    suspicious: Number(summary.suspicious ?? 0),
    harmless: Number(summary.harmless ?? 0),
    undetected: Number(summary.undetected ?? 0),
  };
}

async function rateLimit(organisationId: string): Promise<void> {
  const cap = await getCap(organisationId);
  const now = Date.now();
  const w = windowsByOrg.get(organisationId);
  if (!w || w.resetAt < now) {
    windowsByOrg.set(organisationId, { count: 1, resetAt: now + windowMs });
    return;
  }
  if (w.count < cap) {
    w.count += 1;
    return;
  }
  const waitMs = w.resetAt - now + 50;
  await new Promise((r) => setTimeout(r, waitMs));
  windowsByOrg.set(organisationId, { count: 1, resetAt: Date.now() + windowMs });
}

function endpointFor(type: string, value: string): string | null {
  switch (type) {
    case "ip":
      return `https://www.virustotal.com/api/v3/ip_addresses/${encodeURIComponent(value)}`;
    case "domain":
      return `https://www.virustotal.com/api/v3/domains/${encodeURIComponent(value)}`;
    case "file_hash":
      return `https://www.virustotal.com/api/v3/files/${encodeURIComponent(value)}`;
    case "url": {
      // VT requires the base64url-encoded URL without padding.
      const id = Buffer.from(value).toString("base64url").replace(/=+$/, "");
      return `https://www.virustotal.com/api/v3/urls/${id}`;
    }
    default:
      return null;
  }
}

function summariseStats(json: Record<string, unknown>): Record<string, unknown> {
  const data = (json.data as Record<string, unknown>) ?? {};
  const attrs = (data.attributes as Record<string, unknown>) ?? {};
  const stats = (attrs.last_analysis_stats as Record<string, number>) ?? {};
  return {
    malicious: stats.malicious ?? 0,
    suspicious: stats.suspicious ?? 0,
    harmless: stats.harmless ?? 0,
    undetected: stats.undetected ?? 0,
    timeout: stats.timeout ?? 0,
    categories: attrs.categories,
    reputation: attrs.reputation,
    link: `https://www.virustotal.com/gui/search/${encodeURIComponent(String((data as { id?: string }).id ?? ""))}`,
  };
}

export const virusTotalProvider: EnrichmentProvider = {
  name: "virustotal",
  cacheTtlSeconds: 24 * 60 * 60,
  supports(type) {
    return ["ip", "domain", "url", "file_hash"].includes(type);
  },
  async isConfigured(organisationId) {
    return (await getApiKey(organisationId)) !== null;
  },
  async enrich({ type, value, organisationId }) {
    const apiKey = await getApiKey(organisationId);
    if (!apiKey) return { status: "unconfigured" };
    const url = endpointFor(type, value);
    if (!url) return { status: "unsupported_type" };
    await rateLimit(organisationId);
    const res = await fetch(url, {
      headers: { "x-apikey": apiKey, accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });
    if (res.status === 404) return { status: "not_found" };
    if (!res.ok) {
      return { status: "error", http_status: res.status };
    }
    const json = (await res.json()) as Record<string, unknown>;
    return { status: "ok", ...summariseStats(json) };
  },
};
