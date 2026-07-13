import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { alerts } from "@/db/schema";
import { and, desc, eq, sql } from "drizzle-orm";
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
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const severity = url.searchParams.get("severity");
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 100), 1), 200);
  const filters = [eq(alerts.organisationId, auth.token.organisationId)];
  if (status === "open") {
    filters.push(sql`${alerts.status} in ('new', 'triaged')`);
  } else if (status) {
    filters.push(sql`${alerts.status} = ${status}`);
  }
  if (severity) filters.push(sql`${alerts.severity} = ${severity}`);
  const rows = await db
    .select()
    .from(alerts)
    .where(and(...filters))
    .orderBy(desc(alerts.createdAt))
    .limit(limit);
  return NextResponse.json({ alerts: rows });
}
