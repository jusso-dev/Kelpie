"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  acknowledgeCase,
  addAdditionalAssignee,
  assignCaseQueue,
  removeAdditionalAssignee,
  setWaitingReason,
} from "@/actions/queues";
import { feedbackError } from "@/components/confirm-dialog";

type QueueOption = { id: string; name: string; teamName: string };
type Member = { id: string; name: string };
type AdditionalAssignee = { userId: string; userName: string };

export function QueueOwnershipPanel(props: {
  caseId: string;
  queueId: string | null;
  queueAssignedAt: string | null;
  assigneeAssignedAt: string | null;
  acknowledgedAt: string | null;
  waitingReason: "none" | "third_party" | "approval";
  waitingSince: string | null;
  queues: QueueOption[];
  members: Member[];
  additionalAssignees: AdditionalAssignee[];
  canEdit: boolean;
}) {
  const [pending, start] = useTransition();
  const [addAssigneeId, setAddAssigneeId] = useState("");
  const router = useRouter();

  function handleQueueChange(value: string) {
    start(async () => {
      const result = await assignCaseQueue(props.caseId, value || null);
      if (!result.ok) {
        toast.error("Could not assign queue", { description: feedbackError(result.error, "") });
        return;
      }
      toast.success("Queue updated");
      router.refresh();
    });
  }

  function handleAcknowledge() {
    start(async () => {
      const result = await acknowledgeCase(props.caseId);
      if (result.alreadyAcknowledged) {
        toast.info("This case was already acknowledged");
      } else {
        toast.success("Case acknowledged");
      }
      router.refresh();
    });
  }

  function handleWaitingReason(value: "none" | "third_party" | "approval") {
    start(async () => {
      await setWaitingReason(props.caseId, value);
      router.refresh();
    });
  }

  function handleAddAssignee() {
    if (!addAssigneeId) return;
    start(async () => {
      try {
        await addAdditionalAssignee(props.caseId, addAssigneeId);
        setAddAssigneeId("");
        toast.success("Assignee added");
        router.refresh();
      } catch (error) {
        toast.error("Could not add assignee", { description: feedbackError(error, "") });
      }
    });
  }

  function handleRemoveAssignee(userId: string) {
    start(async () => {
      await removeAdditionalAssignee(props.caseId, userId);
      router.refresh();
    });
  }

  const availableForAdd = props.members.filter(
    (m) => !props.additionalAssignees.some((a) => a.userId === m.id),
  );

  return (
    <div className="kelpie-card space-y-4 p-5">
      <h2 className="text-sm font-medium text-slate-300">Queue &amp; ownership</h2>

      <div className="grid gap-1 sm:grid-cols-3 sm:items-center">
        <label htmlFor="case-queue" className="text-xs uppercase tracking-wider text-slate-400">
          Team queue
        </label>
        <div className="sm:col-span-2">
          <select
            id="case-queue"
            className="kelpie-input"
            defaultValue={props.queueId ?? ""}
            disabled={pending || !props.canEdit}
            onChange={(event) => handleQueueChange(event.target.value)}
          >
            <option value="">No queue</option>
            {props.queues.map((queue) => (
              <option key={queue.id} value={queue.id}>{queue.teamName} / {queue.name}</option>
            ))}
          </select>
          {props.queueAssignedAt ? (
            <p className="mt-1 text-xs text-slate-500">
              Queued {format(new Date(props.queueAssignedAt), "PP p")}
            </p>
          ) : null}
        </div>
      </div>

      <div className="grid gap-1 sm:grid-cols-3 sm:items-start">
        <span className="text-xs uppercase tracking-wider text-slate-400">
          Additional assignees
        </span>
        <div className="sm:col-span-2 space-y-2">
          {props.additionalAssignees.length === 0 ? (
            <p className="text-xs text-slate-500">None besides the primary owner.</p>
          ) : (
            <ul className="space-y-1">
              {props.additionalAssignees.map((assignee) => (
                <li key={assignee.userId} className="flex items-center justify-between text-xs text-slate-300">
                  {assignee.userName}
                  {props.canEdit ? (
                    <button
                      type="button"
                      className="kelpie-link"
                      disabled={pending}
                      onClick={() => handleRemoveAssignee(assignee.userId)}
                    >
                      Remove
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {props.canEdit && availableForAdd.length > 0 ? (
            <div className="flex gap-2">
              <select
                className="kelpie-input"
                value={addAssigneeId}
                onChange={(event) => setAddAssigneeId(event.target.value)}
              >
                <option value="">Add analyst…</option>
                {availableForAdd.map((member) => (
                  <option key={member.id} value={member.id}>{member.name}</option>
                ))}
              </select>
              <button
                type="button"
                className="kelpie-btn kelpie-btn-secondary"
                disabled={pending || !addAssigneeId}
                onClick={handleAddAssignee}
              >
                Add
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="grid gap-1 sm:grid-cols-3 sm:items-center">
        <span className="text-xs uppercase tracking-wider text-slate-400">Acknowledged</span>
        <div className="sm:col-span-2">
          {props.acknowledgedAt ? (
            <p className="text-xs text-slate-300">
              {format(new Date(props.acknowledgedAt), "PP p")}
            </p>
          ) : props.canEdit ? (
            <button
              type="button"
              className="kelpie-btn kelpie-btn-secondary"
              disabled={pending}
              onClick={handleAcknowledge}
            >
              Acknowledge case
            </button>
          ) : (
            <p className="text-xs text-slate-500">Not yet acknowledged.</p>
          )}
        </div>
      </div>

      <div className="grid gap-1 sm:grid-cols-3 sm:items-center">
        <label htmlFor="case-waiting" className="text-xs uppercase tracking-wider text-slate-400">
          Waiting on
        </label>
        <div className="sm:col-span-2">
          <select
            id="case-waiting"
            className="kelpie-input"
            defaultValue={props.waitingReason}
            disabled={pending || !props.canEdit}
            onChange={(event) =>
              handleWaitingReason(event.target.value as "none" | "third_party" | "approval")
            }
          >
            <option value="none">Nothing</option>
            <option value="third_party">Third party</option>
            <option value="approval">Approval</option>
          </select>
          {props.waitingReason !== "none" && props.waitingSince ? (
            <p className="mt-1 text-xs text-slate-500">
              Since {format(new Date(props.waitingSince), "PP p")}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
