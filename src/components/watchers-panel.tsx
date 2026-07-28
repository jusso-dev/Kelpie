"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  addWatcher,
  removeWatcher,
  unwatchCaseAsSelf,
  updateOwnWatcherPreferences,
  watchCaseAsSelf,
} from "@/actions/watchers";
import { feedbackError } from "@/components/confirm-dialog";
import type { WatcherPreferences } from "@/lib/watchers-core";

type Watcher = { userId: string; userName: string } & WatcherPreferences;
type Member = { id: string; name: string };

/**
 * Watching is a notification preference, not an access grant: everyone who
 * can already see this case (any organisation member with a role that
 * permits it) can add themselves as a watcher, and admins/analysts can add
 * or remove anyone else's watch, but this list never changes who can open
 * the case.
 */
export function WatchersPanel({
  caseId,
  currentUserId,
  watchers,
  members,
  canManageOthers,
}: {
  caseId: string;
  currentUserId: string;
  watchers: Watcher[];
  members: Member[];
  canManageOthers: boolean;
}) {
  const [pending, start] = useTransition();
  const [addUserId, setAddUserId] = useState("");
  const router = useRouter();
  const isWatching = watchers.some((w) => w.userId === currentUserId);
  const mine = watchers.find((w) => w.userId === currentUserId);

  function toggleSelf() {
    start(async () => {
      if (isWatching) {
        await unwatchCaseAsSelf(caseId);
      } else {
        await watchCaseAsSelf(caseId);
      }
      router.refresh();
    });
  }

  function togglePreference(field: keyof WatcherPreferences, value: boolean) {
    start(async () => {
      await updateOwnWatcherPreferences(caseId, { [field]: value });
      router.refresh();
    });
  }

  function handleAddOther() {
    if (!addUserId) return;
    start(async () => {
      try {
        await addWatcher(caseId, addUserId);
        setAddUserId("");
        router.refresh();
      } catch (error) {
        toast.error("Could not add watcher", { description: feedbackError(error, "") });
      }
    });
  }

  function handleRemoveOther(userId: string) {
    start(async () => {
      await removeWatcher(caseId, userId);
      router.refresh();
    });
  }

  const availableForAdd = members.filter(
    (m) => !watchers.some((w) => w.userId === m.id),
  );

  return (
    <div className="kelpie-card space-y-3 p-5">
      <h2 className="text-sm font-medium text-slate-300">Watchers</h2>
      <button
        type="button"
        className="kelpie-btn kelpie-btn-secondary"
        disabled={pending}
        onClick={toggleSelf}
      >
        {isWatching ? "Stop watching" : "Watch this case"}
      </button>

      {isWatching && mine ? (
        <fieldset className="space-y-1 border-t border-[color:var(--color-navy-700)] pt-3">
          <legend className="text-xs uppercase tracking-wider text-slate-400">
            Notify me about
          </legend>
          {(
            [
              ["notifyOnComment", "Comments"],
              ["notifyOnStatusChange", "Status changes"],
              ["notifyOnAssignment", "Assignment changes"],
              ["notifyOnSlaRisk", "SLA warnings/breaches"],
            ] as const
          ).map(([field, label]) => (
            <label key={field} className="flex items-center gap-2 text-xs text-slate-300">
              <input
                type="checkbox"
                checked={mine[field]}
                disabled={pending}
                onChange={(event) => togglePreference(field, event.target.checked)}
              />
              {label}
            </label>
          ))}
        </fieldset>
      ) : null}

      <div className="border-t border-[color:var(--color-navy-700)] pt-3">
        <p className="mb-2 text-xs uppercase tracking-wider text-slate-400">
          {watchers.length} watching
        </p>
        <ul className="space-y-1">
          {watchers.map((w) => (
            <li key={w.userId} className="flex items-center justify-between text-xs text-slate-300">
              {w.userName}
              {canManageOthers && w.userId !== currentUserId ? (
                <button
                  type="button"
                  className="kelpie-link"
                  disabled={pending}
                  onClick={() => handleRemoveOther(w.userId)}
                >
                  Remove
                </button>
              ) : null}
            </li>
          ))}
        </ul>
        {canManageOthers && availableForAdd.length > 0 ? (
          <div className="mt-2 flex gap-2">
            <select
              className="kelpie-input"
              value={addUserId}
              onChange={(event) => setAddUserId(event.target.value)}
            >
              <option value="">Add watcher…</option>
              {availableForAdd.map((member) => (
                <option key={member.id} value={member.id}>{member.name}</option>
              ))}
            </select>
            <button
              type="button"
              className="kelpie-btn kelpie-btn-secondary"
              disabled={pending || !addUserId}
              onClick={handleAddOther}
            >
              Add
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
