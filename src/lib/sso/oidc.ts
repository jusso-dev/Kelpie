import crypto from "node:crypto";
import type { OidcConfig } from "./config";
import { safeFetch } from "@/lib/outbound-request";

type Discovery = {
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint?: string;
};

const discoveryCache = new Map<string, { doc: Discovery; at: number }>();
const DISCOVERY_TTL_MS = 60 * 60 * 1000;

export async function discover(issuer: string): Promise<Discovery> {
  const base = issuer.replace(/\/$/, "");
  const cached = discoveryCache.get(base);
  if (cached && Date.now() - cached.at < DISCOVERY_TTL_MS) return cached.doc;
  const res = await safeFetch(`${base}/.well-known/openid-configuration`, {
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`OIDC discovery failed: HTTP ${res.status}`);
  const doc = (await res.json()) as Discovery;
  if (!doc.authorization_endpoint || !doc.token_endpoint) {
    throw new Error("OIDC discovery document is missing required endpoints");
  }
  discoveryCache.set(base, { doc, at: Date.now() });
  return doc;
}

export function pkce(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto
    .createHash("sha256")
    .update(verifier)
    .digest("base64url");
  return { verifier, challenge };
}

export function buildAuthorizeUrl(opts: {
  discovery: Discovery;
  config: OidcConfig;
  redirectUri: string;
  state: string;
  nonce: string;
  challenge: string;
}): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: opts.config.clientId,
    redirect_uri: opts.redirectUri,
    scope: opts.config.scopes?.trim() || "openid email profile",
    state: opts.state,
    nonce: opts.nonce,
    code_challenge: opts.challenge,
    code_challenge_method: "S256",
  });
  return `${opts.discovery.authorization_endpoint}?${params.toString()}`;
}

export type OidcClaims = Record<string, unknown>;

function decodeJwtPayload(jwt: string): OidcClaims {
  const parts = jwt.split(".");
  if (parts.length < 2) return {};
  try {
    return JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    ) as OidcClaims;
  } catch {
    return {};
  }
}

export async function exchangeCode(opts: {
  discovery: Discovery;
  config: OidcConfig;
  redirectUri: string;
  code: string;
  verifier: string;
}): Promise<OidcClaims> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: opts.code,
    redirect_uri: opts.redirectUri,
    client_id: opts.config.clientId,
    client_secret: opts.config.clientSecret,
    code_verifier: opts.verifier,
  });
  const res = await safeFetch(opts.discovery.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(15000),
  });
  const json = (await res.json().catch(() => ({}))) as {
    id_token?: string;
    access_token?: string;
    error_description?: string;
  };
  if (!res.ok || (!json.id_token && !json.access_token)) {
    throw new Error(json.error_description || `token exchange HTTP ${res.status}`);
  }

  let claims: OidcClaims = json.id_token ? decodeJwtPayload(json.id_token) : {};

  // Merge userinfo for providers that keep email/role out of the id_token.
  if (opts.discovery.userinfo_endpoint && json.access_token) {
    const ui = await safeFetch(opts.discovery.userinfo_endpoint, {
      headers: { Authorization: `Bearer ${json.access_token}` },
      signal: AbortSignal.timeout(15000),
    }).catch(() => null);
    if (ui && ui.ok) {
      const uiJson = (await ui.json().catch(() => ({}))) as OidcClaims;
      claims = { ...claims, ...uiJson };
    }
  }
  return claims;
}

export function claimString(claims: OidcClaims, path: string): string | undefined {
  let cur: unknown = claims;
  for (const part of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  if (typeof cur === "string") return cur;
  if (Array.isArray(cur) && typeof cur[0] === "string") return cur[0] as string;
  return undefined;
}
