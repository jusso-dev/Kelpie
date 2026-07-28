import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  ReviewError,
  createFollowUpCore,
  listFollowUpsCore,
} from "@/lib/post-incident-review";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const createSchema = z.object({
  title: z.string().trim().min(1).max(500),
  description: z.string().trim().max(10_000).nullable().optional(),
  ownerId: z.string().trim().min(1).max(100).nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
  theme: z.string().trim().max(200).nullable().optional(),
  externalTicketRef: z.string().trim().max(200).nullable().optional(),
  externalTicketUrl: z.string().trim().max(2048).nullable().optional(),
});

function serializeFollowUp(row: {
  id: string;
  reviewId: string;
  caseId: string;
  title: string;
  description: string | null;
  status: string;
  ownerId: string | null;
  dueAt: Date | null;
  theme: string | null;
  completedAt: Date | null;
  completedBy: string | null;
  externalTicketRef: string | null;
  externalTicketUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    reviewId: row.reviewId,
    caseId: row.caseId,
    title: row.title,
    description: row.description,
    status: row.status,
    ownerId: row.ownerId,
    dueAt: row.dueAt?.toISOString() ?? null,
    theme: row.theme,
    completedAt: row.completedAt?.toISOString() ?? null,
    completedBy: row.completedBy,
    externalTicketRef: row.externalTicketRef,
    externalTicketUrl: row.externalTicketUrl,
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
  const followUps = await listFollowUpsCore(auth.token.organisationId, id);
  return NextResponse.json(
    { followUps: followUps.map(serializeFollowUp) },
    { headers: { "cache-control": "private, no-store" } },
  );
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
    const followUp = await createFollowUpCore(
      auth.token.organisationId,
      id,
      auth.token.createdBy,
      parsed.data,
    );
    return NextResponse.json(
      { followUp: serializeFollowUp(followUp) },
      { status: 201, headers: { "cache-control": "private, no-store" } },
    );
  } catch (err) {
    if (err instanceof ReviewError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
