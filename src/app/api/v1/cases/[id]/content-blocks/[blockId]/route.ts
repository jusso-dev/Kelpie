import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  CASE_CONTENT_BLOCK_TYPES,
  ContentBlockError,
  archiveContentBlockCore,
  getContentBlockCore,
  reorderContentBlocksCore,
  restoreContentBlockRevisionCore,
  updateContentBlockCore,
} from "@/lib/content-blocks-core";

const tlpSchema = z.enum(["clear", "green", "amber", "amber_strict", "red"]);
const papSchema = z.enum(["clear", "green", "amber", "red"]);

const patchSchema = z.object({
  type: z.enum(CASE_CONTENT_BLOCK_TYPES).optional(),
  title: z.string().trim().min(1).max(500).optional(),
  content: z.string().max(100_000).optional(),
  contentStructured: z.unknown().nullable().optional(),
  groupKey: z.string().trim().max(128).nullable().optional(),
  collapsed: z.boolean().optional(),
  tlp: tlpSchema.optional(),
  pap: papSchema.optional(),
  sensitive: z.boolean().optional(),
  includeInReport: z.boolean().optional(),
  changeSummary: z.string().max(500).nullable().optional(),
  /** When set, reorders this block among active blocks and ignores other fields. */
  targetIndex: z.number().int().min(0).optional(),
  /** Soft-archive the block. */
  archive: z.boolean().optional(),
  /** Restore a prior revision number as a new head. */
  restoreRevision: z.number().int().min(1).optional(),
});

type Params = { params: Promise<{ id: string; blockId: string }> };

export async function GET(req: Request, { params }: Params) {
  const auth = await authenticateApiTokenWithScope(req, "content_blocks:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id, blockId } = await params;
  try {
    const block = await getContentBlockCore(
      auth.token.organisationId,
      id,
      blockId,
    );
    return NextResponse.json({ block });
  } catch (error) {
    if (error instanceof ContentBlockError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}

export async function PATCH(req: Request, { params }: Params) {
  const auth = await authenticateApiTokenWithScope(req, "content_blocks:write");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id, blockId } = await params;
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  try {
    if (parsed.data.targetIndex !== undefined) {
      const blocks = await reorderContentBlocksCore(
        auth.token.organisationId,
        auth.token.createdBy,
        id,
        blockId,
        parsed.data.targetIndex,
      );
      return NextResponse.json({ blocks });
    }
    if (parsed.data.archive === true) {
      const block = await archiveContentBlockCore(
        auth.token.organisationId,
        auth.token.createdBy,
        id,
        blockId,
      );
      return NextResponse.json({ block });
    }
    if (parsed.data.restoreRevision !== undefined) {
      const block = await restoreContentBlockRevisionCore(
        auth.token.organisationId,
        auth.token.createdBy,
        id,
        blockId,
        parsed.data.restoreRevision,
      );
      return NextResponse.json({ block });
    }
    const {
      targetIndex: _t,
      archive: _a,
      restoreRevision: _r,
      ...patch
    } = parsed.data;
    const block = await updateContentBlockCore(
      auth.token.organisationId,
      auth.token.createdBy,
      id,
      blockId,
      patch,
    );
    return NextResponse.json({ block });
  } catch (error) {
    if (error instanceof ContentBlockError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: "The content block could not be updated" },
      { status: 500 },
    );
  }
}

export async function DELETE(req: Request, { params }: Params) {
  const auth = await authenticateApiTokenWithScope(req, "content_blocks:write");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id, blockId } = await params;
  try {
    const block = await archiveContentBlockCore(
      auth.token.organisationId,
      auth.token.createdBy,
      id,
      blockId,
    );
    return NextResponse.json({ block });
  } catch (error) {
    if (error instanceof ContentBlockError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: "The content block could not be archived" },
      { status: 500 },
    );
  }
}
