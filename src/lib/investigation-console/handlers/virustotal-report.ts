import { z } from "zod";
import { db } from "@/db";
import { organisations } from "@/db/schema";
import { eq } from "drizzle-orm";
import { safeFetch } from "@/lib/outbound-request";
import {
  entityValueSchema,
  observableTypeSchema,
} from "../params";
import type { InvestigationCommandHandler } from "../types";

const VT_TYPES = ["ip", "domain", "url", "file_hash"] as const;

const paramSchema = z.object({
  value: entityValueSchema,
  type: observableTypeSchema.refine(
    (t): t is (typeof VT_TYPES)[number] =>
      (VT_TYPES as readonly string[]).includes(t),
    { message: "VirusTotal supports ip, domain, url, file_hash only" },
  ),
});

async function getApiKey(organisationId: string): Promise<string | null> {
  const [org] = await db
    .select({ settings: organisations.settings })
    .from(organisations)
    .where(eq(organisations.id, organisationId))
    .limit(1);
  const settings = (org?.settings as Record<string, unknown>) ?? {};
  const key = settings.vt_api_key;
  if (typeof key === "string" && key.trim()) return key.trim();
  return process.env.VIRUSTOTAL_API_KEY?.trim() || null;
}

/**
 * Build a fixed VirusTotal API v3 path from typed indicator fields.
 * Never accepts a free-form destination URL (SSRF-safe).
 */
export function virusTotalEndpointFor(
  type: string,
  value: string,
): string | null {
  switch (type) {
    case "ip":
      return `https://www.virustotal.com/api/v3/ip_addresses/${encodeURIComponent(value)}`;
    case "domain":
      return `https://www.virustotal.com/api/v3/domains/${encodeURIComponent(value)}`;
    case "file_hash":
      return `https://www.virustotal.com/api/v3/files/${encodeURIComponent(value)}`;
    case "url": {
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
    id: data.id ?? null,
    malicious: stats.malicious ?? 0,
    suspicious: stats.suspicious ?? 0,
    harmless: stats.harmless ?? 0,
    undetected: stats.undetected ?? 0,
    timeout: stats.timeout ?? 0,
    reputation: attrs.reputation ?? null,
    categories: attrs.categories ?? null,
  };
}

/**
 * VirusTotal report for an indicator. Destination host is fixed in code;
 * parameters only supply type + value which are path-encoded into known
 * VT API routes. Uses safeFetch for DNS/SSRF policy.
 */
export const virusTotalReportHandler: InvestigationCommandHandler = {
  name: "virustotal.report",
  version: "1.0.0",
  label: "VirusTotal report",
  description:
    "Fetch a VirusTotal analysis summary for an IP, domain, URL, or file hash.",
  accessClass: "read",
  requiredScopes: ["investigation:execute"],
  parameters: [
    {
      key: "value",
      label: "Indicator value",
      type: "entity_value",
      required: true,
    },
    {
      key: "type",
      label: "Indicator type",
      type: "enum",
      required: true,
      enumValues: [...VT_TYPES],
    },
  ],
  paramSchema: paramSchema as z.ZodType<Record<string, unknown>>,
  resultRenderers: ["json", "table"],
  timeoutMs: 15_000,
  maxResultBytes: 128 * 1024,
  rateLimitPerMinute: 4,
  approvalRequired: false,
  redactParamKeys: ["api_key", "apikey"],
  async execute(params, ctx) {
    const value = String(params.value ?? "").trim();
    const type = String(params.type ?? "");
    const endpoint = virusTotalEndpointFor(type, value);
    if (!endpoint) {
      return {
        ok: false,
        renderer: "json",
        data: {},
        summary: "Unsupported indicator type for VirusTotal",
        error: "unsupported_type",
      };
    }

    const apiKey = await getApiKey(ctx.organisationId);
    if (!apiKey) {
      // Stub/mock mode when VT is not configured — deterministic offline shape
      // so the console remains usable in demos and tests without a key.
      return {
        ok: true,
        renderer: "json",
        summary: `VirusTotal mock report for ${type}:${value} (not configured)`,
        providerRequestId: `vt-mock:${type}:${value}`,
        data: {
          mode: "mock",
          type,
          value,
          stats: {
            malicious: 0,
            suspicious: 0,
            harmless: 0,
            undetected: 0,
          },
          note: "VirusTotal API key not configured; returning mock summary.",
        },
      };
    }

    if (ctx.signal.aborted) {
      return {
        ok: false,
        renderer: "json",
        data: {},
        summary: "Cancelled",
        error: "cancelled",
      };
    }

    try {
      const res = await safeFetch(endpoint, {
        headers: { "x-apikey": apiKey, accept: "application/json" },
        signal: ctx.signal,
      });
      if (res.status === 404) {
        return {
          ok: true,
          renderer: "json",
          summary: `No VirusTotal record for ${value}`,
          providerRequestId: res.headers.get("x-request-id"),
          data: { mode: "live", notFound: true, type, value },
        };
      }
      if (!res.ok) {
        return {
          ok: false,
          renderer: "json",
          data: { httpStatus: res.status },
          summary: `VirusTotal request failed (HTTP ${res.status})`,
          providerRequestId: res.headers.get("x-request-id"),
          error: `http_${res.status}`,
        };
      }
      const json = (await res.json()) as Record<string, unknown>;
      const stats = summariseStats(json);
      return {
        ok: true,
        renderer: "json",
        summary: `VirusTotal: ${stats.malicious} malicious / ${stats.suspicious} suspicious for ${value}`,
        providerRequestId:
          res.headers.get("x-request-id") ??
          (typeof stats.id === "string" ? stats.id : null),
        data: {
          mode: "live",
          type,
          value,
          stats,
        },
      };
    } catch (err) {
      if (ctx.signal.aborted) {
        return {
          ok: false,
          renderer: "json",
          data: {},
          summary: "Cancelled or timed out",
          error: "cancelled",
        };
      }
      return {
        ok: false,
        renderer: "json",
        data: {},
        summary: "VirusTotal request failed",
        error: (err as Error).message,
      };
    }
  },
};
