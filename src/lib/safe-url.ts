/**
 * Validation for externally supplied links that Kelpie stores and later renders
 * as an anchor (for example the `source_url` deep link on an imported case).
 *
 * Anything that reaches this helper came from outside the trust boundary, so it
 * is validated on the way in *and* on the way out: a value that predates this
 * check, or that was written by another path, must not become a `javascript:`
 * or `data:` href when the case page renders it.
 */

const SAFE_URL_PROTOCOLS = new Set(["http:", "https:"]);

export const MAX_EXTERNAL_URL_LENGTH = 2048;

/**
 * Returns the normalised URL when `value` is a link that is safe to store and
 * render, otherwise `null`. Only http(s) is accepted, embedded credentials are
 * rejected, and the value is length-capped.
 */
export function safeExternalUrl(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_EXTERNAL_URL_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (!SAFE_URL_PROTOCOLS.has(url.protocol)) return null;
  // `https://user:pass@host` renders a misleading hostname and can leak the
  // embedded credentials to the destination.
  if (url.username || url.password) return null;
  if (!url.hostname) return null;
  const normalised = url.toString();
  return normalised.length > MAX_EXTERNAL_URL_LENGTH ? null : normalised;
}

export function isSafeExternalUrl(value: string | null | undefined): boolean {
  return safeExternalUrl(value) !== null;
}
