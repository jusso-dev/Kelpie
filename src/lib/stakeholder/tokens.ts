/**
 * Invite + session token helpers for the stakeholder portal.
 * Tokens are random, prefixed, and stored only as SHA-256 hashes.
 */

import crypto from "node:crypto";

export const INVITE_TOKEN_PREFIX = "kstk_";
export const SESSION_TOKEN_PREFIX = "ksts_";

export function hashStakeholderToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function generateInviteToken(): { plaintext: string; hash: string } {
  const raw = crypto.randomBytes(32).toString("base64url");
  const plaintext = `${INVITE_TOKEN_PREFIX}${raw}`;
  return { plaintext, hash: hashStakeholderToken(plaintext) };
}

export function generateSessionToken(): { plaintext: string; hash: string } {
  const raw = crypto.randomBytes(32).toString("base64url");
  const plaintext = `${SESSION_TOKEN_PREFIX}${raw}`;
  return { plaintext, hash: hashStakeholderToken(plaintext) };
}

export function looksLikeInviteToken(token: string): boolean {
  return token.startsWith(INVITE_TOKEN_PREFIX) && token.length > 20;
}

export function looksLikeSessionToken(token: string): boolean {
  return token.startsWith(SESSION_TOKEN_PREFIX) && token.length > 20;
}
