import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  serialiseContext,
  setAnalystOverridesCore,
} from "@/lib/asset-context/context-core";
import {
  AssetContextError,
  CRITICALITY_LEVELS,
  EXPOSURE_LEVELS,
  PRIVILEGE_LEVELS,
  RECOVERY_PRIORITIES,
} from "@/lib/asset-context/types";
import { getPriorityScoringSettings } from "@/lib/asset-context/settings";

const schema = z.object({
  criticalityOverride: z.enum(CRITICALITY_LEVELS).nullable().optional(),
  privilegeLevelOverride: z.enum(PRIVILEGE_LEVELS).nullable().optional(),
  exposureOverride: z.enum(EXPOSURE_LEVELS).nullable().optional(),
  isCrownJewelOverride: z.boolean().nullable().optional(),
  recoveryPriorityOverride: z.enum(RECOVERY_PRIORITIES).nullable().optional(),
});

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiTokenWithScope(req, "asset_context:write");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await context.params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  try {
    const row = await setAnalystOverridesCore(
      auth.token.organisationId,
      id,
      parsed.data,
      auth.token.createdBy ?? null,
    );
    const settings = await getPriorityScoringSettings(auth.token.organisationId);
    return NextResponse.json({
      context: serialiseContext(row, {
        staleAfterHours: settings.staleAfterHours,
      }),
    });
  } catch (err) {
    if (err instanceof AssetContextError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
