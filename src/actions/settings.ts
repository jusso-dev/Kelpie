"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { apiTokens } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireRole } from "@/lib/session";
import { newId } from "@/lib/utils";
import { generateApiToken } from "@/lib/api-tokens";

export async function createApiToken(formData: FormData): Promise<{
  plaintext: string;
}> {
  const user = await requireRole(["admin"]);
  const name = String(formData.get("name") ?? "").trim();
  const scopesRaw = String(formData.get("scopes") ?? "");
  if (!name) throw new Error("Name required");
  const scopes = scopesRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const { plaintext, hash } = generateApiToken();
  await db.insert(apiTokens).values({
    id: newId("tok"),
    organisationId: user.organisationId,
    name,
    tokenHash: hash,
    scopes,
    createdBy: user.id,
  });
  revalidatePath("/settings");
  return { plaintext };
}

export async function revokeApiToken(tokenId: string) {
  const user = await requireRole(["admin"]);
  await db
    .delete(apiTokens)
    .where(
      and(eq(apiTokens.id, tokenId), eq(apiTokens.organisationId, user.organisationId)),
    );
  revalidatePath("/settings");
}
