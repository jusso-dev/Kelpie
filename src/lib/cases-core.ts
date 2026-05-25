/**
 * Core case mutations, callable from both server actions and API routes.
 *
 * These functions assume the caller has already authorised the actor for the
 * given organisation; pass `organisationId` and `actorId` (the latter may be
 * null for system events).
 */

import { db } from "@/db";
import { cases } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { newId } from "./utils";
import { nextCaseNumber } from "./case-number";
import { writeTimelineEvent } from "./timeline";
import { normalizeTags } from "./tags";

const STATUS_VALUES = [
  "open",
  "in_progress",
  "contained",
  "eradicated",
  "recovered",
  "closed",
] as const;
const SEVERITY_VALUES = ["low", "medium", "high", "critical"] as const;
const TLP_VALUES = ["clear", "green", "amber", "amber_strict", "red"] as const;
const PAP_VALUES = ["clear", "green", "amber", "red"] as const;
const CLASSIFICATION_VALUES = [
  "malware",
  "phishing",
  "unauthorised_access",
  "data_breach",
  "dos",
  "policy_violation",
  "other",
] as const;

export type CaseStatus = (typeof STATUS_VALUES)[number];
export type CaseSeverity = (typeof SEVERITY_VALUES)[number];
export type CaseTlp = (typeof TLP_VALUES)[number];
export type CasePap = (typeof PAP_VALUES)[number];
export type CaseClassification = (typeof CLASSIFICATION_VALUES)[number];

export const CASE_ENUMS = {
  status: STATUS_VALUES,
  severity: SEVERITY_VALUES,
  tlp: TLP_VALUES,
  pap: PAP_VALUES,
  classification: CLASSIFICATION_VALUES,
};

export class CaseVersionConflictError extends Error {
  current: Record<string, unknown>;
  constructor(current: Record<string, unknown>) {
    super("case_version_conflict");
    this.name = "CaseVersionConflictError";
    this.current = current;
  }
}

async function loadCaseInOrg(caseId: string, organisationId: string) {
  const [c] = await db
    .select()
    .from(cases)
    .where(and(eq(cases.id, caseId), eq(cases.organisationId, organisationId)))
    .limit(1);
  return c ?? null;
}

export type CreateCaseInput = {
  title: string;
  summary?: string;
  severity?: CaseSeverity;
  tlp?: CaseTlp;
  pap?: CasePap;
  classification?: CaseClassification;
  assigneeId?: string | null;
  reporterId?: string | null;
  sourceAlertId?: string | null;
  tags?: string[];
  dataClassificationTags?: string[];
};

export async function createCaseCore(
  organisationId: string,
  actorId: string | null,
  input: CreateCaseInput,
): Promise<{ id: string; caseNumber: string }> {
  if (!input.title?.trim()) throw new Error("Title is required");
  const id = newId("case");
  const caseNumber = await nextCaseNumber(organisationId);
  await db.insert(cases).values({
    id,
    organisationId,
    caseNumber,
    title: input.title.trim(),
    summary: input.summary?.trim() || null,
    severity: input.severity ?? "medium",
    tlp: input.tlp ?? "amber",
    pap: input.pap ?? "amber",
    classification: input.classification ?? "other",
    assigneeId: input.assigneeId ?? actorId,
    reporterId: input.reporterId ?? actorId,
    sourceAlertId: input.sourceAlertId ?? null,
    tags: normalizeTags(input.tags ?? []),
    dataClassificationTags: normalizeTags(input.dataClassificationTags ?? []),
  });
  await writeTimelineEvent({
    caseId: id,
    actorId,
    eventType: "case_created",
    payload: { title: input.title, severity: input.severity ?? "medium" },
  });
  return { id, caseNumber };
}

export async function setCaseStatusCore(
  organisationId: string,
  actorId: string | null,
  caseId: string,
  nextStatus: CaseStatus,
): Promise<void> {
  const existing = await loadCaseInOrg(caseId, organisationId);
  if (!existing) throw new Error("Case not found");
  if (existing.status === nextStatus) return;

  const patch: Partial<typeof cases.$inferInsert> = { status: nextStatus };
  if (nextStatus === "in_progress" && !existing.acknowledgedAt) {
    patch.acknowledgedAt = new Date();
  }
  if (nextStatus === "contained" && !existing.containedAt) {
    patch.containedAt = new Date();
  }
  if (
    (nextStatus === "recovered" || nextStatus === "closed") &&
    !existing.resolvedAt
  ) {
    patch.resolvedAt = new Date();
  }
  if (nextStatus === "closed" && !existing.closedAt) {
    patch.closedAt = new Date();
  }
  await db.update(cases).set(patch).where(eq(cases.id, caseId));
  await writeTimelineEvent({
    caseId,
    actorId,
    eventType: "status_change",
    payload: { from: existing.status, to: nextStatus },
  });
}

