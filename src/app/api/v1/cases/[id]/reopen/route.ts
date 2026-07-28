import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import { CaseVersionConflictError } from "@/lib/cases-errors";
import { reopenCaseCore } from "@/lib/cases-core";
import { ClosurePathError } from "@/lib/closure/types";

const bodySchema = z.object({
  reason: z.string().min(3),
  nextStatus: z
    .enum(["open", "in_progress", "contained", "eradicated", "recovered"])
    .optional(),
  version: z.number().int().optional(),
});

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiTokenWithScope(req, "cases:write");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await context.params;
  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const result = await reopenCaseCore(
      auth.token.organisationId,
      auth.token.createdBy ?? null,
      id,
      {
        reason: parsed.data.reason,
        nextStatus: parsed.data.nextStatus,
        expectedVersion: parsed.data.version,
      },
    );
    return NextResponse.json({
      ok: true,
      version: result.version,
      snapshot_id: result.snapshotId,
    });
  } catch (e) {
    if (e instanceof CaseVersionConflictError) {
      return NextResponse.json(
        { error: "version_conflict", current: e.current },
        { status: 409 },
      );
    }
    if (e instanceof ClosurePathError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }
}
