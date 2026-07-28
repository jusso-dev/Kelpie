/**
 * Copyable MCP agent onboarding blocks for Settings (issue #53).
 *
 * Endpoint always comes from the configured public application origin
 * (`APP_URL` / `appBaseUrl()`), never from an untrusted Host header.
 * Placeholder mode never embeds a real token secret.
 */
import { LLM_AGENT_PROMPT } from "@/lib/llm-prompt";
import {
  MCP_PROTOCOL_VERSION,
  MCP_TOOLS,
  formatToolScopeLines,
  toolsPermittedByScopes,
  type McpToolDefinition,
} from "@/lib/mcp/catalogue";
import { KNOWN_SCOPES, type ScopeValue } from "@/lib/scopes";
import { appBaseUrl } from "@/lib/sso/config";

export const MCP_TOKEN_PLACEHOLDER = "<KELPIE_API_TOKEN>";

export type PublicUrlResolution =
  | { ok: true; baseUrl: string; endpoint: string }
  | { ok: false; reason: "missing" | "invalid" };

export function resolvePublicMcpUrl(
  configuredBaseUrl?: string | null,
): PublicUrlResolution {
  const raw = (configuredBaseUrl ?? appBaseUrl()).trim();
  if (!raw) {
    return { ok: false, reason: "missing" };
  }
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { ok: false, reason: "invalid" };
    }
    const baseUrl = raw.replace(/\/$/, "");
    return { ok: true, baseUrl, endpoint: `${baseUrl}/api/mcp` };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}

export function mcpEndpointFromBaseUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, "")}/api/mcp`;
}

export function scopeLabel(scope: string): string {
  return KNOWN_SCOPES.find((s) => s.value === scope)?.label ?? scope;
}

export function formatSelectedScopes(scopes: string[]): string {
  return scopes.join(", ");
}

export type OnboardingCopyInput = {
  endpoint: string;
  scopes: string[];
  /** Real secret only when the admin just created it; otherwise omit. */
  token?: string | null;
  /** When true (default), configs use the placeholder even if a token is set. */
  placeholderMode?: boolean;
  organisationName?: string;
};

function resolveToken(input: OnboardingCopyInput): {
  token: string;
  includesSecret: boolean;
} {
  const placeholderMode = input.placeholderMode !== false;
  if (!placeholderMode && input.token && input.token.trim()) {
    return { token: input.token.trim(), includesSecret: true };
  }
  return { token: MCP_TOKEN_PLACEHOLDER, includesSecret: false };
}

export function buildConnectionDetails(input: OnboardingCopyInput): string {
  const { token, includesSecret } = resolveToken(input);
  const tools = toolsPermittedByScopes(input.scopes);
  const secretNote = includesSecret
    ? "SENSITIVE: this block contains a live bearer token. Store it only in a secret manager or local client config. Do not commit it."
    : "Placeholder mode: replace <KELPIE_API_TOKEN> with the token shown once at creation (never recoverable later).";

  return [
    "Kelpie MCP — Streamable HTTP (stateless)",
    secretNote,
    "",
    `Endpoint          : ${input.endpoint}`,
    "Transport         : Streamable HTTP (JSON-RPC over POST)",
    `Protocol version  : ${MCP_PROTOCOL_VERSION}`,
    "Method            : POST only (GET returns 405)",
    `Authorization     : Bearer ${token}`,
    "Accept            : application/json, text/event-stream",
    "Content-Type      : application/json",
    `Scopes            : ${formatSelectedScopes(input.scopes) || "(none)"}`,
    "",
    "Tool discovery returns only tools permitted by the token scopes:",
    formatToolScopeLines(tools.length > 0 ? tools : MCP_TOOLS),
  ].join("\n");
}

export function buildCursorMcpConfig(input: OnboardingCopyInput): string {
  const { token, includesSecret } = resolveToken(input);
  const header = includesSecret
    ? "// SENSITIVE: contains a live bearer token. Do not commit.\n"
    : "// Placeholder token — replace before connecting.\n";
  const config = {
    mcpServers: {
      kelpie: {
        url: input.endpoint,
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    },
  };
  return `${header}${JSON.stringify(config, null, 2)}\n`;
}

export function buildVsCodeMcpConfig(input: OnboardingCopyInput): string {
  const { token, includesSecret } = resolveToken(input);
  const header = includesSecret
    ? "// SENSITIVE: contains a live bearer token. Do not commit.\n"
    : "// Placeholder token — replace before connecting.\n";
  const config = {
    servers: {
      kelpie: {
        type: "http",
        url: input.endpoint,
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    },
  };
  return `${header}${JSON.stringify(config, null, 2)}\n`;
}

export function buildAgentsMdBlock(input: OnboardingCopyInput): string {
  const { token, includesSecret } = resolveToken(input);
  const tools = toolsPermittedByScopes(input.scopes);
  const toolLines =
    tools.length > 0
      ? formatToolScopeLines(tools)
      : "- (no tools permitted with the selected scopes)";
  const org =
    input.organisationName?.trim() || "<ORGANISATION_NAME>";
  const secretNote = includesSecret
    ? "SENSITIVE: this block embeds a live bearer token. Paste only into a private agent config, never into a shared repo."
    : "Replace <KELPIE_API_TOKEN> with the one-time token value from Settings. Existing secrets are never recoverable.";

  return `# Kelpie MCP agent instructions

