/**
 * Short in-product explainers keyed by page.
 * Full how-tos live under /guides#anchor.
 */
export type PageHelpKey =
  | "dashboard"
  | "cases"
  | "cases-new"
  | "queues"
  | "tasks"
  | "observables"
  | "ti"
  | "briefing"
  | "threat-landscape"
  | "playbooks"
  | "attack-coverage"
  | "asset-context"
  | "settings"
  | "guides";

export type PageHelp = {
  /** One or two sentences under the page title. */
  summary: string;
  /** Optional one-line tip shown next to the full-guide link. */
  tip?: string;
  /** Anchor on /guides. */
  guideHref: string;
};

export const PAGE_HELP: Record<PageHelpKey, PageHelp> = {
  dashboard: {
    summary:
      "Org pulse: active load, SLA pressure, and response speed. Use it for handoff, not deep investigation.",
    tip: "Admins also see per-analyst caseload below.",
    guideHref: "/guides#triage-and-dashboard",
  },
  cases: {
    summary:
      "Primary triage queue. Filter by ownership, severity, SLA risk, and saved views. Open a case to investigate; keep status and assignee current.",
    tip: "Saved views pin a filter set for the team.",
    guideHref: "/guides#case-queue-and-views",
  },
  "cases-new": {
    summary:
      "Open a durable investigation record. Prefer facts in the summary; severity and markings drive SLA and handling.",
    tip: "Apply a template or playbook when the scenario is known.",
    guideHref: "/guides#cases-and-templates",
  },
  queues: {
    summary:
      "Team queues hold work before an individual owns it. Workload is severity-weighted so overloaded analysts stand out.",
    tip: "Weight: low 1 · medium 2 · high 4 · critical 8.",
    guideHref: "/guides#queues-and-workload",
  },
  tasks: {
    summary:
      "Cross-case work items. Overdue and due-soon rise first so nothing stalls while the case list is quiet.",
    tip: "Mark done from the row; blocked needs a comment on the case.",
    guideHref: "/guides#task-inbox",
  },
  observables: {
    summary:
      "Cross-case indicator lookup. Search a value to see every case it appears on and whether it was marked IOC.",
    tip: "TLP on the observable can be tighter than the case.",
    guideHref: "/guides#observables-and-iocs",
  },
  ti: {
    summary:
      "Browse indicators loaded from feeds. A match is enrichment, not a verdict — validate before you escalate.",
    tip: "Admins manage feed URLs and poll intervals under Integrations.",
    guideHref: "/guides#threat-intelligence",
  },
  briefing: {
    summary:
      "Curated cyber news and vendor-matched reports. Use it for situational awareness, not as a case source of record.",
    tip: "Watch vendors in Settings so matches surface here.",
    guideHref: "/guides#cyber-brief-and-landscape",
  },
  "threat-landscape": {
    summary:
      "Near-real-time attack activity from configured sources. Context for prioritisation, not ownership of a specific incident.",
    guideHref: "/guides#cyber-brief-and-landscape",
  },
  playbooks: {
    summary:
      "Ordered response steps with due-time offsets. Apply a playbook to spawn tasks on a case; templates prefill a new case.",
    tip: "Baseline catalogue can sync without overwriting custom playbooks.",
    guideHref: "/guides#playbooks-and-agents",
  },
  "attack-coverage": {
    summary:
      "Map cases and detections to MITRE ATT&CK so gaps and repeated techniques are visible over time.",
    guideHref: "/guides#attack-coverage",
  },
  "asset-context": {
    summary:
      "Hosts, identities, and business context that change how severe a case feels. Import and keep ownership current.",
    guideHref: "/guides#asset-context",
  },
  settings: {
    summary:
      "Organisation configuration: team, SLA, tokens, SSO, integrations, and data shape. Analysts see a subset; admins own the rest.",
    tip: "Create scoped API tokens; never reuse a browser session for agents.",
    guideHref: "/guides#settings-and-roles",
  },
  guides: {
    summary:
      "How-to notes for features that need more than a button label. Short explainers also sit under each page title.",
    guideHref: "/guides#cases-and-templates",
  },
};
