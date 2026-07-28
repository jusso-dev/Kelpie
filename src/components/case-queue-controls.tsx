"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  acknowledgeCase,
  addAssignee,
  addWatcher,
  assignQueue,
  createHandoff,
  removeAssignee,
  removeWatcher,
  updateWatcherPreferences,
} from "@/actions/case-ownership";
import { feedbackError } from "@/components/confirm-dialog";

type OrgUser = { id: string; name: string; email: string };
type Team = { id: string; name: string };
type Assignee = { userId: string; name: string; email: string; addedAt: string };
type Watcher = {
  userId: string;
  name: string;
  email: string;
  notifyOnComment: boolean;
  notifyOnStatusChange: boolean;
  notifyOnAssignment: boolean;
  notifyOnEscalation: boolean;
};
type Handoff = {
  id: string;
  fromUserId: string | null;
  toUserId: string | null;
  toQueueId: string | null;
  note: string;
  createdAt: string;
};

type Props = {
  caseId: string;
  version: number;
  queueId: string | null;
  acknowledgedAt: string | null;
  teams: Team[];
  users: OrgUser[];
  assignees: Assignee[];
  watchers: Watcher[];
  handoffs: Handoff[];
};

function userLabel(users: OrgUser[], id: string | null): string {
  if (!id) return "Unassigned";
  return users.find((u) => u.id === id)?.name ?? id;
}

