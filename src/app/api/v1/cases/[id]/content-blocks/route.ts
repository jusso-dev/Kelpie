import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  CASE_CONTENT_BLOCK_TYPES,
  ContentBlockError,
  createContentBlockCore,
  listContentBlocksCore,
} from "@/lib/content-blocks-core";

const tlpSchema = z.enum(["clear", "green", "amber", "amber_strict", "red"]);
const papSchema = z.enum(["clear", "green", "amber", "red"]);

const createSchema = z.object({
  type: z.enum(CASE_CONTENT_BLOCK_TYPES),
  title: z.string().trim().min(1).max(500),
  content: z.string().max(100_000).optional(),
  contentStructured: z.unknown().optional(),
  groupKey: z.string().trim().max(128).nullable().optional(),
  collapsed: z.boolean().optional(),
  tlp: tlpSchema.optional(),
  pap: papSchema.optional(),
  sensitive: z.boolean().optional(),
  includeInReport: z.boolean().optional(),
});

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  const auth = await authenticateApiTokenWithScope(req, "content_blocks:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await params;
  const includeArchived =
    new URL(req.url).searchParams.get("includeArchived") === "true";
  try {
    const blocks = await listContentBlocksCore(auth.token.organisationId, id, {
      includeArchived,
    });
    return NextResponse.json({ blocks });
  } catch (error) {
    if (error instanceof ContentBlockError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}

export async function POST(req: Request, { params }: Params) {
  const auth = await authenticateApiTokenWithScope(req, "content_blocks:write");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  try {
    const block = await createContentBlockCore(
      auth.token.organisationId,
      auth.token.createdBy,
      id,
      parsed.data,
    );
    return NextResponse.json({ block }, { status: 201 });
  } catch (error) {
    if (error instanceof ContentBlockError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: "The content block could not be created" },
      { status: 500 },
    );
  }
}
