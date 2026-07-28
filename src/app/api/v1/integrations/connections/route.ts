import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import { auditContextFromRequest } from "@/lib/audit/request-context";
import {
  IntegrationNotFoundError,
  pauseConnection,
  resumeConnection,
  testConnection,
} from "@/lib/integrations/control";
import { isConnectionKind } from "@/lib/integrations/types";
import { updateSyncPolicy } from "@/lib/integrations/sync-policy";
import { recordAuditEvent } from "@/lib/audit/events";

const controlBody = z.object({
  connectionKind: z.string(),
  connectionId: z.string().min(1),
  action: z.enum(["pause", "resume", "test", "enable_outbound", "disable_outbound"]),
  outboundScopes: z.array(z.string()).optional(),
});

export async function POST(req: Request) {
  const auth = await authenticateApiTokenWithScope(req, "integrations:write");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }

  let body: z.infer<typeof controlBody>;
  try {
    body = controlBody.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  if (!isConnectionKind(body.connectionKind)) {
    return NextResponse.json({ error: "Unknown connection kind" }, { status: 400 });
  }

  const audit = auditContextFromRequest(req);
  try {
    if (body.action === "pause") {
      const state = await pauseConnection({
        organisationId: auth.token.organisationId,
        connectionKind: body.connectionKind,
        connectionId: body.connectionId,
        actorId: auth.token.id,
        actorLabel: auth.token.id,
        audit,
      });
      return NextResponse.json({
        connectionKind: state.connectionKind,
        connectionId: state.connectionId,
        isPaused: state.isPaused,
        status: state.status,
      });
    }
    if (body.action === "resume") {
      const state = await resumeConnection({
        organisationId: auth.token.organisationId,
        connectionKind: body.connectionKind,
        connectionId: body.connectionId,
        actorId: auth.token.id,
        actorLabel: auth.token.id,
        audit,
      });
      return NextResponse.json({
        connectionKind: state.connectionKind,
        connectionId: state.connectionId,
        isPaused: state.isPaused,
        status: state.status,
      });
    }
    if (body.action === "test") {
      const result = await testConnection({
        organisationId: auth.token.organisationId,
        connectionKind: body.connectionKind,
        connectionId: body.connectionId,
        actorId: auth.token.id,
        actorLabel: auth.token.id,
        audit,
      });
      return NextResponse.json(result);
    }
    if (body.action === "enable_outbound" || body.action === "disable_outbound") {
      const enabled = body.action === "enable_outbound";
      if (enabled && (!body.outboundScopes || body.outboundScopes.length === 0)) {
        return NextResponse.json(
          {
            error:
              "Outbound write access requires explicit scopes plus per-field policy",
          },
          { status: 400 },
        );
      }
      const policy = await updateSyncPolicy({
        organisationId: auth.token.organisationId,
        connectionKind: body.connectionKind,
        connectionId: body.connectionId,
        outboundEnabled: enabled,
        outboundScopes: body.outboundScopes,
      });
      // Also flip the connection-level writeEnabled gate.
      const { recordConnectionHealth } = await import("@/lib/integrations/state");
      await recordConnectionHealth({
        organisationId: auth.token.organisationId,
        connectionKind: body.connectionKind,
        connectionId: body.connectionId,
        writeEnabled: enabled,
      });
      await recordAuditEvent({
        organisationId: auth.token.organisationId,
        actorId: auth.token.id,
        actorType: "api_token",
        actorLabel: auth.token.id,
        action: enabled
          ? "integration.outbound_enabled"
          : "integration.outbound_disabled",
        targetType: "integration_sync_policy",
        targetId: policy.id,
        before: { outboundEnabled: !enabled },
        after: {
          outboundEnabled: policy.outboundEnabled,
          outboundScopes: policy.outboundScopes,
        },
        ...audit,
      });
      return NextResponse.json({
        outboundEnabled: policy.outboundEnabled,
        outboundScopes: policy.outboundScopes,
      });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    if (error instanceof IntegrationNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    const message = error instanceof Error ? error.message : "Request failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
