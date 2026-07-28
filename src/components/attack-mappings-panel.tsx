"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  attachAttackTechnique,
  removeAttackMapping,
} from "@/actions/attack";
import { ConfirmDialog, feedbackError } from "@/components/confirm-dialog";
import { ConfidenceBadge } from "@/components/badges";
import AttackTechniqueCombobox, {
  type TechniqueOption,
} from "@/components/attack-technique-combobox";
import type { MappingEntityType } from "@/lib/attack/mapping-core";

export type MappingRow = {
  id: string;
  entityType: string;
  entityId: string;
  techniqueId: string;
  confidence: number | null;
  source: string;
  notes: string | null;
  detectionNotes: string | null;
  responseNotes: string | null;
  actorAttribution: string | null;
  createdAt: string;
  technique: { name: string | null; tactics: Array<{ id: string; name: string }>; deprecated: boolean };
};

const SOURCES = ["analyst", "detection_rule", "threat_intel", "provider"] as const;

export default function AttackMappingsPanel({
  caseId,
  entityType,
  entityId,
  mappings,
  canEdit,
  title = "ATT&CK technique mappings",
}: {
  caseId: string;
  entityType: MappingEntityType;
  entityId: string;
  mappings: MappingRow[];
  canEdit: boolean;
  title?: string;
}) {
  const [formOpen, setFormOpen] = useState(false);

  return (
    <div className="kelpie-card p-5 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-medium text-slate-300">{title}</h2>
          <p className="text-xs text-slate-500 mt-1">
            Confidence, source, notes, detection notes, response notes, and actor
            attribution are recorded separately for each mapping.
          </p>
        </div>
        {canEdit ? (
          <button
            type="button"
            className="kelpie-btn kelpie-btn-secondary kelpie-btn-sm shrink-0"
            onClick={() => setFormOpen((v) => !v)}
          >
            {formOpen ? "Cancel" : "Attach technique"}
          </button>
        ) : null}
      </div>

      {mappings.length === 0 ? (
        <p className="text-xs text-slate-500">No techniques mapped yet.</p>
      ) : (
        <ul className="space-y-2">
          {mappings.map((mapping) => (
            <MappingItem key={mapping.id} caseId={caseId} mapping={mapping} canEdit={canEdit} />
          ))}
        </ul>
      )}

      {formOpen ? (
        <AttachForm
          caseId={caseId}
          entityType={entityType}
          entityId={entityId}
          onDone={() => setFormOpen(false)}
        />
      ) : null}
    </div>
  );
}

