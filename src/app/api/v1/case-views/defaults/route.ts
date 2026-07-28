import { NextResponse } from "next/server";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  CaseViewError,
  listCaseViewDefaultsCore,
  setCaseViewDefaultCore,
  type CaseViewActor,
} from "@/lib/case-views/core";
import { setCaseViewDefaultBodySchema } from "@/lib/case-views/config";

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

export async function GET(req: Request) {
  const auth = await authenticateApiTokenWithScope(req, "case_views:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const defaults = await listCaseViewDefaultsCore(actorFromAuth(auth.token));
  return NextResponse.json({ defaults });
}

export async function PUT(req: Request) {
  const auth = await authenticateApiTokenWithScope(req, "case_views:write");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const body = await req.json().catch(() => null);
  const parsed = setCaseViewDefaultBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  // Role/team defaults need admin — API tokens act as analyst, so block those scopes.
  if (parsed.data.scope === "role" || parsed.data.scope === "team") {
    return NextResponse.json(
      {
        error:
          "Role and team defaults must be set by an admin session (not API tokens)",
      },
      { status: 403 },
    );
  }
  try {
    await setCaseViewDefaultCore(actorFromAuth(auth.token), {
      scope: parsed.data.scope,
      viewId: parsed.data.viewId,
      role: parsed.data.role,
      teamId: parsed.data.teamId,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof CaseViewError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Could not set default",
      },
      { status: 400 },
    );
  }
}
