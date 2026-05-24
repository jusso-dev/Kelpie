import crypto from "node:crypto";
import { db } from "@/db";
import { apiTokens } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

const TOKEN_PREFIX = "klp_";

export function generateApiToken(): { plaintext: string; hash: string } {
  const raw = crypto.randomBytes(32).toString("base64url");
  const plaintext = `${TOKEN_PREFIX}${raw}`;
  const hash = crypto.createHash("sha256").update(plaintext).digest("hex");
  return { plaintext, hash };
}

export function hashApiToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export type AuthenticatedToken = {
  id: string;
  organisationId: string;
  scopes: string[];
};

export async function authenticateApiToken(
  header: string | null,
): Promise<AuthenticatedToken | null> {
  if (!header) return null;
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : header.trim();
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  const hash = hashApiToken(token);
  const [row] = await db
    .select()
    .from(apiTokens)
    .where(eq(apiTokens.tokenHash, hash))
    .limit(1);
  if (!row) return null;
  if (row.expiresAt && row.expiresAt < new Date()) return null;
  await db
    .update(apiTokens)
    .set({ lastUsedAt: sql`now()` })
    .where(eq(apiTokens.id, row.id));
  return {
    id: row.id,
    organisationId: row.organisationId,
    scopes: (row.scopes as string[]) ?? [],
  };
}
