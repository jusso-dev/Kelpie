import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  AttackMappingError,
  MAPPING_ENTITY_TYPES,
  attachTechniqueCore,
  listMappingsForCase,
  listMappingsForEntity,
} from "@/lib/attack/mapping-core";

const entityTypeSchema = z.enum(MAPPING_ENTITY_TYPES);

const createSchema = z.object({
  entityType: entityTypeSchema,
  entityId: z.string().trim().min(1).max(128),
  techniqueId: z.string().trim().min(1).max(32),
  confidence: z.number().int().min(0).max(100).nullable().optional(),
  source: z.string().trim().max(64).optional(),
  notes: z.string().max(10_000).nullable().optional(),
  detectionNotes: z.string().max(10_000).nullable().optional(),
  responseNotes: z.string().max(10_000).nullable().optional(),
  actorAttribution: z.string().max(500).nullable().optional(),
});

export async function GET(req: Request) {
  const auth = await authenticateApiTokenWithScope(req, "attack:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const url = new URL(req.url);
  const caseId = url.searchParams.get("caseId");
  const entityType = url.searchParams.get("entityType");
  const entityId = url.searchParams.get("entityId");

  if (caseId) {
    const mappings = await listMappingsForCase(auth.token.organisationId, caseId);
    return NextResponse.json({ mappings });
  }
  if (entityType && entityId) {
    const parsedType = entityTypeSchema.safeParse(entityType);
    if (!parsedType.success) {
      return NextResponse.json({ error: "Invalid payload", details: parsedType.error.flatten() }, { status: 400 });
    }
    const mappings = await listMappingsForEntity(auth.token.organisationId, parsedType.data, entityId);
    return NextResponse.json({ mappings });
  }
  return NextResponse.json(
    { error: "Provide caseId, or both entityType and entityId" },
    { status: 400 },
  );
}

export async function POST(req: Request) {
  const auth = await authenticateApiTokenWithScope(req, "attack:write");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  try {
    const mapping = await attachTechniqueCore(auth.token.organisationId, null, parsed.data);
    return NextResponse.json({ mapping }, { status: 201 });
  } catch (error) {
    if (error instanceof AttackMappingError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "The technique mapping could not be created" }, { status: 500 });
  }
}
