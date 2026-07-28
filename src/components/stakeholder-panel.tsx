"use client";

import { useState, useTransition } from "react";
import {
  inviteStakeholderAction,
  revokeStakeholderInviteAction,
  publishStakeholderUpdateAction,
  createEvidenceRequestAction,
  createApprovalRequestAction,
  previewStakeholderViewAction,
} from "@/actions/stakeholder";
import type { StakeholderRole, StakeholderTlp, StakeholderPap } from "@/lib/stakeholder/types";

type InviteRow = {
  id: string;
  role: string;
  purpose: string;
  status: string;
  maxTlp: string;
  maxPap: string;
  expiresAt: string;
  collaboratorEmail: string;
  collaboratorName: string;
  singleUse: boolean;
  createdAt: string;
};

type Contribution = {
  id: string;
  body: string;
  createdAt: string;
  attribution: string;
  email: string;
  source: "external";
};

export default function StakeholderPanel({
  caseId,
  initialInvites,
  contributions,
  canWrite,
}: {
  caseId: string;
  initialInvites: InviteRow[];
  contributions: Contribution[];
  canWrite: boolean;
}) {
  const [invites, setInvites] = useState(initialInvites);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [tokenOnce, setTokenOnce] = useState<string | null>(null);
  const [previewJson, setPreviewJson] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [role, setRole] = useState<StakeholderRole>("update_reader");
  const [maxTlp, setMaxTlp] = useState<StakeholderTlp>("amber");
  const [maxPap, setMaxPap] = useState<StakeholderPap>("amber");

  const [updateTitle, setUpdateTitle] = useState("");
  const [updateBody, setUpdateBody] = useState("");

  function refreshInvites(next: InviteRow[]) {
    setInvites(next);
  }

  return (
    <section className="space-y-4 rounded-lg border border-slate-800 bg-slate-950/40 p-4">
      <header>
        <h2 className="text-sm font-semibold text-slate-100">
          Stakeholder portal
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          Case-scoped external access for owners, vendors, legal, and customers.
          External sessions are separate from staff accounts.
        </p>
      </header>

      {error && (
        <p className="text-xs text-rose-400" role="alert">
          {error}
        </p>
      )}

      {tokenOnce && (
        <div className="rounded border border-amber-700/50 bg-amber-950/30 p-3 text-xs text-amber-100">
          <p className="font-medium">Invite token (shown once)</p>
          <code className="mt-1 block break-all">{tokenOnce}</code>
          <p className="mt-2 text-amber-200/80">
            Share via secure channel. Portal accept URL:{" "}
            <code>/portal?token=…</code>
          </p>
          <button
            type="button"
            className="mt-2 text-amber-300 underline"
            onClick={() => setTokenOnce(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {canWrite && (
        <form
          className="grid gap-2 rounded border border-slate-800 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            startTransition(async () => {
              const res = await inviteStakeholderAction({
                caseId,
                email,
                displayName,
                role,
                purpose,
                maxTlp,
                maxPap,
              });
              if (!res.ok) {
                setError(res.error);
                return;
              }
              setTokenOnce(res.token);
              setEmail("");
              setDisplayName("");
              setPurpose("");
              setInvites((prev) => [
                {
                  id: res.invitationId,
                  role,
                  purpose,
                  status: "pending",
                  maxTlp,
                  maxPap,
                  expiresAt: res.expiresAt,
                  collaboratorEmail: email,
                  collaboratorName: displayName,
                  singleUse: true,
                  createdAt: new Date().toISOString(),
                },
                ...prev,
              ]);
            });
          }}
        >
          <p className="text-xs font-medium text-slate-300">New invitation</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              className="kelpie-input"
              placeholder="Email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <input
              className="kelpie-input"
              placeholder="Display name"
              required
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>
          <input
            className="kelpie-input"
            placeholder="Purpose (why they need access)"
            required
            minLength={3}
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
          />
          <div className="grid gap-2 sm:grid-cols-3">
            <select
              className="kelpie-input"
              value={role}
              onChange={(e) => setRole(e.target.value as StakeholderRole)}
              aria-label="Role template"
            >
              <option value="update_reader">Update reader</option>
              <option value="evidence_provider">Evidence provider</option>
              <option value="respondent">Respondent</option>
              <option value="approver">Approver</option>
            </select>
            <select
              className="kelpie-input"
              value={maxTlp}
              onChange={(e) => setMaxTlp(e.target.value as StakeholderTlp)}
              aria-label="Max TLP"
            >
              {["clear", "green", "amber", "amber_strict", "red"].map((t) => (
                <option key={t} value={t}>
                  Max TLP:{t}
                </option>
              ))}
            </select>
            <select
              className="kelpie-input"
              value={maxPap}
              onChange={(e) => setMaxPap(e.target.value as StakeholderPap)}
              aria-label="Max PAP"
            >
              {["clear", "green", "amber", "red"].map((t) => (
                <option key={t} value={t}>
                  Max PAP:{t}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            disabled={pending}
            className="kelpie-btn-primary w-fit text-xs"
          >
            Create invite
          </button>
        </form>
      )}

      <div className="space-y-2">
        <p className="text-xs font-medium text-slate-300">Invitations</p>
        {invites.length === 0 && (
          <p className="text-xs text-slate-500">No invitations yet.</p>
        )}
        <ul className="space-y-2">
          {invites.map((inv) => (
            <li
              key={inv.id}
              className="rounded border border-slate-800 p-2 text-xs text-slate-300"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <strong className="text-slate-100">{inv.collaboratorName}</strong>{" "}
                  &lt;{inv.collaboratorEmail}&gt; · {inv.role} ·{" "}
                  <span className="uppercase">{inv.status}</span>
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="text-sky-400 underline"
                    onClick={() => {
                      setError(null);
                      startTransition(async () => {
                        const res = await previewStakeholderViewAction({
                          invitationId: inv.id,
                          caseId,
                        });
                        if (!res.ok) {
                          setError(res.error);
                          return;
                        }
                        setPreviewJson(JSON.stringify(res.view, null, 2));
                      });
                    }}
                  >
                    Preview external view
                  </button>
                  {canWrite && inv.status !== "revoked" && (
                    <button
                      type="button"
                      className="text-rose-400 underline"
                      onClick={() => {
                        setError(null);
                        startTransition(async () => {
                          const res = await revokeStakeholderInviteAction({
                            invitationId: inv.id,
                            caseId,
                            reason: "Revoked by analyst",
                          });
                          if (!res.ok) {
                            setError(res.error);
                            return;
                          }
                          refreshInvites(
                            invites.map((i) =>
                              i.id === inv.id
                                ? { ...i, status: "revoked" }
                                : i,
                            ),
                          );
                        });
                      }}
                    >
                      Revoke
                    </button>
                  )}
                </div>
              </div>
              <p className="mt-1 text-slate-500">
                {inv.purpose} · ceiling TLP:{inv.maxTlp} PAP:{inv.maxPap} ·
                expires {new Date(inv.expiresAt).toLocaleString()}
              </p>
              {canWrite &&
                inv.status !== "revoked" &&
                inv.status !== "expired" &&
                inv.role === "evidence_provider" && (
                  <button
                    type="button"
                    className="mt-1 text-slate-400 underline"
                    onClick={() => {
                      startTransition(async () => {
                        const res = await createEvidenceRequestAction({
                          caseId,
                          invitationId: inv.id,
                          title: "Please upload requested evidence",
                          instructions:
                            "Attach the files requested by the analyst. Uploads are scanned before release.",
                        });
                        if (!res.ok) setError(res.error);
                      });
                    }}
                  >
                    Request evidence
                  </button>
                )}
              {canWrite &&
                inv.status !== "revoked" &&
                inv.status !== "expired" &&
                inv.role === "approver" && (
                  <button
                    type="button"
                    className="mt-1 ml-2 text-slate-400 underline"
                    onClick={() => {
                      startTransition(async () => {
                        const res = await createApprovalRequestAction({
                          caseId,
                          invitationId: inv.id,
                          title: "Approve next response step",
                          description:
                            "Please review the shared update and approve or reject the proposed action.",
                        });
                        if (!res.ok) setError(res.error);
                      });
                    }}
                  >
                    Request approval
                  </button>
                )}
            </li>
          ))}
        </ul>
      </div>

      {canWrite && (
        <form
          className="grid gap-2 rounded border border-slate-800 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            startTransition(async () => {
              const res = await publishStakeholderUpdateAction({
                caseId,
                title: updateTitle,
                body: updateBody,
                tlp: maxTlp,
                pap: maxPap,
              });
              if (!res.ok) {
                setError(res.error);
                return;
              }
              setUpdateTitle("");
              setUpdateBody("");
            });
          }}
        >
          <p className="text-xs font-medium text-slate-300">
            Publish stakeholder update
          </p>
          <input
            className="kelpie-input"
            placeholder="Title"
            required
            value={updateTitle}
            onChange={(e) => setUpdateTitle(e.target.value)}
          />
          <textarea
            className="kelpie-input min-h-[72px]"
            placeholder="Update body visible to invited stakeholders (within TLP/PAP ceiling)"
            required
            value={updateBody}
            onChange={(e) => setUpdateBody(e.target.value)}
          />
          <button
            type="submit"
            disabled={pending}
            className="kelpie-btn-primary w-fit text-xs"
          >
            Publish update
          </button>
        </form>
      )}

      {contributions.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-slate-300">
            External contributions
          </p>
          <ul className="space-y-2">
            {contributions.map((c) => (
              <li
                key={c.id}
                className="rounded border border-violet-800/50 bg-violet-950/20 p-2 text-xs"
              >
                <div className="flex items-center gap-2 text-violet-200">
                  <span className="rounded bg-violet-900/60 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                    External
                  </span>
                  <span>{c.attribution}</span>
                  <span className="text-slate-500">
                    {new Date(c.createdAt).toLocaleString()}
                  </span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-slate-200">
                  {c.body}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {previewJson && (
        <div className="rounded border border-sky-800/40 bg-sky-950/20 p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-sky-200">
              Analyst preview (exact external view)
            </p>
            <button
              type="button"
              className="text-xs text-sky-400 underline"
              onClick={() => setPreviewJson(null)}
            >
              Close
            </button>
          </div>
          <pre className="mt-2 max-h-80 overflow-auto text-[10px] text-sky-100/90">
            {previewJson}
          </pre>
        </div>
      )}
    </section>
  );
}
