/**
 * Coverage for issue #53: Settings MCP agent onboarding copy blocks, least-
 * privilege defaults, placeholder-vs-secret modes, public APP_URL endpoint
 * resolution, and drift guards against the canonical MCP tool catalogue.
 *
 * Pure unit tests — no database or running Next.js server required.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  MCP_PROTOCOL_VERSION,
  MCP_TOOLS,
  formatToolScopeLines,
  isToolReadOnly,
  mcpDefaultScopes,
  toolsPermittedByScopes,
} from "../src/lib/mcp/catalogue";
import {
  MCP_TOKEN_PLACEHOLDER,
  buildAgentsMdBlock,
  buildConnectionDetails,
  buildCursorMcpConfig,
  buildLlmTxtPrompt,
  buildVsCodeMcpConfig,
  describePublicUrlError,
  listCatalogueToolNames,
  mcpScopeCapabilities,
  resolvePublicMcpUrl,
  toolsExpectedForScopes,
} from "../src/lib/mcp/onboarding";
import { LLM_AGENT_PROMPT } from "../src/lib/llm-prompt";

const REAL_LOOKING_TOKEN = "klp_" + "a".repeat(43);

function main() {
  // ── Catalogue integrity ─────────────────────────────────────────────────
  assert.ok(MCP_TOOLS.length >= 10, "catalogue must list the shipped tools");
  const names = listCatalogueToolNames();
  assert.equal(new Set(names).size, names.length, "tool names must be unique");

  const writeTools = MCP_TOOLS.filter((t) => !isToolReadOnly(t));
  assert.deepEqual(
    writeTools.map((t) => t.name),
    ["attack_technique_attach"],
    "only attack_technique_attach is a write tool today",
  );

  const defaults = mcpDefaultScopes();
  assert.ok(defaults.length > 0, "default scopes must not be empty");
  assert.ok(
    !defaults.includes("attack:write"),
    "least-privilege defaults must exclude attack:write",
  );
  for (const scope of defaults) {
    assert.ok(
      MCP_TOOLS.some((t) => t.scope === scope && isToolReadOnly(t)),
      `default scope ${scope} must back a read-only tool`,
    );
  }

  const tiOnly = toolsPermittedByScopes(["threat_intelligence:read"]);
  assert.deepEqual(
    tiOnly.map((t) => t.name),
    ["search_threat_intelligence"],
  );
  const none = toolsPermittedByScopes(["cases:read"]);
  assert.equal(none.length, 0, "unrelated scopes must grant no MCP tools");

  // Empty / unmatched scopes must never list the full catalogue as "permitted".
  const emptyConn = buildConnectionDetails({
    endpoint: "https://kelpie.example/api/mcp",
    scopes: [],
    placeholderMode: true,
  });
  assert.match(emptyConn, /no tools permitted/i);
  assert.doesNotMatch(
    emptyConn,
    /search_threat_intelligence/,
    "empty scopes must not dump the full tool catalogue into copy blocks",
  );
  const emptyAgents = buildAgentsMdBlock({
    endpoint: "https://kelpie.example/api/mcp",
    scopes: ["cases:read"],
    placeholderMode: true,
  });
  assert.match(emptyAgents, /no tools permitted/i);

  const caps = mcpScopeCapabilities();
  assert.ok(caps.some((c) => c.scope === "playbooks:read"));
  assert.ok(caps.some((c) => c.scope === "attack:write" && c.readOnly === false));

  // ── Public URL resolution (never Host header) ───────────────────────────
  const ok = resolvePublicMcpUrl("https://kelpie.example/");
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.baseUrl, "https://kelpie.example");
    assert.equal(ok.endpoint, "https://kelpie.example/api/mcp");
  }

  const missing = resolvePublicMcpUrl("   ");
  assert.equal(missing.ok, false);
  if (!missing.ok) {
    assert.equal(missing.reason, "missing");
    assert.match(describePublicUrlError(missing.reason), /APP_URL/);
  }

  const invalid = resolvePublicMcpUrl("not a url");
  assert.equal(invalid.ok, false);
  if (!invalid.ok) {
    assert.equal(invalid.reason, "invalid");
  }

  // ── Placeholder mode never embeds secrets ───────────────────────────────
  const endpoint = "https://kelpie.example/api/mcp";
  const scopes = mcpDefaultScopes();

  const placeholderBlocks = [
    buildConnectionDetails({ endpoint, scopes, placeholderMode: true }),
    buildConnectionDetails({
      endpoint,
      scopes,
      token: REAL_LOOKING_TOKEN,
      placeholderMode: true,
    }),
    buildCursorMcpConfig({ endpoint, scopes, placeholderMode: true }),
    buildVsCodeMcpConfig({ endpoint, scopes, placeholderMode: true }),
    buildAgentsMdBlock({
      endpoint,
      scopes,
      organisationName: "Acme SOC",
      placeholderMode: true,
    }),
  ];

  for (const block of placeholderBlocks) {
    assert.ok(
      block.includes(MCP_TOKEN_PLACEHOLDER),
      "placeholder blocks must include the token placeholder",
    );
    assert.ok(
      !block.includes(REAL_LOOKING_TOKEN),
      "placeholder mode must never embed a real token",
    );
    assert.ok(
      !/klp_[A-Za-z0-9_-]{20,}/.test(block),
      "placeholder mode must not look like a live klp_ token",
    );
  }

  // ── One-time secret mode is explicit ────────────────────────────────────
  const secretBlocks = [
    buildConnectionDetails({
      endpoint,
      scopes,
      token: REAL_LOOKING_TOKEN,
      placeholderMode: false,
    }),
    buildCursorMcpConfig({
      endpoint,
      scopes,
      token: REAL_LOOKING_TOKEN,
      placeholderMode: false,
    }),
    buildAgentsMdBlock({
      endpoint,
      scopes,
      token: REAL_LOOKING_TOKEN,
      placeholderMode: false,
    }),
  ];
  for (const block of secretBlocks) {
    assert.ok(block.includes(REAL_LOOKING_TOKEN));
    assert.match(block, /SENSITIVE/i);
  }

  // ── Protocol / transport requirements in copy ───────────────────────────
  const connection = buildConnectionDetails({ endpoint, scopes });
  assert.ok(connection.includes(endpoint));
  assert.ok(connection.includes(MCP_PROTOCOL_VERSION));
  assert.ok(connection.includes("Streamable HTTP"));
  assert.ok(connection.includes("application/json, text/event-stream"));
  assert.ok(connection.includes("Authorization"));

  const cursor = buildCursorMcpConfig({ endpoint, scopes });
  const cursorJson = JSON.parse(
    cursor.replace(/^\/\/.*\n/, ""),
  ) as { mcpServers: { kelpie: { url: string; headers: { Authorization: string } } } };
  assert.equal(cursorJson.mcpServers.kelpie.url, endpoint);
  assert.ok(
    cursorJson.mcpServers.kelpie.headers.Authorization.startsWith("Bearer "),
  );

  const vscode = buildVsCodeMcpConfig({ endpoint, scopes });
  const vscodeJson = JSON.parse(vscode.replace(/^\/\/.*\n/, "")) as {
    servers: { kelpie: { type: string; url: string } };
  };
  assert.equal(vscodeJson.servers.kelpie.type, "http");
  assert.equal(vscodeJson.servers.kelpie.url, endpoint);

  // ── AGENTS.md behavioural commitments from issue #53 ────────────────────
  const agents = buildAgentsMdBlock({
    endpoint,
    scopes,
    organisationName: "Acme SOC",
  });
  for (const phrase of [
    "Kelpie",
    endpoint,
    "organisation",
    "TLP",
    "PAP",
    "ip",
    "file_hash",
    "domain",
    "do not invent",
    "Missing scope",
    "tools/list",
    "Rotate",
  ]) {
    assert.ok(
      agents.toLowerCase().includes(phrase.toLowerCase()),
      `AGENTS.md block must mention "${phrase}"`,
    );
  }
  // Enumerates tool-to-scope mappings for selected scopes.
  for (const tool of toolsPermittedByScopes(scopes)) {
    assert.ok(
      agents.includes(tool.name),
      `AGENTS.md must list permitted tool ${tool.name}`,
    );
    assert.ok(agents.includes(tool.scope));
  }
  // Full catalogue still present for reference.
  for (const tool of MCP_TOOLS) {
    assert.ok(
      agents.includes(tool.name),
      `AGENTS.md full catalogue must include ${tool.name}`,
    );
  }

  // ── LLM.txt copy is the canonical constant ──────────────────────────────
  assert.equal(buildLlmTxtPrompt(), LLM_AGENT_PROMPT);
  assert.ok(!/klp_[A-Za-z0-9_-]{20,}/.test(buildLlmTxtPrompt()));

  // ── toolsExpectedForScopes matches catalogue filter ─────────────────────
  assert.deepEqual(
    toolsExpectedForScopes(["playbooks:read"]),
    ["playbooks_list", "playbooks_get"],
  );

  // ── Docs / Settings surface drift guards ────────────────────────────────
  const repoRoot = path.resolve(__dirname, "..");
  const apiMd = fs.readFileSync(path.join(repoRoot, "docs/api.md"), "utf8");
  assert.ok(
    apiMd.includes("Settings → MCP agent setup") ||
      apiMd.includes("Settings → MCP agent setup"),
    "docs/api.md must point admins at Settings MCP onboarding",
  );
  assert.ok(
    apiMd.includes("src/lib/mcp/catalogue.ts"),
    "docs/api.md must name the canonical catalogue module",
  );
  for (const tool of MCP_TOOLS) {
    assert.ok(
      apiMd.includes(`\`${tool.name}\``),
      `docs/api.md must list tool ${tool.name}`,
    );
    assert.ok(
      apiMd.includes(tool.scope),
      `docs/api.md must mention scope ${tool.scope} for ${tool.name}`,
    );
  }

  const settingsPage = fs.readFileSync(
    path.join(repoRoot, "src/app/(app)/settings/page.tsx"),
    "utf8",
  );
  assert.ok(settingsPage.includes("McpOnboarding"));
  assert.ok(settingsPage.includes("mcp-agent-setup"));
  assert.ok(settingsPage.includes("resolvePublicMcpUrl"));

  const onboardingUi = fs.readFileSync(
    path.join(repoRoot, "src/components/mcp-onboarding.tsx"),
    "utf8",
  );
  assert.ok(onboardingUi.includes("navigator.clipboard"));
  assert.ok(onboardingUi.includes("aria-label"));
  assert.ok(onboardingUi.includes("role=\"alert\"") || onboardingUi.includes('role="alert"'));
  assert.ok(onboardingUi.includes("placeholderMode"));
  assert.ok(onboardingUi.includes("tools/list"));
  // Must not hard-code a recovered secret path.
  assert.ok(!onboardingUi.includes("tokenHash"));
  assert.ok(!onboardingUi.includes("plaintext from db"));

  const route = fs.readFileSync(
    path.join(repoRoot, "src/app/api/mcp/route.ts"),
    "utf8",
  );
  assert.ok(route.includes("MCP_TOOLS"), "MCP route must import the catalogue");
  assert.ok(
    !route.includes('name: "search_threat_intelligence"'),
    "MCP route must not redefine the catalogue inline",
  );

  // formatToolScopeLines is the shared bullet format used by docs generators.
  const lines = formatToolScopeLines();
  for (const tool of MCP_TOOLS) {
    assert.ok(lines.includes(tool.name));
  }

  console.log(
    `MCP onboarding: ${MCP_TOOLS.length} catalogue tools, ${defaults.length} default scopes, copy blocks and drift guards ok.`,
  );
}

main();
