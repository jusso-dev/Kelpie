"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { linkCases, unlinkCase, dismissSuggestion } from "@/actions/case-relationships";
import { ConfirmDialog, feedbackError } from "@/components/confirm-dialog";
import { RelationshipTypeBadge, ConfidenceBadge, SeverityBadge, StatusBadge } from "@/components/badges";
import type { RelationshipTypeInput } from "@/lib/case-relationships-core";

// Mirrors `RELATIONSHIP_TYPES` from `@/lib/case-relationships-core`. Duplicated
// here (rather than imported) because that module pulls in server-only
// database access and must never be bundled into a client component.
const RELATIONSHIP_TYPE_OPTIONS: Array<{
  value: RelationshipTypeInput;
  label: (caseNumber: string) => string;
}> = [
  { value: "duplicate_of", label: (n) => `This is a duplicate of case #${n}` },
  { value: "related_to", label: (n) => `This is related to case #${n}` },
  { value: "parent_of", label: (n) => `This is the parent case of #${n}` },
  { value: "child_of", label: (n) => `This is the child case of #${n}` },
];

export type RelationshipRow = {
  id: string;
  relationshipType: RelationshipTypeInput;
  direction: "outgoing" | "incoming" | "symmetric";
  confidence: number | null;
  origin: "analyst" | "provider" | "rule";
  reason: string;
  createdAt: string;
  otherCase: {
    id: string;
    caseNumber: string;
    title: string;
    status: string;
    severity: string;
  };
};

export type MatchedSignalsRow = {
  titleSimilarity: number;
  sharedObservables: string[];
  sharedTags: string[];
  sharedVendors: string[];
};

export type SuggestionRow = {
  candidateCase: {
    id: string;
    caseNumber: string;
    title: string;
    status: string;
    severity: string;
  };
  score: number;
  matchedSignals: MatchedSignalsRow;
  suggestedType: "duplicate_of" | "related_to";
};

function originLabel(origin: RelationshipRow["origin"]) {
  if (origin === "analyst") return "Linked by analyst";
  if (origin === "rule") return "Suggested by rule";
  return "Linked by provider";
}

function explainSignals(signals: MatchedSignalsRow) {
  const parts: string[] = [];
  if (signals.titleSimilarity >= 0.5) parts.push("Similar title");
  if (signals.sharedObservables.length > 0) {
    parts.push(
      `${signals.sharedObservables.length} shared observable${signals.sharedObservables.length === 1 ? "" : "s"}`,
    );
  }
  if (signals.sharedTags.length > 0) {
    parts.push(`${signals.sharedTags.length} shared tag${signals.sharedTags.length === 1 ? "" : "s"}`);
  }
  if (signals.sharedVendors.length > 0) {
    parts.push(
      `${signals.sharedVendors.length} shared vendor${signals.sharedVendors.length === 1 ? "" : "s"}`,
    );
  }
  return parts.length > 0 ? parts.join(", ") : "Matched by scoring heuristics";
}

