"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { feedbackError } from "@/components/confirm-dialog";
import {
  renameEvidence,
  setEvidenceLabels,
  setEvidenceRelevance,
  setEvidenceNotes,
  setEvidenceAcquisition,
} from "@/actions/attachments";

const RELEVANCE_OPTIONS = [
  { value: "unknown", label: "Unknown" },
  { value: "relevant", label: "Relevant" },
  { value: "not_relevant", label: "Not relevant" },
] as const;

function toLocalInputValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function EvidenceEditor({
  caseId,
  evidenceId,
  filename,
  labels,
  relevance,
  examinerNotes,
  acquisitionSource,
  acquiredAt,
  canEdit,
}: {
  caseId: string;
  evidenceId: string;
  filename: string;
  labels: string[];
  relevance: "unknown" | "relevant" | "not_relevant";
  examinerNotes: string | null;
  acquisitionSource: string | null;
  acquiredAt: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState<string | null>(null);
  const [filenameDraft, setFilenameDraft] = useState(filename);
  const [labelsDraft, setLabelsDraft] = useState(labels.join(", "));
  const [notesDraft, setNotesDraft] = useState(examinerNotes ?? "");
  const [sourceDraft, setSourceDraft] = useState(acquisitionSource ?? "");
  const [acquiredAtDraft, setAcquiredAtDraft] = useState(
    toLocalInputValue(acquiredAt),
  );

  async function run(field: string, label: string, fn: () => Promise<unknown>) {
    setSaving(field);
    try {
      await fn();
      toast.success(`${label} updated`);
      router.refresh();
    } catch (error) {
      toast.error(`${label} could not be updated`, {
        description: feedbackError(error, "Nothing changed. Try again."),
      });
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="kelpie-card p-5 space-y-4">
      <h2 className="text-sm font-medium text-slate-300">Evidence details</h2>

      <div className="kelpie-field">
        <label htmlFor="evidence-filename" className="kelpie-label">
          Filename
        </label>
        <input
          id="evidence-filename"
          className="kelpie-input"
          value={filenameDraft}
          disabled={!canEdit || saving === "filename"}
          onChange={(event) => setFilenameDraft(event.target.value)}
          onBlur={() => {
            const next = filenameDraft.trim();
            if (next && next !== filename) {
              void run("filename", "Filename", () =>
                renameEvidence(caseId, evidenceId, next),
              );
            }
          }}
        />
      </div>

      <div className="kelpie-field">
        <label htmlFor="evidence-relevance" className="kelpie-label">
          Relevance
        </label>
        <select
          id="evidence-relevance"
          className="kelpie-input"
          defaultValue={relevance}
          disabled={!canEdit || saving === "relevance"}
          onChange={(event) =>
            void run("relevance", "Relevance", () =>
              setEvidenceRelevance(
                caseId,
                evidenceId,
                event.target.value as typeof relevance,
              ),
            )
          }
        >
          {RELEVANCE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="kelpie-field">
        <label htmlFor="evidence-labels" className="kelpie-label">
          Labels
        </label>
        <input
          id="evidence-labels"
          className="kelpie-input"
          value={labelsDraft}
          disabled={!canEdit || saving === "labels"}
          placeholder="comma, separated, labels"
          onChange={(event) => setLabelsDraft(event.target.value)}
          onBlur={() => {
            if (labelsDraft !== labels.join(", ")) {
              void run("labels", "Labels", () =>
                setEvidenceLabels(caseId, evidenceId, labelsDraft),
              );
            }
          }}
        />
      </div>

      <div className="kelpie-field">
        <label htmlFor="evidence-notes" className="kelpie-label">
          Examiner notes
        </label>
        <textarea
          id="evidence-notes"
          className="kelpie-input"
          rows={3}
          value={notesDraft}
          disabled={!canEdit || saving === "notes"}
          onChange={(event) => setNotesDraft(event.target.value)}
          onBlur={() => {
            if (notesDraft !== (examinerNotes ?? "")) {
              void run("notes", "Examiner notes", () =>
                setEvidenceNotes(caseId, evidenceId, notesDraft.trim() || null),
              );
            }
          }}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="kelpie-field">
          <label htmlFor="evidence-acq-source" className="kelpie-label">
            Acquisition source
          </label>
          <input
            id="evidence-acq-source"
            className="kelpie-input"
            value={sourceDraft}
            disabled={!canEdit || saving === "acquisition"}
            onChange={(event) => setSourceDraft(event.target.value)}
            placeholder="e.g. host triage image, forensic export"
          />
        </div>
        <div className="kelpie-field">
          <label htmlFor="evidence-acq-at" className="kelpie-label">
            Acquired at
          </label>
          <input
            id="evidence-acq-at"
            type="datetime-local"
            className="kelpie-input"
            value={acquiredAtDraft}
            disabled={!canEdit || saving === "acquisition"}
            onChange={(event) => setAcquiredAtDraft(event.target.value)}
          />
        </div>
      </div>
      {canEdit ? (
        <div className="flex justify-end">
          <button
            type="button"
            className="kelpie-btn kelpie-btn-secondary kelpie-btn-sm"
            disabled={saving === "acquisition"}
            onClick={() =>
              void run("acquisition", "Acquisition details", () =>
                setEvidenceAcquisition(
                  caseId,
                  evidenceId,
                  sourceDraft.trim() || null,
                  acquiredAtDraft ? new Date(acquiredAtDraft).toISOString() : null,
                ),
              )
            }
          >
            Save acquisition details
          </button>
        </div>
      ) : null}
    </div>
  );
}
