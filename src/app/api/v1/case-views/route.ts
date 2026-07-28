import { NextResponse } from "next/server";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  CaseViewError,
  createCaseViewCore,
  listCaseViewsCore,
  type CaseViewActor,
} from "@/lib/case-views/core";
import { createCaseViewBodySchema } from "@/lib/case-views/config";

function actorFromAuth(token: {
  organisationId: string;
  createdBy: string | null;
}): CaseViewActor {
  return {
    id: token.createdBy ?? `token:${token.organisationId}`,
    organisationId: token.organisationId,
    // API tokens manage views with analyst semantics; org views still require
    // admin session actions. Tokens with write can create personal/team views
    // when createdBy is a real user who is a team member.
    role: "analyst",
  };
}

export async function GET(req: Request) {
  const auth = await authenticateApiTokenWithScope(req, "case_views:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const views = await listCaseViewsCore(actorFromAuth(auth.token));
  return NextResponse.json({
    views: views.map((v) => ({
      id: v.id,
      name: v.name,
      description: v.description,
      visibility: v.visibility,
      ownerUserId: v.ownerUserId,
      teamId: v.teamId,
      config: v.config,
      createdAt: v.createdAt.toISOString(),
      updatedAt: v.updatedAt.toISOString(),
    })),
  });
}

export async function POST(req: Request) {
  const auth = await authenticateApiTokenWithScope(req, "case_views:write");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const body = await req.json().catch(() => null);
  const parsed = createCaseViewBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  try {
    // Organisation views via API require elevating — only allow personal/team
    // unless the token creator is known; admins use session UI for org views.
    if (parsed.data.visibility === "organisation") {
      return NextResponse.json(
        {
          error:
            "Organisation views must be created by an admin session (not API tokens)",
        },
        { status: 403 },
      );
    }
    const view = await createCaseViewCore(actorFromAuth(auth.token), parsed.data);
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
      { error: error instanceof Error ? error.message : "Could not create view" },
      { status: 400 },
    );
  }
}
