"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import {
  addWatcherCore,
  listWatchersCore,
  removeWatcherCore,
  updateWatcherPreferencesCore,
  type WatcherPreferences,
} from "@/lib/watchers-core";

export async function addWatcher(
  caseId: string,
  userId: string,
  preferences: Partial<WatcherPreferences> = {},
) {
  const user = await requireRole(["admin", "analyst"]);
  await addWatcherCore(user.organisationId, user.id, caseId, userId, preferences);
  revalidatePath(`/cases/${caseId}`);
}

export async function watchCaseAsSelf(caseId: string) {
  const user = await requireRole(["admin", "analyst", "read_only"]);
  await addWatcherCore(user.organisationId, user.id, caseId, user.id);
  revalidatePath(`/cases/${caseId}`);
}

export async function unwatchCaseAsSelf(caseId: string) {
  const user = await requireRole(["admin", "analyst", "read_only"]);
  await removeWatcherCore(user.organisationId, caseId, user.id);
  revalidatePath(`/cases/${caseId}`);
}

export async function removeWatcher(caseId: string, userId: string) {
  const user = await requireRole(["admin", "analyst"]);
  await removeWatcherCore(user.organisationId, caseId, userId);
  revalidatePath(`/cases/${caseId}`);
}

export async function updateOwnWatcherPreferences(
  caseId: string,
  preferences: Partial<WatcherPreferences>,
) {
  const user = await requireRole(["admin", "analyst", "read_only"]);
  await updateWatcherPreferencesCore(user.organisationId, caseId, user.id, preferences);
  revalidatePath(`/cases/${caseId}`);
}

export async function listWatchers(caseId: string) {
  const user = await requireRole(["admin", "analyst", "read_only"]);
  return listWatchersCore(user.organisationId, caseId);
}
