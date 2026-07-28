import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  D3fendMappingError,
  createD3fendMappingCore,
  listD3fendMappingsCore,
  removeD3fendMappingCore,
} from "@/lib/attack/d3fend-core";

const createSchema = z.object({
  catalogVersion: z.string().trim().max(64).optional(),
  d3fendTechniqueId: z.string().trim().min(1).max(64),
  d3fendTechniqueName: z.string().trim().min(1).max(256),
  attackTechniqueIds: z.array(z.string().trim().max(32)).optional(),
  playbookId: z.string().trim().max(128).nullable().optional(),
  playbookStepId: z.string().trim().max(128).nullable().optional(),
  responseActionId: z.string().trim().max(128).nullable().optional(),
  notes: z.string().max(10_000).nullable().optional(),
});

export async function GET(req: Request) {
  const auth = await authenticateApiTokenWithScope(req, "attack:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const url = new URL(req.url);
  const playbookId = url.searchParams.get("playbookId") ?? undefined;
  const responseActionId = url.searchParams.get("responseActionId") ?? undefined;
  const mappings = await listD3fendMappingsCore(auth.token.organisationId, { playbookId, responseActionId });
  return NextResponse.json({ mappings });
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
    const mapping = await createD3fendMappingCore(auth.token.organisationId, null, parsed.data);
    return NextResponse.json({ mapping }, { status: 201 });
  } catch (error) {
    if (error instanceof D3fendMappingError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "The D3FEND mapping could not be created" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const auth = await authenticateApiTokenWithScope(req, "attack:write");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  try {
    await removeD3fendMappingCore(auth.token.organisationId, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof D3fendMappingError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "The D3FEND mapping could not be removed" }, { status: 500 });
  }
}
