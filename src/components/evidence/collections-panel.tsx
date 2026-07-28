"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { feedbackError } from "@/components/confirm-dialog";
import {
  createEvidenceCollection,
  addEvidenceToCollection,
  removeEvidenceFromCollection,
} from "@/actions/attachments";

export type CollectionRow = {
  id: string;
  name: string;
  description: string | null;
};

export function CollectionsPanel({
  caseId,
  collections,
  canEdit,
}: {
  caseId: string;
  collections: CollectionRow[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [pending, setPending] = useState(false);

  async function create() {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    setPending(true);
    try {
      await createEvidenceCollection(caseId, trimmedName, description.trim() || null);
      setName("");
      setDescription("");
      toast.success(`Collection "${trimmedName}" created`);
      router.refresh();
    } catch (error) {
      toast.error("Could not create collection", {
        description: feedbackError(error, "The collection was not created. Try again."),
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="kelpie-card p-5 space-y-3">
      <h2 className="text-sm font-medium text-slate-300">Collections</h2>
      {collections.length === 0 ? (
        <p className="text-xs text-slate-500">No collections yet.</p>
      ) : (
        <ul className="space-y-1">
          {collections.map((c) => (
            <li key={c.id} className="kelpie-chip w-full justify-start">
              <div className="min-w-0">
                <p className="truncate text-sm text-slate-200">{c.name}</p>
                {c.description ? (
                  <p className="truncate text-xs text-slate-500">{c.description}</p>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      {canEdit ? (
        <form
          className="space-y-2 border-t border-[color:var(--color-navy-700)] pt-3"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <div className="kelpie-field">
            <label htmlFor="new-collection-name" className="kelpie-label">
              New collection name
            </label>
            <input
              id="new-collection-name"
              className="kelpie-input"
              required
              value={name}
              disabled={pending}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. host triage"
            />
          </div>
          <div className="kelpie-field">
            <label htmlFor="new-collection-description" className="kelpie-label">
              Description (optional)
            </label>
            <input
              id="new-collection-description"
              className="kelpie-input"
              value={description}
              disabled={pending}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <button
            type="submit"
            className="kelpie-btn kelpie-btn-secondary kelpie-btn-sm w-full justify-center"
            disabled={pending || !name.trim()}
          >
            {pending ? "Creating…" : "Create collection"}
          </button>
        </form>
      ) : null}
    </div>
  );
}

export function EvidenceCollectionSelect({
  caseId,
  evidenceId,
  collectionId,
  collections,
  canEdit,
}: {
  caseId: string;
  evidenceId: string;
  collectionId: string | null;
  collections: CollectionRow[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function change(value: string) {
    setPending(true);
    try {
      if (value) {
        await addEvidenceToCollection(caseId, value, evidenceId);
      } else {
        await removeEvidenceFromCollection(caseId, evidenceId);
      }
      toast.success("Collection updated");
      router.refresh();
    } catch (error) {
      toast.error("Could not update collection", {
        description: feedbackError(error, "Nothing changed. Try again."),
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="kelpie-field">
      <label htmlFor="evidence-collection" className="kelpie-label">
        Collection
      </label>
      <select
        id="evidence-collection"
        className="kelpie-input"
        defaultValue={collectionId ?? ""}
        disabled={!canEdit || pending || collections.length === 0}
        onChange={(event) => void change(event.target.value)}
      >
        <option value="">No collection</option>
        {collections.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      {collections.length === 0 ? (
        <p className="text-xs text-slate-500">
          No collections exist for this case yet.
        </p>
      ) : null}
    </div>
  );
}
