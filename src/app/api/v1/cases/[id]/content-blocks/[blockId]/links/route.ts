import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  CASE_CONTENT_BLOCK_LINK_TYPES,
  ContentBlockError,
  addContentBlockLinkCore,
} from "@/lib/content-blocks-core";

const createSchema = z.object({
  linkType: z.enum(CASE_CONTENT_BLOCK_LINK_TYPES),
  targetId: z.string().trim().min(1).max(256),
});

type Params = { params: Promise<{ id: string; blockId: string }> };

export async function POST(req: Request, { params }: Params) {
  const auth = await authenticateApiTokenWithScope(req, "content_blocks:write");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id, blockId } = await params;
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  try {
    const link = await addContentBlockLinkCore(
      auth.token.organisationId,
      auth.token.createdBy,
      id,
      blockId,
      parsed.data.linkType,
      parsed.data.targetId,
    );
    return NextResponse.json({ link }, { status: 201 });
  } catch (error) {
    if (error instanceof ContentBlockError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: "The link could not be created" },
      { status: 500 },
    );
  }
}
