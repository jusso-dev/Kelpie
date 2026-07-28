"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Bookmark, ChevronDown, Copy, Save, Star, Trash2 } from "lucide-react";
import {
  createCaseViewAction,
  deleteCaseViewAction,
  duplicateCaseViewAction,
  setCaseViewDefaultAction,
  updateCaseViewAction,
} from "@/actions/case-views";
import { ConfirmDialog } from "@/components/confirm-dialog";
import type { CaseViewConfig, CaseViewVisibility } from "@/lib/case-views/config";

export type SwitcherView = {
  id: string;
  name: string;
  visibility: CaseViewVisibility;
  teamId: string | null;
  count?: number;
  isDefault?: boolean;
  canWrite: boolean;
  href: string;
};

type TeamOption = { id: string; name: string };

/**
 * Compact saved-view switcher for the cases page: pick a view, save current
 * filters, duplicate/delete, and set personal default.
 */
export function CaseViewSwitcher({
  views,
  activeViewId,
  isDirty,
  currentConfig,
  teams,
  canWrite,
  isAdmin,
}: {
  views: SwitcherView[];
  activeViewId?: string;
  isDirty: boolean;
  currentConfig: CaseViewConfig;
  teams: TeamOption[];
  canWrite: boolean;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [menuOpen, setMenuOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState<CaseViewVisibility>("personal");
  const [teamId, setTeamId] = useState(teams[0]?.id ?? "");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const active = views.find((v) => v.id === activeViewId);

  function handleSaveAs() {
    if (!name.trim()) {
      toast.warning("Enter a name for this view");
      return;
    }
    start(async () => {
      const result = await createCaseViewAction({
        name: name.trim(),
        visibility,
        teamId: visibility === "team" ? teamId : null,
        config: currentConfig,
      });
      if (!result.ok) {
        toast.error("Could not save view", { description: result.error });
        return;
      }
      toast.success("View saved");
      setSaveOpen(false);
      setName("");
      setMenuOpen(false);
      router.push(`/cases?savedView=${result.id}`);
      router.refresh();
    });
  }

  function handleUpdateActive() {
    if (!activeViewId || !active?.canWrite) return;
    start(async () => {
      const result = await updateCaseViewAction({
        id: activeViewId,
        config: currentConfig,
      });
      if (!result.ok) {
        toast.error("Could not update view", { description: result.error });
        return;
      }
      toast.success("View updated");
      router.refresh();
    });
  }

  function handleDuplicate(viewId: string) {
    start(async () => {
      const result = await duplicateCaseViewAction({ id: viewId });
      if (!result.ok) {
        toast.error("Could not duplicate view", { description: result.error });
        return;
      }
      toast.success("View duplicated");
      router.push(`/cases?savedView=${result.id}`);
      router.refresh();
    });
  }

  function handleSetDefault(viewId: string | null) {
    start(async () => {
      const result = await setCaseViewDefaultAction({
        scope: "personal",
        viewId,
      });
      if (!result.ok) {
        toast.error("Could not set default", { description: result.error });
        return;
      }
      toast.success(viewId ? "Default view set" : "Default view cleared");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative">
        <button
          type="button"
          className="kelpie-btn kelpie-btn-secondary"
          aria-haspopup="listbox"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <Bookmark size={16} aria-hidden="true" />
          <span className="max-w-[12rem] truncate">
            {active ? active.name : "Saved views"}
          </span>
          {isDirty && active ? (
            <span
              className="text-[color:var(--color-tan-300)]"
              title="Filters differ from saved view"
            >
              *
            </span>
          ) : null}
          <ChevronDown size={14} aria-hidden="true" />
        </button>
        {menuOpen ? (
          <div
            className="absolute left-0 z-30 mt-1 w-72 max-w-[calc(100vw-2rem)] rounded-md border border-[color:var(--color-navy-700)] bg-[color:var(--color-navy-900)] p-1 shadow-lg"
            role="listbox"
            aria-label="Saved case views"
          >
            <Link
              href="/cases"
              className="block rounded px-3 py-2 text-sm text-slate-300 hover:bg-[color:var(--color-navy-800)]"
              onClick={() => setMenuOpen(false)}
            >
              Standard list
            </Link>
            {views.length === 0 ? (
              <p className="px-3 py-2 text-xs text-slate-500">No saved views yet.</p>
            ) : (
              views.map((view) => (
                <div
                  key={view.id}
                  className={
                    "flex items-center gap-1 rounded px-1 " +
                    (view.id === activeViewId
                      ? "bg-[color:var(--color-navy-800)]"
                      : "hover:bg-[color:var(--color-navy-800)]")
                  }
                >
                  <Link
                    href={view.href}
                    className="min-w-0 flex-1 truncate px-2 py-2 text-sm text-slate-200"
                    onClick={() => setMenuOpen(false)}
                    role="option"
                    aria-selected={view.id === activeViewId}
                  >
                    <span className="block truncate">{view.name}</span>
                    <span className="block text-[10px] uppercase tracking-wide text-slate-500">
                      {view.visibility}
                      {view.count !== undefined ? ` · ${view.count}` : ""}
                      {view.isDefault ? " · default" : ""}
                    </span>
                  </Link>
                  <button
                    type="button"
                    className="kelpie-btn kelpie-btn-ghost p-2"
                    aria-label={
                      view.isDefault
                        ? `Clear default for ${view.name}`
                        : `Set ${view.name} as default`
                    }
                    title="Personal default"
                    disabled={pending}
                    onClick={() =>
                      handleSetDefault(view.isDefault ? null : view.id)
                    }
                  >
                    <Star
                      size={14}
                      className={
                        view.isDefault
                          ? "fill-[color:var(--color-tan-300)] text-[color:var(--color-tan-300)]"
                          : "text-slate-500"
                      }
                      aria-hidden="true"
                    />
                  </button>
                  {canWrite ? (
                    <button
                      type="button"
                      className="kelpie-btn kelpie-btn-ghost p-2"
                      aria-label={`Duplicate ${view.name}`}
                      disabled={pending}
                      onClick={() => handleDuplicate(view.id)}
                    >
                      <Copy size={14} aria-hidden="true" />
                    </button>
                  ) : null}
                  {view.canWrite ? (
                    <button
                      type="button"
                      className="kelpie-btn kelpie-btn-ghost p-2 text-rose-300"
                      aria-label={`Delete ${view.name}`}
                      disabled={pending}
                      onClick={() => setDeleteId(view.id)}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
              ))
            )}
          </div>
        ) : null}
      </div>

      {canWrite ? (
        <>
          <button
            type="button"
            className="kelpie-btn kelpie-btn-secondary"
            disabled={pending}
            onClick={() => {
              setSaveOpen((o) => !o);
              setMenuOpen(false);
            }}
          >
            <Save size={16} aria-hidden="true" />
            Save view
          </button>
          {active && active.canWrite && isDirty ? (
            <button
              type="button"
              className="kelpie-btn kelpie-btn-ghost"
              disabled={pending}
              onClick={handleUpdateActive}
            >
              Update current
            </button>
          ) : null}
        </>
      ) : null}

      {saveOpen ? (
        <div className="kelpie-panel flex w-full flex-col gap-3 p-4 sm:max-w-md">
          <label className="text-xs font-medium text-slate-300">
            Name
            <input
              className="kelpie-input mt-1"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My high-priority queue"
              maxLength={120}
            />
          </label>
          <label className="text-xs font-medium text-slate-300">
            Visibility
            <select
              className="kelpie-input mt-1"
              value={visibility}
              onChange={(e) =>
                setVisibility(e.target.value as CaseViewVisibility)
              }
            >
              <option value="personal">Personal</option>
              {teams.length > 0 ? <option value="team">Team</option> : null}
              {isAdmin ? (
                <option value="organisation">Organisation</option>
              ) : null}
            </select>
          </label>
          {visibility === "team" ? (
            <label className="text-xs font-medium text-slate-300">
              Team
              <select
                className="kelpie-input mt-1"
                value={teamId}
                onChange={(e) => setTeamId(e.target.value)}
              >
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="kelpie-btn kelpie-btn-primary"
              disabled={pending}
              onClick={handleSaveAs}
            >
              Save
            </button>
            <button
              type="button"
              className="kelpie-btn kelpie-btn-ghost"
              onClick={() => setSaveOpen(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={deleteId !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteId(null);
        }}
        title="Delete saved view?"
        description="Are you sure? This removes the saved view for everyone who could see it. Case data is not affected."
        confirmLabel="Delete view"
        pending={pending}
        onConfirm={() => {
          if (!deleteId) return;
          const id = deleteId;
          start(async () => {
            const result = await deleteCaseViewAction(id);
            if (!result.ok) {
              toast.error("Could not delete view", { description: result.error });
              return;
            }
            toast.success("View deleted");
            setDeleteId(null);
            if (activeViewId === id) {
              router.push("/cases");
            }
            router.refresh();
          });
        }}
      />
    </div>
  );
}
