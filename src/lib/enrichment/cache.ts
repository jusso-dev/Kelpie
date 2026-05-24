import crypto from "node:crypto";
import { db } from "@/db";
import { enrichmentCache } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { newId } from "@/lib/utils";

function valueHash(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export async function readCache(
  provider: string,
  type: string,
  value: string,
): Promise<Record<string, unknown> | null> {
  const [row] = await db
    .select()
    .from(enrichmentCache)
    .where(
      and(
        eq(enrichmentCache.provider, provider),
        eq(enrichmentCache.type, type),
        eq(enrichmentCache.valueHash, valueHash(value)),
      ),
    )
    .limit(1);
  if (!row) return null;
  if (row.expiresAt < new Date()) return null;
  return row.response as Record<string, unknown>;
}

export async function writeCache(
  provider: string,
  type: string,
  value: string,
  response: Record<string, unknown>,
  ttlSeconds: number,
): Promise<void> {
  if (ttlSeconds <= 0) return;
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  await db
    .insert(enrichmentCache)
    .values({
      id: newId("ec"),
      provider,
      type,
      valueHash: valueHash(value),
      response,
      expiresAt,
    })
    .onConflictDoUpdate({
      target: [enrichmentCache.provider, enrichmentCache.type, enrichmentCache.valueHash],
      set: { response, expiresAt, fetchedAt: sql`now()` },
    });
}

export async function purgeExpiredCache(): Promise<void> {
  await db.delete(enrichmentCache).where(sql`${enrichmentCache.expiresAt} < now()`);
}
