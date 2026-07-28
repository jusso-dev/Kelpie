/**
 * Core team/queue administration mutations and queries, callable from both
 * server actions and API routes. Callers must already have resolved
 * `organisationId` for the acting user/token; every function re-verifies
 * that any team id it touches belongs to that organisation before doing
 * anything with it.
 *
 * This module only manages team/queue *administration* (create teams,
 * rename/deactivate, manage membership). Assigning a case to a queue is
 * handled elsewhere (case-ownership-core.ts) via `cases.queueId`.
 */

import { db } from "@/db";
import { teams, teamMembers, users, type Team } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { newId } from "./utils";

export class TeamError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "TeamError";
    this.status = status;
  }
}

async function loadTeamInOrg(
  organisationId: string,
  teamId: string,
): Promise<Team | null> {
  const [row] = await db
    .select()
    .from(teams)
    .where(and(eq(teams.id, teamId), eq(teams.organisationId, organisationId)))
    .limit(1);
  return row ?? null;
}

export async function createTeamCore(
  organisationId: string,
  actorId: string | null,
  input: { name: string; description?: string | null },
): Promise<{ id: string }> {
  const name = input.name?.trim() ?? "";
  if (!name) throw new TeamError("Team name is required", 400);

  const id = newId("team");
  const [inserted] = await db
    .insert(teams)
    .values({
      id,
      organisationId,
      name,
      description: input.description?.trim() || null,
      createdBy: actorId,
    })
    .onConflictDoNothing()
    .returning();
  if (!inserted) {
    throw new TeamError("A team with this name already exists", 409);
  }
  return { id: inserted.id };
}

export async function listTeamsCore(
  organisationId: string,
  opts?: { includeInactive?: boolean },
): Promise<Team[]> {
  const includeInactive = opts?.includeInactive ?? false;
  return db
    .select()
    .from(teams)
    .where(
      includeInactive
        ? eq(teams.organisationId, organisationId)
        : and(eq(teams.organisationId, organisationId), eq(teams.isActive, true)),
    )
    .orderBy(teams.name);
}

export async function getTeamCore(
  organisationId: string,
  teamId: string,
): Promise<Team | null> {
  return loadTeamInOrg(organisationId, teamId);
}

export async function updateTeamCore(
  organisationId: string,
  actorId: string | null,
  teamId: string,
  patch: { name?: string; description?: string | null; isActive?: boolean },
): Promise<Team> {
  const existing = await loadTeamInOrg(organisationId, teamId);
  if (!existing) throw new TeamError("Team not found", 404);

  const update: Partial<typeof teams.$inferInsert> = { updatedAt: new Date() };
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw new TeamError("Team name is required", 400);
    const [conflict] = await db
      .select({ id: teams.id })
      .from(teams)
      .where(and(eq(teams.organisationId, organisationId), eq(teams.name, name)))
      .limit(1);
    if (conflict && conflict.id !== teamId) {
      throw new TeamError("A team with this name already exists", 409);
    }
    update.name = name;
  }
  if (patch.description !== undefined) {
    update.description = patch.description?.trim() || null;
  }
  if (patch.isActive !== undefined) {
    update.isActive = patch.isActive;
  }

  const [updated] = await db
    .update(teams)
    .set(update)
    .where(and(eq(teams.id, teamId), eq(teams.organisationId, organisationId)))
    .returning();
  if (!updated) throw new TeamError("Team not found", 404);
  return updated;
}

export type TeamMemberView = {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: "lead" | "member";
  createdAt: Date;
};

export async function listTeamMembersCore(
  organisationId: string,
  teamId: string,
): Promise<TeamMemberView[]> {
  const team = await loadTeamInOrg(organisationId, teamId);
  if (!team) throw new TeamError("Team not found", 404);

  return db
    .select({
      id: teamMembers.id,
      userId: teamMembers.userId,
      name: users.name,
      email: users.email,
      role: teamMembers.role,
      createdAt: teamMembers.createdAt,
    })
    .from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.userId))
    .where(eq(teamMembers.teamId, teamId));
}

export async function addTeamMemberCore(
  organisationId: string,
  actorId: string | null,
  teamId: string,
  userId: string,
  role: "lead" | "member" = "member",
): Promise<{ id: string }> {
  const team = await loadTeamInOrg(organisationId, teamId);
  if (!team) throw new TeamError("Team not found", 404);

  const [targetUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.organisationId, organisationId)))
    .limit(1);
  if (!targetUser) {
    throw new TeamError("User not found in this organisation", 404);
  }

  const id = newId("teammember");
  const [row] = await db
    .insert(teamMembers)
    .values({ id, teamId, userId, role })
    .onConflictDoUpdate({
      target: [teamMembers.teamId, teamMembers.userId],
      set: { role },
    })
    .returning();
  return { id: row.id };
}

export async function removeTeamMemberCore(
  organisationId: string,
  teamId: string,
  userId: string,
): Promise<void> {
  const team = await loadTeamInOrg(organisationId, teamId);
  if (!team) throw new TeamError("Team not found", 404);

  await db
    .delete(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)));
}
