import {
  isTiIndicatorType,
  UNRECOGNISED_INDICATOR_TYPE,
  type TiIndicatorType,
} from "./indicator-types";

const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const HASH = /^[a-fA-F0-9]{32}$|^[a-fA-F0-9]{40}$|^[a-fA-F0-9]{64}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const DOMAIN = /^(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}$/;
const CIDR = /^(?:\d{1,3}\.){3}\d{1,3}\/(?:[0-9]|[12][0-9]|3[0-2])$/;
const CVE = /^CVE-\d{4}-\d{4,}$/i;

/**
 * Every shape Kelpie can recognise, including the ones it deliberately
 * refuses to store. Detection stays broad so ingestion can report an accurate
 * skip reason instead of silently discarding records.
 */
export type DetectedIndicatorType =
  | TiIndicatorType
  | "cidr"
  | "cve"
  | "email"
  | typeof UNRECOGNISED_INDICATOR_TYPE;

/** Shape of a bare indicator value, whether or not Kelpie supports it. */
export function detectIndicatorType(value: string): DetectedIndicatorType {
  const v = value.trim();
  if (IPV4.test(v)) return "ip";
  if (CIDR.test(v)) return "cidr";
  if (CVE.test(v)) return "cve";
  if (HASH.test(v)) return "file_hash";
  if (EMAIL.test(v)) return "email";
  if (/^https?:\/\//i.test(v)) return "url";
  if (DOMAIN.test(v)) return "domain";
  return UNRECOGNISED_INDICATOR_TYPE;
}

/** Supported type for a bare indicator value, or null when unsupported. */
export function guessIndicatorType(value: string): TiIndicatorType | null {
  const detected = detectIndicatorType(value);
  return isTiIndicatorType(detected) ? detected : null;
}

/** Common feed vocabulary mapped onto Kelpie's detection vocabulary. */
const TYPE_LABELS: Readonly<Record<string, DetectedIndicatorType>> = {
  ip: "ip",
  ipv4: "ip",
  "ip-dst": "ip",
  "ip-src": "ip",
  "ipv4-addr": "ip",
  cidr: "cidr",
  network: "cidr",
  cve: "cve",
  vulnerability: "cve",
  domain: "domain",
  hostname: "domain",
  "domain-name": "domain",
  url: "url",
  uri: "url",
  md5: "file_hash",
  sha1: "file_hash",
  sha256: "file_hash",
  hash: "file_hash",
  file: "file_hash",
  filehash: "file_hash",
  file_hash: "file_hash",
  email: "email",
  "email-src": "email",
  "email-dst": "email",
};

export type IndicatorTypeResolution =
  | { ok: true; type: TiIndicatorType }
  | { ok: false; rejectedType: string };

/**
 * Resolve a feed-supplied type label plus its value onto the strict indicator
 * contract. Unsupported records are rejected with the reason they were
 * rejected for; they are never coerced into a supported type.
 *
 * Precedence:
 *  1. A declared label Kelpie recognises but refuses (`cidr`, `cve`, `email`)
 *     is rejected on the label, even if the value looks like something else.
 *  2. A value whose own shape is refused is rejected on that shape, so a
 *     network range can never be relabelled as a single IP.
 *  3. Otherwise the value-derived type wins, falling back to a supported
 *     declared label when the value alone is inconclusive (for example a
 *     schemeless URL from a feed that declares `url`).
 */
export function resolveIndicatorType(
  raw: string,
  value: string,
): IndicatorTypeResolution {
  const label = raw.trim().toLowerCase();
  const declared = label ? TYPE_LABELS[label] ?? null : null;
  if (declared && !isTiIndicatorType(declared)) {
    return { ok: false, rejectedType: declared };
  }

  const detected = detectIndicatorType(value);
  if (detected !== UNRECOGNISED_INDICATOR_TYPE && !isTiIndicatorType(detected)) {
    return { ok: false, rejectedType: detected };
  }
  if (isTiIndicatorType(detected)) return { ok: true, type: detected };
  if (declared && isTiIndicatorType(declared)) return { ok: true, type: declared };
  return { ok: false, rejectedType: UNRECOGNISED_INDICATOR_TYPE };
}

/**
 * Convenience wrapper for callers that only need the supported type.
 * Returns null when the record must be skipped.
 */
export function normaliseType(
  raw: string,
  value: string,
): TiIndicatorType | null {
  const resolved = resolveIndicatorType(raw, value);
  return resolved.ok ? resolved.type : null;
}
