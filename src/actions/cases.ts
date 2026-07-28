"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/session";
import {
  CASE_ENUMS,
  CaseVersionConflictError,
  closeCaseFullCore,
  createCaseCore,
  patchCaseCore,
  reopenCaseCore,
  setCaseStatusCore,
  type CaseClassification,
  type CasePap,
  type CaseSeverity,
  type CaseStatus,
  type CaseTlp,
} from "@/lib/cases-core";
import {
  ClosureOverrideError,
  ClosurePathError,
  ClosureRequirementsError,
} from "@/lib/closure/types";
import { previewCaseClosure } from "@/lib/closure/close-core";

export type CaseFieldResult =
  | { ok: true; version: number }
  | { ok: false; conflict: Record<string, unknown> };

export type CloseCaseActionResult =
  | {
      ok: true;
      version: number;
      snapshotId: string;
      wasOverride: boolean;
    }
  | {
      ok: false;
      error: string;
      code?:
        | "requirements_not_met"
        | "version_conflict"
        | "override_denied"
        | "bad_request";
      evaluation?: unknown;
      conflict?: Record<string, unknown>;
    };

import { parseTagsInput } from "@/lib/tags";

function pickEnum<T extends readonly string[]>(
  values: T,
  raw: FormDataEntryValue | null,
  fallback: T[number],
): T[number] {
  const v = typeof raw === "string" ? raw : "";
  return (values as readonly string[]).includes(v) ? (v as T[number]) : fallback;
}

export async function createCase(formData: FormData) {
  const user = await requireRole(["admin", "analyst"]);
  const result = await createCaseCore(user.organisationId, user.id, {
    title: String(formData.get("title") ?? ""),
    summary: String(formData.get("summary") ?? ""),
    severity: pickEnum(CASE_ENUMS.severity, formData.get("severity"), "medium"),
    tlp: pickEnum(CASE_ENUMS.tlp, formData.get("tlp"), "amber"),
    pap: pickEnum(CASE_ENUMS.pap, formData.get("pap"), "amber"),
    classification: pickEnum(
      CASE_ENUMS.classification,
      formData.get("classification"),
      "other",
    ),
    tags: parseTagsInput(String(formData.get("tags") ?? "")),
    dataClassificationTags: parseTagsInput(
      String(formData.get("dataClassificationTags") ?? ""),
    ),
  });
  revalidatePath("/cases");
  redirect(`/cases/${result.id}`);
}

export async function updateCaseStatus(
  caseId: string,
  nextStatus: CaseStatus,
  expectedVersion?: number,
): Promise<CaseFieldResult> {
  const user = await requireRole(["admin", "analyst"]);
  let updated: { version: number };
  try {
    updated = await setCaseStatusCore(
      user.organisationId,
      user.id,
      caseId,
      nextStatus,
      expectedVersion,
    );
  } catch (e) {
    if (e instanceof CaseVersionConflictError) {
      return { ok: false, conflict: e.current };
    }
    throw e;
  }
  revalidatePath(`/cases/${caseId}`);
  revalidatePath("/cases");
  return { ok: true, version: updated.version };
}

export async function updateCaseField(
  caseId: string,
  field: "severity" | "assigneeId" | "tlp" | "pap" | "classification",
  value: string | null,
  expectedVersion?: number,
): Promise<CaseFieldResult> {
  const user = await requireRole(["admin", "analyst"]);
  const patch: Parameters<typeof patchCaseCore>[3] = {};
  if (field === "severity") {
    if (!(CASE_ENUMS.severity as readonly string[]).includes(value ?? "")) {
      throw new Error("Invalid severity");
    }
    patch.severity = value as CaseSeverity;
  } else if (field === "tlp") {
    if (!(CASE_ENUMS.tlp as readonly string[]).includes(value ?? "")) {
      throw new Error("Invalid TLP");
    }
    patch.tlp = value as CaseTlp;
  } else if (field === "pap") {
    if (!(CASE_ENUMS.pap as readonly string[]).includes(value ?? "")) {
      throw new Error("Invalid PAP");
    }
    patch.pap = value as CasePap;
  } else if (field === "classification") {
    if (!(CASE_ENUMS.classification as readonly string[]).includes(value ?? "")) {
      throw new Error("Invalid classification");
    }
    patch.classification = value as CaseClassification;
  } else if (field === "assigneeId") {
    patch.assigneeId = value;
  }
  try {
    const updated = await patchCaseCore(
      user.organisationId,
      user.id,
      caseId,
      patch,
      expectedVersion,
    );
    revalidatePath(`/cases/${caseId}`);
    return { ok: true, version: updated.version };
  } catch (e) {
    if (e instanceof CaseVersionConflictError) {
      return { ok: false, conflict: e.current };
    }
    throw e;
  }
}

