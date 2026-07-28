/**
 * Filenames arrive from an untrusted client and end up in a DB column, a
 * `content-disposition` header, and forensic notes read by an analyst.
 * `sanitizeFilename` produces the strict, display-safe name stored in
 * `filename`; `stripControlChars` only removes bytes that could break a
 * header or log line, keeping the raw client-provided name for
 * `originalFilename` so custody records reflect what was actually uploaded.
 */

// Built from char codes rather than a literal regex so no raw control bytes
// live in this source file.
const CONTROL_CHARS = new RegExp(
  "[" + String.fromCharCode(0) + "-" + String.fromCharCode(31) + String.fromCharCode(127) + "]",
  "g",
);

export function stripControlChars(name: string): string {
  const cleaned = name.replace(CONTROL_CHARS, "").trim();
  return cleaned.length > 0 ? cleaned.slice(0, 512) : "unnamed";
}

export function sanitizeFilename(name: string): string {
  const base = stripControlChars(name).split(/[\\/]/).pop() ?? "unnamed";
  const safe = base
    .replace(/[^A-Za-z0-9._ -]/g, "_")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 255);
  return safe.length > 0 ? safe : "unnamed";
}
