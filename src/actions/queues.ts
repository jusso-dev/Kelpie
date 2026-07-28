"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import {
  acknowledgeCaseCore,
  addAdditionalAssigneeCore,
  addTeamMemberCore,
  assignCaseAnalystCore,
  assignCaseQueueCore,
  createQueueCore,
  createTeamCore,
  removeAdditionalAssigneeCore,
  removeTeamMemberCore,
  setQueueActiveCore,
  setTeamActiveCore,
  setWaitingReasonCore,
} from "@/lib/queues-core";

export async function createTeam(formData: FormData) {
  const user = await requireRole(["admin"]);
  await createTeamCore(
    user.organisationId,
    user.id,
    String(formData.get("name") ?? ""),
    String(formData.get("description") ?? ""),
  );
  revalidatePath("/queues");
}

export async function setTeamActive(teamId: string, isActive: boolean) {
  const user = await requireRole(["admin"]);
  await setTeamActiveCore(user.organisationId, teamId, isActive);
  revalidatePath("/queues");
}

export async function addTeamMember(teamId: string, userId: string) {
  const user = await requireRole(["admin"]);
  await addTeamMemberCore(user.organisationId, user.id, teamId, userId);
  revalidatePath("/queues");
}

export async function removeTeamMember(teamId: string, userId: string) {
  const user = await requireRole(["admin"]);
  await removeTeamMemberCore(user.organisationId, teamId, userId);
  revalidatePath("/queues");
}

export async function createQueue(formData: FormData) {
  const user = await requireRole(["admin"]);
  await createQueueCore(
    user.organisationId,
    user.id,
    String(formData.get("teamId") ?? ""),
    String(formData.get("name") ?? ""),
    String(formData.get("description") ?? ""),
  );
  revalidatePath("/queues");
}

export async function setQueueActive(queueId: string, isActive: boolean) {
  const user = await requireRole(["admin"]);
  await setQueueActiveCore(user.organisationId, queueId, isActive);
  revalidatePath("/queues");
}

export async function assignCaseQueue(
  caseId: string,
  queueId: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireRole(["admin", "analyst"]);
  try {
    await assignCaseQueueCore(user.organisationId, user.id, caseId, queueId);
    revalidatePath(`/cases/${caseId}`);
    revalidatePath("/cases");
    revalidatePath("/queues");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Failed" };
  }
}

export async function assignCaseAnalyst(
  caseId: string,
  assigneeId: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireRole(["admin", "analyst"]);
  try {
    await assignCaseAnalystCore(user.organisationId, user.id, caseId, assigneeId);
    revalidatePath(`/cases/${caseId}`);
    revalidatePath("/cases");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Failed" };
  }
}

export async function addAdditionalAssignee(caseId: string, userId: string) {
  const user = await requireRole(["admin", "analyst"]);
  await addAdditionalAssigneeCore(user.organisationId, user.id, caseId, userId);
  revalidatePath(`/cases/${caseId}`);
}

export async function removeAdditionalAssignee(caseId: string, userId: string) {
  const user = await requireRole(["admin", "analyst"]);
  await removeAdditionalAssigneeCore(user.organisationId, caseId, userId);
  revalidatePath(`/cases/${caseId}`);
}

export async function acknowledgeCase(caseId: string) {
  const user = await requireRole(["admin", "analyst"]);
  const result = await acknowledgeCaseCore(user.organisationId, user.id, caseId);
  revalidatePath(`/cases/${caseId}`);
  revalidatePath("/cases");
  return result;
}

export async function setWaitingReason(
  caseId: string,
  reason: "none" | "third_party" | "approval",
) {
  const user = await requireRole(["admin", "analyst"]);
  await setWaitingReasonCore(user.organisationId, user.id, caseId, reason);
  revalidatePath(`/cases/${caseId}`);
  revalidatePath("/cases");
}