${secretNote}

## Connection

- MCP endpoint: \`${input.endpoint}\`
- Transport: Streamable HTTP (stateless POST JSON-RPC)
- Protocol: \`${MCP_PROTOCOL_VERSION}\`
- Auth header: \`Authorization: Bearer ${token}\`
- Organisation: ${org} (resolved server-side from the token; never send it yourself)
- Token scopes: \`${formatSelectedScopes(input.scopes) || "(none)"}\`

## What Kelpie is for

Kelpie is this organisation's source of truth for threat intelligence, threat
landscape, cyber briefing, watched vendors, case relationships, evidence
metadata, playbooks, and ATT&CK mappings/coverage (and any later tools the
server exposes under the same scopes). Prefer Kelpie MCP before relying on
stale assumptions whenever a relevant tool exists.

## Tools available with this token

Only tools allowed by the token's scopes appear in \`tools/list\`. Current
mapping for the selected scopes:

${toolLines}

Full catalogue of every Kelpie MCP tool (for reference if scopes change):

${formatToolScopeLines(MCP_TOOLS)}

## Hard rules

- Do not invent results, claim actions occurred, or expose bearer tokens.
- Never place the bearer token in logs, commits, analytics, or shared chat.
- Respect organisation boundaries: the server scopes every call to the
  organisation that owns the token.
- Treat TLP and PAP markings as binding; do not restate marked content to an
  audience the marking would not permit.
- Threat-intelligence indicator types are only \`ip\`, \`url\`, \`file_hash\`, and
  \`domain\`. Do not invent other types.
- Response / containment actions still require human approval in Kelpie.
  Do not claim an action ran unless a tool confirmed it.
- If connection fails, the token is expired/revoked, or a tool returns a
  missing-scope error, report that clearly and continue safely without
  fabricating data. Name the missing scope when known.

## Verify

1. POST \`initialize\` then \`tools/list\` to \`${input.endpoint}\`.
2. Confirm the returned tool names match the scope-permitted list above.
3. On \`Missing scope: …\` errors, ask an administrator to reissue a token
   with that scope (or drop the capability) — do not work around it.

## Rotate / remove

Administrators rotate or revoke the token under **Settings → API tokens**.
After revoke, remove the server entry from the client config and delete any
copied secret material.

## Canonical agent prompt

See the repository \`LLM.txt\` / Guides → Playbooks and agents for the full
playbook-oriented agent prompt (placeholders only). Settings can also copy it.
`;
}

export function buildLlmTxtPrompt(): string {
  return LLM_AGENT_PROMPT;
}

export function toolsExpectedForScopes(scopes: string[]): string[] {
  return toolsPermittedByScopes(scopes).map((t) => t.name);
}

export function describePublicUrlError(
  reason: "missing" | "invalid",
): string {
  if (reason === "missing") {
    return "Public application URL is not configured. Set APP_URL (or BETTER_AUTH_URL) to the external HTTPS origin before issuing MCP connection details.";
  }
  return "Public application URL is invalid. Set APP_URL to an absolute http(s) origin (for example https://kelpie.example), not a Host header value.";
}

/** Capability chips for the Settings UI (scope → tools that need it). */
export function mcpScopeCapabilities(
  scopes: readonly ScopeValue[] = mcpCapabilityScopes(),
): Array<{
  scope: ScopeValue;
  label: string;
  tools: string[];
  readOnly: boolean;
}> {
  return scopes.map((scope) => {
    const tools = MCP_TOOLS.filter((t) => t.scope === scope);
    return {
      scope,
      label: scopeLabel(scope),
      tools: tools.map((t) => t.name),
      readOnly: tools.every((t) => t.readOnly !== false),
    };
  });
}

function mcpCapabilityScopes(): ScopeValue[] {
  const seen = new Set<ScopeValue>();
  const ordered: ScopeValue[] = [];
  for (const tool of MCP_TOOLS) {
    if (seen.has(tool.scope)) continue;
    seen.add(tool.scope);
    ordered.push(tool.scope);
  }
  return ordered;
}

export function listCatalogueToolNames(): string[] {
  return MCP_TOOLS.map((t: McpToolDefinition) => t.name);
}
