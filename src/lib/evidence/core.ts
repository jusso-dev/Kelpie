/**
 * Core evidence-lifecycle mutations and queries, callable from server
 * actions, REST routes, and MCP tools alike. Callers must already have
 * resolved `organisationId` for the acting user/token; every function
 * re-verifies that the evidence/case id it touches belongs to that
 * organisation before doing anything with it (see `caseRelationshipsCore`
 * for the same pattern).
 */

import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  attachments,
  cases,
  evidenceCustodyEvents,
  type Attachment,
} from "@/db/schema";
import { newId } from "@/lib/utils";
import { normalizeTags } from "@/lib/tags";
import { deleteFile, putFile, readFile } from "@/lib/storage";
import { writeTimelineEvent } from "@/lib/timeline";
import { sanitizeFilename, stripControlChars } from "./filename";
import { sniffMimeType } from "./mime-sniff";
import { sniffArchive } from "./archive-sniff";
import { recordCustodyEvent } from "./custody";
import { isUnderActiveHold } from "./legal-hold";
import crypto from "node:crypto";

export const MAX_EVIDENCE_SIZE_BYTES = 25 * 1024 * 1024;

export class EvidenceError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "EvidenceError";
    this.status = status;
  }
}

async function loadCaseInOrg(caseId: string, organisationId: string) {
  const [c] = await db
    .select({ id: cases.id, organisationId: cases.organisationId })
    .from(cases)
    .where(and(eq(cases.id, caseId), eq(cases.organisationId, organisationId)))
    .limit(1);
  return c ?? null;
}

