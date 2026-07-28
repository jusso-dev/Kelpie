"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { format } from "date-fns";
import { createHandoff } from "@/actions/handoffs";
import { feedbackError } from "@/components/confirm-dialog";

type Handoff = {
  id: string;
  summary: string;
  keyActions: string[];
  openItems: string[];
  fromUserId: string | null;
  toUserId: string | null;
  createdAt: string;
};
type Member = { id: string; name: string };

/**
 * Hand-offs are immutable: this panel can only ever create a new one
 * (createHandoff -> createHandoffCore), never edit or delete an existing
 * entry. A correction during the next shift is recorded as another hand-off.
 */
export function HandoffPanel({
  caseId,
  handoffs,
  members,
  canCreate,
}: {
  caseId: string;
  handoffs: Handoff[];
  members: Member[];
  canCreate: boolean;
}) {
  const [pending, start] = useTransition();
  const [summary, setSummary] = useState("");
  const [toUserId, setToUserId] = useState("");
  const router = useRouter();

  function nameFor(userId: string | null): string {
    if (!userId) return "Unassigned";
    return members.find((m) => m.id === userId)?.name ?? "Former member";
  }

  function handleSubmit() {
    if (!summary.trim()) {
      toast.warning("A hand-off needs a summary");
      return;
    }
    start(async () => {
      const result = await createHandoff(caseId, {
        toUserId: toUserId || null,
        summary,
      });
      if (!result.ok) {
        toast.error("Could not record hand-off", { description: feedbackError(result.error, "") });
        return;
      }
      setSummary("");
      setToUserId("");
      toast.success("Hand-off recorded");
      router.refresh();
    });
  }

  return (
    <div className="kelpie-card space-y-3 p-5">
      <h2 className="text-sm font-medium text-slate-300">Shift hand-offs</h2>
      {handoffs.length === 0 ? (
        <p className="text-xs text-slate-500">No hand-offs recorded yet.</p>
      ) : (
        <ul className="space-y-3">
          {handoffs.map((h) => (
            <li key={h.id} className="border-t border-[color:var(--color-navy-700)] pt-2 text-xs text-slate-300">
              <p className="text-slate-500">
                {format(new Date(h.createdAt), "PP p")} · {nameFor(h.fromUserId)} → {nameFor(h.toUserId)}
              </p>
              <p className="mt-1 whitespace-pre-wrap">{h.summary}</p>
            </li>
          ))}
        </ul>
      )}
      {canCreate ? (
        <div className="space-y-2 border-t border-[color:var(--color-navy-700)] pt-3">
          <label className="block text-xs uppercase tracking-wider text-slate-400" htmlFor="handoff-to">
            Hand off to
          </label>
          <select
            id="handoff-to"
            className="kelpie-input"
            value={toUserId}
            onChange={(event) => setToUserId(event.target.value)}
          >
            <option value="">Leave with current queue/owner</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>{member.name}</option>
            ))}
          </select>
          <textarea
            className="kelpie-input"
            rows={4}
            placeholder="What happened this shift, key actions taken, and what's outstanding."
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
          />
          <button
            type="button"
            className="kelpie-btn kelpie-btn-primary"
            disabled={pending}
            onClick={handleSubmit}
          >
            Record hand-off
          </button>
        </div>
      ) : null}
    </div>
  );
}
