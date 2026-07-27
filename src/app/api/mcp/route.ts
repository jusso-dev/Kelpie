import { z } from "zod";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  listRelationshipsCore,
  listSuggestionsCore,
} from "@/lib/case-relationships-core";
import {
  listWatchedVendors,
  queryCyberBriefing,
  queryThreatIntelligence,
} from "@/lib/machine-data";
import type { ScopeValue } from "@/lib/scopes";
import { tokenHasScope } from "@/lib/scopes";
import { getThreatLandscapeData } from "@/lib/threat-landscape";
import { TI_INDICATOR_TYPES } from "@/lib/ti/indicator-types";

export const dynamic = "force-dynamic";

const PROTOCOL_VERSION = "2025-11-25";
const SUPPORTED_PROTOCOLS = new Set([
  PROTOCOL_VERSION,
  "2025-06-18",
  "2025-03-26",
]);

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

const tools = [
  {
    name: "search_threat_intelligence",
    title: "Search threat intelligence",
    description:
      "Search this organisation's threat-intelligence indicators and inspect feed health. Kelpie threat intelligence covers IP, URL, file hash and domain indicators only (no CVE/vulnerability data).",
    scope: "threat_intelligence:read" as ScopeValue,
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
    scope: "threat_landscape:read" as ScopeValue,
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
    scope: "briefing:read" as ScopeValue,
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
    scope: "briefing:read" as ScopeValue,
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
    scope: "case_relationships:read" as ScopeValue,
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
    scope: "case_relationships:read" as ScopeValue,
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
] as const;

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
      serverInfo: { name: "kelpie", version: "0.2.0" },
      instructions:
        "Read-only access to organisation threat intelligence, Threat landscape, Cyber brief, and watched-vendor matches.",
    });
  }
  if (message.method === "ping") return rpcResult(id, {});
  if (message.method === "tools/list") {
    return rpcResult(id, {
      tools: tools
        .filter((tool) => tokenHasScope(auth.token.scopes, tool.scope))
        .map(({ scope: _scope, ...tool }) => ({
          ...tool,
          annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
          },
        })),
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
