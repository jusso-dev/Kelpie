import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import { AlertError, getAlertInOrg, linkEntityToAlertCore, listEntitiesForAlert } from "@/lib/investigations/alerts-core";
import { EntityError, resolveEntityCore } from "@/lib/investigations/entities-core";

const ENTITY_TYPES = [
  "user_identity",
  "device_endpoint",
  "mailbox",
  "email_message",
  "ip",
  "domain",
  "url",
  "file",
  "file_hash",
  "process",
  "cloud_resource",
  "application",
  "tenant",
  "network",
  "asset",
] as const;

const IDENTIFIER_KINDS = [
  "email",
  "upn",
  "sid",
  "aad_object_id",
  "device_id",
  "hostname",
  "ip",
  "fqdn",
  "url",
  "sha256",
  "sha1",
  "md5",
  "process_guid",
  "cloud_resource_id",
  "tenant_id",
  "application_id",
  "other",
] as const;

const linkSchema = z.object({
  type: z.enum(ENTITY_TYPES),
  displayName: z.string().min(1),
  role: z.enum(["actor", "target", "impacted", "related"]).default("related"),
  identifiers: z
    .array(
      z.object({
        kind: z.enum(IDENTIFIER_KINDS),
        value: z.string().min(1),
        source: z.string().nullable().optional(),
      }),
    )
    .min(1),
  attributes: z.record(z.string(), z.unknown()).optional(),
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
  const entities = await listEntitiesForAlert(id, auth.token.organisationId);
  return NextResponse.json({ entities });
}

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiTokenWithScope(req, "alerts:write");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await context.params;
  const body = await req.json().catch(() => null);
  const parsed = linkSchema.safeParse(body);
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
  try {
    const { entity } = await resolveEntityCore({
      organisationId: auth.token.organisationId,
      type: parsed.data.type,
      displayName: parsed.data.displayName,
      identifiers: parsed.data.identifiers,
      attributes: parsed.data.attributes,
    });
    const link = await linkEntityToAlertCore({
      organisationId: auth.token.organisationId,
      actorId: actor?.id ?? null,
      alertId: id,
      entityId: entity.id,
      role: parsed.data.role,
    });
    return NextResponse.json({ entity, link }, { status: 201 });
  } catch (err) {
    if (err instanceof AlertError || err instanceof EntityError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
