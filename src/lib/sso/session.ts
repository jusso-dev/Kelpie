import crypto from "node:crypto";
import { db } from "@/db";
import { sessions } from "@/db/schema";
import { newId } from "@/lib/utils";
import { AUTH_SECRET, AUTH_BASE_URL } from "@/lib/auth";

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const COOKIE_BASE = "better-auth.session_token";

function useSecureCookies(): boolean {
  return AUTH_BASE_URL.startsWith("https://");
}

function cookieName(): string {
  return useSecureCookies() ? `__Secure-${COOKIE_BASE}` : COOKIE_BASE;
}

/**
 * Creates a BetterAuth-compatible session row and returns a signed Set-Cookie
 * header value. The signing matches BetterAuth's cookie format exactly:
 *   encodeURIComponent(`${token}.${base64(hmacSha256(secret, token))}`)
 * so the standard session middleware accepts it.
 */
export async function createSessionCookie(
  userId: string,
  req: Request,
): Promise<string> {
  const token = crypto.randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000);

  await db.insert(sessions).values({
    id: newId("ses"),
    userId,
    token,
    expiresAt,
    ipAddress:
      req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
      req.headers.get("x-real-ip") ??
      null,
    userAgent: req.headers.get("user-agent") ?? null,
  });

  const signature = crypto
    .createHmac("sha256", AUTH_SECRET)
    .update(token)
    .digest("base64");
  const value = encodeURIComponent(`${token}.${signature}`);

  const parts = [
    `${cookieName()}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_TTL_SECONDS}`,
  ];
  if (useSecureCookies()) parts.push("Secure");
  return parts.join("; ");
}
