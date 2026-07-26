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