function MappingItem({
  caseId,
  mapping,
  canEdit,
}: {
  caseId: string;
  mapping: MappingRow;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);

  async function confirmRemove() {
    setPending(true);
    try {
      await removeAttackMapping(mapping.id, caseId);
      setConfirmOpen(false);
      toast.success(`Removed ${mapping.techniqueId} mapping`);
      router.refresh();
    } catch (error) {
      toast.error("Could not remove mapping", {
        description: feedbackError(error, "The mapping was not removed. Try again."),
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <li className="rounded border border-[color:var(--color-navy-700)] p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-slate-400">{mapping.techniqueId}</span>
            <span className="text-sm text-slate-200">{mapping.technique.name ?? "Unknown technique"}</span>
            {mapping.technique.deprecated ? (
              <span className="kelpie-badge text-slate-500">deprecated</span>
            ) : null}
            <ConfidenceBadge value={mapping.confidence} />
          </div>
          <p className="text-xs text-slate-500 mt-1">
            {mapping.technique.tactics.map((t) => t.name).join(", ") || "No tactic recorded"}
            {" · "}
            {mapping.entityType} · source: {mapping.source}
          </p>
          {mapping.notes ? <p className="text-xs text-slate-400 mt-1">{mapping.notes}</p> : null}
          {mapping.detectionNotes ? (
            <p className="text-xs text-slate-400 mt-1">
              <span className="text-slate-500">Detection:</span> {mapping.detectionNotes}
            </p>
          ) : null}
          {mapping.responseNotes ? (
            <p className="text-xs text-slate-400 mt-1">
              <span className="text-slate-500">Response:</span> {mapping.responseNotes}
            </p>
          ) : null}
          {mapping.actorAttribution ? (
            <p className="text-xs text-slate-400 mt-1">
              <span className="text-slate-500">Actor attribution:</span> {mapping.actorAttribution}
            </p>
          ) : null}
        </div>
        {canEdit ? (
          <button
            type="button"
            className="kelpie-btn kelpie-btn-danger kelpie-btn-sm shrink-0"
            onClick={() => setConfirmOpen(true)}
          >
            Remove
          </button>
        ) : null}
      </div>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          setConfirmOpen(open);
          if (!open) setPending(false);
        }}
        title={`Remove ${mapping.techniqueId} mapping?`}
        description={`This removes the ${mapping.techniqueId} mapping from this ${mapping.entityType}. It is recorded on the case timeline and organisation audit trail.`}
        confirmLabel="Remove mapping"
        pending={pending}
        tone="danger"
        onConfirm={() => void confirmRemove()}
      />
    </li>
  );
}

function AttachForm({
  caseId,
  entityType,
  entityId,
  onDone,
}: {
  caseId: string;
  entityType: MappingEntityType;
  entityId: string;
  onDone: () => void;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<TechniqueOption | null>(null);
  const [confidence, setConfidence] = useState("");
  const [source, setSource] = useState<(typeof SOURCES)[number]>("analyst");
  const [notes, setNotes] = useState("");
  const [detectionNotes, setDetectionNotes] = useState("");
  const [responseNotes, setResponseNotes] = useState("");
  const [actorAttribution, setActorAttribution] = useState("");
  const [pending, setPending] = useState(false);

  async function submit() {
    if (!selected) return;
    setPending(true);
    try {
      await attachAttackTechnique(
        entityType,
        entityId,
        {
          techniqueId: selected.techniqueId,
          confidence: confidence.trim() ? Number(confidence) : null,
          source,
          notes: notes.trim() || null,
          detectionNotes: detectionNotes.trim() || null,
          responseNotes: responseNotes.trim() || null,
          actorAttribution: actorAttribution.trim() || null,
        },
        caseId,
      );
      toast.success(`${selected.techniqueId} attached`);
      onDone();
      router.refresh();
    } catch (error) {
      toast.error("Could not attach technique", {
        description: feedbackError(error, "The mapping was not created. Try again."),
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      className="space-y-3 border-t border-[color:var(--color-navy-700)] pt-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="kelpie-field">
        <span className="kelpie-label">Technique</span>
        {selected ? (
          <div className="flex items-center justify-between gap-2 rounded border border-[color:var(--color-navy-700)] px-3 py-2">
            <span className="text-sm">
              <span className="font-mono text-xs text-slate-400 mr-2">{selected.techniqueId}</span>
              {selected.name}
            </span>
            <button
              type="button"
              className="kelpie-btn kelpie-btn-ghost kelpie-btn-sm"
              onClick={() => setSelected(null)}
            >
              Change
            </button>
          </div>
        ) : (
          <AttackTechniqueCombobox onSelect={setSelected} />
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="kelpie-field">
          <span className="kelpie-label">Confidence (0-100)</span>
          <input
            type="number"
            min={0}
            max={100}
            className="kelpie-input"
            value={confidence}
            onChange={(e) => setConfidence(e.target.value)}
          />
        </label>
        <label className="kelpie-field">
          <span className="kelpie-label">Source</span>
          <select
            className="kelpie-input"
            value={source}
            onChange={(e) => setSource(e.target.value as (typeof SOURCES)[number])}
          >
            {SOURCES.map((value) => (
              <option key={value} value={value}>
                {value.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="kelpie-field">
        <span className="kelpie-label">Notes</span>
        <textarea className="kelpie-input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <label className="kelpie-field">
        <span className="kelpie-label">Detection notes</span>
        <textarea
          className="kelpie-input"
          rows={2}
          value={detectionNotes}
          onChange={(e) => setDetectionNotes(e.target.value)}
        />
      </label>
      <label className="kelpie-field">
        <span className="kelpie-label">Response notes</span>
        <textarea
          className="kelpie-input"
          rows={2}
          value={responseNotes}
          onChange={(e) => setResponseNotes(e.target.value)}
        />
      </label>
      <label className="kelpie-field">
        <span className="kelpie-label">Actor attribution (analyst-entered only)</span>
        <textarea
          className="kelpie-input"
          rows={2}
          value={actorAttribution}
          onChange={(e) => setActorAttribution(e.target.value)}
          placeholder="Kelpie never infers this automatically"
        />
      </label>
      <div className="flex justify-end">
        <button type="submit" className="kelpie-btn kelpie-btn-primary kelpie-btn-sm" disabled={!selected || pending}>
          {pending ? "Attaching..." : "Attach technique"}
        </button>
      </div>
    </form>
  );
}
