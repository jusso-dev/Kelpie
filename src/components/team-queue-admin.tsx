"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  addTeamMember,
  createQueue,
  createTeam,
  removeTeamMember,
  setQueueActive,
  setTeamActive,
} from "@/actions/queues";
import { feedbackError } from "@/components/confirm-dialog";

type Team = { id: string; name: string; isActive: boolean };
type Queue = { id: string; name: string; teamId: string; teamName: string; isActive: boolean };
type Member = { id: string; name: string };
type Membership = { teamId: string; userId: string };

export function TeamQueueAdmin({
  isAdmin,
  teams,
  queues,
  members,
  memberships,
}: {
  isAdmin: boolean;
  teams: Team[];
  queues: Queue[];
  members: Member[];
  memberships: Membership[];
}) {
  const [pending, start] = useTransition();
  const [addMember, setAddMember] = useState<Record<string, string>>({});
  const router = useRouter();

  function handleCreateTeam(formData: FormData) {
    start(async () => {
      try {
        await createTeam(formData);
        toast.success("Team created");
        router.refresh();
      } catch (error) {
        toast.error("Could not create team", { description: feedbackError(error, "") });
      }
    });
  }

  function handleCreateQueue(formData: FormData) {
    start(async () => {
      try {
        await createQueue(formData);
        toast.success("Queue created");
        router.refresh();
      } catch (error) {
        toast.error("Could not create queue", { description: feedbackError(error, "") });
      }
    });
  }

  function handleToggleTeam(teamId: string, isActive: boolean) {
    start(async () => {
      await setTeamActive(teamId, isActive);
      router.refresh();
    });
  }

  function handleToggleQueue(queueId: string, isActive: boolean) {
    start(async () => {
      await setQueueActive(queueId, isActive);
      router.refresh();
    });
  }

  function handleAddMember(teamId: string) {
    const userId = addMember[teamId];
    if (!userId) return;
    start(async () => {
      try {
        await addTeamMember(teamId, userId);
        setAddMember((s) => ({ ...s, [teamId]: "" }));
        router.refresh();
      } catch (error) {
        toast.error("Could not add team member", { description: feedbackError(error, "") });
      }
    });
  }

  function handleRemoveMember(teamId: string, userId: string) {
    start(async () => {
      await removeTeamMember(teamId, userId);
      router.refresh();
    });
  }

  if (!isAdmin && teams.length === 0) {
    return null;
  }

  return (
    <section className="kelpie-panel space-y-5 p-5">
      <h2 className="text-sm font-medium text-slate-300">Teams &amp; queues</h2>

      <div className="space-y-4">
        {teams.map((team) => {
          const teamMemberIds = memberships
            .filter((m) => m.teamId === team.id)
            .map((m) => m.userId);
          const teamMembersList = members.filter((m) => teamMemberIds.includes(m.id));
          const availableToAdd = members.filter((m) => !teamMemberIds.includes(m.id));
          const teamQueues = queues.filter((q) => q.teamId === team.id);
          return (
            <div key={team.id} className="rounded-lg border border-[color:var(--color-navy-700)] p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-slate-200">
                  {team.name} {!team.isActive ? <span className="kelpie-badge ml-2">disabled</span> : null}
                </h3>
                {isAdmin ? (
                  <button
                    type="button"
                    className="kelpie-link text-xs"
                    disabled={pending}
                    onClick={() => handleToggleTeam(team.id, !team.isActive)}
                  >
                    {team.isActive ? "Disable" : "Enable"}
                  </button>
                ) : null}
              </div>

              <div className="mt-3">
                <p className="text-xs uppercase tracking-wider text-slate-500">Queues</p>
                <ul className="mt-1 space-y-1 text-xs text-slate-300">
                  {teamQueues.length === 0 ? (
                    <li className="text-slate-500">No queues yet.</li>
                  ) : (
                    teamQueues.map((q) => (
                      <li key={q.id} className="flex items-center justify-between">
                        {q.name} {!q.isActive ? <span className="text-slate-500">(disabled)</span> : null}
                        {isAdmin ? (
                          <button
                            type="button"
                            className="kelpie-link"
                            disabled={pending}
                            onClick={() => handleToggleQueue(q.id, !q.isActive)}
                          >
                            {q.isActive ? "Disable" : "Enable"}
                          </button>
                        ) : null}
                      </li>
                    ))
                  )}
                </ul>
                {isAdmin ? (
                  <form action={handleCreateQueue} className="mt-2 flex gap-2">
                    <input type="hidden" name="teamId" value={team.id} />
                    <input name="name" placeholder="New queue name" className="kelpie-input" required />
                    <button type="submit" className="kelpie-btn kelpie-btn-secondary" disabled={pending}>
                      Add queue
                    </button>
                  </form>
                ) : null}
              </div>

              <div className="mt-3">
                <p className="text-xs uppercase tracking-wider text-slate-500">Members</p>
                <ul className="mt-1 space-y-1 text-xs text-slate-300">
                  {teamMembersList.length === 0 ? (
                    <li className="text-slate-500">No members yet.</li>
                  ) : (
                    teamMembersList.map((m) => (
                      <li key={m.id} className="flex items-center justify-between">
                        {m.name}
                        {isAdmin ? (
                          <button
                            type="button"
                            className="kelpie-link"
                            disabled={pending}
                            onClick={() => handleRemoveMember(team.id, m.id)}
                          >
                            Remove
                          </button>
                        ) : null}
                      </li>
                    ))
                  )}
                </ul>
                {isAdmin && availableToAdd.length > 0 ? (
                  <div className="mt-2 flex gap-2">
                    <select
                      className="kelpie-input"
                      value={addMember[team.id] ?? ""}
                      onChange={(event) =>
                        setAddMember((s) => ({ ...s, [team.id]: event.target.value }))
                      }
                    >
                      <option value="">Add member…</option>
                      {availableToAdd.map((m) => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="kelpie-btn kelpie-btn-secondary"
                      disabled={pending || !addMember[team.id]}
                      onClick={() => handleAddMember(team.id)}
                    >
                      Add
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {isAdmin ? (
        <form action={handleCreateTeam} className="flex gap-2 border-t border-[color:var(--color-navy-700)] pt-4">
          <input name="name" placeholder="New team name" className="kelpie-input" required />
          <input name="description" placeholder="Description (optional)" className="kelpie-input" />
          <button type="submit" className="kelpie-btn kelpie-btn-primary" disabled={pending}>
            Create team
          </button>
        </form>
      ) : null}
    </section>
  );
}