export async function updateCaseTags(
  caseId: string,
  field: "tags" | "dataClassificationTags",
  values: string[],
  expectedVersion?: number,
): Promise<CaseFieldResult> {
  const user = await requireRole(["admin", "analyst"]);
  const patch: Parameters<typeof patchCaseCore>[3] = {};
  patch[field] = values;
  try {
    const updated = await patchCaseCore(
      user.organisationId,
      user.id,
      caseId,
      patch,
      expectedVersion,
    );
    revalidatePath(`/cases/${caseId}`);
    revalidatePath("/cases");
    return { ok: true, version: updated.version };
  } catch (e) {
    if (e instanceof CaseVersionConflictError) {
      return { ok: false, conflict: e.current };
    }
    throw e;
  }
}

export async function updateCaseSummary(
  caseId: string,
  summary: string,
  expectedVersion?: number,
): Promise<CaseFieldResult> {
  const user = await requireRole(["admin", "analyst"]);
  try {
    const updated = await patchCaseCore(
      user.organisationId,
      user.id,
      caseId,
      { summary },
      expectedVersion,
    );
    revalidatePath(`/cases/${caseId}`);
    return { ok: true, version: updated.version };
  } catch (e) {
    if (e instanceof CaseVersionConflictError) {
      return { ok: false, conflict: e.current };
    }
    throw e;
  }
}

