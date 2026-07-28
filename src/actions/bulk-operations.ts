"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import {
  applyBulkOperationCore,
  type BulkOperationPayload,
  type BulkOperationResult,
  type BulkOperationType,
} from "@/lib/bulk-ops-core";

/**
 * `idempotencyKey` is required from the caller rather than generated here:
 * the UI generates one (e.g. `crypto.randomUUID()`) once per distinct user
 * click and reuses it across retries of that same click, so a double-click
 * or a retried network request never double-applies the operation.
 */
export async function applyBulkOperation(input: {
  operationType: BulkOperationType;
  caseIds: string[];
  idempotencyKey: string;
  payload: BulkOperationPayload;
}): Promise<BulkOperationResult> {
  const user = await requireRole(["admin", "analyst"]);
  const result = await applyBulkOperationCore(user.organisationId, user.id, input);
  revalidatePath("/cases");
  return result;
}
