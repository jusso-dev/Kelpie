import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { alerts } from "@/db/schema";
import { newId } from "@/lib/utils";
import { authenticateApiToken } from "@/lib/api-tokens";

const observableSchema = z.object({
  type: z.string(),
  value: z.string(),
});

const alertSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  severity: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  source: z.string().min(1),
  externalRef: z.string().optional(),
  observables: z.array(observableSchema).optional(),
  rawPayload: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(req: Request) {
  const token = await authenticateApiToken(req.headers.get("authorization"));
  if (!token) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  if (token.scopes.length > 0 && !token.scopes.includes("alerts:write")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const parsed = alertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const id = newId("alert");
  await db.insert(alerts).values({
    id,
    organisationId: token.organisationId,
    source: parsed.data.source,
    externalRef: parsed.data.externalRef ?? null,
    title: parsed.data.title,
    description: parsed.data.description ?? null,
    severity: parsed.data.severity,
    rawPayload: parsed.data.rawPayload ?? {},
    observables: parsed.data.observables ?? [],
  });
  return NextResponse.json({ id, status: "new" }, { status: 201 });
}

export async function GET(req: Request) {
  const token = await authenticateApiToken(req.headers.get("authorization"));
  if (!token) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  if (token.scopes.length > 0 && !token.scopes.includes("alerts:read")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const rows = await db.query.alerts.findMany({
    where: (a, { eq }) => eq(a.organisationId, token.organisationId),
    orderBy: (a, { desc }) => desc(a.createdAt),
    limit: 100,
  });
  return NextResponse.json({ alerts: rows });
}
