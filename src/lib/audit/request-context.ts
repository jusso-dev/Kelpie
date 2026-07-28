import type { AuditContext } from "./events";

function firstForwardedIp(value: string | null): string | null {
  if (!value) return null;
  return value.split(",")[0]?.trim() || null;
}

/** Extracts request ID / source IP / user agent from a `Request` for a v1 API route. */
export function auditContextFromRequest(req: Request): AuditContext {
  const headers = req.headers;
  return {
    requestId: headers.get("x-request-id") ?? crypto.randomUUID(),
    sourceIp: firstForwardedIp(headers.get("x-forwarded-for")) ?? headers.get("x-real-ip"),
    userAgent: headers.get("user-agent"),
  };
}

/** Same extraction for server actions / server components, which read headers via `next/headers`. */
export function auditContextFromHeaders(headers: Headers): AuditContext {
  return {
    requestId: headers.get("x-request-id") ?? crypto.randomUUID(),
    sourceIp: firstForwardedIp(headers.get("x-forwarded-for")) ?? headers.get("x-real-ip"),
    userAgent: headers.get("user-agent"),
  };
}
