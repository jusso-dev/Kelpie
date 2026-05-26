import type { FieldMapping, NormalisedAlert } from "./types";

export function getPath(obj: unknown, path: string): unknown {
  if (!path) return undefined;
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function asString(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return null;
}

const VALID_SEVERITIES = ["low", "medium", "high", "critical"] as const;
type Severity = (typeof VALID_SEVERITIES)[number];

function coerceSeverity(
  mapping: FieldMapping,
  record: Record<string, unknown>,
): Severity {
  const fallback = mapping.defaultSeverity ?? "medium";
  if (!mapping.severity) return fallback;
  const raw = asString(getPath(record, mapping.severity));
  if (!raw) return fallback;
  if (mapping.severityMap && mapping.severityMap[raw]) {
    return mapping.severityMap[raw];
  }
  const lower = raw.toLowerCase();
  if ((VALID_SEVERITIES as readonly string[]).includes(lower)) {
    return lower as Severity;
  }
  // Common numeric scales (1-100 / 1-5) → buckets.
  const num = Number(raw);
  if (Number.isFinite(num)) {
    if (num >= 80 || num >= 4) return "critical";
    if (num >= 60 || num >= 3) return "high";
    if (num >= 30 || num >= 2) return "medium";
    return "low";
  }
  return fallback;
}

export function applyMapping(
  record: Record<string, unknown>,
  mapping: FieldMapping,
): NormalisedAlert {
  const title = asString(getPath(record, mapping.title)) ?? "Untitled alert";
  const description = mapping.description
    ? asString(getPath(record, mapping.description))
    : null;
  const externalRef = asString(getPath(record, mapping.externalRef));
  const observables: Array<{ type: string; value: string }> = [];
  for (const o of mapping.observables ?? []) {
    const value = asString(getPath(record, o.path));
    if (value) observables.push({ type: o.type, value });
  }
  return {
    title,
    description,
    severity: coerceSeverity(mapping, record),
    externalRef,
    observables,
    rawPayload: record,
  };
}
