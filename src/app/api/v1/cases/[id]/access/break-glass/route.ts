import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  ACCESS_PERMISSIONS,
  AccessError,
  breakGlassAccess,
  resolveTokenActor,
} from "@/lib/access";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  reason: z.string().min(8).max(2000),
  /** TTL in milliseconds; default 4 hours, max 24 hours. */
  ttlMs: z.number().int().positive().max(86_400_000).optional(),
  permissions: z.array(z.enum(ACCESS_PERMISSIONS)).optional(),
});

/**
 * POST /api/v1/cases/:id/access/break-glass
 * Emergency self-grant. Requires user-backed token. Always audited + notifies admins.
 */
export async function POST(req: Request, context: Params) {
  const auth = await authenticateApiTokenWithScope(req, "cases:write");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await context.params;
  const actor = await resolveTokenActor(auth.token);
  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const result = await breakGlassAccess(
      auth.token.organisationId,
      actor,
      id,
      {
        reason: parsed.data.reason,
        ttlMs: parsed.data.ttlMs,
        permissions: parsed.data.permissions,
      },
    );
    return NextResponse.json(
      {
        id: result.id,
        expiresAt: result.expiresAt.toISOString(),
        accessPolicyVersion: result.accessPolicyVersion,
      },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof AccessError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
