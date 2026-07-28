/**
 * Canonical MCP tool catalogue.
 *
 * Single source of truth for tool names, scopes, descriptions, and input
 * schemas. The Streamable HTTP route (`/api/mcp`), Settings MCP onboarding
 * copy blocks, and docs/tests all derive from this list so tool-to-scope
 * mappings cannot drift.
 */
import { MAPPING_ENTITY_TYPES } from "@/lib/attack/mapping-core";
import type { ScopeValue } from "@/lib/scopes";
import { tokenHasScope } from "@/lib/scopes";
import { TI_INDICATOR_TYPES } from "@/lib/ti/indicator-types";

export const MCP_PROTOCOL_VERSION = "2025-11-25";

export const MCP_SUPPORTED_PROTOCOLS = new Set([
  MCP_PROTOCOL_VERSION,
  "2025-06-18",
  "2025-03-26",
]);

export const MCP_SERVER_NAME = "kelpie";
export const MCP_SERVER_VERSION = "0.2.0";

export type McpToolDefinition = {
  name: string;
  title: string;
  description: string;
  scope: ScopeValue;
  /** Defaults to true when omitted. */
  readOnly?: boolean;
  inputSchema: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
};

export const MCP_TOOLS: readonly McpToolDefinition[] = [
  {
    name: "search_threat_intelligence",
    title: "Search threat intelligence",
    description:
      "Search this organisation's threat-intelligence indicators and inspect feed health. Kelpie threat intelligence covers IP, URL, file hash and domain indicators only (no CVE/vulnerability data).",
    scope: "threat_intelligence:read",
    inputSchema: {
      type: "object",
      properties: {
        value: { type: "string", description: "Indicator value or substring." },
        exact: { type: "boolean", description: "Use exact value matching." },
        type: {
          type: "string",
          enum: [...TI_INDICATOR_TYPES],
          description:
            "Indicator type filter. Kelpie stores network and file indicators only (IP, URL, file hash, domain).",
        },
        feed_id: { type: "string", description: "Feed identifier filter." },
        tag: { type: "string", description: "Exact indicator tag filter." },
        min_confidence: {
          type: "integer",
          minimum: 0,
          maximum: 100,
          description: "Minimum indicator confidence, inclusive.",
        },
        limit: { type: "integer", minimum: 1, maximum: 200, default: 100 },
        offset: { type: "integer", minimum: 0, default: 0 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_threat_landscape",
    title: "Get Threat landscape",
    description:
      "Get current Cloudflare Radar attack locations, routes, mitigation products, request profile, targeted sectors, managed-rule signals, confidence, and update time.",
    scope: "threat_landscape:read",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "get_cyber_briefing",
    title: "Get Cyber brief",
    description:
      "Search and page through public cyber reporting, including matches against this organisation's watched vendors.",
    scope: "briefing:read",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Headline and summary search." },
        source: { type: "string", description: "Exact source name filter." },
        vendor: {
          type: "string",
          description:
            "Watched vendor slug, or 'watched' for any matched vendor.",
        },
        sort: {
          type: "string",
          enum: ["newest", "oldest", "source"],
          default: "newest",
        },
        page: { type: "integer", minimum: 1, default: 1 },
        page_size: { type: "integer", minimum: 1, maximum: 100, default: 25 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "list_watched_vendors",
    title: "List watched vendors",
    description:
      "List vendors whose mentions Kelpie highlights in Cyber brief reporting.",
    scope: "briefing:read",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "case_relationships_list",
    title: "List case relationships",
    description:
      "List confirmed relationships (duplicate_of, related_to, parent_of, child_of) for a case, including confidence, origin, and reason.",
    scope: "case_relationships:read",
    inputSchema: {
      type: "object",
      properties: {
        caseId: { type: "string", description: "Case identifier." },
      },
      required: ["caseId"],
      additionalProperties: false,
    },
  },
  {
    name: "case_relationship_suggestions_list",
    title: "List case relationship suggestions",
    description:
      "List possible duplicate/related case suggestions for a case, with match score and matched signals (title similarity, shared observables/tags/vendors).",
    scope: "case_relationships:read",
    inputSchema: {
      type: "object",
      properties: {
        caseId: { type: "string", description: "Case identifier." },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 50,
          default: 10,
          description: "Maximum number of suggestions to return.",
        },
      },
      required: ["caseId"],
      additionalProperties: false,
    },
  },
  {
    name: "evidence_list",
    title: "List evidence",
    description:
      "List evidence items for a case, including status, hashes, labels, relevance, and acquisition metadata. Never returns internal storage locations.",
    scope: "evidence:read",
    inputSchema: {
      type: "object",
      properties: {
        caseId: { type: "string", description: "Case identifier." },
      },
      required: ["caseId"],
      additionalProperties: false,
    },
  },
  {
    name: "evidence_custody_list",
    title: "List evidence custody events",
    description:
      "List the append-only chain-of-custody events recorded for an evidence item (uploads, downloads, overrides, renames, holds, and more).",
    scope: "evidence:read",
    inputSchema: {
      type: "object",
      properties: {
        evidenceId: { type: "string", description: "Evidence identifier." },
      },
      required: ["evidenceId"],
      additionalProperties: false,
    },
  },
  {
    name: "playbooks_list",
    title: "List playbooks",
    description:
      "List this organisation's playbook catalogue (baseline and custom), with classification, severity guidance, tags, required observable types, and provenance. Read-only — never starts a playbook or changes case data.",
    scope: "playbooks:read",
    inputSchema: {
      type: "object",
      properties: {
        scenario: {
          type: "string",
          description:
            "Baseline catalogue scenario key filter (see playbooks_get output's catalogueKey), exact match.",
        },
        classification: {
          type: "string",
          description: "Case classification filter, exact match.",
        },
        severity: {
          type: "string",
          description: "Default severity filter, exact match.",
        },
        tag: { type: "string", description: "Exact playbook tag filter." },
        observable_type: {
          type: "string",
          description: "Required observable type filter, exact match.",
        },
        q: { type: "string", description: "Search name and description." },
        include_inactive: {
          type: "boolean",
          description: "Include deactivated playbooks. Defaults to active-only.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "playbooks_get",
    title: "Get playbook",
    description:
      "Get full detail for one playbook in this organisation, including its ordered steps and structured content (purpose, triggers, evidence to preserve, decision points, approval actions, closure criteria, MITRE ATT&CK references, and more).",
    scope: "playbooks:read",
    inputSchema: {
      type: "object",
      properties: {
        playbookId: { type: "string", description: "Playbook identifier." },
      },
      required: ["playbookId"],
      additionalProperties: false,
    },
  },
  {
    name: "attack_techniques_search",
    title: "Search ATT&CK techniques",
    description:
      "Search the organisation-independent ATT&CK technique catalog by id, name, or tactic. Deprecated techniques are excluded unless includeDeprecated is set.",
    scope: "attack:read",
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Technique id or name substring." },
        tactic: {
          type: "string",
          description: "Exact ATT&CK tactic id, e.g. 'lateral-movement'.",
        },
        includeDeprecated: {
          type: "boolean",
          description: "Include deprecated techniques.",
        },
        limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "attack_mappings_list",
    title: "List ATT&CK technique mappings",
    description:
      "List ATT&CK technique mappings, either every mapping touching a case (its own mapping plus its linked alerts/observables/evidence/tasks) or the mappings on one specific entity. Includes confidence, source, notes, detection/response notes, and actor attribution.",
    scope: "attack:read",
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: {
        caseId: {
          type: "string",
          description:
            "Case identifier. Returns every mapping touching this case.",
        },
        entityType: { type: "string", enum: [...MAPPING_ENTITY_TYPES] },
        entityId: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "attack_coverage_get",
    title: "Get ATT&CK coverage",
    description:
      "Get organisation-wide ATT&CK coverage: mapped techniques by tactic, mappings still missing detection/response notes, and playbook/case-template coverage gaps by investigation/detection/containment/recovery guidance category.",
    scope: "attack:read",
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "attack_technique_attach",
    title: "Attach an ATT&CK technique mapping",
    description:
      "Attach an ATT&CK technique to a case, alert, observable, evidence item, or task, recording confidence, source, notes, detection notes, response notes, and analyst-entered actor attribution. Rejects a duplicate mapping for the same technique on the same entity.",
    scope: "attack:write",
    readOnly: false,
    inputSchema: {
      type: "object",
      properties: {
        entityType: { type: "string", enum: [...MAPPING_ENTITY_TYPES] },
        entityId: { type: "string" },
        techniqueId: {
          type: "string",
          description: "e.g. T1059 or T1059.001",
        },
        confidence: { type: "integer", minimum: 0, maximum: 100 },
        source: {
          type: "string",
          description:
            "e.g. analyst, detection_rule, threat_intel, provider",
        },
        notes: { type: "string" },
        detectionNotes: { type: "string" },
        responseNotes: { type: "string" },
        actorAttribution: {
          type: "string",
          description:
            "Analyst-entered only; never inferred automatically.",
        },
      },
      required: ["entityType", "entityId", "techniqueId"],
      additionalProperties: false,
    },
  },
];

export function isToolReadOnly(tool: McpToolDefinition): boolean {
  return tool.readOnly !== false;
}

/** Unique scopes required by tools in the catalogue, stable order. */
export function mcpCatalogueScopes(options?: {
  readOnlyOnly?: boolean;
}): ScopeValue[] {
  const seen = new Set<ScopeValue>();
  const ordered: ScopeValue[] = [];
  for (const tool of MCP_TOOLS) {
    if (options?.readOnlyOnly && !isToolReadOnly(tool)) continue;
    if (seen.has(tool.scope)) continue;
    seen.add(tool.scope);
    ordered.push(tool.scope);
  }
  return ordered;
}

/** Least-privilege default scopes for a new MCP agent token (read-only tools). */
export function mcpDefaultScopes(): ScopeValue[] {
  return mcpCatalogueScopes({ readOnlyOnly: true });
}

export function toolsPermittedByScopes(scopes: string[]): McpToolDefinition[] {
  return MCP_TOOLS.filter((tool) => tokenHasScope(scopes, tool.scope));
}

/** Bullet list of `tool — scope` lines for docs and agent instructions. */
export function formatToolScopeLines(
  tools: readonly McpToolDefinition[] = MCP_TOOLS,
): string {
  return tools
    .map((tool) => {
      const mode = isToolReadOnly(tool) ? "read-only" : "write";
      return `- \`${tool.name}\` — \`${tool.scope}\` (${mode})`;
    })
    .join("\n");
}

export const MCP_SERVER_INSTRUCTIONS =
  "Access to organisation threat intelligence, Threat landscape, Cyber brief, watched-vendor matches, case relationships, evidence, and ATT&CK technique mappings/coverage. Most tools are read-only; attack_technique_attach is the one tool that writes data (see each tool's readOnlyHint).";
