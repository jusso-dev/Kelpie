import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { alerts } from "@/db/schema";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import { ingestAlert } from "@/lib/alerts-core";

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
  const auth = await authenticateApiTokenWithScope(req, "alerts:write");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const body = await req.json().catch(() => null);
  const parsed = alertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const result = await ingestAlert(auth.token.organisationId, parsed.data);
  return NextResponse.json(
    {
      id: result.alert.id,
      status: result.alert.status,
      deduplicated: !result.created,
    },
    { status: result.created ? 201 : 200 },
  );
}

export async function GET(req: Request) {
  const auth = await authenticateApiTokenWithScope(req, "alerts:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const rows = await db.query.alerts.findMany({
    where: (a, { eq }) => eq(a.organisationId, auth.token.organisationId),
    orderBy: (a, { desc }) => desc(a.createdAt),
    limit: 100,
  });
  return NextResponse.json({ alerts: rows });
}