export default function CaseRelationshipsPanel({
  caseId,
  relationships,
  suggestions,
  canEdit = true,
}: {
  caseId: string;
  relationships: RelationshipRow[];
  suggestions: SuggestionRow[];
  canEdit?: boolean;
}) {
  return (
    <>
      <div className="kelpie-card p-5 space-y-3">
        <div>
          <h2 className="text-sm font-medium text-slate-300">Related cases</h2>
          <p className="text-xs text-slate-500 mt-1">
            Confirmed links between this case and other cases in your organisation.
          </p>
        </div>
        {relationships.length === 0 ? (
          <p className="text-xs text-slate-500">No related cases have been linked yet.</p>
        ) : (
          <ul className="space-y-2">
            {relationships.map((relationship) => (
              <RelationshipItem
                key={relationship.id}
                caseId={caseId}
                relationship={relationship}
                canEdit={canEdit}
              />
            ))}
          </ul>
        )}
      </div>

      <div className="kelpie-card p-5 space-y-3">
        <div>
          <h2 className="text-sm font-medium text-slate-300">Possible duplicates &amp; related cases</h2>
          <p className="text-xs text-slate-500 mt-1">
            Suggested by scoring shared titles, observables, tags, and vendors.
          </p>
        </div>
        {!canEdit ? (
          <p className="text-xs text-slate-500">
            Read-only users cannot link or dismiss suggested cases.
          </p>
        ) : null}
        {suggestions.length === 0 ? (
          <p className="text-xs text-slate-500">No possible duplicates or related cases found.</p>
        ) : (
          <ul className="space-y-2">
            {suggestions.map((suggestion) => (
              <SuggestionItem
                key={suggestion.candidateCase.id}
                caseId={caseId}
                suggestion={suggestion}
                canEdit={canEdit}
              />
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function RelationshipItem({
  caseId,
  relationship,
  canEdit,
}: {
  caseId: string;
  relationship: RelationshipRow;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [formOpen, setFormOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);

  async function confirmUnlink() {
    const trimmedReason = reason.trim();
    if (!trimmedReason) return;
    setPending(true);
    try {
      await unlinkCase(caseId, relationship.id, trimmedReason);
      setConfirmOpen(false);
      setFormOpen(false);
      setReason("");
      toast.success(`Unlinked case #${relationship.otherCase.caseNumber}`);
      router.refresh();
    } catch (error) {
      toast.error("Could not unlink case", {
        description: feedbackError(error, "The link was not removed. Try again."),
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
            <RelationshipTypeBadge value={relationship.relationshipType} />
            <ConfidenceBadge value={relationship.confidence} />
          </div>
          <Link
            href={`/cases/${relationship.otherCase.id}`}
            className="kelpie-link text-sm font-medium block mt-1 truncate"
          >
            #{relationship.otherCase.caseNumber} — {relationship.otherCase.title}
          </Link>
          <div className="flex flex-wrap items-center gap-2 mt-1">
            <SeverityBadge value={relationship.otherCase.severity} />
            <StatusBadge value={relationship.otherCase.status} />
          </div>
          <p className="text-xs text-slate-500 mt-1">{originLabel(relationship.origin)}</p>
        </div>
        {canEdit ? (
          <button
            type="button"
            className="kelpie-btn kelpie-btn-danger kelpie-btn-sm shrink-0"
            onClick={() => setFormOpen((open) => !open)}
          >
            {formOpen ? "Cancel" : "Unlink"}
          </button>
        ) : null}
      </div>

      {formOpen ? (
        <form
          className="mt-3 space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!reason.trim()) return;
            setConfirmOpen(true);
          }}
        >
          <div className="kelpie-field">
            <label
              htmlFor={`unlink-reason-${relationship.id}`}
              className="kelpie-label"
            >
              Reason for unlinking
            </label>
            <textarea
              id={`unlink-reason-${relationship.id}`}
              className="kelpie-input"
              rows={2}
              required
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Why are these cases no longer linked?"
            />
          </div>
          <div className="flex justify-end">
            <button type="submit" className="kelpie-btn kelpie-btn-danger kelpie-btn-sm" disabled={pending}>
              Unlink case
            </button>
          </div>
        </form>
      ) : null}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          setConfirmOpen(open);
          if (!open) setPending(false);
        }}
        title={`Unlink case #${relationship.otherCase.caseNumber}?`}
        description={`This removes the ${relationship.relationshipType.replace(/_/g, " ")} relationship between these cases. Reason: ${reason.trim() || "(none entered)"}`}
        confirmLabel="Unlink case"
        pending={pending}
        tone="danger"
        onConfirm={() => void confirmUnlink()}
      />
    </li>
  );
}

function SuggestionItem({
  caseId,
  suggestion,
  canEdit,
}: {
  caseId: string;
  suggestion: SuggestionRow;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [activeForm, setActiveForm] = useState<"dismiss" | "link" | null>(null);
  const [dismissReason, setDismissReason] = useState("");
  const [dismissConfirmOpen, setDismissConfirmOpen] = useState(false);
  const [dismissPending, setDismissPending] = useState(false);

  const [linkType, setLinkType] = useState<RelationshipTypeInput>(suggestion.suggestedType);
  const [linkReason, setLinkReason] = useState("");
  const [linkConfirmOpen, setLinkConfirmOpen] = useState(false);
  const [linkPending, setLinkPending] = useState(false);

  async function confirmDismiss() {
    const trimmedReason = dismissReason.trim();
    if (!trimmedReason) return;
    setDismissPending(true);
    try {
      await dismissSuggestion(caseId, suggestion.candidateCase.id, trimmedReason);
      setDismissConfirmOpen(false);
      setActiveForm(null);
      setDismissReason("");
      toast.success(`Dismissed suggestion for #${suggestion.candidateCase.caseNumber}`);
      router.refresh();
    } catch (error) {
      toast.error("Could not dismiss suggestion", {
        description: feedbackError(error, "The suggestion is still open. Try again."),
      });
    } finally {
      setDismissPending(false);
    }
  }

  async function confirmLink() {
    const trimmedReason = linkReason.trim();
    if (!trimmedReason) return;
    setLinkPending(true);
    try {
      await linkCases(caseId, suggestion.candidateCase.id, linkType, trimmedReason);
      setLinkConfirmOpen(false);
      setActiveForm(null);
      setLinkReason("");
      toast.success(`Linked to case #${suggestion.candidateCase.caseNumber}`);
      router.refresh();
    } catch (error) {
      toast.error("Could not link cases", {
        description: feedbackError(error, "The cases were not linked. Try again."),
      });
    } finally {
      setLinkPending(false);
    }
  }

  return (
    <li className="rounded border border-[color:var(--color-navy-700)] p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link
            href={`/cases/${suggestion.candidateCase.id}`}
            className="kelpie-link text-sm font-medium block truncate"
          >
            #{suggestion.candidateCase.caseNumber} — {suggestion.candidateCase.title}
          </Link>
          <div className="flex flex-wrap items-center gap-2 mt-1">
            <SeverityBadge value={suggestion.candidateCase.severity} />
            <StatusBadge value={suggestion.candidateCase.status} />
            <span className="kelpie-badge text-slate-300">{suggestion.score}% match</span>
          </div>
          <p className="text-xs text-slate-500 mt-1">{explainSignals(suggestion.matchedSignals)}</p>
        </div>
        {canEdit ? (
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              className="kelpie-btn kelpie-btn-ghost kelpie-btn-sm"
              onClick={() => setActiveForm(activeForm === "dismiss" ? null : "dismiss")}
            >
              {activeForm === "dismiss" ? "Cancel" : "Dismiss"}
            </button>
            <button
              type="button"
              className="kelpie-btn kelpie-btn-primary kelpie-btn-sm"
              onClick={() => setActiveForm(activeForm === "link" ? null : "link")}
            >
              {activeForm === "link" ? "Cancel" : "Link"}
            </button>
          </div>
        ) : null}
      </div>

      {activeForm === "dismiss" ? (
        <form
          className="mt-3 space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!dismissReason.trim()) return;
            setDismissConfirmOpen(true);
          }}
        >
          <div className="kelpie-field">
            <label
              htmlFor={`dismiss-reason-${suggestion.candidateCase.id}`}
              className="kelpie-label"
            >
              Reason for dismissing
            </label>
            <textarea
              id={`dismiss-reason-${suggestion.candidateCase.id}`}
              className="kelpie-input"
              rows={2}
              required
              value={dismissReason}
              onChange={(event) => setDismissReason(event.target.value)}
              placeholder="Why isn't this a match?"
            />
          </div>
          <div className="flex justify-end">
            <button
              type="submit"
              className="kelpie-btn kelpie-btn-secondary kelpie-btn-sm"
              disabled={dismissPending}
            >
              Dismiss suggestion
            </button>
          </div>
        </form>
      ) : null}

      {activeForm === "link" ? (
        <form
          className="mt-3 space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!linkReason.trim()) return;
            setLinkConfirmOpen(true);
          }}
        >
          <div className="kelpie-field">
            <span className="kelpie-label">Relationship type</span>
            <div className="space-y-1">
              {RELATIONSHIP_TYPE_OPTIONS.map((option) => (
                <label key={option.value} className="flex items-center gap-2 text-sm text-slate-300">
                  <input
                    type="radio"
                    className="kelpie-checkbox"
                    name={`link-type-${suggestion.candidateCase.id}`}
                    value={option.value}
                    checked={linkType === option.value}
                    onChange={() => setLinkType(option.value)}
                  />
                  {option.label(suggestion.candidateCase.caseNumber)}
                </label>
              ))}
            </div>
          </div>
          <div className="kelpie-field">
            <label
              htmlFor={`link-reason-${suggestion.candidateCase.id}`}
              className="kelpie-label"
            >
              Reason for linking
            </label>
            <textarea
              id={`link-reason-${suggestion.candidateCase.id}`}
              className="kelpie-input"
              rows={2}
              required
              value={linkReason}
              onChange={(event) => setLinkReason(event.target.value)}
              placeholder="What makes these cases the same or related?"
            />
          </div>
          <div className="flex justify-end">
            <button
              type="submit"
              className="kelpie-btn kelpie-btn-primary kelpie-btn-sm"
              disabled={linkPending}
            >
              Link cases
            </button>
          </div>
        </form>
      ) : null}

      <ConfirmDialog
        open={dismissConfirmOpen}
        onOpenChange={(open) => {
          setDismissConfirmOpen(open);
          if (!open) setDismissPending(false);
        }}
        title={`Dismiss suggestion for #${suggestion.candidateCase.caseNumber}?`}
        description={`This case will no longer be suggested as a duplicate or related case. Reason: ${dismissReason.trim() || "(none entered)"}`}
        confirmLabel="Dismiss suggestion"
        pending={dismissPending}
        tone="warning"
        onConfirm={() => void confirmDismiss()}
      />

      <ConfirmDialog
        open={linkConfirmOpen}
        onOpenChange={(open) => {
          setLinkConfirmOpen(open);
          if (!open) setLinkPending(false);
        }}
        title={`Link to case #${suggestion.candidateCase.caseNumber}?`}
        description={`${RELATIONSHIP_TYPE_OPTIONS.find((o) => o.value === linkType)?.label(suggestion.candidateCase.caseNumber) ?? ""}. Reason: ${linkReason.trim() || "(none entered)"}`}
        confirmLabel="Link cases"
        pending={linkPending}
        tone="warning"
        onConfirm={() => void confirmLink()}
      />
    </li>
  );
}
