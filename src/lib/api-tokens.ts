import crypto from "node:crypto";
import { db } from "@/db";
import { apiTokens } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import type { ScopeValue } from "./scopes";
import { tokenHasScope } from "./scopes";

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
  createdBy: string | null;
};

export type AuthFailure =
  | { ok: false; status: 401; reason: "missing" | "invalid" | "expired" | "deprecated" }
  | { ok: false; status: 403; reason: "forbidden" };
export type AuthSuccess = { ok: true; token: AuthenticatedToken };

function clientIp(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip");
}

export async function authenticateApiTokenWithScope(
  req: Request,
  required: ScopeValue | null,
): Promise<AuthSuccess | AuthFailure> {
  const header = req.headers.get("authorization");
  if (!header) return { ok: false, status: 401, reason: "missing" };
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : header.trim();
  if (!token.startsWith(TOKEN_PREFIX)) {
    return { ok: false, status: 401, reason: "invalid" };
  }
  const hash = hashApiToken(token);
  const [row] = await db
    .select()
    .from(apiTokens)
    .where(eq(apiTokens.tokenHash, hash))
    .limit(1);
  if (!row) return { ok: false, status: 401, reason: "invalid" };
  if (row.deprecatedAt && row.deprecatedAt < new Date()) {
    return { ok: false, status: 401, reason: "deprecated" };
  }
  if (row.expiresAt && row.expiresAt < new Date()) {
    return { ok: false, status: 401, reason: "expired" };
  }
  const scopes = (row.scopes as string[]) ?? [];
  if (required !== null && !tokenHasScope(scopes, required)) {
    return { ok: false, status: 403, reason: "forbidden" };
  }
  const ip = clientIp(req);
  await db
    .update(apiTokens)
    .set({ lastUsedAt: sql`now()`, lastUsedIp: ip ?? null })
    .where(eq(apiTokens.id, row.id));
  return {
    ok: true,
    token: {
      id: row.id,
      organisationId: row.organisationId,
      scopes,
      createdBy: row.createdBy,
    },
  };
}

/** Legacy single-arg form retained for the existing alerts route. */
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
  if (row.deprecatedAt && row.deprecatedAt < new Date()) return null;
  await db
    .update(apiTokens)
    .set({ lastUsedAt: sql`now()` })
    .where(eq(apiTokens.id, row.id));
  return {
    id: row.id,
    organisationId: row.organisationId,
    scopes: (row.scopes as string[]) ?? [],
    createdBy: row.createdBy,
  };
}