function parseReviewedIds(raw: FormDataEntryValue | null): string[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function closeCase(formData: FormData): Promise<CloseCaseActionResult> {
  const user = await requireRole(["admin", "analyst"]);
  const caseId = String(formData.get("caseId") ?? "");
  if (!caseId) {
    return { ok: false, error: "caseId required", code: "bad_request" };
  }

  const disposition = String(formData.get("reason") ?? formData.get("disposition") ?? "");
  const conclusion = String(formData.get("summary") ?? formData.get("conclusion") ?? "");
  const determination = String(formData.get("determination") ?? "") || null;
  const rootCause = String(formData.get("rootCause") ?? "") || null;
  const businessImpact = String(formData.get("businessImpact") ?? "") || null;
  const lessonsLearned = String(formData.get("lessonsLearned") ?? "") || null;
  const approverId = String(formData.get("approverId") ?? "") || null;
  const override = formData.get("override") === "true" || formData.get("override") === "on";
  const overrideReason = String(formData.get("overrideReason") ?? "") || null;
  const expectedVersionRaw = formData.get("expectedVersion");
  const expectedVersion =
    expectedVersionRaw !== null && String(expectedVersionRaw).length > 0
      ? Number(expectedVersionRaw)
      : undefined;
  const reviewedRelatedCaseIds = parseReviewedIds(
    formData.get("reviewedRelatedCaseIds"),
  );
  const postIncidentReviewCompleted =
    formData.get("postIncidentReviewCompleted") === "true" ||
    formData.get("postIncidentReviewCompleted") === "on";

  try {
    const result = await closeCaseFullCore(user.organisationId, user.id, caseId, {
      disposition,
      conclusion,
      determination,
      rootCause,
      businessImpact,
      lessonsLearned,
      approverId,
      reviewedRelatedCaseIds,
      postIncidentReviewCompleted,
      expectedVersion: Number.isFinite(expectedVersion) ? expectedVersion : undefined,
      override,
      overrideReason,
      canOverride: user.role === "admin",
    });
    revalidatePath(`/cases/${caseId}`);
    revalidatePath("/cases");
    return {
      ok: true,
      version: result.version,
      snapshotId: result.snapshotId,
      wasOverride: result.wasOverride,
    };
  } catch (e) {
    if (e instanceof ClosureRequirementsError) {
      return {
        ok: false,
        error: "Closure requirements not met",
        code: "requirements_not_met",
        evaluation: e.evaluation,
      };
    }
    if (e instanceof CaseVersionConflictError) {
      return {
        ok: false,
        error: "version_conflict",
        code: "version_conflict",
        conflict: e.current,
      };
    }
    if (e instanceof ClosureOverrideError) {
      return {
        ok: false,
        error: e.message,
        code: e.status === 403 ? "override_denied" : "bad_request",
      };
    }
    if (e instanceof ClosurePathError) {
      return { ok: false, error: e.message, code: "bad_request" };
    }
    throw e;
  }
}

export async function previewCloseCase(formData: FormData) {
  const user = await requireRole(["admin", "analyst", "read_only"]);
  const caseId = String(formData.get("caseId") ?? "");
  if (!caseId) throw new Error("caseId required");
  return previewCaseClosure(user.organisationId, caseId, {
    disposition: String(formData.get("reason") ?? formData.get("disposition") ?? ""),
    conclusion: String(formData.get("summary") ?? formData.get("conclusion") ?? ""),
    determination: String(formData.get("determination") ?? "") || null,
    rootCause: String(formData.get("rootCause") ?? "") || null,
    businessImpact: String(formData.get("businessImpact") ?? "") || null,
    lessonsLearned: String(formData.get("lessonsLearned") ?? "") || null,
    approverId: String(formData.get("approverId") ?? "") || null,
    reviewedRelatedCaseIds: parseReviewedIds(formData.get("reviewedRelatedCaseIds")),
    postIncidentReviewCompleted:
      formData.get("postIncidentReviewCompleted") === "true" ||
      formData.get("postIncidentReviewCompleted") === "on",
  });
}

export async function reopenCase(formData: FormData): Promise<CloseCaseActionResult> {
  const user = await requireRole(["admin", "analyst"]);
  const caseId = String(formData.get("caseId") ?? "");
  const reason = String(formData.get("reason") ?? "");
  const expectedVersionRaw = formData.get("expectedVersion");
  const expectedVersion =
    expectedVersionRaw !== null && String(expectedVersionRaw).length > 0
      ? Number(expectedVersionRaw)
      : undefined;
  if (!caseId) {
    return { ok: false, error: "caseId required", code: "bad_request" };
  }
  try {
    const result = await reopenCaseCore(user.organisationId, user.id, caseId, {
      reason,
      expectedVersion: Number.isFinite(expectedVersion) ? expectedVersion : undefined,
    });
    revalidatePath(`/cases/${caseId}`);
    revalidatePath("/cases");
    return {
      ok: true,
      version: result.version,
      snapshotId: result.snapshotId ?? "",
      wasOverride: false,
    };
  } catch (e) {
    if (e instanceof CaseVersionConflictError) {
      return {
        ok: false,
        error: "version_conflict",
        code: "version_conflict",
        conflict: e.current,
      };
    }
    if (e instanceof ClosurePathError) {
      return { ok: false, error: e.message, code: "bad_request" };
    }
    throw e;
  }
}

export async function updateMitreTechniques(
  caseId: string,
  techniqueIds: string[],
  expectedVersion?: number,
): Promise<CaseFieldResult> {
  const user = await requireRole(["admin", "analyst"]);
  try {
    const updated = await patchCaseCore(
      user.organisationId,
      user.id,
      caseId,
      { mitreTechniques: techniqueIds },
      expectedVersion,
    );
    revalidatePath(`/cases/${caseId}`);
    return { ok: true, version: updated.version };
  } catch (e) {
    if (e instanceof CaseVersionConflictError) {
      return { ok: false, conflict: e.current };
    }
    throw e;
  }
}
