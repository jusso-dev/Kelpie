import { db } from "@/db";
import { organisations } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { EnrichmentProvider } from "../types";

const RATE_LIMIT_PER_MIN = 4; // VT free tier default; configurable below.
const windowMs = 60 * 1000;
type Window = { count: number; resetAt: number };
const windowsByOrg = new Map<string, Window>();

async function getApiKey(organisationId: string): Promise<string | null> {
  const [org] = await db
    .select({ settings: organisations.settings })
    .from(organisations)
    .where(eq(organisations.id, organisationId))
    .limit(1);
  const settings = (org?.settings as Record<string, unknown>) ?? {};
  const key = settings.vt_api_key;
  if (typeof key === "string" && key.length > 0) return key;
  const envKey = process.env.VIRUSTOTAL_API_KEY;
  return envKey ?? null;
}

async function getCap(organisationId: string): Promise<number> {
  const [org] = await db
    .select({ settings: organisations.settings })
    .from(organisations)
    .where(eq(organisations.id, organisationId))
    .limit(1);
  const settings = (org?.settings as Record<string, unknown>) ?? {};
  const cap = settings.vt_rate_per_min;
  if (typeof cap === "number" && cap > 0) return cap;
  return RATE_LIMIT_PER_MIN;
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
