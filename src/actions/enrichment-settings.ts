"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { organisations } from "@/db/schema";
import { requireRole } from "@/lib/session";
import {
  testVirusTotalConnection,
  type VirusTotalConnectionTest,
} from "@/lib/enrichment/providers/virustotal";

async function organisationSettings(
  organisationId: string,
): Promise<Record<string, unknown>> {
  const [row] = await db
    .select({ settings: organisations.settings })
    .from(organisations)
    .where(eq(organisations.id, organisationId))
    .limit(1);
  return (row?.settings as Record<string, unknown>) ?? {};
}

function apiKeyFrom(formData: FormData): string {
  return String(formData.get("apiKey") ?? "").trim();
}

function rateLimitFrom(formData: FormData): number {
  const rateLimit = Number(formData.get("rateLimitPerMinute"));
  if (!Number.isInteger(rateLimit) || rateLimit < 1 || rateLimit > 500) {
    throw new Error("Rate limit must be between 1 and 500 requests per minute.");
  }
  return rateLimit;
}

export async function saveVirusTotalSettings(formData: FormData): Promise<void> {
  const user = await requireRole(["admin"]);
  const apiKey = apiKeyFrom(formData);
  const rateLimitPerMinute = rateLimitFrom(formData);
  if (apiKey && (apiKey.length < 16 || apiKey.length > 256)) {
    throw new Error("VirusTotal API key format is invalid.");
  }

  const settings = await organisationSettings(user.organisationId);
  const existingKey =
    typeof settings.vt_api_key === "string" ? settings.vt_api_key.trim() : "";
  if (!apiKey && !existingKey && !process.env.VIRUSTOTAL_API_KEY?.trim()) {
    throw new Error("Enter a VirusTotal API key before saving.");
  }

  await db
    .update(organisations)
    .set({
      settings: {
        ...settings,
        ...(apiKey ? { vt_api_key: apiKey } : {}),
        vt_rate_per_min: rateLimitPerMinute,
      },
    })
    .where(eq(organisations.id, user.organisationId));
  revalidatePath("/settings/integrations");
}

export async function testVirusTotalSettings(
  formData: FormData,
): Promise<VirusTotalConnectionTest> {
  const user = await requireRole(["admin"]);
  const submittedKey = apiKeyFrom(formData);
  const settings = await organisationSettings(user.organisationId);
  const storedKey =
    typeof settings.vt_api_key === "string" ? settings.vt_api_key.trim() : "";
  const apiKey =
    submittedKey || storedKey || process.env.VIRUSTOTAL_API_KEY?.trim() || "";
  if (!apiKey) throw new Error("Enter or save a VirusTotal API key first.");
  return testVirusTotalConnection(apiKey);
}

export async function removeVirusTotalSettings(): Promise<void> {
  const user = await requireRole(["admin"]);
  const settings = await organisationSettings(user.organisationId);
  const { vt_api_key: _apiKey, vt_rate_per_min: _rate, ...next } = settings;
  await db
    .update(organisations)
    .set({ settings: next })
    .where(eq(organisations.id, user.organisationId));
  revalidatePath("/settings/integrations");
}

function brolgaBaseUrlFrom(formData: FormData): string {
  return String(formData.get("baseUrl") ?? "").trim();
}

function brolgaEnabledFrom(formData: FormData): boolean {
  const raw = formData.get("enabled");
  return raw === "on" || raw === "true" || raw === "1";
}

function brolgaTimeoutFrom(formData: FormData): number {
  const timeout = Number(formData.get("timeoutMs") ?? 8000);
  if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 30000) {
    throw new Error("Timeout must be between 1000 and 30000 milliseconds.");
  }
  return timeout;
}

export async function saveBrolgaSettings(formData: FormData): Promise<void> {
  const user = await requireRole(["admin"]);
  const baseUrlRaw = brolgaBaseUrlFrom(formData);
  const token = apiKeyFrom(formData);
  const enabled = brolgaEnabledFrom(formData);
  const timeoutMs = brolgaTimeoutFrom(formData);

  let baseUrl: string | null = null;
  if (baseUrlRaw) {
    let parsed: URL;
    try {
      parsed = new URL(baseUrlRaw);
    } catch {
      throw new Error("Brolga base URL is invalid.");
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error("Brolga base URL must use HTTP or HTTPS.");
    }
    baseUrl = parsed.origin;
  }

  const settings = await organisationSettings(user.organisationId);
  const existingUrl =
    typeof settings.brolga_base_url === "string"
      ? settings.brolga_base_url.trim()
      : "";
  if (enabled && !baseUrl && !existingUrl && !process.env.BROLGA_BASE_URL?.trim()) {
    throw new Error("Enter a Brolga base URL before enabling the integration.");
  }

  await db
    .update(organisations)
    .set({
      settings: {
        ...settings,
        ...(baseUrl ? { brolga_base_url: baseUrl } : {}),
        ...(token ? { brolga_api_token: token } : {}),
        brolga_enabled: enabled,
        brolga_timeout_ms: timeoutMs,
      },
    })
    .where(eq(organisations.id, user.organisationId));
  revalidatePath("/settings/integrations");
}

export async function testBrolgaSettings(): Promise<{
  ok: boolean;
  message: string;
  httpStatus?: number;
}> {
  const user = await requireRole(["admin"]);
  const { testBrolgaConnection } = await import("@/lib/brolga/client");
  return testBrolgaConnection(user.organisationId);
}

export async function removeBrolgaSettings(): Promise<void> {
  const user = await requireRole(["admin"]);
  const settings = await organisationSettings(user.organisationId);
  const {
    brolga_base_url: _url,
    brolga_api_token: _token,
    brolga_enabled: _enabled,
    brolga_timeout_ms: _timeout,
    ...next
  } = settings;
  await db
    .update(organisations)
    .set({ settings: next })
    .where(eq(organisations.id, user.organisationId));
  revalidatePath("/settings/integrations");
}
