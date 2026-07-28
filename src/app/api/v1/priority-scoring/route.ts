import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  getPriorityScoringSettings,
  updatePriorityScoringSettings,
} from "@/lib/asset-context/settings";
import {
  PRIORITY_WEIGHT_KEYS,
  STALE_CONTEXT_POLICIES,
} from "@/lib/asset-context/types";

const weightsSchema = z.object(
  Object.fromEntries(
    PRIORITY_WEIGHT_KEYS.map((k) => [k, z.number().min(0).max(1).optional()]),
  ) as Record<(typeof PRIORITY_WEIGHT_KEYS)[number], z.ZodOptional<z.ZodNumber>>,
);

const patchSchema = z.object({
  enabled: z.boolean().optional(),
  weights: weightsSchema.optional(),
  staleContextPolicy: z.enum(STALE_CONTEXT_POLICIES).optional(),
  staleAfterHours: z.number().int().min(1).max(24 * 90).optional(),
});

export async function GET(req: Request) {
  const auth = await authenticateApiTokenWithScope(req, "asset_context:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const settings = await getPriorityScoringSettings(auth.token.organisationId);
  return NextResponse.json({ settings });
}

export async function PATCH(req: Request) {
  const auth = await authenticateApiTokenWithScope(req, "asset_context:write");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  try {
    const settings = await updatePriorityScoringSettings(
      auth.token.organisationId,
      {
        enabled: parsed.data.enabled,
        weights: parsed.data.weights,
        staleContextPolicy: parsed.data.staleContextPolicy,
        staleAfterHours: parsed.data.staleAfterHours,
      },
    );
    return NextResponse.json({ settings });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Update failed" },
      { status: 400 },
    );
  }
}
