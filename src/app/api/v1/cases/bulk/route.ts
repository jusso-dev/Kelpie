import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  applyBulkOperationCore,
  BulkOperationError,
  BULK_OPERATION_TYPES,
  MAX_BULK_CASE_IDS,
} from "@/lib/bulk-ops-core";

const bodySchema = z.object({
  operationType: z.enum(BULK_OPERATION_TYPES),
  caseIds: z.array(z.string().min(1)).min(1).max(MAX_BULK_CASE_IDS),
  idempotencyKey: z.string().min(1),
  payload: z.object({}).passthrough().default({}),
});

export async function POST(req: Request) {
  const auth = await authenticateApiTokenWithScope(req, "bulk_operations:write");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
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
    const result = await applyBulkOperationCore(auth.token.organisationId, actor?.id ?? null, {
      operationType: parsed.data.operationType,
      caseIds: parsed.data.caseIds,
      idempotencyKey: parsed.data.idempotencyKey,
      payload: parsed.data.payload,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof BulkOperationError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
