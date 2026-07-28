import { NextResponse } from "next/server";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  ContentBlockError,
  removeContentBlockLinkCore,
} from "@/lib/content-blocks-core";

type Params = {
  params: Promise<{ id: string; blockId: string; linkId: string }>;
};

export async function DELETE(req: Request, { params }: Params) {
  const auth = await authenticateApiTokenWithScope(req, "content_blocks:write");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id, blockId, linkId } = await params;
  try {
    await removeContentBlockLinkCore(
      auth.token.organisationId,
      auth.token.createdBy,
      id,
      blockId,
      linkId,
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof ContentBlockError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: "The link could not be removed" },
      { status: 500 },
    );
  }
}
