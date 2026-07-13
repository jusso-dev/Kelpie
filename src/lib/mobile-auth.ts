import { db } from "@/db";
import { apiTokens, organisations, users } from "@/db/schema";
import { generateApiToken, authenticateApiTokenWithScope } from "@/lib/api-tokens";
import type { ScopeValue } from "@/lib/scopes";
import { newId } from "@/lib/utils";
import { and, eq } from "drizzle-orm";

export const MOBILE_TOKEN_DAYS = 30;

const MOBILE_READ_SCOPES: ScopeValue[] = [
  "alerts:read",
  "cases:read",
  "tasks:read",
  "observables:read",
  "comments:read",
];

const MOBILE_ANALYST_SCOPES: ScopeValue[] = [
  ...MOBILE_READ_SCOPES,
  "alerts:write",
  "tasks:write",
  "comments:write",
];

export async function issueMobileToken(userId: string): Promise<{
  token: string;
  expiresAt: Date;
  scopes: ScopeValue[];
}> {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) throw new Error("User not found");
  if (user.banned) throw new Error("Account locked");
  if (user.passwordResetRequired) throw new Error("Password reset required");
  if (user.mfaRequired || user.twoFactorEnabled) throw new Error("MFA required");
  if (!user.organisationId) throw new Error("Onboarding required");

  const [org] = await db
    .select({ id: organisations.id })
    .from(organisations)
    .where(eq(organisations.id, user.organisationId))
    .limit(1);
  if (!org) throw new Error("Organisation not found");

  const { plaintext, hash } = generateApiToken();
  const expiresAt = new Date(Date.now() + MOBILE_TOKEN_DAYS * 24 * 60 * 60 * 1000);

  const scopes =
    user.role === "read_only" ? MOBILE_READ_SCOPES : MOBILE_ANALYST_SCOPES;
  await db.insert(apiTokens).values({
    id: newId("tok"),
    organisationId: user.organisationId,
    name: `iOS mobile session for ${user.email}`,
    tokenHash: hash,
    scopes,
    createdBy: user.id,
    expiresAt,
  });

  return { token: plaintext, expiresAt, scopes };
}

export async function authenticateMobileRequest(req: Request) {
  return authenticateApiTokenWithScope(req, null);
}

export async function authenticateMobileUser(req: Request) {
  const auth = await authenticateMobileRequest(req);
  if (!auth.ok) return auth;
  if (!auth.token.createdBy) {
    return { ok: false as const, status: 403 as const, reason: "forbidden" as const };
  }
  const [user] = await db
    .select()
    .from(users)
    .where(
      and(
        eq(users.id, auth.token.createdBy),
        eq(users.organisationId, auth.token.organisationId),
      ),
    )
    .limit(1);
  if (!user || user.banned) {
    return { ok: false as const, status: 403 as const, reason: "forbidden" as const };
  }
  return { ...auth, user };
}

export async function revokeMobileToken(tokenId: string, organisationId: string) {
  await db
    .update(apiTokens)
    .set({ deprecatedAt: new Date() })
    .where(
      and(
        eq(apiTokens.id, tokenId),
        eq(apiTokens.organisationId, organisationId),
      ),
    );
}
