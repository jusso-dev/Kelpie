import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { format } from "date-fns";
import Link from "next/link";
import { requireUser } from "@/lib/session";
import { uploadAttachment, overrideEvidenceQuarantine } from "@/actions/attachments";
import { listEvidenceForCase } from "@/lib/evidence/core";
import { listCollectionsForCase } from "@/lib/evidence/collections";
import { listLegalHoldsForCase } from "@/lib/evidence/legal-hold";
import { EvidenceStatusBadge, EvidenceRelevanceBadge } from "@/components/evidence/status-badge";
import { ReasonedActionButton } from "@/components/evidence/reasoned-action-button";
import { CollectionsPanel } from "@/components/evidence/collections-panel";
import { LegalHoldPanel, type LegalHoldRow } from "@/components/evidence/legal-hold-panel";

type Props = { params: Promise<{ id: string }> };

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function CaseAttachmentsPage({ params }: Props) {
  const { id } = await params;
  const user = await requireUser();
  const canEdit = user.role === "admin" || user.role === "analyst";
  const isAdmin = user.role === "admin";

  const [rows, collections, holds, orgUsers] = await Promise.all([
    listEvidenceForCase(id, user.organisationId),
    listCollectionsForCase(id, user.organisationId),
    listLegalHoldsForCase(id, user.organisationId),
    db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(eq(users.organisationId, user.organisationId)),
  ]);

  const usersById = new Map(orgUsers.map((u) => [u.id, u.name]));
  const collectionsById = new Map(collections.map((c) => [c.id, c.name]));
  const evidenceLabelById = Object.fromEntries(
    rows.map((r) => [r.id, r.filename]),
  );

  const holdRows: LegalHoldRow[] = holds.map((h) => ({
    id: h.id,
    caseId: h.caseId,
    evidenceId: h.evidenceId,
    reason: h.reason,
    appliedByName: h.appliedBy ? usersById.get(h.appliedBy) ?? null : null,
    appliedAt: h.appliedAt.toISOString(),
    releasedByName: h.releasedBy ? usersById.get(h.releasedBy) ?? null : null,
    releasedAt: h.releasedAt ? h.releasedAt.toISOString() : null,
    releaseReason: h.releaseReason,
  }));

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div className="md:col-span-2 space-y-4">
        <div className="kelpie-card kelpie-scroll-x" tabIndex={0} aria-label="Attachments table">
          <table className="kelpie-table">
            <thead>
              <tr>
                <th>File</th>
                <th>Status</th>
                <th>Relevance</th>
                <th>Collection</th>
                <th>Size</th>
                <th>SHA256</th>
                <th>Uploaded</th>
                <th>
                  <span className="kelpie-sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center text-slate-500 py-8">
                    No attachments yet.
                  </td>
                </tr>
              ) : (
                rows.map((a) => (
                  <tr key={a.id}>
                    <td>
                      {a.status === "available" ? (
                        <a href={`/api/attachments/${a.id}`} className="kelpie-link">
                          {a.filename}
                        </a>
                      ) : (
                        <span className="text-slate-300">{a.filename}</span>
                      )}
                      <div className="text-xs text-slate-500">{a.contentType}</div>
                    </td>
                    <td>
                      <EvidenceStatusBadge status={a.status} />
                      {a.status === "quarantined" || a.status === "scan_failed" ? (
                        <p className="mt-1 text-xs text-slate-500">
                          {a.scanDetail ?? "Blocked pending review."}
                        </p>
                      ) : null}
                      {isAdmin && (a.status === "quarantined" || a.status === "scan_failed") ? (
                        <div className="mt-2">
                          <ReasonedActionButton
                            action={(reason) => overrideEvidenceQuarantine(id, a.id, reason)}
                            title={`Override quarantine on ${a.filename}?`}
                            description="This makes the file downloadable despite the scan result. This is recorded in the chain of custody."
                            confirmLabel="Override quarantine"
                            triggerLabel="Override quarantine"
                            reasonLabel="Reason for override"
                            reasonPlaceholder="Why is this safe to release?"
                            successTitle="Quarantine overridden"
                            tone="warning"
                            className="kelpie-btn kelpie-btn-secondary kelpie-btn-sm"
                          />
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <EvidenceRelevanceBadge relevance={a.relevance} />
                    </td>
                    <td className="text-xs text-slate-400">
                      {a.collectionId ? collectionsById.get(a.collectionId) ?? "—" : "—"}
                    </td>
                    <td className="text-slate-300 tabular-nums">{formatSize(a.sizeBytes)}</td>
                    <td className="font-mono text-xs text-slate-500">{a.sha256.slice(0, 16)}...</td>
                    <td className="text-xs text-slate-400">
                      {format(a.uploadedAt, "PP p")}
                      <div className="text-slate-500">
                        {a.uploadedBy ? usersById.get(a.uploadedBy) ?? "Unknown" : "Unknown"}
                      </div>
                    </td>
                    <td>
                      <Link
                        href={`/cases/${id}/attachments/${a.id}`}
                        className="kelpie-btn kelpie-btn-ghost kelpie-btn-sm"
                      >
                        Details
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      <div className="space-y-4">
        {canEdit ? (
          <form action={uploadAttachment} className="kelpie-card p-5 space-y-3">
            <input type="hidden" name="caseId" value={id} />
            <h2 className="text-sm font-medium text-slate-300">Upload a file</h2>
            <label htmlFor="attachment-file" className="kelpie-sr-only">
              File
            </label>
            <input
              id="attachment-file"
              name="file"
              type="file"
              required
              className="block w-full text-sm text-slate-300 file:mr-2 file:px-3 file:py-1 file:rounded file:border-0 file:bg-[color:var(--color-navy-700)] file:text-slate-200"
            />
            <p className="text-xs text-slate-500">
              Max 25 MB. Stored locally by default; configure S3 for production. New
              uploads are scanned before they become downloadable.
            </p>
            <button className="kelpie-btn kelpie-btn-primary w-full justify-center">
              Upload
            </button>
          </form>
        ) : null}

        <CollectionsPanel caseId={id} collections={collections} canEdit={canEdit} />

        <LegalHoldPanel
          caseId={id}
          holds={holdRows}
          canManage={isAdmin}
          evidenceLabelById={evidenceLabelById}
        />
      </div>
    </div>
  );
}
