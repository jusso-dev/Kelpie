"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  PLAYBOOK_GUIDANCE_CATEGORIES,
  type PlaybookGuidanceCategory,
} from "@/lib/attack/playbook-guidance";

type DraftStep = {
  title: string;
  description: string;
  offsetMinutes: number;
  isRequired: boolean;
  attackTechniqueIds: string[];
  guidanceCategories: PlaybookGuidanceCategory[];
};

const STARTING: DraftStep[] = [
  {
    title: "Acknowledge and triage",
    description: "Open the case, confirm scope, set severity.",
    offsetMinutes: 15,
    isRequired: true,
    attackTechniqueIds: [],
    guidanceCategories: [],
  },
];

export default function PlaybookStepsEditor({
  initial,
}: {
  initial?: DraftStep[];
}) {
  const [steps, setSteps] = useState<DraftStep[]>(initial ?? STARTING);
  const [removeIndex, setRemoveIndex] = useState<number | null>(null);

  function update(i: number, patch: Partial<DraftStep>) {
    setSteps((prev) =>
      prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)),
    );
  }
  function remove(i: number) {
    setSteps((prev) => prev.filter((_, idx) => idx !== i));
    setRemoveIndex(null);
    toast.success("Step removed from draft", {
      description: "Save the playbook to make this change permanent.",
    });
  }
  function add() {
    setSteps((prev) => [
      ...prev,
      {
        title: "",
        description: "",
        offsetMinutes: 60,
        isRequired: true,
        attackTechniqueIds: [],
        guidanceCategories: [],
      },
    ]);
  }

  function toggleGuidance(i: number, category: PlaybookGuidanceCategory) {
    setSteps((prev) =>
      prev.map((s, idx) =>
        idx === i
          ? {
              ...s,
              guidanceCategories: s.guidanceCategories.includes(category)
                ? s.guidanceCategories.filter((c) => c !== category)
                : [...s.guidanceCategories, category],
            }
          : s,
      ),
    );
  }

  return (
    <div>
      <label className="block text-xs uppercase tracking-wider text-slate-400 mb-1">
        Steps
      </label>
      <input type="hidden" name="steps" value={JSON.stringify(steps)} />
      <div className="space-y-3">
        {steps.map((s, i) => (
          <div
            key={i}
            className="border border-[color:var(--color-navy-700)] rounded p-3 space-y-2"
          >
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500 font-mono w-6">{i + 1}</span>
              <input
                aria-label={`Step ${i + 1} title`}
                className="kelpie-input"
                placeholder="Step title"
                value={s.title}
                onChange={(e) => update(i, { title: e.target.value })}
              />
              <button
                type="button"
                className="kelpie-btn kelpie-btn-ghost text-red-400"
                onClick={() => setRemoveIndex(i)}
              >
                Remove
              </button>
            </div>
            <textarea
              aria-label={`Step ${i + 1} description`}
              className="kelpie-input"
              rows={2}
              placeholder="Description (optional)"
              value={s.description}
              onChange={(e) => update(i, { description: e.target.value })}
            />
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
              <label htmlFor={`step-offset-${i}`} className="text-xs text-slate-400">
                Due (minutes after start)
              </label>
              <input
                id={`step-offset-${i}`}
                type="number"
                min={0}
                className="kelpie-input max-w-[8rem]"
                value={s.offsetMinutes}
                onChange={(e) =>
                  update(i, { offsetMinutes: Number(e.target.value) || 0 })
                }
              />
              <label className="text-xs text-slate-400 inline-flex items-center gap-1">
                <input
                  type="checkbox"
                  className="kelpie-checkbox"
                  checked={s.isRequired}
                  onChange={(e) => update(i, { isRequired: e.target.checked })}
                />
                Required
              </label>
            </div>
            <div className="kelpie-field">
              <label htmlFor={`step-techniques-${i}`} className="kelpie-label">
                ATT&CK technique ids this step documents (comma separated)
              </label>
              <input
                id={`step-techniques-${i}`}
                className="kelpie-input"
                placeholder="T1566, T1566.001"
                value={s.attackTechniqueIds.join(", ")}
                onChange={(e) =>
                  update(i, {
                    attackTechniqueIds: e.target.value
                      .split(",")
                      .map((v) => v.trim().toUpperCase())
                      .filter(Boolean),
                  })
                }
              />
            </div>
            <fieldset className="flex flex-wrap gap-3">
              <legend className="text-xs text-slate-400 mb-1">
                Guidance categories this step&apos;s description documents
              </legend>
              {PLAYBOOK_GUIDANCE_CATEGORIES.map((category) => (
                <label
                  key={category}
                  className="text-xs text-slate-400 inline-flex items-center gap-1 capitalize"
                >
                  <input
                    type="checkbox"
                    className="kelpie-checkbox"
                    checked={s.guidanceCategories.includes(category)}
                    onChange={() => toggleGuidance(i, category)}
                  />
                  {category}
                </label>
              ))}
            </fieldset>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="kelpie-btn kelpie-btn-secondary mt-3"
        onClick={add}
      >
        Add step
      </button>
      <ConfirmDialog
        open={removeIndex !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveIndex(null);
        }}
        title="Remove this playbook step?"
        description="Are you sure? The step is removed from the draft. The saved playbook remains unchanged until you save."
        confirmLabel="Remove step"
        onConfirm={() => {
          if (removeIndex !== null) remove(removeIndex);
        }}
      />
    </div>
  );
}
