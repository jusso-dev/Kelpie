import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  CaseViewError,
  duplicateCaseViewCore,
  type CaseViewActor,
} from "@/lib/case-views/core";
import { CASE_VIEW_VISIBILITIES } from "@/lib/case-views/config";

const duplicateSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    visibility: z.enum(CASE_VIEW_VISIBILITIES).optional(),
    teamId: z.string().trim().min(1).max(80).optional().nullable(),
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

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiTokenWithScope(req, "case_views:write");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = duplicateSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  if (parsed.data.visibility === "organisation") {
    return NextResponse.json(
      {
        error:
          "Organisation views must be created by an admin session (not API tokens)",
      },
      { status: 403 },
    );
  }
  try {
    const view = await duplicateCaseViewCore(
      actorFromAuth(auth.token),
      id,
      parsed.data,
    );
    return NextResponse.json(
      {
        id: view.id,
        name: view.name,
        description: view.description,
        visibility: view.visibility,
        ownerUserId: view.ownerUserId,
        teamId: view.teamId,
        config: view.config,
        createdAt: view.createdAt.toISOString(),
        updatedAt: view.updatedAt.toISOString(),
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof CaseViewError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Could not duplicate view",
      },
      { status: 400 },
    );
  }
}
