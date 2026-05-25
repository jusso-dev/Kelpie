export const DATA_CLASSIFICATION_SUGGESTIONS = [
  "public",
  "internal",
  "confidential",
  "restricted",
  "pii",
  "phi",
  "pci",
  "credentials",
  "customer-data",
  "employee-data",
  "financial",
  "legal-privileged",
] as const;

export function normalizeTag(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9.+:-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}

export function normalizeTags(values: Iterable<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const tag = normalizeTag(value);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out.slice(0, 24);
}

export function parseTagsInput(input: string): string[] {
  return normalizeTags(input.split(/[,;\n]/g));
}
