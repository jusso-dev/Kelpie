import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { cases } from "@/db/schema";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import { CASE_ENUMS, createCaseCore } from "@/lib/cases-core";
import {
  MAX_SOURCE_REFERENCE_LENGTH,
  MAX_SOURCE_SYSTEM_LENGTH,
  isApiIngestableSourceSystem,
} from "@/lib/case-source-identity";
import { MAX_EXTERNAL_URL_LENGTH, isSafeExternalUrl, safeExternalUrl } from "@/lib/safe-url";
import { recordInboundSourceDelivery, recordInboundSourceError } from "@/lib/inbound-source-status";

const createSchema = z
  .object({
    title: z.string().min(1).max(500),
    summary: z.string().max(50_000).optional(),
    severity: z.enum(CASE_ENUMS.severity).optional(),
    tlp: z.enum(CASE_ENUMS.tlp).optional(),
    pap: z.enum(CASE_ENUMS.pap).optional(),
    classification: z.enum(CASE_ENUMS.classification).optional(),
    assigneeId: z.string().nullable().optional(),
    tags: z.array(z.string()).optional(),
    dataClassificationTags: z.array(z.string()).optional(),
    sourceSystem: z
      .string()
      .trim()
      .min(1)
      .max(MAX_SOURCE_SYSTEM_LENGTH)
      .refine(
        isApiIngestableSourceSystem,
        "sourceSystem must be a lowercase slug and must not use a reserved connector namespace",
      )
      .optional(),
    sourceReference: z
      .string()
      .trim()
      .min(1)
      .max(MAX_SOURCE_REFERENCE_LENGTH)
      .optional(),
    sourceUrl: z
      .string()
      .trim()
      .max(MAX_EXTERNAL_URL_LENGTH)
      .refine(
        isSafeExternalUrl,
        "sourceUrl must be an http(s) URL without embedded credentials",
      )
      .optional(),
  })
  .refine((data) => !data.sourceReference || !!data.sourceSystem, {
    message: "sourceReference requires sourceSystem",
    path: ["sourceReference"],
  });

/**
 * Best-effort extraction of a `sourceSystem` from a request body that failed
 * schema validation, so we can still attribute a 400 to the right push
 * producer in its delivery health. Only a value that would itself have
 * passed validation is trusted; anything else records nothing rather than
 * risk keying telemetry off unvalidated caller input.
 */
function extractIngestableSourceSystem(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const value = (body as Record<string, unknown>).sourceSystem;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return isApiIngestableSourceSystem(trimmed) ? trimmed : null;
}

/** Field names and messages only — never echoes back submitted values. */
function summariseZodIssues(issues: z.ZodIssue[]): string {
  return issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}

export async function GET(req: Request) {
  const auth = await authenticateApiTokenWithScope(req, "cases:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const url = new URL(req.url);
  const filters = [eq(cases.organisationId, auth.token.organisationId)];
  const status = url.searchParams.get("status");
  const severity = url.searchParams.get("severity");
  const classification = url.searchParams.get("classification");
  const tlp = url.searchParams.get("tlp");
  const assignee = url.searchParams.get("assignee");
  const openedSince = url.searchParams.get("openedSince");
  const source = url.searchParams.get("source");
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);
  if (status === "active") {
    filters.push(sql`${cases.status} <> 'closed'`);
  } else if (status) {
    filters.push(sql`${cases.status} = ${status}`);
  }
  if (severity) filters.push(sql`${cases.severity} = ${severity}`);
  if (classification)
    filters.push(sql`${cases.classification} = ${classification}`);
  if (tlp) filters.push(sql`${cases.tlp} = ${tlp}`);
  if (assignee) filters.push(eq(cases.assigneeId, assignee));
  if (openedSince) {
    const since = new Date(openedSince);
    if (!Number.isNaN(since.getTime())) {
      filters.push(gte(cases.openedAt, since));
    }
  }
  if (source) filters.push(eq(cases.sourceSystem, source));
  const rows = await db
    .select()
    .from(cases)
    .where(and(...filters))
    .orderBy(desc(cases.openedAt))
    .limit(limit);
  return NextResponse.json({ cases: rows });
}

export async function POST(req: Request) {
  const auth = await authenticateApiTokenWithScope(req, "cases:write");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    const sourceSystem = extractIngestableSourceSystem(body);
    if (sourceSystem) {
      await recordInboundSourceError({
        organisationId: auth.token.organisationId,
        sourceSystem,
        status: 400,
        message: summariseZodIssues(parsed.error.issues),
      });
    }
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { sourceSystem, sourceUrl: rawSourceUrl, ...rest } = parsed.data;
  try {
    const created = await createCaseCore(auth.token.organisationId, null, {
      ...rest,
      sourceSystem,
      sourceUrl: rawSourceUrl ? safeExternalUrl(rawSourceUrl) : undefined,
    });
    if (sourceSystem) {
      await recordInboundSourceDelivery({
        organisationId: auth.token.organisationId,
        sourceSystem,
        outcome: created.created ? "created" : "duplicate",
      });
    }
    return NextResponse.json(
      { id: created.id, caseNumber: created.caseNumber, created: created.created },
      { status: created.created ? 201 : 200 },
    );
  } catch {
    // Never leak the raw error (or the request body / Authorization header
    // that produced it) to the caller.
    if (sourceSystem) {
      await recordInboundSourceError({
        organisationId: auth.token.organisationId,
        sourceSystem,
        status: 500,
        message: "Case could not be created",
      });
    }
    return NextResponse.json({ error: "Case could not be created" }, { status: 500 });
  }
}
