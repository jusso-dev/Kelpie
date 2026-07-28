"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { applyBulkPresetAction } from "@/actions/case-views";
import { ConfirmDialog } from "@/components/confirm-dialog";
import type { BulkPreset } from "@/lib/case-views/config";

/**
 * Renders saved bulk-action presets for a view. Selecting a preset never
 * auto-runs: it previews impact against the *current* checkbox selection and
 * requires branded confirmation before calling the normal bulk path.
 */
export function CaseViewBulkPresets({
  viewId,
  formId,
  presets,
}: {
  viewId: string;
  formId: string;
  presets: BulkPreset[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [pendingPreset, setPendingPreset] = useState<{
    preset: BulkPreset;
    caseIds: string[];
  } | null>(null);

  if (presets.length === 0) return null;

  function collectSelectedCaseIds(): string[] {
    const form = document.getElementById(formId) as HTMLFormElement | null;
    if (!form) return [];
    // Checkboxes live on the table with form={formId}; FormData still picks them up.
    const data = new FormData(form);
    return data.getAll("caseIds").map(String);
  }

  function requestPreset(preset: BulkPreset) {
    const caseIds = collectSelectedCaseIds();
    if (caseIds.length === 0) {
      toast.warning("Select at least one case first");
      return;
    }
    setPendingPreset({ preset, caseIds });
  }

  return (
    <div
      className="kelpie-panel flex flex-wrap items-center gap-2 p-3"
      aria-label="Bulk action presets"
    >
      <span className="text-xs font-medium text-slate-400">Presets</span>
      {presets.map((preset) => (
        <button
          key={preset.id}
          type="button"
          className="kelpie-btn kelpie-btn-secondary"
          disabled={pending}
          onClick={() => requestPreset(preset)}
        >
          {preset.name}
        </button>
      ))}

      <ConfirmDialog
        open={pendingPreset !== null}
        onOpenChange={(open) => {
          if (!open) setPendingPreset(null);
        }}
        title={
          pendingPreset
            ? `Apply preset “${pendingPreset.preset.name}”?`
            : "Apply preset?"
        }
        description={
          pendingPreset
            ? `This will run “${pendingPreset.preset.operationType.replace(/_/g, " ")}” on ${pendingPreset.caseIds.length} currently selected case${pendingPreset.caseIds.length === 1 ? "" : "s"}. Targets are re-resolved now; the preset never stores case IDs and never skips permissions.`
            : ""
        }
        confirmLabel="Apply preset"
        tone="warning"
        pending={pending}
        onConfirm={() => {
          if (!pendingPreset) return;
          const { preset, caseIds } = pendingPreset;
          start(async () => {
            const result = await applyBulkPresetAction({
              viewId,
              presetId: preset.id,
              caseIds,
              confirmed: true,
            });
            if (!result.ok) {
              toast.error("Preset failed", { description: result.error });
              return;
            }
            if (result.failureCount === 0) {
              toast.success(
                `Updated ${result.successCount} case${result.successCount === 1 ? "" : "s"}`,
              );
            } else {
              toast.warning(
                `Updated ${result.successCount} of ${result.attempted} cases`,
                {
                  description: `${result.failureCount} case${result.failureCount === 1 ? "" : "s"} could not be changed.`,
                },
              );
            }
            setPendingPreset(null);
            router.refresh();
          });
        }}
      />
    </div>
  );
}
