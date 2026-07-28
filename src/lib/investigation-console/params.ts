import { z } from "zod";
import type { InvestigationCommandHandler } from "./types";
import { InvestigationConsoleError } from "./limits";

/**
 * Patterns that must never appear in investigation command parameters.
 * Blocks shell metacharacters, script injection, and raw executable payloads.
 * Handlers never pass params to a shell; this is defence in depth.
 * Deliberately does NOT match the start of every string — only risky tokens.
 */
const FORBIDDEN_PARAM_PATTERN =
  /(?:[;\n\r|&`]|\$\(|\b(?:bash|zsh|powershell|cmd\.exe|os\.system|child_process|eval\s*\(|new\s+Function)\b)/i;

const SSRF_URL_KEYS = new Set([
  "url",
  "uri",
  "endpoint",
  "destination",
  "callback",
  "webhook",
  "target_url",
  "base_url",
  "host",
  "hostname",
]);

/**
 * Reject parameters that look like injection or attempt to supply arbitrary
 * destination URLs. Handlers build their own outbound URLs from typed fields
 * (e.g. indicator type + value → fixed VirusTotal path).
 */
export function rejectDangerousParams(
  params: Record<string, unknown>,
): void {
  for (const [key, raw] of Object.entries(params)) {
    if (raw === null || raw === undefined) continue;
    const asString =
      typeof raw === "string"
        ? raw
        : typeof raw === "number" || typeof raw === "boolean"
          ? String(raw)
          : JSON.stringify(raw);
    if (asString.length > 8_000) {
      throw new InvestigationConsoleError(
        `Parameter "${key}" exceeds maximum length`,
        400,
      );
    }
    const lowerKey = key.toLowerCase();
    if (SSRF_URL_KEYS.has(lowerKey) || lowerKey.endsWith("_url")) {
      // Absolute URLs in URL-shaped keys are never accepted as free-form input.
      if (/^\s*https?:\/\//i.test(asString) || /^\s*\/\//.test(asString)) {
        throw new InvestigationConsoleError(
          `Parameter "${key}" must not be an arbitrary destination URL`,
          400,
        );
      }
    }
    if (FORBIDDEN_PARAM_PATTERN.test(asString)) {
      throw new InvestigationConsoleError(
        `Parameter "${key}" contains disallowed content`,
        400,
      );
    }
  }
}

/** Validate params against the handler schema + injection guards. */
export function validateCommandParams(
  handler: InvestigationCommandHandler,
  raw: unknown,
): Record<string, unknown> {
  if (raw === null || raw === undefined || typeof raw !== "object" || Array.isArray(raw)) {
    throw new InvestigationConsoleError("Parameters must be an object", 400);
  }
  const parsed = handler.paramSchema.safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error.issues
      .map((i) => `${i.path.join(".") || "params"}: ${i.message}`)
      .join("; ");
    throw new InvestigationConsoleError(`Invalid parameters: ${msg}`, 400);
  }
  const params = parsed.data as Record<string, unknown>;
  rejectDangerousParams(params);
  return params;
}

/** Common zod helpers for handlers. */
export const entityValueSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .describe("Indicator or entity value (not a free-form URL destination)");

export const observableTypeSchema = z.enum([
  "ip",
  "domain",
  "url",
  "file_hash",
  "email",
  "hostname",
  "username",
  "registry_key",
  "other",
]);
