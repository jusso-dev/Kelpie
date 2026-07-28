import { NextResponse } from "next/server";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  CaseViewError,
  deleteCaseViewCore,
  getCaseViewCore,
  updateCaseViewCore,
  type CaseViewActor,
} from "@/lib/case-views/core";
import { updateCaseViewBodySchema } from "@/lib/case-views/config";

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

function serialize(view: NonNullable<Awaited<ReturnType<typeof getCaseViewCore>>>) {
  return {
    id: view.id,
    name: view.name,
    description: view.description,
    visibility: view.visibility,
    ownerUserId: view.ownerUserId,
    teamId: view.teamId,
    config: view.config,
    createdAt: view.createdAt.toISOString(),
    updatedAt: view.updatedAt.toISOString(),
  };
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiTokenWithScope(_req, "case_views:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await params;
  const view = await getCaseViewCore(actorFromAuth(auth.token), id);
  if (!view) {
    return NextResponse.json({ error: "View not found" }, { status: 404 });
  }
  return NextResponse.json(serialize(view));
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiTokenWithScope(req, "case_views:write");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = updateCaseViewBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  try {
    const view = await updateCaseViewCore(
      actorFromAuth(auth.token),
      id,
      parsed.data,
    );
    return NextResponse.json(serialize(view));
  } catch (error) {
    if (error instanceof CaseViewError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not update view" },
      { status: 400 },
    );
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiTokenWithScope(req, "case_views:write");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await params;
  try {
    await deleteCaseViewCore(actorFromAuth(auth.token), id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof CaseViewError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not delete view" },
      { status: 400 },
    );
  }
}
