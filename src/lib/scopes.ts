export const KNOWN_SCOPES = [
  { value: "cases:read", label: "Read cases" },
  { value: "cases:write", label: "Create and update cases" },
  { value: "tasks:read", label: "Read tasks" },
  { value: "tasks:write", label: "Create and update tasks" },
  { value: "observables:read", label: "Read observables" },
  { value: "observables:write", label: "Add observables" },
  { value: "comments:read", label: "Read comments" },
  { value: "comments:write", label: "Post comments" },
  { value: "threat_intelligence:read", label: "Read threat intelligence" },
  { value: "threat_landscape:read", label: "Read Threat landscape data" },
  { value: "briefing:read", label: "Read Cyber brief and vendor matches" },
  {
    value: "case_relationships:read",
    label: "Read case relationships and duplicate/related suggestions",
  },
  {
    value: "case_relationships:write",
    label: "Link, unlink, and dismiss case relationships",
  },
] as const;

export type ScopeValue = (typeof KNOWN_SCOPES)[number]["value"];

export function isKnownScope(s: string): s is ScopeValue {
  return KNOWN_SCOPES.some((k) => k.value === s);
}

export function tokenHasScope(scopes: string[], required: ScopeValue): boolean {
  if (scopes.length === 0) return true; // legacy: empty scopes means full access
  return scopes.includes(required);
}
