/**
 * At-rest credential encryption for mailbox connections (issue #42).
 *
 * Format: `v1:<iv_b64url>:<tag_b64url>:<ciphertext_b64url>`
 * Algorithm: AES-256-GCM
 * Key: `CREDENTIALS_ENCRYPTION_KEY` — 32 raw bytes as base64, base64url, or 64 hex chars.
 *
 * Never log plaintext secrets or ciphertext blobs that include recoverable secrets
 * in application logs.
 */

import crypto from "node:crypto";

const PREFIX = "v1";
const IV_BYTES = 12;
const KEY_BYTES = 32;

export class CredentialCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialCryptoError";
  }
}

function resolveKeyMaterial(): Buffer {
  const raw = process.env.CREDENTIALS_ENCRYPTION_KEY?.trim();
  if (!raw) {
    throw new CredentialCryptoError(
      "CREDENTIALS_ENCRYPTION_KEY is required to store mailbox credentials",
    );
  }
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, "hex");
  }
  // Accept standard or url-safe base64 of 32 bytes.
  const b64 = raw.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  try {
    const buf = Buffer.from(padded, "base64");
    if (buf.length === KEY_BYTES) return buf;
  } catch {
    // fall through
  }
  throw new CredentialCryptoError(
    "CREDENTIALS_ENCRYPTION_KEY must be 32 bytes (64 hex chars or base64)",
  );
}

function b64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromB64url(value: string): Buffer {
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  return Buffer.from(padded, "base64");
}

/** Seal a JSON-serialisable secret object. */
export function encryptCredentials(secrets: Record<string, unknown>): string {
  const key = resolveKeyMaterial();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(secrets), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}:${b64url(iv)}:${b64url(tag)}:${b64url(ciphertext)}`;
}

/** Open a sealed credential blob produced by `encryptCredentials`. */
export function decryptCredentials(sealed: string): Record<string, string> {
  const key = resolveKeyMaterial();
  const parts = sealed.split(":");
  if (parts.length !== 4 || parts[0] !== PREFIX) {
    throw new CredentialCryptoError("Unsupported credential ciphertext format");
  }
  const [, ivPart, tagPart, ctPart] = parts;
  if (!ivPart || !tagPart || !ctPart) {
    throw new CredentialCryptoError("Malformed credential ciphertext");
  }
  const iv = fromB64url(ivPart);
  const tag = fromB64url(tagPart);
  const ciphertext = fromB64url(ctPart);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  const parsed = JSON.parse(plaintext.toString("utf8")) as Record<
    string,
    unknown
  >;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (typeof v === "string") out[k] = v;
    else if (v == null) continue;
    else out[k] = String(v);
  }
  return out;
}

/** True when env provides a usable key (tests / startup checks). */
export function hasCredentialsEncryptionKey(): boolean {
  try {
    resolveKeyMaterial();
    return true;
  } catch {
    return false;
  }
}
