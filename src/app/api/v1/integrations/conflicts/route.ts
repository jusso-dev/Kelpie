import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import { auditContextFromRequest } from "@/lib/audit/request-context";
import { recordAuditEvent } from "@/lib/audit/events";
import { listOpenConflicts, resolveConflict } from "@/lib/integrations/conflicts";

export async function GET(req: Request) {
  const auth = await authenticateApiTokenWithScope(req, "integrations:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { searchParams } = new URL(req.url);
  const caseId = searchParams.get("caseId") ?? undefined;
  const limit = Number(searchParams.get("limit") ?? "50");
  const conflicts = await listOpenConflicts(auth.token.organisationId, {
    caseId,
    limit: Number.isFinite(limit) ? limit : 50,
  });
  return NextResponse.json({
    conflicts: conflicts.map((c) => ({
      id: c.id,
      connectionKind: c.connectionKind,
      connectionId: c.connectionId,
      caseId: c.caseId,
      fieldName: c.fieldName,
      kelpieValue: c.kelpieValue,
      sourceValue: c.sourceValue,
      kelpieUpdatedAt: c.kelpieUpdatedAt?.toISOString() ?? null,
      sourceUpdatedAt: c.sourceUpdatedAt?.toISOString() ?? null,
      kelpieProvenance: c.kelpieProvenance,
      sourceProvenance: c.sourceProvenance,
      status: c.status,
      createdAt: c.createdAt.toISOString(),
    })),
  });
}

const resolveBody = z.object({
  conflictId: z.string().min(1),
  resolution: z.enum([
    "resolved_keep_kelpie",
    "resolved_take_source",
    "dismissed",
  ]),
});

export async function POST(req: Request) {
  const auth = await authenticateApiTokenWithScope(req, "integrations:write");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  let body: z.infer<typeof resolveBody>;
  try {
    body = resolveBody.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  try {
    const conflict = await resolveConflict({
      organisationId: auth.token.organisationId,
      conflictId: body.conflictId,
      resolution: body.resolution,
      actorId: null,
    });
    await recordAuditEvent({
      organisationId: auth.token.organisationId,
      actorId: auth.token.id,
      actorType: "api_token",
      actorLabel: auth.token.id,
      action: "integration.conflict_resolved",
      targetType: "integration_sync_conflict",
      targetId: conflict.id,
      targetLabel: conflict.fieldName,
      before: { status: "open" },
      after: { status: body.resolution },
      ...auditContextFromRequest(req),
    });
    return NextResponse.json({
      id: conflict.id,
      status: conflict.status,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Resolve failed";
    const status = message === "Conflict not found" ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