/** Excludes soft-deleted evidence unless `includeDeleted` is set. */
export async function getEvidenceInOrg(
  evidenceId: string,
  organisationId: string,
  includeDeleted = false,
): Promise<Attachment | null> {
  const [row] = await db
    .select()
    .from(attachments)
    .where(
      and(
        eq(attachments.id, evidenceId),
        eq(attachments.organisationId, organisationId),
        includeDeleted ? undefined : isNull(attachments.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function listEvidenceForCase(
  caseId: string,
  organisationId: string,
): Promise<Attachment[]> {
  return db
    .select()
    .from(attachments)
    .where(
      and(
        eq(attachments.caseId, caseId),
        eq(attachments.organisationId, organisationId),
        isNull(attachments.deletedAt),
      ),
    )
    .orderBy(desc(attachments.uploadedAt));
}

export async function listCustodyEventsForEvidence(
  evidenceId: string,
  organisationId: string,
) {
  return db
    .select()
    .from(evidenceCustodyEvents)
    .where(
      and(
        eq(evidenceCustodyEvents.evidenceId, evidenceId),
        eq(evidenceCustodyEvents.organisationId, organisationId),
      ),
    )
    .orderBy(desc(evidenceCustodyEvents.occurredAt));
}

function sha256(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export type UploadEvidenceInput = {
  organisationId: string;
  caseId: string;
  /** Nullable for system/mailbox intake paths with no human actor. */
  actorId: string | null;
  buffer: Buffer;
  filename: string;
  declaredContentType: string | null;
  source?: string;
  acquisitionSource?: string | null;
  acquiredAt?: Date | null;
  examinerNotes?: string | null;
};

/**
 * Uploads always land as `pending_scan`; the async scan runner (or an
 * explicit admin override) is the only path to `available`. If the DB
 * insert fails after the object is written to storage, the object is
 * removed so no orphaned storage object survives a failed upload.
 */
export async function uploadEvidenceCore(
  input: UploadEvidenceInput,
): Promise<Attachment> {
  if (input.buffer.length === 0) {
    throw new EvidenceError("Empty file", 400);
  }
  if (input.buffer.length > MAX_EVIDENCE_SIZE_BYTES) {
    throw new EvidenceError("File too large (max 25MB)", 413);
  }
  const c = await loadCaseInOrg(input.caseId, input.organisationId);
  if (!c) throw new EvidenceError("Case not found", 404);

  const originalFilename = stripControlChars(input.filename);
  const filename = sanitizeFilename(input.filename);
  const contentType = sniffMimeType(input.buffer);
  const archive = sniffArchive(input.buffer);

  const stored = await putFile(input.buffer, input.organisationId, filename);
  const id = newId("att");
  try {
    const [row] = await db
      .insert(attachments)
      .values({
        id,
        caseId: input.caseId,
        organisationId: input.organisationId,
        filename,
        originalFilename,
        contentType,
        declaredContentType: input.declaredContentType,
        sizeBytes: stored.sizeBytes,
        storageKey: stored.key,
        sha256: stored.sha256,
        uploadedBy: input.actorId,
        source: input.source ?? "analyst_upload",
        isArchive: archive.isArchive,
        archiveKind: archive.kind,
        archiveEntryCount: archive.entryCount,
        archivePasswordProtected: archive.passwordProtected,
        acquisitionSource: input.acquisitionSource ?? null,
        acquiredAt: input.acquiredAt ?? null,
        examinerNotes: input.examinerNotes ?? null,
      })
      .returning();
    if (!row) throw new EvidenceError("Failed to record evidence", 500);

    await recordCustodyEvent({
      evidenceId: id,
      organisationId: input.organisationId,
      actorId: input.actorId,
      eventType: "uploaded",
      payload: {
        filename,
        original_filename: originalFilename,
        size_bytes: stored.sizeBytes,
        sha256: stored.sha256,
        content_type: contentType,
        declared_content_type: input.declaredContentType,
        source: input.source ?? "analyst_upload",
      },
    });
    await writeTimelineEvent({
      caseId: input.caseId,
      actorId: input.actorId,
      eventType: "file_uploaded",
      payload: {
        attachment_id: id,
        filename,
        size_bytes: stored.sizeBytes,
        sha256: stored.sha256,
      },
    });
    return row;
  } catch (error) {
    await deleteFile(stored.key).catch(() => {});
    throw error;
  }
}

export type DownloadResult = { evidence: Attachment; buffer: Buffer };

/**
 * Blocks anything not currently `available` (quarantined, still scanning,
 * scan_failed, or soft-deleted) and re-verifies the stored object's hash
 * against the recorded hash before returning bytes.
 */
export async function downloadEvidenceCore(
  evidenceId: string,
  organisationId: string,
  actorId: string,
): Promise<DownloadResult> {
  const evidence = await getEvidenceInOrg(evidenceId, organisationId);
  if (!evidence) throw new EvidenceError("Evidence not found", 404);
  if (evidence.status !== "available") {
    throw new EvidenceError(
      "This evidence is not available for download: " +
        describeStatus(evidence.status),
      423,
    );
  }
  const buffer = await readFile(evidence.storageKey);
  const actualHash = sha256(buffer);
  if (actualHash !== evidence.sha256) {
    await recordCustodyEvent({
      evidenceId,
      organisationId,
      actorId,
      eventType: "hash_mismatch",
      payload: { expected: evidence.sha256, actual: actualHash },
    });
    throw new EvidenceError(
      "Integrity check failed: stored file hash does not match the recorded hash.",
      409,
    );
  }
  await recordCustodyEvent({
    evidenceId,
    organisationId,
    actorId,
    eventType: "downloaded",
  });
  await recordCustodyEvent({
    evidenceId,
    organisationId,
    actorId,
    eventType: "hash_verified",
    payload: { sha256: actualHash },
  });
  return { evidence, buffer };
}

function describeStatus(status: Attachment["status"]): string {
  switch (status) {
    case "pending_scan":
      return "scanning is still in progress.";
    case "quarantined":
      return "it was quarantined by malware scanning.";
    case "scan_failed":
      return "malware scanning could not complete.";
    default:
      return "it is unavailable.";
  }
}

export type OverrideQuarantineInput = {
  evidenceId: string;
  organisationId: string;
  actorId: string;
  reason: string;
};

/** Caller must already have enforced admin-only access before calling this. */
export async function overrideQuarantineCore(
  input: OverrideQuarantineInput,
): Promise<Attachment> {
  const reason = input.reason.trim();
  if (reason.length < 3) {
    throw new EvidenceError("A reason is required to override quarantine", 400);
  }
  const evidence = await getEvidenceInOrg(input.evidenceId, input.organisationId);
  if (!evidence) throw new EvidenceError("Evidence not found", 404);
  if (evidence.status !== "quarantined" && evidence.status !== "scan_failed") {
    throw new EvidenceError(
      "Only quarantined or scan-failed evidence can be overridden",
      409,
    );
  }
  const [updated] = await db
    .update(attachments)
    .set({
      status: "available",
      overriddenBy: input.actorId,
      overriddenAt: new Date(),
      overrideReason: reason,
    })
    .where(eq(attachments.id, input.evidenceId))
    .returning();
  if (!updated) throw new EvidenceError("Evidence not found", 404);
  await recordCustodyEvent({
    evidenceId: input.evidenceId,
    organisationId: input.organisationId,
    actorId: input.actorId,
    eventType: "override_granted",
    reason,
    payload: { previous_status: evidence.status },
  });
  return updated;
}

export async function renameEvidenceCore(opts: {
  evidenceId: string;
  organisationId: string;
  actorId: string;
  newFilename: string;
}): Promise<Attachment> {
  const evidence = await getEvidenceInOrg(opts.evidenceId, opts.organisationId);
  if (!evidence) throw new EvidenceError("Evidence not found", 404);
  const newFilename = sanitizeFilename(opts.newFilename);
  if (newFilename === evidence.filename) return evidence;
  const [updated] = await db
    .update(attachments)
    .set({ filename: newFilename })
    .where(eq(attachments.id, opts.evidenceId))
    .returning();
  if (!updated) throw new EvidenceError("Evidence not found", 404);
  await recordCustodyEvent({
    evidenceId: opts.evidenceId,
    organisationId: opts.organisationId,
    actorId: opts.actorId,
    eventType: "renamed",
    payload: { from: evidence.filename, to: newFilename },
  });
  return updated;
}

export async function deleteEvidenceCore(opts: {
  evidenceId: string;
  organisationId: string;
  actorId: string;
  reason: string;
}): Promise<void> {
  const reason = opts.reason.trim();
  if (reason.length < 3) {
    throw new EvidenceError("A reason is required to delete evidence", 400);
  }
  const evidence = await getEvidenceInOrg(opts.evidenceId, opts.organisationId);
  if (!evidence) throw new EvidenceError("Evidence not found", 404);

  const held = await isUnderActiveHold(opts.organisationId, {
    caseId: evidence.caseId,
    evidenceId: evidence.id,
  });
  if (held) {
    throw new EvidenceError(
      "This evidence is under an active legal hold and cannot be deleted",
      409,
    );
  }

  const [updated] = await db
    .update(attachments)
    .set({
      deletedAt: new Date(),
      deletedBy: opts.actorId,
      deletionReason: reason,
    })
    .where(and(eq(attachments.id, opts.evidenceId), isNull(attachments.deletedAt)))
    .returning({ id: attachments.id });
  if (!updated) throw new EvidenceError("Evidence not found", 404);

  await recordCustodyEvent({
    evidenceId: opts.evidenceId,
    organisationId: opts.organisationId,
    actorId: opts.actorId,
    eventType: "deleted",
    reason,
  });
  await deleteFile(evidence.storageKey).catch(() => {});
}

export type CreateDerivedCopyInput = {
  parentEvidenceId: string;
  organisationId: string;
  actorId: string;
  buffer: Buffer;
  filename: string;
  declaredContentType: string | null;
  reason: string;
};

/**
 * A derived copy is always a new row: the parent row's bytes, hash, and
 * metadata are never touched. `parentEvidenceId` records lineage in both
 * directions via a custody event on each row.
 */
export async function createDerivedCopyCore(
  input: CreateDerivedCopyInput,
): Promise<Attachment> {
  const reason = input.reason.trim();
  if (reason.length < 3) {
    throw new EvidenceError("A reason is required to create a derived copy", 400);
  }
  const parent = await getEvidenceInOrg(input.parentEvidenceId, input.organisationId);
  if (!parent) throw new EvidenceError("Parent evidence not found", 404);
  if (input.buffer.length === 0) throw new EvidenceError("Empty file", 400);
  if (input.buffer.length > MAX_EVIDENCE_SIZE_BYTES) {
    throw new EvidenceError("File too large (max 25MB)", 413);
  }

  const originalFilename = stripControlChars(input.filename);
  const filename = sanitizeFilename(input.filename);
  const contentType = sniffMimeType(input.buffer);
  const archive = sniffArchive(input.buffer);
  const stored = await putFile(input.buffer, input.organisationId, filename);
  const id = newId("att");

  try {
    const [row] = await db
      .insert(attachments)
      .values({
        id,
        caseId: parent.caseId,
        organisationId: input.organisationId,
        filename,
        originalFilename,
        contentType,
        declaredContentType: input.declaredContentType,
        sizeBytes: stored.sizeBytes,
        storageKey: stored.key,
        sha256: stored.sha256,
        uploadedBy: input.actorId,
        source: "derived_copy",
        isArchive: archive.isArchive,
        archiveKind: archive.kind,
        archiveEntryCount: archive.entryCount,
        archivePasswordProtected: archive.passwordProtected,
        parentEvidenceId: parent.id,
      })
      .returning();
    if (!row) throw new EvidenceError("Failed to record derived copy", 500);

    await recordCustodyEvent({
      evidenceId: id,
      organisationId: input.organisationId,
      actorId: input.actorId,
      eventType: "derived_copy_created",
      reason,
      payload: { parent_evidence_id: parent.id, sha256: stored.sha256 },
    });
    await recordCustodyEvent({
      evidenceId: parent.id,
      organisationId: input.organisationId,
      actorId: input.actorId,
      eventType: "derived_copy_created",
      reason,
      payload: { child_evidence_id: id },
    });
    return row;
  } catch (error) {
    await deleteFile(stored.key).catch(() => {});
    throw error;
  }
}

export async function setLabelsCore(opts: {
  evidenceId: string;
  organisationId: string;
  actorId: string;
  labels: string[];
}): Promise<Attachment> {
  const evidence = await getEvidenceInOrg(opts.evidenceId, opts.organisationId);
  if (!evidence) throw new EvidenceError("Evidence not found", 404);
  const labels = normalizeTags(opts.labels);
  const [updated] = await db
    .update(attachments)
    .set({ labels })
    .where(eq(attachments.id, opts.evidenceId))
    .returning();
  if (!updated) throw new EvidenceError("Evidence not found", 404);
  const previous = new Set((evidence.labels as string[] | null) ?? []);
  const next = new Set(labels);
  const added = labels.filter((l) => !previous.has(l));
  const removed = [...previous].filter((l) => !next.has(l));
  if (added.length) {
    await recordCustodyEvent({
      evidenceId: opts.evidenceId,
      organisationId: opts.organisationId,
      actorId: opts.actorId,
      eventType: "label_added",
      payload: { labels: added },
    });
  }
  if (removed.length) {
    await recordCustodyEvent({
      evidenceId: opts.evidenceId,
      organisationId: opts.organisationId,
      actorId: opts.actorId,
      eventType: "label_removed",
      payload: { labels: removed },
    });
  }
  return updated;
}

export async function setRelevanceCore(opts: {
  evidenceId: string;
  organisationId: string;
  actorId: string;
  relevance: "unknown" | "relevant" | "not_relevant";
}): Promise<Attachment> {
  const evidence = await getEvidenceInOrg(opts.evidenceId, opts.organisationId);
  if (!evidence) throw new EvidenceError("Evidence not found", 404);
  const [updated] = await db
    .update(attachments)
    .set({ relevance: opts.relevance })
    .where(eq(attachments.id, opts.evidenceId))
    .returning();
  if (!updated) throw new EvidenceError("Evidence not found", 404);
  if (evidence.relevance !== opts.relevance) {
    await recordCustodyEvent({
      evidenceId: opts.evidenceId,
      organisationId: opts.organisationId,
      actorId: opts.actorId,
      eventType: "relevance_changed",
      payload: { from: evidence.relevance, to: opts.relevance },
    });
  }
  return updated;
}

export async function setExaminerNotesCore(opts: {
  evidenceId: string;
  organisationId: string;
  actorId: string;
  notes: string | null;
}): Promise<Attachment> {
  const evidence = await getEvidenceInOrg(opts.evidenceId, opts.organisationId);
  if (!evidence) throw new EvidenceError("Evidence not found", 404);
  const notes = opts.notes?.trim() || null;
  const [updated] = await db
    .update(attachments)
    .set({ examinerNotes: notes })
    .where(eq(attachments.id, opts.evidenceId))
    .returning();
  if (!updated) throw new EvidenceError("Evidence not found", 404);
  await recordCustodyEvent({
    evidenceId: opts.evidenceId,
    organisationId: opts.organisationId,
    actorId: opts.actorId,
    eventType: "notes_updated",
  });
  return updated;
}

export async function setAcquisitionCore(opts: {
  evidenceId: string;
  organisationId: string;
  actorId: string;
  acquisitionSource: string | null;
  acquiredAt: Date | null;
}): Promise<Attachment> {
  const evidence = await getEvidenceInOrg(opts.evidenceId, opts.organisationId);
  if (!evidence) throw new EvidenceError("Evidence not found", 404);
  const [updated] = await db
    .update(attachments)
    .set({
      acquisitionSource: opts.acquisitionSource,
      acquiredAt: opts.acquiredAt,
    })
    .where(eq(attachments.id, opts.evidenceId))
    .returning();
  if (!updated) throw new EvidenceError("Evidence not found", 404);
  await recordCustodyEvent({
    evidenceId: opts.evidenceId,
    organisationId: opts.organisationId,
    actorId: opts.actorId,
    eventType: "acquisition_updated",
    payload: {
      acquisition_source: opts.acquisitionSource,
      acquired_at: opts.acquiredAt?.toISOString() ?? null,
    },
  });
  return updated;
}

const TLP_RANK = ["clear", "green", "amber", "amber_strict", "red"] as const;
const PAP_RANK = ["clear", "green", "amber", "red"] as const;

/**
 * Foundation-level disclosure/export gate. Case access is enforced by the
 * caller resolving `organisationId`; this additionally enforces evidence
 * status, the parent case's TLP/PAP against a caller-supplied ceiling (e.g.
 * a stakeholder-portal or report-export context passing a lower ceiling
 * than an internal one), and that evidence isn't soft-deleted. Compartment
 * enforcement is out of scope until #61 introduces compartments.
 */
export function assertEvidenceExportable(
  evidence: Attachment,
  caseRow: { tlp: (typeof TLP_RANK)[number]; pap: (typeof PAP_RANK)[number] },
  ceiling?: {
    maxTlp?: (typeof TLP_RANK)[number];
    maxPap?: (typeof PAP_RANK)[number];
  },
): void {
  if (evidence.deletedAt) {
    throw new EvidenceError("Evidence has been deleted", 404);
  }
  if (evidence.status !== "available") {
    throw new EvidenceError(
      "This evidence is not available for export: " +
        describeStatus(evidence.status),
      423,
    );
  }
  if (ceiling?.maxTlp && TLP_RANK.indexOf(caseRow.tlp) > TLP_RANK.indexOf(ceiling.maxTlp)) {
    throw new EvidenceError(
      `Case TLP:${caseRow.tlp.toUpperCase()} exceeds the export ceiling of TLP:${ceiling.maxTlp.toUpperCase()}`,
      403,
    );
  }
  if (ceiling?.maxPap && PAP_RANK.indexOf(caseRow.pap) > PAP_RANK.indexOf(ceiling.maxPap)) {
    throw new EvidenceError(
      `Case PAP:${caseRow.pap.toUpperCase()} exceeds the export ceiling of PAP:${ceiling.maxPap.toUpperCase()}`,
      403,
    );
  }
}
