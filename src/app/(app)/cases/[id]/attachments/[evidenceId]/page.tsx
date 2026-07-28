import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { format } from "date-fns";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session";
import {
  getEvidenceInOrg,
  listCustodyEventsForEvidence,
} from "@/lib/evidence/core";
import { listCollectionsForCase } from "@/lib/evidence/collections";
import { listLegalHoldsForCase } from "@/lib/evidence/legal-hold";
import {
  overrideEvidenceQuarantine,
  deleteEvidence,
} from "@/actions/attachments";
import { EvidenceStatusBadge } from "@/components/evidence/status-badge";
import { EvidenceEditor } from "@/components/evidence/evidence-editor";
import { EvidenceCollectionSelect } from "@/components/evidence/collections-panel";
import { LegalHoldPanel, type LegalHoldRow } from "@/components/evidence/legal-hold-panel";
import { ReasonedActionButton } from "@/components/evidence/reasoned-action-button";
import { CustodyLog, type CustodyEventRow } from "@/components/evidence/custody-log";

type Props = { params: Promise<{ id: string; evidenceId: string }> };

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function EvidenceDetailPage({ params }: Props) {
  const { id, evidenceId } = await params;
  const user = await requireUser();
  const canEdit = user.role === "admin" || user.role === "analyst";
  const isAdmin = user.role === "admin";

  const evidence = await getEvidenceInOrg(evidenceId, user.organisationId);
  if (!evidence || evidence.caseId !== id) notFound();

  const [custodyEvents, collections, holds, orgUsers] = await Promise.all([
    listCustodyEventsForEvidence(evidenceId, user.organisationId),
    listCollectionsForCase(id, user.organisationId),
    listLegalHoldsForCase(id, user.organisationId),
    db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(eq(users.organisationId, user.organisationId)),
  ]);

  const usersById = new Map(orgUsers.map((u) => [u.id, u.name]));

  const custodyRows: CustodyEventRow[] = custodyEvents.map((event) => ({
    id: event.id,
    eventType: event.eventType,
    reason: event.reason,
    payload: event.payload,
    occurredAt: event.occurredAt,
    actorName: event.actorId ? usersById.get(event.actorId) ?? null : null,
  }));

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

  const underHold = holdRows.some(
    (h) => !h.releasedAt && (h.evidenceId === evidenceId || h.caseId === id),
  );

  return (
    <div className="space-y-4">
      <div>
        <Link href={`/cases/${id}/attachments`} className="text-xs text-slate-400 hover:text-slate-200">
          ← Back to attachments
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold text-slate-100 break-all">{evidence.filename}</h1>
          <EvidenceStatusBadge status={evidence.status} />
        </div>
        {evidence.status === "available" ? (
          <a href={`/api/attachments/${evidence.id}`} className="kelpie-link text-sm">
            Download
          </a>
        ) : (
          <p className="text-sm text-slate-500">
            {evidence.status === "pending_scan"
              ? "Scanning is still in progress; this file cannot be downloaded yet."
              : evidence.scanDetail ?? "This file is blocked and cannot be downloaded."}
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="space-y-4 md:col-span-2">
          <EvidenceEditor
            caseId={id}
            evidenceId={evidenceId}
            filename={evidence.filename}
            labels={Array.isArray(evidence.labels) ? (evidence.labels as string[]) : []}
            relevance={evidence.relevance}
            examinerNotes={evidence.examinerNotes}
            acquisitionSource={evidence.acquisitionSource}
            acquiredAt={evidence.acquiredAt ? evidence.acquiredAt.toISOString() : null}
            canEdit={canEdit}
          />

          <div className="kelpie-card p-5 space-y-3">
            <h2 className="text-sm font-medium text-slate-300">Chain of custody</h2>
            <CustodyLog events={custodyRows} />
          </div>
        </div>

        <div className="space-y-4">
          <div className="kelpie-card p-5 space-y-2 text-sm">
            <h2 className="text-sm font-medium text-slate-300">Metadata</h2>
            <dl className="space-y-2 text-xs">
              <div>
                <dt className="text-slate-500">Original filename</dt>
                <dd className="text-slate-200 break-all">{evidence.originalFilename}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Content type</dt>
                <dd className="text-slate-200">
                  {evidence.contentType}
                  {evidence.declaredContentType && evidence.declaredContentType !== evidence.contentType
                    ? ` (declared: ${evidence.declaredContentType})`
                    : ""}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Size</dt>
                <dd className="text-slate-200">{formatSize(evidence.sizeBytes)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">SHA256</dt>
                <dd className="font-mono text-slate-300 break-all">{evidence.sha256}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Source</dt>
                <dd className="text-slate-200">{evidence.source.replace(/_/g, " ")}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Uploaded</dt>
                <dd className="text-slate-200">
                  {format(evidence.uploadedAt, "PP p")} by{" "}
                  {evidence.uploadedBy ? usersById.get(evidence.uploadedBy) ?? "Unknown" : "Unknown"}
                </dd>
              </div>
              {evidence.isArchive ? (
                <div>
                  <dt className="text-slate-500">Archive</dt>
                  <dd className="text-slate-200">
                    {evidence.archiveKind ?? "archive"}
                    {typeof evidence.archiveEntryCount === "number"
                      ? `, ${evidence.archiveEntryCount} entries`
                      : ""}
                    {evidence.archivePasswordProtected ? ", password protected" : ""}
                  </dd>
                </div>
              ) : null}
              {evidence.overriddenAt ? (
                <div>
                  <dt className="text-slate-500">Quarantine override</dt>
                  <dd className="text-slate-200">
                    {format(evidence.overriddenAt, "PP p")} by{" "}
                    {evidence.overriddenBy ? usersById.get(evidence.overriddenBy) ?? "Unknown" : "Unknown"}
                    {evidence.overrideReason ? ` — ${evidence.overrideReason}` : ""}
                  </dd>
                </div>
              ) : null}
            </dl>
          </div>

          <div className="kelpie-card p-5">
            <EvidenceCollectionSelect
              caseId={id}
              evidenceId={evidenceId}
              collectionId={evidence.collectionId}
              collections={collections}
              canEdit={canEdit}
            />
          </div>

          <LegalHoldPanel
            caseId={id}
            evidenceId={evidenceId}
            holds={holdRows}
            canManage={isAdmin}
          />

          {isAdmin ? (
            <div className="kelpie-card p-5 space-y-3">
              <h2 className="text-sm font-medium text-slate-300">Admin actions</h2>
              {evidence.status === "quarantined" || evidence.status === "scan_failed" ? (
                <ReasonedActionButton
                  action={(reason) => overrideEvidenceQuarantine(id, evidenceId, reason)}
                  title="Override quarantine on this evidence?"
                  description="This makes the file downloadable despite the scan result. This is recorded in the chain of custody."
                  confirmLabel="Override quarantine"
                  triggerLabel="Override quarantine"
                  reasonLabel="Reason for override"
                  reasonPlaceholder="Why is this safe to release?"
                  successTitle="Quarantine overridden"
                  tone="warning"
                  className="kelpie-btn kelpie-btn-secondary w-full justify-center"
                />
              ) : null}
              <ReasonedActionButton
                action={(reason) => deleteEvidence(id, evidenceId, reason)}
                title="Delete this evidence?"
                description={
                  underHold
                    ? "This evidence is under an active legal hold and cannot be deleted until the hold is released."
                    : "This soft-deletes the evidence and removes the stored file. This cannot be undone from the UI."
                }
                confirmLabel="Delete evidence"
                triggerLabel="Delete evidence"
                reasonLabel="Reason for deletion"
                reasonPlaceholder="Why is this evidence being deleted?"
                successTitle="Evidence deleted"
                tone="danger"
                disabled={underHold}
                redirectTo={`/cases/${id}/attachments`}
                className="kelpie-btn kelpie-btn-danger w-full justify-center"
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
