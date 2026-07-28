import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  listContextsCore,
  serialiseContext,
  upsertContextFromProvider,
} from "@/lib/asset-context/context-core";
import {
  ASSET_CONTEXT_KINDS,
  AssetContextError,
  CRITICALITY_LEVELS,
  ENVIRONMENT_KINDS,
  EXPOSURE_LEVELS,
  PRIVILEGE_LEVELS,
  RECOVERY_PRIORITIES,
} from "@/lib/asset-context/types";
import { getPriorityScoringSettings } from "@/lib/asset-context/settings";

const IDENTIFIER_KINDS = [
  "email",
  "upn",
  "sid",
  "aad_object_id",
  "device_id",
  "hostname",
  "ip",
  "fqdn",
  "url",
  "sha256",
  "sha1",
  "md5",
  "process_guid",
  "cloud_resource_id",
  "tenant_id",
  "application_id",
  "other",
] as const;

const upsertSchema = z.object({
  kind: z.enum(ASSET_CONTEXT_KINDS),
  displayName: z.string().trim().min(1).max(300),
  primaryIdentifierKind: z.enum(IDENTIFIER_KINDS),
  primaryIdentifierValue: z.string().trim().min(1).max(500),
  criticality: z.enum(CRITICALITY_LEVELS).optional(),
  privilegeLevel: z.enum(PRIVILEGE_LEVELS).optional(),
  exposure: z.enum(EXPOSURE_LEVELS).optional(),
  environment: z.enum(ENVIRONMENT_KINDS).optional(),
  isCrownJewel: z.boolean().optional(),
  recoveryPriority: z.enum(RECOVERY_PRIORITIES).optional(),
  ownerTeam: z.string().trim().max(200).nullable().optional(),
  ownerEmail: z.string().trim().max(320).nullable().optional(),
  businessService: z.string().trim().max(300).nullable().optional(),
  applicationName: z.string().trim().max(300).nullable().optional(),
  dataClassifications: z.array(z.string().max(100)).max(50).optional(),
  regulatoryScope: z.array(z.string().max(100)).max(50).optional(),
  attributes: z.record(z.string(), z.unknown()).optional(),
  providerExternalId: z.string().trim().max(200).nullable().optional(),
});

export async function GET(req: Request) {
  const auth = await authenticateApiTokenWithScope(req, "asset_context:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { searchParams } = new URL(req.url);
  const kind = searchParams.get("kind") ?? undefined;
  const criticalOnly = searchParams.get("criticalOnly") === "true";
  const crownJewelOnly = searchParams.get("crownJewelOnly") === "true";
  const limitParam = Number(searchParams.get("limit") ?? "");
  const settings = await getPriorityScoringSettings(auth.token.organisationId);
  const items = await listContextsCore(auth.token.organisationId, {
    kind: kind as (typeof ASSET_CONTEXT_KINDS)[number] | undefined,
    criticalOnly,
    crownJewelOnly,
    limit: Number.isFinite(limitParam) ? limitParam : 100,
  });
  return NextResponse.json({
    contexts: items.map((c) =>
      serialiseContext(c, { staleAfterHours: settings.staleAfterHours }),
    ),
  });
}

export async function POST(req: Request) {
  const auth = await authenticateApiTokenWithScope(req, "asset_context:write");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const body = await req.json().catch(() => null);
  const parsed = upsertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  try {
    const result = await upsertContextFromProvider({
      organisationId: auth.token.organisationId,
      ...parsed.data,
      providerSource: "rest",
      actorId: auth.token.createdBy ?? null,
      markSyncOk: true,
    });
    const settings = await getPriorityScoringSettings(auth.token.organisationId);
    return NextResponse.json(
      {
        context: serialiseContext(result.context, {
          staleAfterHours: settings.staleAfterHours,
        }),
        created: result.created,
        matchReviewId: result.matchReviewId,
      },
      { status: result.created ? 201 : 200 },
    );
  } catch (err) {
    if (err instanceof AssetContextError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
