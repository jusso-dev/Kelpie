"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import {
  acknowledgeCaseCore,
  addAdditionalAssigneeCore,
  assignCaseAnalystCore,
  assignCaseQueueCore,
  createHandoffCore,
  removeAdditionalAssigneeCore,
  type CreateHandoffInput,
} from "@/lib/case-ownership-core";
import { CaseVersionConflictError } from "@/lib/cases-core";
import {
  addWatcherCore,
  removeWatcherCore,
  updateWatcherPreferencesCore,
  type WatcherPreferences,
} from "@/lib/watchers-core";

export type CaseOwnershipFieldResult =
  | { ok: true; version: number }
  | { ok: false; conflict: Record<string, unknown> };

export async function assignQueue(
  caseId: string,
  queueId: string | null,
  expectedVersion?: number,
): Promise<CaseOwnershipFieldResult> {
  const user = await requireRole(["admin", "analyst"]);
  try {
    const updated = await assignCaseQueueCore(
      user.organisationId,
      user.id,
      caseId,
      queueId,
      expectedVersion,
    );
    revalidatePath(`/cases/${caseId}`);
    return { ok: true, version: updated.version };
  } catch (e) {
    if (e instanceof CaseVersionConflictError) {
      return { ok: false, conflict: e.current };
    }
    throw e;
  }
}

export async function assignAnalyst(
  caseId: string,
  assigneeId: string | null,
  expectedVersion?: number,
): Promise<CaseOwnershipFieldResult> {
  const user = await requireRole(["admin", "analyst"]);
  try {
    const updated = await assignCaseAnalystCore(
      user.organisationId,
      user.id,
      caseId,
      assigneeId,
      expectedVersion,
    );
    revalidatePath(`/cases/${caseId}`);
    return { ok: true, version: updated.version };
  } catch (e) {
    if (e instanceof CaseVersionConflictError) {
      return { ok: false, conflict: e.current };
    }
    throw e;
  }
}

export async function acknowledgeCase(
  caseId: string,
): Promise<{ acknowledgedAt: Date; alreadyAcknowledged: boolean }> {
  const user = await requireRole(["admin", "analyst"]);
  const result = await acknowledgeCaseCore(user.organisationId, user.id, caseId);
  revalidatePath(`/cases/${caseId}`);
  return result;
}

export async function createHandoff(
  caseId: string,
  input: CreateHandoffInput,
): Promise<{ id: string }> {
  const user = await requireRole(["admin", "analyst"]);
  const result = await createHandoffCore(user.organisationId, user.id, caseId, input);
  revalidatePath(`/cases/${caseId}`);
  return result;
}

export async function addAssignee(caseId: string, userId: string): Promise<{ id: string }> {
  const user = await requireRole(["admin", "analyst"]);
  const result = await addAdditionalAssigneeCore(user.organisationId, user.id, caseId, userId);
  revalidatePath(`/cases/${caseId}`);
  return result;
}

export async function removeAssignee(caseId: string, userId: string): Promise<void> {
  const user = await requireRole(["admin", "analyst"]);
  await removeAdditionalAssigneeCore(user.organisationId, caseId, userId);
  revalidatePath(`/cases/${caseId}`);
}

export async function addWatcher(
  caseId: string,
  userId: string,
  preferences?: WatcherPreferences,
): Promise<{ id: string }> {
  const user = await requireRole(["admin", "analyst"]);
  const result = await addWatcherCore(user.organisationId, user.id, caseId, userId, preferences);
  revalidatePath(`/cases/${caseId}`);
  return result;
}

export async function removeWatcher(caseId: string, userId: string): Promise<void> {
  const user = await requireRole(["admin", "analyst"]);
  await removeWatcherCore(user.organisationId, caseId, userId);
  revalidatePath(`/cases/${caseId}`);
}

export async function updateWatcherPreferences(
  caseId: string,
  userId: string,
  preferences: WatcherPreferences,
): Promise<void> {
  const user = await requireRole(["admin", "analyst"]);
  await updateWatcherPreferencesCore(user.organisationId, caseId, userId, preferences);
  revalidatePath(`/cases/${caseId}`);
}
