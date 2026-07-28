import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireRole } from "@/lib/session";
import { listTeamMembersCore, listTeamsCore, type TeamMemberView } from "@/lib/teams-core";
import { addTeamMember, createTeam, removeTeamMember, updateTeam } from "@/actions/teams";

async function submitToggleTeamActive(formData: FormData): Promise<void> {
  "use server";
  const teamId = String(formData.get("teamId") ?? "");
  const nextIsActive = formData.get("nextIsActive") === "true";
  if (!teamId) return;
  await updateTeam(teamId, { isActive: nextIsActive });
}

async function submitUpdateTeamDetails(formData: FormData): Promise<void> {
  "use server";
  const teamId = String(formData.get("teamId") ?? "");
  if (!teamId) return;
  const name = String(formData.get("name") ?? "");
  const description = String(formData.get("description") ?? "");
  await updateTeam(teamId, { name, description: description || null });
}

async function submitAddMember(formData: FormData): Promise<void> {
  "use server";
  const teamId = String(formData.get("teamId") ?? "");
  const userId = String(formData.get("userId") ?? "");
  const roleRaw = formData.get("role");
  const role = roleRaw === "lead" ? "lead" : "member";
  if (!teamId || !userId) return;
  await addTeamMember(teamId, userId, role);
}

async function submitRemoveMember(formData: FormData): Promise<void> {
  "use server";
  const teamId = String(formData.get("teamId") ?? "");
  const userId = String(formData.get("userId") ?? "");
  if (!teamId || !userId) return;
  await removeTeamMember(teamId, userId);
}

