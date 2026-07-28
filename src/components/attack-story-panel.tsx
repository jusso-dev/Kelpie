"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  addAttackStoryEntry,
  reorderAttackStoryEntry,
  removeAttackStoryEntry,
} from "@/actions/attack";
import { ConfirmDialog, feedbackError } from "@/components/confirm-dialog";
import { format } from "date-fns";

export type StoryEntryRow = {
  id: string;
  sequenceIndex: number;
  title: string;
  description: string | null;
  provenance: "analyst" | "provider";
  sourceRef: string | null;
  occurredAt: string | null;
  techniqueId: string | null;
  techniqueName: string | null;
};

/**
 * Explicit analyst/provider-ordered attack story. `sequenceIndex` — set by
 * whoever adds or reorders an entry — is the only thing that determines
 * display order here. `occurredAt` is shown only as optional context; moving
 * an entry never reads or infers from it, so the order can never be
 * mistaken for a timestamp-derived causality claim.
 */
export default function AttackStoryPanel({
  caseId,
  entries,
  canEdit,
}: {
  caseId: string;
  entries: StoryEntryRow[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [formOpen, setFormOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [provenance, setProvenance] = useState<"analyst" | "provider">("analyst");
  const [sourceRef, setSourceRef] = useState("");
  const [pending, setPending] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<StoryEntryRow | null>(null);
  const [removing, setRemoving] = useState(false);

  async function submit() {
    const trimmed = title.trim();
    if (!trimmed) return;
    setPending(true);
    try {
      await addAttackStoryEntry(caseId, {
        title: trimmed,
        provenance,
        sourceRef: sourceRef.trim() || null,
      });
      setTitle("");
      setSourceRef("");
      setFormOpen(false);
      toast.success("Story entry added");
      router.refresh();
    } catch (error) {
      toast.error("Could not add story entry", {
        description: feedbackError(error, "The entry was not added. Try again."),
      });
    } finally {
      setPending(false);
    }
  }

  async function move(entryId: string, currentIndex: number, delta: number) {
    const targetIndex = currentIndex + delta;
    if (targetIndex < 0 || targetIndex >= entries.length) return;
    try {
      await reorderAttackStoryEntry(caseId, entryId, targetIndex);
      router.refresh();
    } catch (error) {
      toast.error("Could not reorder story", {
        description: feedbackError(error, "The order was not changed. Try again."),
      });
    }
  }

  async function confirmRemove() {
    if (!removeTarget) return;
    setRemoving(true);
    try {
      await removeAttackStoryEntry(caseId, removeTarget.id);
      setRemoveTarget(null);
      toast.success("Story entry removed");
      router.refresh();
    } catch (error) {
      toast.error("Could not remove story entry", {
        description: feedbackError(error, "The entry was not removed. Try again."),
      });
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="kelpie-card p-5 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-medium text-slate-300">Attack story</h2>
          <p className="text-xs text-slate-500 mt-1">
            Explicit analyst/provider-ordered sequence. Order is set here, never
            inferred from timestamps.
          </p>
        </div>
        {canEdit ? (
          <button
            type="button"
            className="kelpie-btn kelpie-btn-secondary kelpie-btn-sm shrink-0"
            onClick={() => setFormOpen((v) => !v)}
          >
            {formOpen ? "Cancel" : "Add step"}
          </button>
        ) : null}
      </div>

      {entries.length === 0 ? (
        <p className="text-xs text-slate-500">No attack story steps recorded yet.</p>
      ) : (
        <ol className="space-y-2">
          {entries.map((entry, index) => (
            <li key={entry.id} className="rounded border border-[color:var(--color-navy-700)] p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-mono text-slate-500">{index + 1}.</span>
                    <span className="text-sm text-slate-200">{entry.title}</span>
                    <span className="kelpie-badge text-slate-400">{entry.provenance}</span>
                    {entry.techniqueId ? (
                      <span className="font-mono text-xs text-slate-400">
                        {entry.techniqueId}
                        {entry.techniqueName ? ` — ${entry.techniqueName}` : ""}
                      </span>
                    ) : null}
                  </div>
                  {entry.description ? (
                    <p className="text-xs text-slate-400 mt-1">{entry.description}</p>
                  ) : null}
                  <p className="text-xs text-slate-500 mt-1">
                    {entry.sourceRef ? `Source: ${entry.sourceRef}` : null}
                    {entry.occurredAt
                      ? `${entry.sourceRef ? " · " : ""}Context time: ${format(new Date(entry.occurredAt), "PP p")}`
                      : ""}
                  </p>
                </div>
                {canEdit ? (
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      className="kelpie-btn kelpie-btn-ghost kelpie-btn-sm"
                      aria-label={`Move ${entry.title} earlier`}
                      disabled={index === 0}
                      onClick={() => void move(entry.id, index, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="kelpie-btn kelpie-btn-ghost kelpie-btn-sm"
                      aria-label={`Move ${entry.title} later`}
                      disabled={index === entries.length - 1}
                      onClick={() => void move(entry.id, index, 1)}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="kelpie-btn kelpie-btn-danger kelpie-btn-sm"
                      onClick={() => setRemoveTarget(entry)}
                    >
                      Remove
                    </button>
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      )}

      {formOpen ? (
        <form
          className="space-y-2 border-t border-[color:var(--color-navy-700)] pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label className="kelpie-field">
            <span className="kelpie-label">Step title</span>
            <input
              className="kelpie-input"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Initial phishing click"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="kelpie-field">
              <span className="kelpie-label">Provenance</span>
              <select
                className="kelpie-input"
                value={provenance}
                onChange={(e) => setProvenance(e.target.value as "analyst" | "provider")}
              >
                <option value="analyst">Analyst</option>
                <option value="provider">Provider</option>
              </select>
            </label>
            <label className="kelpie-field">
              <span className="kelpie-label">Source reference (optional)</span>
              <input
                className="kelpie-input"
                value={sourceRef}
                onChange={(e) => setSourceRef(e.target.value)}
                placeholder="Detection rule id, provider event id..."
              />
            </label>
          </div>
          <div className="flex justify-end">
            <button type="submit" className="kelpie-btn kelpie-btn-primary kelpie-btn-sm" disabled={pending}>
              {pending ? "Adding..." : "Add step"}
            </button>
          </div>
        </form>
      ) : null}

      <ConfirmDialog
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRemoveTarget(null);
            setRemoving(false);
          }
        }}
        title={removeTarget ? `Remove "${removeTarget.title}"?` : "Remove step?"}
        description="This removes the step from the attack story. Recorded on the case timeline."
        confirmLabel="Remove step"
        pending={removing}
        tone="danger"
        onConfirm={() => void confirmRemove()}
      />
    </div>
  );
}
