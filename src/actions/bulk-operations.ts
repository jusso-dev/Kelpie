"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import {
  runBulkOperationCore,
  type BulkOperationParams,
  type BulkOperationType,
} from "@/lib/bulk-operations-core";

export async function runBulkOperation(
  operationType: BulkOperationType,
  caseIds: string[],
  params: BulkOperationParams,
): Promise<
  | { ok: true; attempted: number; successCount: number; failureCount: number; errors: Array<{ caseId: string; error: string }> }
  | { ok: false; error: string }
> {
  const user = await requireRole(["admin", "analyst"]);
  try {
    const result = await runBulkOperationCore(
      user.organisationId,
      user.id,
      operationType,
      caseIds,
      params,
    );
    revalidatePath("/cases");
    revalidatePath("/queues");
    return { ok: true, ...result };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Failed" };
  }
}
