"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import {
  CaseViewError,
  createCaseViewCore,
  deleteCaseViewCore,
  duplicateCaseViewCore,
  setCaseViewDefaultCore,
  updateCaseViewCore,
  type CaseViewActor,
} from "@/lib/case-views/core";
import {
  CASE_VIEW_VISIBILITIES,
  type CaseViewVisibility,
  parseCaseViewConfig,
} from "@/lib/case-views/config";
import {
  applyBulkPresetBodySchema,
  previewBulkPreset,
  BulkPresetValidationError,
} from "@/lib/case-views/presets";
import { getCaseViewCore } from "@/lib/case-views/core";
import { runBulkOperationCore } from "@/lib/bulk-operations-core";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { cases } from "@/db/schema";

function actorFromUser(user: {
  id: string;
  organisationId: string;
  role: "admin" | "analyst" | "read_only";
}): CaseViewActor {
  return {
    id: user.id,
    organisationId: user.organisationId,
    role: user.role,
  };
}

function err(error: unknown): { ok: false; error: string } {
  if (error instanceof CaseViewError || error instanceof BulkPresetValidationError) {
    return { ok: false, error: error.message };
  }
  return {
    ok: false,
    error: error instanceof Error ? error.message : "Request failed",
  };
}

export async function createCaseViewAction(input: {
  name: string;
  description?: string | null;
  visibility: CaseViewVisibility;
  teamId?: string | null;
  config?: unknown;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const user = await requireUser();
    if (!(CASE_VIEW_VISIBILITIES as readonly string[]).includes(input.visibility)) {
      return { ok: false, error: "Invalid visibility" };
    }
    // Config may come from the current URL state — re-validate strictly.
    if (input.config !== undefined) parseCaseViewConfig(input.config);
    const view = await createCaseViewCore(actorFromUser(user), input);
    revalidatePath("/cases");
    return { ok: true, id: view.id };
  } catch (error) {
    return err(error);
  }
}

export async function updateCaseViewAction(input: {
  id: string;
  name?: string;
  description?: string | null;
  config?: unknown;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const user = await requireUser();
    await updateCaseViewCore(actorFromUser(user), input.id, input);
    revalidatePath("/cases");
    return { ok: true };
  } catch (error) {
    return err(error);
  }
}

export async function deleteCaseViewAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const user = await requireUser();
    await deleteCaseViewCore(actorFromUser(user), id);
    revalidatePath("/cases");
    return { ok: true };
  } catch (error) {
    return err(error);
  }
}

export async function duplicateCaseViewAction(input: {
  id: string;
  name?: string;
  visibility?: CaseViewVisibility;
  teamId?: string | null;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const user = await requireUser();
    const view = await duplicateCaseViewCore(actorFromUser(user), input.id, input);
    revalidatePath("/cases");
    return { ok: true, id: view.id };
  } catch (error) {
    return err(error);
  }
}

export async function setCaseViewDefaultAction(input: {
  scope: "personal" | "role" | "team";
  viewId: string | null;
  role?: "admin" | "analyst" | "read_only";
  teamId?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const user = await requireUser();
    await setCaseViewDefaultCore(actorFromUser(user), input);
    revalidatePath("/cases");
    return { ok: true };
  } catch (error) {
    return err(error);
  }
}

/**
 * Apply a bulk preset: re-resolve targets, require confirmed=true, then run
 * the normal bulk operation path (permissions + per-case audit).
 */
export async function applyBulkPresetAction(input: {
  viewId: string;
  presetId: string;
  caseIds: string[];
  confirmed: true;
}): Promise<
  | {
      ok: true;
      attempted: number;
      successCount: number;
      failureCount: number;
      errors: Array<{ caseId: string; error: string }>;
    }
  | { ok: false; error: string }
> {
  try {
    const user = await requireUser();
    if (user.role === "read_only") {
      return { ok: false, error: "Read-only users cannot run bulk actions" };
    }
    const parsed = applyBulkPresetBodySchema.safeParse({
      presetId: input.presetId,
      caseIds: input.caseIds,
      confirmed: input.confirmed,
    });
    if (!parsed.success) {
      return { ok: false, error: "Invalid preset application payload" };
    }
    const view = await getCaseViewCore(actorFromUser(user), input.viewId);
    if (!view) return { ok: false, error: "View not found" };

    const resolved =
      parsed.data.caseIds.length === 0
        ? []
        : await db
            .select({ id: cases.id })
            .from(cases)
            .where(
              and(
                eq(cases.organisationId, user.organisationId),
                inArray(cases.id, parsed.data.caseIds),
              ),
            );

    const preview = previewBulkPreset(
      view.config,
      parsed.data.presetId,
      resolved.map((r) => r.id),
    );
    if (preview.targetCount === 0) {
      return { ok: false, error: "No cases selected (or none visible in this organisation)" };
    }

    const result = await runBulkOperationCore(
      user.organisationId,
      user.id,
      preview.operationType,
      preview.targetCaseIds,
      preview.params,
    );
    revalidatePath("/cases");
    return {
      ok: true,
      attempted: result.attempted,
      successCount: result.successCount,
      failureCount: result.failureCount,
      errors: result.errors,
    };
  } catch (error) {
    return err(error);
  }
}
