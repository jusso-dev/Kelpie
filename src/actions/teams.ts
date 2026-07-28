"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import {
  addTeamMemberCore,
  createTeamCore,
  removeTeamMemberCore,
  updateTeamCore,
} from "@/lib/teams-core";

const TEAMS_PATH = "/settings/teams";

export async function createTeam(formData: FormData) {
  const user = await requireRole(["admin"]);
  const name = String(formData.get("name") ?? "");
  const description = String(formData.get("description") ?? "");
  await createTeamCore(user.organisationId, user.id, {
    name,
    description: description || null,
  });
  revalidatePath(TEAMS_PATH);
}

export async function updateTeam(
  teamId: string,
  patch: { name?: string; description?: string | null; isActive?: boolean },
) {
  const user = await requireRole(["admin"]);
  await updateTeamCore(user.organisationId, user.id, teamId, patch);
  revalidatePath(TEAMS_PATH);
}

export async function addTeamMember(
  teamId: string,
  userId: string,
  role?: "lead" | "member",
) {
  const user = await requireRole(["admin"]);
  await addTeamMemberCore(user.organisationId, user.id, teamId, userId, role);
  revalidatePath(TEAMS_PATH);
}

export async function removeTeamMember(teamId: string, userId: string) {
  const user = await requireRole(["admin"]);
  await removeTeamMemberCore(user.organisationId, teamId, userId);
  revalidatePath(TEAMS_PATH);
}
