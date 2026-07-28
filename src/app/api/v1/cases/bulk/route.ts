import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import { BULK_OPERATION_TYPES, runBulkOperationCore } from "@/lib/bulk-operations-core";
import { CASE_ENUMS } from "@/lib/cases-core";

const bulkSchema = z.object({
  operationType: z.enum(BULK_OPERATION_TYPES),
  caseIds: z.array(z.string().trim().min(1)).min(1).max(500),
  params: z
    .object({
      queueId: z.string().nullable().optional(),
      assigneeId: z.string().nullable().optional(),
      userId: z.string().optional(),
      tag: z.string().optional(),
      severity: z.enum(CASE_ENUMS.severity).optional(),
      status: z.enum(CASE_ENUMS.status).optional(),
    })
    .default({}),
});

export async function POST(req: Request) {
  const auth = await authenticateApiTokenWithScope(req, "cases:write");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  if (!auth.token.createdBy) {
    return NextResponse.json(
      { error: "Bulk operations require a token issued with a known creator" },
      { status: 400 },
    );
  }
  const body = await req.json().catch(() => null);
  const parsed = bulkSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  try {
    const result = await runBulkOperationCore(
      auth.token.organisationId,
      auth.token.createdBy,
      parsed.data.operationType,
      parsed.data.caseIds,
      parsed.data.params,
    );
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Bulk operation failed" },
      { status: 400 },
    );
  }
}
