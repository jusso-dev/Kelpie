import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import { db } from "@/db";
import { cases } from "@/db/schema";
import { getCaseViewCore, type CaseViewActor } from "@/lib/case-views/core";
import {
  BulkPresetValidationError,
  previewBulkPreset,
} from "@/lib/case-views/presets";

const bodySchema = z
  .object({
    presetId: z.string().trim().min(1).max(80),
    /** Fresh selection from the client; re-scoped to the token's organisation. */
    caseIds: z.array(z.string().trim().min(1).max(80)).max(500),
  })
  .strict();

function actorFromAuth(token: {
  organisationId: string;
  createdBy: string | null;
}): CaseViewActor {
  return {
    id: token.createdBy ?? `token:${token.organisationId}`,
    organisationId: token.organisationId,
    role: "analyst",
  };
}

/**
 * Preview a bulk preset's impact against freshly resolved, org-scoped targets.
 * Does not execute the action and never trusts stored case ids from the preset.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiTokenWithScope(req, "case_views:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const actor = actorFromAuth(auth.token);
  const view = await getCaseViewCore(actor, id);
  if (!view) {
    return NextResponse.json({ error: "View not found" }, { status: 404 });
  }

  // Re-resolve: only cases that exist in this organisation count as targets.
  const resolved =
    parsed.data.caseIds.length === 0
      ? []
      : await db
          .select({ id: cases.id })
          .from(cases)
          .where(
            and(
              eq(cases.organisationId, actor.organisationId),
              inArray(cases.id, parsed.data.caseIds),
            ),
          );

  try {
    const preview = previewBulkPreset(
      view.config,
      parsed.data.presetId,
      resolved.map((r) => r.id),
    );
    return NextResponse.json({ preview });
  } catch (error) {
    if (error instanceof BulkPresetValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Preview failed" },
      { status: 400 },
    );
  }
}
