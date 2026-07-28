export const KNOWN_SCOPES = [
  { value: "cases:read", label: "Read cases" },
  { value: "cases:write", label: "Create and update cases" },
  {
    value: "cases:override_closure",
    label:
      "Override case-closure policy requirements (sensitive; only grant to admin-issued tokens)",
  },
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
  {
    value: "playbooks:read",
    label: "Read the playbook catalogue and case templates",
  },
  { value: "evidence:read", label: "Read evidence metadata and custody history" },
  {
    value: "evidence:write",
    label: "Upload evidence and update evidence metadata",
  },
  {
    value: "evidence:override",
    label:
      "Override quarantine and manage legal holds (sensitive; only grant to admin-issued tokens)",
  },
  {
    value: "audit:read",
    label: "Read organisation audit events (sensitive; only grant to admin-issued tokens)",
  },
  { value: "alerts:read", label: "Read alerts, linked entities, and evidence items" },
  {
    value: "alerts:write",
    label: "Create/link alerts, change alert disposition, and link entities",
  },
  {
    value: "alerts:raw_payload:read",
    label:
      "Read raw provider payload references behind alerts and evidence (sensitive; only grant to admin-issued tokens)",
  },
  { value: "queues:read", label: "Read teams, queues, and queue health" },
  {
    value: "queues:write",
    label: "Create teams/queues and assign cases to a queue or analyst",
  },
  {
    value: "attack:read",
    label: "Read ATT&CK technique catalog, mappings, attack stories, and coverage",
  },
  {
    value: "attack:write",
    label: "Attach, update, and remove ATT&CK technique mappings and attack-story entries",
  },
  {
    value: "content_blocks:read",
    label: "Read structured investigation content blocks and revision history",
  },
  {
    value: "content_blocks:write",
    label:
      "Create, edit, archive, reorder, promote, and link structured investigation content blocks",
  },
  {
    value: "correlation:read",
    label: "Read correlation rules, suggestions, and merge history",
  },
  {
    value: "correlation:write",
    label:
      "Evaluate rules, accept/reject suggestions, move/merge/split alerts, and reverse merges",
  },
  {
    value: "asset_context:read",
    label: "Read asset/identity context records and case priority scores",
  },
  {
    value: "asset_context:write",
    label: "Create/update asset context, import inventories, and set priority overrides",
  },
  {
    value: "integrations:read",
    label: "Read integration health, sync conflicts, and support-safe diagnostics",
  },
  {
    value: "integrations:write",
    label:
      "Pause/resume integrations, run connection tests, resolve sync conflicts, and change sync policy",
  },
  {
    value: "case_views:read",
    label: "Read saved case views, counts, and widgets",
  },
  {
    value: "case_views:write",
    label: "Create, update, delete, and set defaults for saved case views",
  },
  {
    value: "reports:read",
    label: "Read report templates, previews, export history, and download released reports",
  },
  {
    value: "reports:write",
    label: "Generate case reports, request release approval, and manage report schedules",
  },
  {
    value: "reports:admin",
    label:
      "Create and version report templates and approve report release (sensitive; admin-issued tokens)",
  },
  {
    value: "reviews:read",
    label:
      "Read post-incident reviews, revisions, follow-ups, knowledge articles, and improvement proposals",
  },
  {
    value: "reviews:write",
    label:
      "Create and edit post-incident reviews, follow-ups, knowledge articles, and improvement proposals",
  },
  {
    value: "reviews:admin",
    label:
      "Manage review templates, org review policy, and approve reviews (sensitive; admin-issued tokens)",
  },
  {
    value: "investigation:read",
    label:
      "List investigation console commands, execution history, and results",
  },
  {
    value: "investigation:execute",
    label:
      "Execute registered investigation commands, cancel in-flight runs, and save results as evidence",
  },
  {
    value: "improvements:read",
    label:
      "Read the detection/control/process improvement register, suggestions, and dashboard",
  },
  {
    value: "improvements:write",
    label:
      "Create, link, validate, close, reopen, and sync external ticket refs on improvement register items",
  },
] as const;

export type ScopeValue = (typeof KNOWN_SCOPES)[number]["value"];

/**
 * Scopes that must never be implied. Empty-scope legacy tokens used to
 * satisfy every check (including these). Fail-closed `tokenHasScope` plus
 * the data migration that rewrites empty arrays deliberately exclude them.
 */
export const SENSITIVE_SCOPES = [
  "alerts:raw_payload:read",
  "evidence:override",
  "audit:read",
  "cases:override_closure",
  "reports:admin",
  "reviews:admin",
] as const satisfies readonly ScopeValue[];

export type SensitiveScopeValue = (typeof SENSITIVE_SCOPES)[number];

/** Explicit scope set written onto tokens that previously had `[]`. */
export function legacyDefaultScopes(): ScopeValue[] {
  const sensitive = new Set<string>(SENSITIVE_SCOPES);
  return KNOWN_SCOPES.map((s) => s.value).filter((v) => !sensitive.has(v));
}

export function isKnownScope(s: string): s is ScopeValue {
  return KNOWN_SCOPES.some((k) => k.value === s);
}

/**
 * Fail closed: an empty scope array grants nothing. Callers that need
 * unscoped authentication (rare) must pass `required: null` to
 * `authenticateApiTokenWithScope` rather than relying on empty arrays.
 */
export function tokenHasScope(scopes: string[], required: ScopeValue): boolean {
  if (scopes.length === 0) return false;
  return scopes.includes(required);
}
