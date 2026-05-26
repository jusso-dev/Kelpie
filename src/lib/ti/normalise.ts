const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const HASH = /^[a-fA-F0-9]{32}$|^[a-fA-F0-9]{40}$|^[a-fA-F0-9]{64}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const DOMAIN = /^(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}$/;

/** Best-effort observable type for a bare indicator value. */
export function guessIndicatorType(value: string): string {
  const v = value.trim();
  if (IPV4.test(v)) return "ip";
  if (HASH.test(v)) return "file_hash";
  if (EMAIL.test(v)) return "email";
  if (/^https?:\/\//i.test(v)) return "url";
  if (DOMAIN.test(v)) return "domain";
  return "other";
}

/** Map common feed type labels onto Kelpie observable types. */
export function normaliseType(raw: string, value: string): string {
  const t = raw.trim().toLowerCase();
  switch (t) {
    case "ip":
    case "ipv4":
    case "ip-dst":
    case "ip-src":
    case "ipv4-addr":
      return "ip";
    case "domain":
    case "hostname":
    case "domain-name":
      return "domain";
    case "url":
    case "uri":
      return "url";
    case "md5":
    case "sha1":
    case "sha256":
    case "hash":
    case "file":
    case "filehash":
    case "file_hash":
      return "file_hash";
    case "email":
    case "email-src":
    case "email-dst":
      return "email";
    case "":
      return guessIndicatorType(value);
    default:
      return guessIndicatorType(value);
  }
}
