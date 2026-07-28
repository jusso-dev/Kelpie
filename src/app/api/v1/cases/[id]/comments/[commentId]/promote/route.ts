import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  CASE_CONTENT_BLOCK_TYPES,
  ContentBlockError,
  promoteCommentToContentBlockCore,
} from "@/lib/content-blocks-core";

const promoteSchema = z.object({
  type: z.enum(CASE_CONTENT_BLOCK_TYPES).optional(),
  title: z.string().trim().min(1).max(500).optional(),
  sensitive: z.boolean().optional(),
  includeInReport: z.boolean().optional(),
  tlp: z.enum(["clear", "green", "amber", "amber_strict", "red"]).optional(),
  pap: z.enum(["clear", "green", "amber", "red"]).optional(),
});

type Params = { params: Promise<{ id: string; commentId: string }> };

export async function POST(req: Request, { params }: Params) {
  // Promoting needs content-block write; comment body is read via core.
  const auth = await authenticateApiTokenWithScope(req, "content_blocks:write");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id, commentId } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = promoteSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  try {
    const block = await promoteCommentToContentBlockCore(
      auth.token.organisationId,
      auth.token.createdBy,
      id,
      commentId,
      parsed.data,
    );
    return NextResponse.json({ block }, { status: 201 });
  } catch (error) {
    if (error instanceof ContentBlockError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: "The comment could not be promoted" },
      { status: 500 },
    );
  }
}
