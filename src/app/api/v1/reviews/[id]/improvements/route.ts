import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  IMPROVEMENT_KINDS,
  ReviewError,
  createImprovementCore,
  listImprovementsCore,
} from "@/lib/post-incident-review";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const createSchema = z.object({
  kind: z.enum(IMPROVEMENT_KINDS),
  title: z.string().trim().min(1).max(500),
  description: z.string().trim().max(10_000).nullable().optional(),
  linkedPlaybookId: z.string().trim().min(1).max(100).nullable().optional(),
  ownerId: z.string().trim().min(1).max(100).nullable().optional(),
  externalTicketRef: z.string().trim().max(200).nullable().optional(),
  externalTicketUrl: z.string().trim().max(2048).nullable().optional(),
});

function serialize(row: {
  id: string;
  reviewId: string;
  caseId: string;
  kind: string;
  title: string;
  description: string | null;
  status: string;
  linkedPlaybookId: string | null;
  externalTicketRef: string | null;
  externalTicketUrl: string | null;
  ownerId: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    reviewId: row.reviewId,
    caseId: row.caseId,
    kind: row.kind,
    title: row.title,
    description: row.description,
    status: row.status,
    linkedPlaybookId: row.linkedPlaybookId,
    externalTicketRef: row.externalTicketRef,
    externalTicketUrl: row.externalTicketUrl,
    ownerId: row.ownerId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function GET(req: Request, context: Params) {
  const auth = await authenticateApiTokenWithScope(req, "reviews:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await context.params;
  try {
    const improvements = await listImprovementsCore(
      auth.token.organisationId,
      id,
      auth.token.createdBy,
    );
    return NextResponse.json(
      { improvements: improvements.map(serialize) },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (err) {
    if (err instanceof ReviewError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}

export async function POST(req: Request, context: Params) {
  const auth = await authenticateApiTokenWithScope(req, "reviews:write");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await context.params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    );
  }
  try {
    const improvement = await createImprovementCore(
      auth.token.organisationId,
      id,
      auth.token.createdBy,
      parsed.data,
    );
    return NextResponse.json(
      { improvement: serialize(improvement) },
      { status: 201, headers: { "cache-control": "private, no-store" } },
    );
  } catch (err) {
    if (err instanceof ReviewError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