export default async function TeamsSettingsPage() {
  const user = await requireRole(["admin"]);

  const [teams, orgUsers] = await Promise.all([
    listTeamsCore(user.organisationId, { includeInactive: true }),
    db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(eq(users.organisationId, user.organisationId)),
  ]);

  const membersByTeam = new Map<string, TeamMemberView[]>();
  await Promise.all(
    teams.map(async (team) => {
      membersByTeam.set(team.id, await listTeamMembersCore(user.organisationId, team.id));
    }),
  );

  return (
    <div className="kelpie-page max-w-5xl">
      <header>
        <Link href="/settings" className="text-xs text-slate-400 hover:text-slate-200">
          ← Settings
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Teams and queues</h1>
        <p>
          Teams double as case queues. Members are candidates for assignment
          and hand-off once a case is routed to a queue.
        </p>
      </header>

      <section className="kelpie-section">
        <div className="kelpie-section-header">
          <h2>Create a team</h2>
          <p>Team names must be unique within your organisation.</p>
        </div>
        <form action={createTeam} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="kelpie-field">
            <label htmlFor="new-team-name" className="kelpie-label">
              Name
            </label>
            <input
              id="new-team-name"
              name="name"
              required
              className="kelpie-input"
              placeholder="Tier 1 triage"
            />
          </div>
          <div className="kelpie-field">
            <label htmlFor="new-team-description" className="kelpie-label">
              Description
            </label>
            <input
              id="new-team-description"
              name="description"
              className="kelpie-input"
              placeholder="Optional"
            />
          </div>
          <div className="sm:col-span-2">
            <button type="submit" className="kelpie-btn kelpie-btn-primary">
              Create team
            </button>
          </div>
        </form>
      </section>

      {teams.length === 0 ? (
        <section className="kelpie-section">
          <p className="text-sm text-slate-400">No teams have been created yet.</p>
        </section>
      ) : (
        teams.map((team) => {
          const members = membersByTeam.get(team.id) ?? [];
          const memberIds = new Set(members.map((m) => m.userId));
          const availableUsers = orgUsers.filter((u) => !memberIds.has(u.id));
          return (
            <section key={team.id} className="kelpie-section">
              <div className="kelpie-section-header">
                <h2>{team.name}</h2>
                <p>
                  {team.isActive ? (
                    <span className="kelpie-badge text-green-400">Active</span>
                  ) : (
                    <span className="kelpie-badge text-slate-400">Inactive</span>
                  )}
                  {" · "}
                  {members.length} member{members.length === 1 ? "" : "s"}
                </p>
              </div>

              <form
                action={submitUpdateTeamDetails}
                className="grid grid-cols-1 gap-4 sm:grid-cols-2"
              >
                <input type="hidden" name="teamId" value={team.id} />
                <div className="kelpie-field">
                  <label htmlFor={`team-name-${team.id}`} className="kelpie-label">
                    Name
                  </label>
                  <input
                    id={`team-name-${team.id}`}
                    name="name"
                    defaultValue={team.name}
                    required
                    className="kelpie-input"
                  />
                </div>
                <div className="kelpie-field">
                  <label htmlFor={`team-description-${team.id}`} className="kelpie-label">
                    Description
                  </label>
                  <input
                    id={`team-description-${team.id}`}
                    name="description"
                    defaultValue={team.description ?? ""}
                    className="kelpie-input"
                  />
                </div>
                <div className="flex items-end gap-2 sm:col-span-2">
                  <button type="submit" className="kelpie-btn kelpie-btn-secondary">
                    Save details
                  </button>
                </div>
              </form>

              <form action={submitToggleTeamActive}>
                <input type="hidden" name="teamId" value={team.id} />
                <input
                  type="hidden"
                  name="nextIsActive"
                  value={team.isActive ? "false" : "true"}
                />
                <button
                  type="submit"
                  className={
                    team.isActive
                      ? "kelpie-btn kelpie-btn-danger"
                      : "kelpie-btn kelpie-btn-secondary"
                  }
                >
                  {team.isActive ? `Deactivate ${team.name}` : `Reactivate ${team.name}`}
                </button>
              </form>

              <div className="kelpie-scroll-x" tabIndex={0} aria-label={`${team.name} members table`}>
                <table className="kelpie-table">
                  <caption className="sr-only">Members of {team.name}</caption>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Role</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="text-sm text-slate-400">
                          No members yet.
                        </td>
                      </tr>
                    ) : (
                      members.map((member) => (
                        <tr key={member.id}>
                          <td className="text-sm text-slate-200">{member.name}</td>
                          <td className="text-sm text-slate-400">{member.email}</td>
                          <td className="text-sm capitalize text-slate-300">{member.role}</td>
                          <td className="text-right">
                            <form action={submitRemoveMember} className="inline">
                              <input type="hidden" name="teamId" value={team.id} />
                              <input type="hidden" name="userId" value={member.userId} />
                              <button
                                type="submit"
                                className="kelpie-btn kelpie-btn-danger text-xs"
                                aria-label={`Remove ${member.name} from ${team.name}`}
                              >
                                Remove
                              </button>
                            </form>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {availableUsers.length > 0 ? (
                <form
                  action={submitAddMember}
                  className="flex flex-wrap items-end gap-3"
                  aria-label={`Add a member to ${team.name}`}
                >
                  <input type="hidden" name="teamId" value={team.id} />
                  <div className="kelpie-field">
                    <label htmlFor={`add-member-user-${team.id}`} className="kelpie-label">
                      Add member
                    </label>
                    <select
                      id={`add-member-user-${team.id}`}
                      name="userId"
                      required
                      className="kelpie-input"
                      defaultValue=""
                    >
                      <option value="" disabled>
                        Select a user
                      </option>
                      {availableUsers.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name} ({u.email})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="kelpie-field">
                    <label htmlFor={`add-member-role-${team.id}`} className="kelpie-label">
                      Role
                    </label>
                    <select
                      id={`add-member-role-${team.id}`}
                      name="role"
                      className="kelpie-input"
                      defaultValue="member"
                    >
                      <option value="member">Member</option>
                      <option value="lead">Lead</option>
                    </select>
                  </div>
                  <button type="submit" className="kelpie-btn kelpie-btn-primary">
                    Add to {team.name}
                  </button>
                </form>
              ) : (
                <p className="text-sm text-slate-400">
                  Every organisation member already belongs to this team.
                </p>
              )}
            </section>
          );
        })
      )}
    </div>
  );
}
