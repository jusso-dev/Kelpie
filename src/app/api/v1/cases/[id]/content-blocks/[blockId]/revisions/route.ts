import { NextResponse } from "next/server";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  ContentBlockError,
  listContentBlockRevisionsCore,
} from "@/lib/content-blocks-core";

type Params = { params: Promise<{ id: string; blockId: string }> };

export async function GET(req: Request, { params }: Params) {
  const auth = await authenticateApiTokenWithScope(req, "content_blocks:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id, blockId } = await params;
  try {
    const revisions = await listContentBlockRevisionsCore(
      auth.token.organisationId,
      id,
      blockId,
    );
    return NextResponse.json({ revisions });
  } catch (error) {
    if (error instanceof ContentBlockError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
