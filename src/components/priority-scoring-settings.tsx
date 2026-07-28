"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { savePrioritySettingsAction } from "@/actions/asset-context";
import {
  PRIORITY_WEIGHT_KEYS,
  type PriorityScoringSettings,
  type PriorityWeightKey,
} from "@/lib/asset-context/types";

const LABELS: Record<PriorityWeightKey, string> = {
  sourceSeverity: "Source severity",
  assetCriticality: "Asset criticality",
  identityPrivilege: "Identity privilege",
  affectedEntityCount: "Affected entity count",
  attackStage: "ATT&CK stage",
  tiConfidence: "TI confidence",
  externalExposure: "External exposure",
  relatedCases: "Related cases",
  slaState: "SLA state",
};

export default function PriorityScoringSettingsForm({
  initial,
}: {
  initial: PriorityScoringSettings;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [enabled, setEnabled] = useState(initial.enabled);
  const [weights, setWeights] = useState(initial.weights);
  const [policy, setPolicy] = useState(initial.staleContextPolicy);
  const [staleHours, setStaleHours] = useState(String(initial.staleAfterHours));

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const res = await savePrioritySettingsAction({
            enabled,
            weights,
            staleContextPolicy: policy,
            staleAfterHours: Number(staleHours) || initial.staleAfterHours,
          });
          if (!res.ok) toast.error(res.error);
          else {
            toast.success("Priority scoring settings saved");
            router.refresh();
          }
        });
      }}
    >
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        Enable priority scoring
      </label>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {PRIORITY_WEIGHT_KEYS.map((key) => (
          <label key={key} className="text-xs text-slate-400">
            {LABELS[key]} (0–1)
            <input
              className="kelpie-input mt-1 block w-full"
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={weights[key]}
              onChange={(e) =>
                setWeights((w) => ({
                  ...w,
                  [key]: Number(e.target.value),
                }))
              }
            />
          </label>
        ))}
      </div>

      <div className="flex flex-wrap gap-4">
        <label className="text-xs text-slate-400">
          Stale context policy
          <select
            className="kelpie-input mt-1 block"
            value={policy}
            onChange={(e) =>
              setPolicy(e.target.value as PriorityScoringSettings["staleContextPolicy"])
            }
          >
            <option value="discount">Discount (×0.5)</option>
            <option value="exclude">Exclude</option>
            <option value="include">Include as-is</option>
          </select>
        </label>
        <label className="text-xs text-slate-400">
          Stale after (hours)
          <input
            className="kelpie-input mt-1 block w-28"
            type="number"
            min={1}
            max={2160}
            value={staleHours}
            onChange={(e) => setStaleHours(e.target.value)}
          />
        </label>
      </div>

      <button
        type="submit"
        className="kelpie-btn kelpie-btn-primary"
        disabled={pending}
      >
        Save settings
      </button>
    </form>
  );
}
