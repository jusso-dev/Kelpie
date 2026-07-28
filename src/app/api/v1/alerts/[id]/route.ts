import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  AlertError,
  AlertVersionConflictError,
  getAlertInOrg,
  setAlertDispositionCore,
} from "@/lib/investigations/alerts-core";

const patchSchema = z.object({
  status: z.enum(["new", "in_progress", "closed", "dismissed"]).optional(),
  determination: z
    .enum(["unknown", "true_positive", "false_positive", "benign_positive"])
    .optional(),
  severity: z
    .enum(["informational", "low", "medium", "high", "critical"])
    .optional(),
  assigneeId: z.string().nullable().optional(),
  analystNotes: z.string().nullable().optional(),
  dismissedReason: z.string().nullable().optional(),
  version: z.number().int().nonnegative().optional(),
});

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiTokenWithScope(req, "alerts:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await context.params;
  const alert = await getAlertInOrg(id, auth.token.organisationId);
  if (!alert) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ alert });
}

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiTokenWithScope(req, "alerts:write");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await context.params;
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const [actor] = auth.token.createdBy
    ? await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, auth.token.createdBy))
        .limit(1)
    : [];
  const { version, ...patch } = parsed.data;
  try {
    const alert = await setAlertDispositionCore({
      organisationId: auth.token.organisationId,
      actorId: actor?.id ?? null,
      alertId: id,
      patch,
      expectedVersion: version,
    });
    return NextResponse.json({ alert });
  } catch (err) {
    if (err instanceof AlertVersionConflictError) {
      return NextResponse.json(
        { error: "version_conflict", current: err.current },
        { status: 409 },
      );
    }
    if (err instanceof AlertError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
