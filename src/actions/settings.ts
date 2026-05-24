"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { apiTokens } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireRole } from "@/lib/session";
import { newId } from "@/lib/utils";
import { generateApiToken } from "@/lib/api-tokens";
import { isKnownScope } from "@/lib/scopes";

function parseScopes(raw: FormDataEntryValue | null): string[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const valid: string[] = [];
    for (const v of parsed) {
      if (typeof v === "string" && isKnownScope(v)) valid.push(v);
    }
    return valid;
  } catch {
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => isKnownScope(s));
  }
}

function parseExpiry(raw: FormDataEntryValue | null): Date | null {
  const v = typeof raw === "string" ? raw.trim() : "";
  if (!v || v === "never") return null;
  const days = Number(v);
  if (Number.isFinite(days) && days > 0) {
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  }
  return null;
}

export async function createApiToken(formData: FormData): Promise<{
  plaintext: string;
}> {
  const user = await requireRole(["admin"]);
  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Name required");
  const scopes = parseScopes(formData.get("scopes"));
  const expiresAt = parseExpiry(formData.get("expiresAt"));
  const { plaintext, hash } = generateApiToken();
  await db.insert(apiTokens).values({
    id: newId("tok"),
    organisationId: user.organisationId,
    name,
    tokenHash: hash,
    scopes,
    createdBy: user.id,
    expiresAt,
  });
  revalidatePath("/settings");
  return { plaintext };
}

export async function revokeApiToken(tokenId: string) {
  const user = await requireRole(["admin"]);
  await db
    .delete(apiTokens)
    .where(
      and(
        eq(apiTokens.id, tokenId),
        eq(apiTokens.organisationId, user.organisationId),
      ),
    );
  revalidatePath("/settings");
}

export async function rotateApiToken(tokenId: string): Promise<{ plaintext: string }> {
  const user = await requireRole(["admin"]);
  const [existing] = await db
    .select()
    .from(apiTokens)
    .where(
      and(
        eq(apiTokens.id, tokenId),
        eq(apiTokens.organisationId, user.organisationId),
      ),
    )
    .limit(1);
  if (!existing) throw new Error("Token not found");
  const { plaintext, hash } = generateApiToken();
  await db.insert(apiTokens).values({
    id: newId("tok"),
    organisationId: user.organisationId,
    name: `${existing.name} (rotated)`,
    tokenHash: hash,
    scopes: existing.scopes ?? [],
    createdBy: user.id,
    expiresAt: existing.expiresAt,
  });
  await db
    .update(apiTokens)
    .set({ deprecatedAt: new Date() })
    .where(eq(apiTokens.id, tokenId));
  revalidatePath("/settings");
  return { plaintext };
}
