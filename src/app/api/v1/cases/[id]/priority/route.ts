import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  getCasePriorityCore,
  listCriticalContextsForCase,
  recalculateCasePriorityCore,
  setPriorityOverrideCore,
} from "@/lib/asset-context/priority-core";
import { AssetContextError } from "@/lib/asset-context/types";
import { serialiseContext } from "@/lib/asset-context/context-core";
import { getPriorityScoringSettings } from "@/lib/asset-context/settings";
import { effectiveContextFields } from "@/lib/asset-context/effective";

const overrideSchema = z.object({
  score: z.number().int().min(0).max(100).nullable(),
  reason: z.string().trim().max(2000).nullable().optional(),
});

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiTokenWithScope(req, "asset_context:read");
  if (!auth.ok) {
    // Also allow cases:read for priority visibility on case detail
    const casesAuth = await authenticateApiTokenWithScope(req, "cases:read");
    if (!casesAuth.ok) {
      return NextResponse.json(
        { error: casesAuth.reason },
        { status: casesAuth.status },
      );
    }
    return handleGet(casesAuth.token.organisationId, await context.params);
  }
  return handleGet(auth.token.organisationId, await context.params);
}

async function handleGet(organisationId: string, params: { id: string }) {
  const { id } = params;
  let score = await getCasePriorityCore(organisationId, id);
  if (!score) {
    score = await recalculateCasePriorityCore(organisationId, id);
  }
  if (!score) {
    return NextResponse.json({ error: "Case not found" }, { status: 404 });
  }
  const settings = await getPriorityScoringSettings(organisationId);
  const critical = await listCriticalContextsForCase(organisationId, id);
  return NextResponse.json({
    priority: score,
    criticalContexts: critical.map((c) => ({
      ...serialiseContext(c, { staleAfterHours: settings.staleAfterHours }),
      effective: effectiveContextFields(c),
    })),
  });
}

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiTokenWithScope(req, "asset_context:write");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await context.params;
  const url = new URL(req.url);
  if (url.searchParams.get("recalculate") === "true") {
    const score = await recalculateCasePriorityCore(
      auth.token.organisationId,
      id,
    );
    if (!score) {
      return NextResponse.json({ error: "Case not found" }, { status: 404 });
    }
    return NextResponse.json({ priority: score });
  }

  const body = await req.json().catch(() => null);
  const parsed = overrideSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  try {
    const score = await setPriorityOverrideCore(
      auth.token.organisationId,
      id,
      parsed.data,
      auth.token.createdBy ?? null,
    );
    return NextResponse.json({ priority: score });
  } catch (err) {
    if (err instanceof AssetContextError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
