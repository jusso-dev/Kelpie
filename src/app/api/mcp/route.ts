import { z } from "zod";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  listRelationshipsCore,
  listSuggestionsCore,
} from "@/lib/case-relationships-core";
import {
  listCustodyEventsForEvidence,
  listEvidenceForCase,
} from "@/lib/evidence/core";
import {
  listWatchedVendors,
  queryCyberBriefing,
  queryThreatIntelligence,
} from "@/lib/machine-data";
import {
  MCP_PROTOCOL_VERSION,
  MCP_SERVER_INSTRUCTIONS,
  MCP_SERVER_NAME,
  MCP_SERVER_VERSION,
  MCP_SUPPORTED_PROTOCOLS,
  MCP_TOOLS,
} from "@/lib/mcp/catalogue";
import { getPlaybookCore, listPlaybooksCore } from "@/lib/playbooks-core";
import { tokenHasScope } from "@/lib/scopes";
import { getThreatLandscapeData } from "@/lib/threat-landscape";
import { TI_INDICATOR_TYPES } from "@/lib/ti/indicator-types";
import { searchTechniques } from "@/lib/attack/catalog-core";
import {
  MAPPING_ENTITY_TYPES,
  attachTechniqueCore,
  listMappingsForCase,
  listMappingsForEntity,
} from "@/lib/attack/mapping-core";
import {
  getCaseTemplateCoverage,
  getOrgCoverageStats,
  getPlaybookCoverage,
} from "@/lib/attack/coverage-core";

export const dynamic = "force-dynamic";

const PROTOCOL_VERSION = MCP_PROTOCOL_VERSION;
const SUPPORTED_PROTOCOLS = MCP_SUPPORTED_PROTOCOLS;
const tools = MCP_TOOLS;

const threatIntelInput = z.object({
  value: z.string().trim().min(1).max(2048).optional(),
  exact: z.boolean().optional(),
  type: z.enum(TI_INDICATOR_TYPES).optional(),
  feed_id: z.string().trim().min(1).max(128).optional(),
  tag: z.string().trim().min(1).max(128).optional(),
  min_confidence: z.number().int().min(0).max(100).optional(),
  limit: z.number().int().min(1).max(200).optional(),
  offset: z.number().int().min(0).max(1_000_000).optional(),
});

const briefingInput = z.object({
  query: z.string().trim().min(1).max(120).optional(),
  source: z.string().trim().min(1).max(120).optional(),
  vendor: z.string().trim().min(1).max(120).optional(),
  sort: z.enum(["newest", "oldest", "source"]).optional(),
  page: z.number().int().min(1).max(10_000).optional(),
  page_size: z.number().int().min(1).max(100).optional(),
});

const noInput = z.object({});

const caseRelationshipsListInput = z.object({
  caseId: z.string().trim().min(1).max(128),
});

const caseRelationshipSuggestionsListInput = z.object({
  caseId: z.string().trim().min(1).max(128),
  limit: z.number().int().min(1).max(50).optional(),
});

const evidenceListInput = z.object({
  caseId: z.string().trim().min(1).max(128),
});

const evidenceCustodyListInput = z.object({
  evidenceId: z.string().trim().min(1).max(128),
});

const playbooksListInput = z.object({
  scenario: z.string().trim().min(1).max(128).optional(),
  classification: z.string().trim().min(1).max(64).optional(),
  severity: z.string().trim().min(1).max(32).optional(),
  tag: z.string().trim().min(1).max(64).optional(),
  observable_type: z.string().trim().min(1).max(32).optional(),
  q: z.string().trim().min(1).max(200).optional(),
  include_inactive: z.boolean().optional(),
});

const playbookGetInput = z.object({
  playbookId: z.string().trim().min(1).max(128),
});

