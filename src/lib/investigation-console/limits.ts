import type { InvestigationCommandHandler } from "./types";
import { ABSOLUTE_MAX_RESULT_BYTES } from "./types";

type Window = { count: number; resetAt: number };
const windows = new Map<string, Window>();

function windowKey(organisationId: string, commandName: string): string {
  return `${organisationId}::${commandName}`;
}

/**
 * Simple in-process sliding window. Best-effort rate limit for a single
 * node; multi-node deployments still rely on provider-side limits.
 */
export async function assertWithinRateLimit(
  organisationId: string,
  handler: InvestigationCommandHandler,
): Promise<void> {
  const cap = handler.rateLimitPerMinute;
  if (cap <= 0) return;
  const key = windowKey(organisationId, handler.name);
  const now = Date.now();
  const w = windows.get(key);
  if (!w || w.resetAt < now) {
    windows.set(key, { count: 1, resetAt: now + 60_000 });
    return;
  }
  if (w.count < cap) {
    w.count += 1;
    return;
  }
  const waitMs = Math.max(0, w.resetAt - now);
  throw new InvestigationConsoleError(
    `Rate limit exceeded for ${handler.name} (${cap}/min). Retry in ${Math.ceil(waitMs / 1000)}s.`,
    429,
  );
}

/** Bound result JSON size; truncate arrays/objects when over the handler cap. */
export function boundResultPayload(
  data: unknown,
  maxBytes: number,
): { data: unknown; truncated: boolean; sizeBytes: number } {
  const cap = Math.min(maxBytes, ABSOLUTE_MAX_RESULT_BYTES);
  let json = safeStringify(data);
  if (Buffer.byteLength(json, "utf8") <= cap) {
    return {
      data,
      truncated: false,
      sizeBytes: Buffer.byteLength(json, "utf8"),
    };
  }
  // Progressive truncation: drop to a summary envelope.
  const truncated = {
    truncated: true,
    note: `Result exceeded ${cap} bytes and was truncated.`,
    preview: json.slice(0, Math.min(cap - 200, 4_000)),
  };
  json = safeStringify(truncated);
  // If even the preview envelope is huge, hard-cut the preview.
  if (Buffer.byteLength(json, "utf8") > cap) {
    truncated.preview = truncated.preview.slice(0, 500);
    json = safeStringify(truncated);
  }
  return {
    data: truncated,
    truncated: true,
    sizeBytes: Buffer.byteLength(json, "utf8"),
  };
}

export function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "null";
  } catch {
    return JSON.stringify({ error: "unserialisable_result" });
  }
}

/** Reset rate windows — test helper only. */
export function __resetRateLimitWindowsForTests(): void {
  windows.clear();
}

export class InvestigationConsoleError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "InvestigationConsoleError";
    this.status = status;
  }
}