export function CaseQueueControls(props: Props) {
  const [pending, start] = useTransition();
  const [queueId, setQueueId] = useState(props.queueId ?? "");
  const [newAssigneeId, setNewAssigneeId] = useState("");
  const [newWatcherId, setNewWatcherId] = useState("");
  const [handoffTarget, setHandoffTarget] = useState("");
  const [handoffNote, setHandoffNote] = useState("");
  const router = useRouter();

  function run(label: string, action: () => Promise<unknown>, onSuccess?: () => void) {
    start(async () => {
      try {
        await action();
        toast.success(`${label} updated`);
        onSuccess?.();
        router.refresh();
      } catch (error) {
        toast.error(`${label} could not be updated`, {
          description: feedbackError(error, "Try again."),
        });
      }
    });
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <section className="kelpie-card space-y-3 p-5">
        <h2 className="text-sm font-medium text-slate-300">Queue</h2>
        <p className="text-xs text-slate-500">
          A case can belong to a team queue without any individual owner.
          Queue assignment is tracked separately from the primary analyst
          assignee.
        </p>
        <label htmlFor="case-queue-select" className="block text-xs uppercase tracking-wider text-slate-400">
          Team queue
        </label>
        <div className="flex gap-2">
          <select
            id="case-queue-select"
            className="kelpie-input"
            value={queueId}
            disabled={pending}
            onChange={(e) => setQueueId(e.target.value)}
          >
            <option value="">No queue</option>
            {props.teams.map((team) => (
              <option key={team.id} value={team.id}>{team.name}</option>
            ))}
          </select>
          <button
            type="button"
            className="kelpie-btn kelpie-btn-secondary"
            disabled={pending}
            onClick={() =>
              run("Queue", () => assignQueue(props.caseId, queueId || null, props.version))
            }
          >
            Save
          </button>
        </div>

        <h3 className="mt-4 text-xs uppercase tracking-wider text-slate-400">
          Acknowledgement
        </h3>
        {props.acknowledgedAt ? (
          <p className="text-sm text-slate-300">
            Acknowledged {new Date(props.acknowledgedAt).toLocaleString()}
          </p>
        ) : (
          <button
            type="button"
            className="kelpie-btn kelpie-btn-primary"
            disabled={pending}
            onClick={() => run("Acknowledgement", () => acknowledgeCase(props.caseId))}
          >
            Acknowledge case
          </button>
        )}
      </section>

      <section className="kelpie-card space-y-3 p-5">
        <h2 className="text-sm font-medium text-slate-300">Additional assignees</h2>
        <p className="text-xs text-slate-500">
          Beyond the primary analyst, other analysts can be added to
          collaborate on this case.
        </p>
        <ul className="space-y-1 text-sm text-slate-300">
          {props.assignees.length === 0 ? (
            <li className="text-slate-500">No additional assignees.</li>
          ) : (
            props.assignees.map((a) => (
              <li key={a.userId} className="flex items-center justify-between gap-2">
                <span>{a.name}</span>
                <button
                  type="button"
                  className="kelpie-btn kelpie-btn-ghost text-xs"
                  disabled={pending}
                  onClick={() =>
                    run("Additional assignees", () => removeAssignee(props.caseId, a.userId))
                  }
                >
                  Remove
                </button>
              </li>
            ))
          )}
        </ul>
        <label htmlFor="case-add-assignee" className="block text-xs uppercase tracking-wider text-slate-400">
          Add assignee
        </label>
        <div className="flex gap-2">
          <select
            id="case-add-assignee"
            className="kelpie-input"
            value={newAssigneeId}
            disabled={pending}
            onChange={(e) => setNewAssigneeId(e.target.value)}
          >
            <option value="">Select analyst…</option>
            {props.users.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
          <button
            type="button"
            className="kelpie-btn kelpie-btn-secondary"
            disabled={pending || !newAssigneeId}
            onClick={() =>
              run(
                "Additional assignees",
                () => addAssignee(props.caseId, newAssigneeId),
                () => setNewAssigneeId(""),
              )
            }
          >
            Add
          </button>
        </div>
      </section>

      <section className="kelpie-card space-y-3 p-5">
        <h2 className="text-sm font-medium text-slate-300">Watchers</h2>
        <p className="text-xs text-slate-500">
          Watching a case only sends notifications — it never grants read or
          write access. Access is still governed purely by role and
          organisation.
        </p>
        <ul className="space-y-2 text-sm text-slate-300">
          {props.watchers.length === 0 ? (
            <li className="text-slate-500">No watchers.</li>
          ) : (
            props.watchers.map((w) => (
              <li key={w.userId} className="space-y-1 border-b border-[color:var(--color-navy-800)] pb-2">
                <div className="flex items-center justify-between gap-2">
                  <span>{w.name}</span>
                  <button
                    type="button"
                    className="kelpie-btn kelpie-btn-ghost text-xs"
                    disabled={pending}
                    onClick={() =>
                      run("Watchers", () => removeWatcher(props.caseId, w.userId))
                    }
                  >
                    Remove
                  </button>
                </div>
                <fieldset className="flex flex-wrap gap-3 text-xs text-slate-400">
                  <legend className="sr-only">Notification preferences for {w.name}</legend>
                  {(
                    [
                      ["notifyOnComment", "Comments"],
                      ["notifyOnStatusChange", "Status changes"],
                      ["notifyOnAssignment", "Assignment/hand-off"],
                      ["notifyOnEscalation", "Escalation"],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key} className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={w[key]}
                        disabled={pending}
                        onChange={(e) =>
                          run("Watcher preferences", () =>
                            updateWatcherPreferences(props.caseId, w.userId, {
                              [key]: e.target.checked,
                            }),
                          )
                        }
                      />
                      {label}
                    </label>
                  ))}
                </fieldset>
              </li>
            ))
          )}
        </ul>
        <label htmlFor="case-add-watcher" className="block text-xs uppercase tracking-wider text-slate-400">
          Add watcher
        </label>
        <div className="flex gap-2">
          <select
            id="case-add-watcher"
            className="kelpie-input"
            value={newWatcherId}
            disabled={pending}
            onChange={(e) => setNewWatcherId(e.target.value)}
          >
            <option value="">Select person…</option>
            {props.users.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
          <button
            type="button"
            className="kelpie-btn kelpie-btn-secondary"
            disabled={pending || !newWatcherId}
            onClick={() =>
              run(
                "Watchers",
                () => addWatcher(props.caseId, newWatcherId),
                () => setNewWatcherId(""),
              )
            }
          >
            Add
          </button>
        </div>
      </section>

      <section className="kelpie-card space-y-3 p-5">
        <h2 className="text-sm font-medium text-slate-300">Shift hand-off</h2>
        <p className="text-xs text-slate-500">
          Hand-off notes are immutable snapshots of the case at the moment
          ownership moves — not editable comments.
        </p>
        <label htmlFor="handoff-target" className="block text-xs uppercase tracking-wider text-slate-400">
          Hand off to
        </label>
        <select
          id="handoff-target"
          className="kelpie-input"
          value={handoffTarget}
          disabled={pending}
          onChange={(e) => setHandoffTarget(e.target.value)}
        >
          <option value="">Select analyst or queue…</option>
          <optgroup label="Analysts">
            {props.users.map((u) => (
              <option key={`user:${u.id}`} value={`user:${u.id}`}>{u.name}</option>
            ))}
          </optgroup>
          <optgroup label="Queues">
            {props.teams.map((t) => (
              <option key={`queue:${t.id}`} value={`queue:${t.id}`}>{t.name}</option>
            ))}
          </optgroup>
        </select>
        <label htmlFor="handoff-note" className="block text-xs uppercase tracking-wider text-slate-400">
          Hand-off note
        </label>
        <textarea
          id="handoff-note"
          className="kelpie-input"
          rows={3}
          value={handoffNote}
          disabled={pending}
          onChange={(e) => setHandoffNote(e.target.value)}
          placeholder="Status, what's been tried, what's next…"
        />
        <button
          type="button"
          className="kelpie-btn kelpie-btn-primary"
          disabled={pending || !handoffTarget || !handoffNote.trim()}
          onClick={() => {
            const [kind, id] = handoffTarget.split(":");
            run(
              "Hand-off",
              () =>
                createHandoff(props.caseId, {
                  toUserId: kind === "user" ? id : null,
                  toQueueId: kind === "queue" ? id : null,
                  note: handoffNote,
                }),
              () => {
                setHandoffTarget("");
                setHandoffNote("");
              },
            );
          }}
        >
          Record hand-off
        </button>

        <h3 className="mt-4 text-xs uppercase tracking-wider text-slate-400">History</h3>
        <ul className="space-y-2 text-sm text-slate-300">
          {props.handoffs.length === 0 ? (
            <li className="text-slate-500">No hand-offs recorded yet.</li>
          ) : (
            props.handoffs.map((h) => (
              <li key={h.id} className="border-b border-[color:var(--color-navy-800)] pb-2">
                <div className="text-xs text-slate-500">
                  {new Date(h.createdAt).toLocaleString()} — {userLabel(props.users, h.fromUserId)} →{" "}
                  {h.toUserId
                    ? userLabel(props.users, h.toUserId)
                    : props.teams.find((t) => t.id === h.toQueueId)?.name ?? "queue"}
                </div>
                <p className="whitespace-pre-wrap">{h.note}</p>
              </li>
            ))
          )}
        </ul>
      </section>
    </div>
  );
}
