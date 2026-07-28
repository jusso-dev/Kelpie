import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  ACCESS_OBJECT_TYPES,
  ACCESS_PERMISSIONS,
  ACCESS_SUBJECT_TYPES,
  AccessError,
  authorizeCase,
  createAccessGrant,
  listAccessGrants,
  resolveTokenActor,
} from "@/lib/access";

type Params = { params: Promise<{ id: string }> };

const createSchema = z.object({
  subjectType: z.enum(ACCESS_SUBJECT_TYPES),
  subjectId: z.string().min(1),
  permissions: z.array(z.enum(ACCESS_PERMISSIONS)).min(1),
  reason: z.string().min(8).max(2000),
  expiresAt: z.string().datetime().nullable().optional(),
  objectType: z.enum(ACCESS_OBJECT_TYPES).optional(),
  objectId: z.string().min(1).nullable().optional(),
});

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
    "administer_access",
  );
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const includeRevoked =
    new URL(req.url).searchParams.get("includeRevoked") === "true";
  const grants = await listAccessGrants(auth.token.organisationId, id, {
    includeRevoked,
  });
  return NextResponse.json({ grants });
}

export async function POST(req: Request, context: Params) {
  const auth = await authenticateApiTokenWithScope(req, "cases:write");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await context.params;
  const actor = await resolveTokenActor(auth.token);
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const result = await createAccessGrant(
      auth.token.organisationId,
      actor,
      id,
      {
        subjectType: parsed.data.subjectType,
        subjectId: parsed.data.subjectId,
        permissions: parsed.data.permissions,
        reason: parsed.data.reason,
        expiresAt: parsed.data.expiresAt
          ? new Date(parsed.data.expiresAt)
          : null,
        objectType: parsed.data.objectType,
        objectId: parsed.data.objectId,
      },
    );
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof AccessError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