const attackTechniquesSearchInput = z.object({
  query: z.string().trim().max(256).optional(),
  tactic: z.string().trim().max(64).optional(),
  includeDeprecated: z.boolean().optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

const attackMappingsListInput = z
  .object({
    caseId: z.string().trim().min(1).max(128).optional(),
    entityType: z.enum(MAPPING_ENTITY_TYPES).optional(),
    entityId: z.string().trim().min(1).max(128).optional(),
  })
  .refine((v) => Boolean(v.caseId) || (Boolean(v.entityType) && Boolean(v.entityId)), {
    message: "Provide caseId, or both entityType and entityId",
  });

const attackTechniqueAttachInput = z.object({
  entityType: z.enum(MAPPING_ENTITY_TYPES),
  entityId: z.string().trim().min(1).max(128),
  techniqueId: z.string().trim().min(1).max(32),
  confidence: z.number().int().min(0).max(100).nullable().optional(),
  source: z.string().trim().max(64).optional(),
  notes: z.string().max(10_000).nullable().optional(),
  detectionNotes: z.string().max(10_000).nullable().optional(),
  responseNotes: z.string().max(10_000).nullable().optional(),
  actorAttribution: z.string().max(500).nullable().optional(),
});


type JsonRpcId = string | number | null;
type JsonRpcRequest = {
  jsonrpc?: unknown;
  id?: JsonRpcId;
  method?: unknown;
  params?: unknown;
};

function rpcResult(id: JsonRpcId, result: unknown): Response {
  return Response.json(
    { jsonrpc: "2.0", id, result },
    {
      headers: {
        "cache-control": "private, no-store",
        "mcp-protocol-version": PROTOCOL_VERSION,
      },
    },
  );
}

function rpcError(
  id: JsonRpcId,
  code: number,
  message: string,
  status = 200,
  data?: unknown,
): Response {
  return Response.json(
    {
      jsonrpc: "2.0",
      id,
      error: { code, message, ...(data === undefined ? {} : { data }) },
    },
    {
      status,
      headers: {
        "cache-control": "private, no-store",
        "mcp-protocol-version": PROTOCOL_VERSION,
      },
    },
  );
}

function originAllowed(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  const allowed = new Set<string>();
  try {
    allowed.add(new URL(req.url).origin);
  } catch {
    // Invalid request URL is rejected by the runtime before this route.
  }
  try {
    if (process.env.APP_URL) allowed.add(new URL(process.env.APP_URL).origin);
  } catch {
    // APP_URL validation occurs during application startup.
  }
  return allowed.has(origin);
}

function toolResult(data: unknown) {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
}

async function callTool(
  name: string,
  rawArguments: unknown,
  organisationId: string,
) {
  const args = rawArguments ?? {};
  if (name === "search_threat_intelligence") {
    const input = threatIntelInput.parse(args);
    return toolResult(
      await queryThreatIntelligence(organisationId, {
        value: input.value,
        exact: input.exact,
        type: input.type,
        feedId: input.feed_id,
        tag: input.tag,
        minConfidence: input.min_confidence,
        limit: input.limit,
        offset: input.offset,
      }),
    );
  }
  if (name === "get_threat_landscape") {
    noInput.parse(args);
    return toolResult(await getThreatLandscapeData());
  }
  if (name === "get_cyber_briefing") {
    const input = briefingInput.parse(args);
    return toolResult(
      await queryCyberBriefing(organisationId, {
        query: input.query,
        source: input.source,
        vendor: input.vendor,
        sort: input.sort,
        page: input.page,
        pageSize: input.page_size,
      }),
    );
  }
  if (name === "list_watched_vendors") {
    noInput.parse(args);
    return toolResult({
      vendors: (await listWatchedVendors(organisationId)).map((vendor) => ({
        id: vendor.id,
        slug: vendor.catalogSlug,
        name: vendor.displayName,
        website: vendor.website,
        category: vendor.category,
      })),
    });
  }
  if (name === "case_relationships_list") {
    const input = caseRelationshipsListInput.parse(args);
    return toolResult(
      await listRelationshipsCore(organisationId, input.caseId),
    );
  }
  if (name === "case_relationship_suggestions_list") {
    const input = caseRelationshipSuggestionsListInput.parse(args);
    return toolResult(
      await listSuggestionsCore(organisationId, input.caseId, input.limit),
    );
  }
  if (name === "evidence_list") {
    const input = evidenceListInput.parse(args);
    const rows = await listEvidenceForCase(input.caseId, organisationId);
    return toolResult({
      evidence: rows.map(({ storageKey: _storageKey, ...safe }) => safe),
    });
  }
  if (name === "evidence_custody_list") {
    const input = evidenceCustodyListInput.parse(args);
    return toolResult({
      events: await listCustodyEventsForEvidence(input.evidenceId, organisationId),
    });
  }
  if (name === "playbooks_list") {
    const input = playbooksListInput.parse(args);
    return toolResult({
      playbooks: await listPlaybooksCore(organisationId, {
        scenario: input.scenario,
        classification: input.classification,
        severity: input.severity,
        tag: input.tag,
        observableType: input.observable_type,
        q: input.q,
        includeInactive: input.include_inactive,
      }),
    });
  }
  if (name === "playbooks_get") {
    const input = playbookGetInput.parse(args);
    const playbook = await getPlaybookCore(organisationId, input.playbookId);
    if (!playbook) {
      return {
        content: [{ type: "text", text: "Playbook not found." }],
        isError: true,
      };
    }
    return toolResult(playbook);
  }
  if (name === "attack_techniques_search") {
    const input = attackTechniquesSearchInput.parse(args);
    return toolResult({ techniques: await searchTechniques(input) });
  }
  if (name === "attack_mappings_list") {
    const input = attackMappingsListInput.parse(args);
    const mappings = input.caseId
      ? await listMappingsForCase(organisationId, input.caseId)
      : await listMappingsForEntity(organisationId, input.entityType!, input.entityId!);
    return toolResult({ mappings });
  }
  if (name === "attack_coverage_get") {
    noInput.parse(args);
    const [stats, playbookCoverage, templateCoverage] = await Promise.all([
      getOrgCoverageStats(organisationId),
      getPlaybookCoverage(organisationId),
      getCaseTemplateCoverage(organisationId),
    ]);
    return toolResult({ stats, playbookCoverage, templateCoverage });
  }
  if (name === "attack_technique_attach") {
    const input = attackTechniqueAttachInput.parse(args);
    const mapping = await attachTechniqueCore(organisationId, null, input);
    return toolResult({ mapping });
  }
  throw new Error("Unknown tool");
}

export async function POST(req: Request) {
  if (!originAllowed(req)) {
    return rpcError(null, -32000, "Origin not allowed", 403);
  }
  const auth = await authenticateApiTokenWithScope(req, null);
  if (!auth.ok) {
    return rpcError(null, -32001, `Authentication failed: ${auth.reason}`, auth.status);
  }
  const rawBody = await req.text();
  if (rawBody.length > 131_072) {
    return rpcError(null, -32600, "Request too large", 413);
  }
  let message: JsonRpcRequest;
  try {
    message = JSON.parse(rawBody) as JsonRpcRequest;
  } catch {
    return rpcError(null, -32700, "Parse error", 400);
  }
  const id = message.id ?? null;
  if (message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    return rpcError(id, -32600, "Invalid Request", 400);
  }
  if (message.id === undefined) {
    return new Response(null, { status: 202 });
  }

  if (message.method === "initialize") {
    const requested =
      message.params &&
      typeof message.params === "object" &&
      "protocolVersion" in message.params &&
      typeof message.params.protocolVersion === "string"
        ? message.params.protocolVersion
        : null;
    return rpcResult(id, {
      protocolVersion:
        requested && SUPPORTED_PROTOCOLS.has(requested)
          ? requested
          : PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
      instructions: MCP_SERVER_INSTRUCTIONS,
    });
  }
  if (message.method === "ping") return rpcResult(id, {});
  if (message.method === "tools/list") {
    return rpcResult(id, {
      tools: tools
        .filter((tool) => tokenHasScope(auth.token.scopes, tool.scope))
        .map((full) => {
          const readOnly = full.readOnly !== false;
          const { scope: _scope, readOnly: _readOnly, ...tool } = full;
          return {
            ...tool,
            annotations: {
              readOnlyHint: readOnly,
              destructiveHint: false,
              idempotentHint: readOnly,
              openWorldHint: true,
            },
          };
        }),
    });
  }
  if (message.method === "tools/call") {
    const params =
      message.params && typeof message.params === "object"
        ? (message.params as { name?: unknown; arguments?: unknown })
        : {};
    if (typeof params.name !== "string") {
      return rpcError(id, -32602, "Tool name is required");
    }
    const tool = tools.find((candidate) => candidate.name === params.name);
    if (!tool) return rpcError(id, -32601, "Tool not found");
    if (!tokenHasScope(auth.token.scopes, tool.scope)) {
      return rpcError(id, -32003, `Missing scope: ${tool.scope}`);
    }
    try {
      return rpcResult(
        id,
        await callTool(params.name, params.arguments, auth.token.organisationId),
      );
    } catch (error) {
      if (error instanceof z.ZodError) {
        return rpcError(id, -32602, "Invalid tool arguments", 200, error.flatten());
      }
      return rpcResult(id, {
        content: [
          {
            type: "text",
            text:
              error instanceof Error
                ? error.message
                : "Kelpie could not complete the tool call.",
          },
        ],
        isError: true,
      });
    }
  }

  return rpcError(id, -32601, "Method not found");
}

export function GET() {
  return new Response("Stateless MCP endpoint accepts POST requests.", {
    status: 405,
    headers: { allow: "POST" },
  });
}

export const DELETE = GET;
