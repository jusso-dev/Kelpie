import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  IMPROVEMENT_REGISTER_SEVERITIES,
  IMPROVEMENT_REGISTER_STATUSES,
  IMPROVEMENT_REGISTER_TYPES,
  ImprovementRegisterError,
  createImprovementCore,
  listImprovementsCore,
  serializeImprovement,
  type ImprovementRegisterStatus,
  type ImprovementRegisterType,
} from "@/lib/improvement-register";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  type: z.enum(IMPROVEMENT_REGISTER_TYPES),
  title: z.string().trim().min(1).max(500),
  description: z.string().trim().max(20_000).nullable().optional(),
  evidence: z.record(z.string(), z.unknown()).nullable().optional(),
  sensitiveEvidence: z.record(z.string(), z.unknown()).nullable().optional(),
  severity: z.enum(IMPROVEMENT_REGISTER_SEVERITIES).optional(),
  residualRisk: z.string().trim().max(5_000).nullable().optional(),
  ownerId: z.string().trim().min(1).max(100).nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
  linkedPlaybookId: z.string().trim().min(1).max(100).nullable().optional(),
  externalTicketRef: z.string().trim().max(200).nullable().optional(),
  externalTicketUrl: z.string().trim().max(2048).nullable().optional(),
  caseId: z.string().trim().min(1).max(100).nullable().optional(),
  reviewId: z.string().trim().min(1).max(100).nullable().optional(),
});

export async function GET(req: Request) {
  const auth = await authenticateApiTokenWithScope(req, "improvements:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const url = new URL(req.url);
  const statusParam = url.searchParams.get("status");
  const typeParam = url.searchParams.get("type");
  const ownerId = url.searchParams.get("ownerId");
  const caseId = url.searchParams.get("caseId");
  const overdueOnly = url.searchParams.get("overdueOnly") === "true";
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw ? Number(limitRaw) : undefined;

  let status: ImprovementRegisterStatus | ImprovementRegisterStatus[] | undefined;
  if (statusParam) {
    const parts = statusParam.split(",").map((s) => s.trim());
    const valid = parts.filter((p) =>
      (IMPROVEMENT_REGISTER_STATUSES as readonly string[]).includes(p),
    ) as ImprovementRegisterStatus[];
    if (valid.length === 0) {
      return NextResponse.json({ error: "Invalid status filter" }, { status: 400 });
    }
    status = valid.length === 1 ? valid[0] : valid;
  }

  let type: ImprovementRegisterType | ImprovementRegisterType[] | undefined;
  if (typeParam) {
    const parts = typeParam.split(",").map((s) => s.trim());
    const valid = parts.filter((p) =>
      (IMPROVEMENT_REGISTER_TYPES as readonly string[]).includes(p),
    ) as ImprovementRegisterType[];
    if (valid.length === 0) {
      return NextResponse.json({ error: "Invalid type filter" }, { status: 400 });
    }
    type = valid.length === 1 ? valid[0] : valid;
  }

  try {
    const improvements = await listImprovementsCore(
      auth.token.organisationId,
      auth.token.createdBy,
      {
        status,
        type,
        ownerId: ownerId || undefined,
        caseId: caseId || undefined,
        overdueOnly,
        limit: Number.isFinite(limit) ? limit : undefined,
      },
    );
    return NextResponse.json(
      { improvements: improvements.map(serializeImprovement) },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (err) {
    if (err instanceof ImprovementRegisterError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}

export async function POST(req: Request) {
  const auth = await authenticateApiTokenWithScope(req, "improvements:write");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
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
      auth.token.createdBy,
      parsed.data,
    );
    return NextResponse.json(
      { improvement: serializeImprovement(improvement) },
      { status: 201, headers: { "cache-control": "private, no-store" } },
    );
  } catch (err) {
    if (err instanceof ImprovementRegisterError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
