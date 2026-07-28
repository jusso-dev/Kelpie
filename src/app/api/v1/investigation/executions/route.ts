import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  authorizeCase,
  resolveTokenActor,
} from "@/lib/access";
import {
  executeInvestigationCommand,
  filterExecutionsForActor,
  InvestigationConsoleError,
  listInvestigationExecutions,
  toPublicExecution,
} from "@/lib/investigation-console/core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const executeSchema = z.object({
  commandName: z.string().min(1).max(120),
  params: z.record(z.string(), z.unknown()).optional().default({}),
  caseId: z.string().min(1).optional(),
  entityId: z.string().min(1).optional(),
  evidenceId: z.string().min(1).optional(),
  alertId: z.string().min(1).optional(),
  idempotencyKey: z.string().min(1).max(120).optional(),
});

/** GET /api/v1/investigation/executions — history (optional caseId filter). */
export async function GET(req: Request) {
  const auth = await authenticateApiTokenWithScope(req, "investigation:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const url = new URL(req.url);
  const caseId = url.searchParams.get("caseId");
  const commandName = url.searchParams.get("commandName");
  // Over-fetch when listing org-wide so ACL filter still yields up to limit.
  const limit = Number(url.searchParams.get("limit") ?? 50);
  const actor = await resolveTokenActor(auth.token);

  if (caseId) {
    const gate = await authorizeCase(
      auth.token.organisationId,
      caseId,
      actor,
      "view_metadata",
    );
    if (!gate.ok) {
      return NextResponse.json({ error: gate.error }, { status: gate.status });
    }
  }

  const fetchLimit = caseId
    ? limit
    : Math.min(100, Math.max(1, Math.floor(limit)) * 4);
  const rows = await listInvestigationExecutions({
    organisationId: auth.token.organisationId,
    caseId,
    commandName,
    limit: fetchLimit,
  });
  const visible = caseId
    ? rows
    : (
        await filterExecutionsForActor(
          auth.token.organisationId,
          actor,
          rows,
        )
      ).slice(0, Math.min(100, Math.max(1, Math.floor(limit) || 50)));
  return NextResponse.json(
    { executions: visible.map(toPublicExecution) },
    { headers: { "cache-control": "private, no-store" } },
  );
}

/** POST /api/v1/investigation/executions — execute a registered command. */
export async function POST(req: Request) {
  const auth = await authenticateApiTokenWithScope(
    req,
    "investigation:execute",
  );
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = executeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    );
  }

  const actor = await resolveTokenActor(auth.token);
  if (parsed.data.caseId) {
    const gate = await authorizeCase(
      auth.token.organisationId,
      parsed.data.caseId,
      actor,
      "edit",
    );
    if (!gate.ok) {
      return NextResponse.json({ error: gate.error }, { status: gate.status });
    }
  }

  if (!auth.token.createdBy) {
    return NextResponse.json(
      { error: "Token has no associated user for audit attribution" },
      { status: 403 },
    );
  }

  try {
    const result = await executeInvestigationCommand({
      organisationId: auth.token.organisationId,
      actorId: auth.token.createdBy,
      tokenScopes: auth.token.scopes,
      commandName: parsed.data.commandName,
      params: parsed.data.params,
      caseId: parsed.data.caseId,
      entityId: parsed.data.entityId,
      evidenceId: parsed.data.evidenceId,
      alertId: parsed.data.alertId,
      idempotencyKey: parsed.data.idempotencyKey,
    });
    return NextResponse.json(
      {
        execution: toPublicExecution(result.execution),
        reused: result.reused,
      },
      {
        status: result.reused ? 200 : 201,
        headers: { "cache-control": "private, no-store" },
      },
    );
  } catch (err) {
    if (err instanceof InvestigationConsoleError) {
      return NextResponse.json(
        { error: err.message },
        { status: err.status },
      );
    }
    throw err;
  }
}