export type CasePatchInput = Partial<{
  severity: CaseSeverity;
  classification: CaseClassification;
  tlp: CaseTlp;
  pap: CasePap;
  assigneeId: string | null;
  title: string;
  summary: string;
  tags: string[];
  dataClassificationTags: string[];
}>;

export async function patchCaseCore(
  organisationId: string,
  actorId: string | null,
  caseId: string,
  patch: CasePatchInput,
  expectedVersion?: number,
): Promise<void> {
  const existing = await loadCaseInOrg(caseId, organisationId);
  if (!existing) throw new Error("Case not found");

  // Optimistic locking: if the caller passed the version it last saw and the
  // case has since moved on, refuse the write and hand back the current value
  // so the UI can offer keep-mine / keep-theirs / merge.
  if (expectedVersion !== undefined && expectedVersion !== existing.version) {
    throw new CaseVersionConflictError({
      version: existing.version,
      severity: existing.severity,
      classification: existing.classification,
      tlp: existing.tlp,
      pap: existing.pap,
      assigneeId: existing.assigneeId,
      title: existing.title,
      summary: existing.summary,
      tags: existing.tags,
      dataClassificationTags: existing.dataClassificationTags,
    });
  }

  const set: Partial<typeof cases.$inferInsert> = {};
  const events: Array<{ eventType: "severity_change" | "assignment_change" | "custom"; payload: Record<string, unknown> }> = [];

  if (patch.severity && patch.severity !== existing.severity) {
    set.severity = patch.severity;
    events.push({
      eventType: "severity_change",
      payload: { from: existing.severity, to: patch.severity },
    });
  }
  if (patch.classification && patch.classification !== existing.classification) {
    set.classification = patch.classification;
    events.push({
      eventType: "custom",
      payload: { field: "classification", from: existing.classification, to: patch.classification },
    });
  }
  if (patch.tlp && patch.tlp !== existing.tlp) {
    set.tlp = patch.tlp;
    events.push({
      eventType: "custom",
      payload: { field: "tlp", from: existing.tlp, to: patch.tlp },
    });
  }
  if (patch.pap && patch.pap !== existing.pap) {
    set.pap = patch.pap;
    events.push({
      eventType: "custom",
      payload: { field: "pap", from: existing.pap, to: patch.pap },
    });
  }
  if (patch.assigneeId !== undefined && patch.assigneeId !== existing.assigneeId) {
    set.assigneeId = patch.assigneeId;
    events.push({
      eventType: "assignment_change",
      payload: { from: existing.assigneeId, to: patch.assigneeId },
    });
  }
  if (patch.title !== undefined && patch.title.trim() && patch.title !== existing.title) {
    set.title = patch.title.trim();
    events.push({
      eventType: "custom",
      payload: { field: "title", from: existing.title, to: patch.title },
    });
  }
  if (patch.summary !== undefined && patch.summary !== existing.summary) {
    set.summary = patch.summary;
    events.push({
      eventType: "custom",
      payload: { field: "summary" },
    });
  }
  if (patch.tags !== undefined) {
    const next = normalizeTags(patch.tags);
    const current = Array.isArray(existing.tags) ? (existing.tags as string[]) : [];
    if (JSON.stringify(next) !== JSON.stringify(current)) {
      set.tags = next;
      events.push({
        eventType: "custom",
        payload: { field: "tags", from: current, to: next },
      });
    }
  }
  if (patch.dataClassificationTags !== undefined) {
    const next = normalizeTags(patch.dataClassificationTags);
    const current = Array.isArray(existing.dataClassificationTags)
      ? (existing.dataClassificationTags as string[])
      : [];
    if (JSON.stringify(next) !== JSON.stringify(current)) {
      set.dataClassificationTags = next;
      events.push({
        eventType: "custom",
        payload: { field: "data_classification_tags", from: current, to: next },
      });
    }
  }
  if (Object.keys(set).length === 0) return;
  set.version = existing.version + 1;
  await db.update(cases).set(set).where(eq(cases.id, caseId));
  for (const e of events) {
    await writeTimelineEvent({
      caseId,
      actorId,
      eventType: e.eventType,
      payload: e.payload,
    });
  }
}

export async function closeCaseCore(
  organisationId: string,
  actorId: string | null,
  caseId: string,
  reason: string,
  summary: string,
): Promise<void> {
  if (!reason.trim()) throw new Error("Closure reason is required");
  if (!summary.trim()) throw new Error("Closure summary is required");
  const existing = await loadCaseInOrg(caseId, organisationId);
  if (!existing) throw new Error("Case not found");
  await db
    .update(cases)
    .set({
      status: "closed",
      closedAt: new Date(),
      resolvedAt: existing.resolvedAt ?? new Date(),
      closureReason: reason.trim(),
      closureSummary: summary.trim(),
    })
    .where(eq(cases.id, caseId));
  await writeTimelineEvent({
    caseId,
    actorId,
    eventType: "status_change",
    payload: { from: existing.status, to: "closed", reason },
  });
}
