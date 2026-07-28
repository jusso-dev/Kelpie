"use client";

import { useState } from "react";
import { ConfirmFormActionButton } from "@/components/confirm-dialog";
import { updateAuditRetention } from "@/actions/audit";

export default function AuditRetentionSettings({
  currentDays,
  minDays,
}: {
  currentDays: number;
  minDays: number;
}) {
  const [days, setDays] = useState(currentDays);

  return (
    <div className="kelpie-field max-w-xs">
      <label htmlFor="audit-retention-days" className="kelpie-label">
        Retention (days)
      </label>
      <input
        id="audit-retention-days"
        type="number"
        min={minDays}
        step={1}
        className="kelpie-input"
        value={days}
        onChange={(event) => setDays(Number(event.target.value))}
      />
      <p className="text-xs text-slate-500">
        Currently retaining audit events for {currentDays} days. Cannot go below{" "}
        {minDays} days.
      </p>
      <ConfirmFormActionButton
        action={updateAuditRetention}
        values={{ retentionDays: String(days) }}
        title="Change audit retention period?"
        description={`Audit events older than the new retention window will be permanently purged on the next retention run. This cannot be undone. Minimum allowed is ${minDays} days.`}
        confirmLabel="Update retention"
        triggerLabel="Save retention"
        successTitle="Audit retention updated"
        successDescription={`Audit events will now be retained for ${days} days.`}
        errorTitle="Retention could not be updated"
        className="kelpie-btn kelpie-btn-primary mt-2"
        disabled={
          !Number.isFinite(days) ||
          !Number.isInteger(days) ||
          days < minDays ||
          days === currentDays
        }
      />
    </div>
  );
}
