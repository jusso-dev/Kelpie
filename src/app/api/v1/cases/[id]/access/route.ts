import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  AccessError,
  authorizeCase,
  getCaseAccessSummary,
  resolveTokenActor,
  setCaseVisibility,
  CASE_VISIBILITY_MODES,
} from "@/lib/access";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/v1/cases/:id/access
 * Returns visibility mode, compartment membership, and active grants.
 * Requires administer_access (or view_metadata so members can see mode only).
 */
export async function GET(req: Request, context: Params) {
  const auth = await authenticateApiTokenWithScope(req, "cases:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await context.params;
  const actor = await resolveTokenActor(auth.token);
  const gate = await authorizeCase(
    auth.token.organisationId,
    id,
    actor,
    "know_exists",
  );
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  const summary = await getCaseAccessSummary(auth.token.organisationId, id);
  if (!summary) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Only administrators see full grant/compartment detail.
  if (!gate.permissions.has("administer_access")) {
    return NextResponse.json({
      visibilityMode: summary.visibilityMode,
      accessPolicyVersion: summary.accessPolicyVersion,
      permissions: [...gate.permissions],
    });
  }

  return NextResponse.json({
    ...summary,
    permissions: [...gate.permissions],
  });
}

const patchSchema = z.object({
  visibilityMode: z.enum(CASE_VISIBILITY_MODES),
  teamIds: z.array(z.string().min(1)).optional(),
  memberIds: z.array(z.string().min(1)).optional(),
  reason: z.string().min(8).max(2000),
});

/**
 * PATCH /api/v1/cases/:id/access
 * Change visibility mode and compartment membership. Requires administer_access.
 */
export async function PATCH(req: Request, context: Params) {
  const auth = await authenticateApiTokenWithScope(req, "cases:write");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await context.params;
  const actor = await resolveTokenActor(auth.token);
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const result = await setCaseVisibility(
      auth.token.organisationId,
      actor,
      id,
      parsed.data,
    );
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof AccessError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
