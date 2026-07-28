/**
 * Bulk-action preset validation and impact preview (issue #46).
 *
 * Presets store only the action *shape* (operation type + params). They never
 * store case ids, never auto-execute, and never bypass confirmation or
 * permission checks. Targets are always re-resolved from the caller's current
 * selection (or a freshly scoped id list) at apply time.
 */
import { z } from "zod";
import {
  BULK_OPERATION_TYPES,
  type BulkOperationParams,
  type BulkOperationType,
} from "@/lib/bulk-operations-core";
import {
  bulkPresetSchema,
  type BulkPreset,
  type CaseViewConfig,
} from "./config";

export { bulkPresetSchema, type BulkPreset };

export class BulkPresetValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BulkPresetValidationError";
  }
}

/** Validate a single preset; reject unknown fields and invalid ops. */
export function parseBulkPreset(input: unknown): BulkPreset {
  const parsed = bulkPresetSchema.safeParse(input);
  if (!parsed.success) {
    throw new BulkPresetValidationError(
      parsed.error.issues[0]?.message ?? "Invalid bulk preset",
    );
  }
  return validatePresetShape(parsed.data);
}

export function parseBulkPresets(input: unknown): BulkPreset[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) {
    throw new BulkPresetValidationError("bulkPresets must be an array");
  }
  if (input.length > 20) {
    throw new BulkPresetValidationError("At most 20 bulk presets are allowed");
  }
  const ids = new Set<string>();
  const out: BulkPreset[] = [];
  for (const item of input) {
    const preset = parseBulkPreset(item);
    if (ids.has(preset.id)) {
      throw new BulkPresetValidationError(`Duplicate bulk preset id "${preset.id}"`);
    }
    ids.add(preset.id);
    out.push(preset);
  }
  return out;
}

function validatePresetShape(preset: BulkPreset): BulkPreset {
  if (!(BULK_OPERATION_TYPES as readonly string[]).includes(preset.operationType)) {
    throw new BulkPresetValidationError(
      `Unknown operation type "${preset.operationType}"`,
    );
  }
  const p = preset.params;
  switch (preset.operationType) {
    case "assign_queue":
      // queueId may be null (clear queue) or a string
      break;
    case "assign_analyst":
      break;
    case "add_watcher":
    case "remove_watcher":
      if (!p.userId) {
        throw new BulkPresetValidationError(
          `${preset.operationType} requires params.userId`,
        );
      }
      break;
    case "add_tag":
    case "remove_tag":
      if (!p.tag) {
        throw new BulkPresetValidationError(
          `${preset.operationType} requires params.tag`,
        );
      }
      break;
    case "set_severity":
      if (!p.severity) {
        throw new BulkPresetValidationError("set_severity requires params.severity");
      }
      break;
    case "set_status":
      if (!p.status) {
        throw new BulkPresetValidationError("set_status requires params.status");
      }
      break;
    case "acknowledge":
      break;
  }
  return preset;
}

export type BulkPresetPreview = {
  presetId: string;
  presetName: string;
  operationType: BulkOperationType;
  params: BulkOperationParams;
  /** Fresh target count after org-scoping (never from stored case ids). */
  targetCount: number;
  targetCaseIds: string[];
  /** Always true: caller must still confirm before execution. */
  requiresConfirmation: true;
};

/**
 * Build an impact preview for a preset against freshly resolved targets.
 * Does not execute anything.
 */
export function previewBulkPreset(
  config: CaseViewConfig,
  presetId: string,
  resolvedCaseIds: string[],
): BulkPresetPreview {
  const preset = config.bulkPresets.find((p) => p.id === presetId);
  if (!preset) {
    throw new BulkPresetValidationError("Bulk preset not found on this view");
  }
  const validated = validatePresetShape(preset);
  // De-dupe while preserving order; drop empties. Never trust client-supplied
  // duplicates or blanks as distinct targets.
  const seen = new Set<string>();
  const targetCaseIds: string[] = [];
  for (const id of resolvedCaseIds) {
    const trimmed = id.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    targetCaseIds.push(trimmed);
  }
  return {
    presetId: validated.id,
    presetName: validated.name,
    operationType: validated.operationType,
    params: validated.params as BulkOperationParams,
    targetCount: targetCaseIds.length,
    targetCaseIds,
    requiresConfirmation: true,
  };
}

/** Zod helper for API body that applies a preset to selected cases. */
export const applyBulkPresetBodySchema = z
  .object({
    presetId: z.string().trim().min(1).max(80),
    /** Fresh selection; server re-scopes to the caller's organisation. */
    caseIds: z.array(z.string().trim().min(1).max(80)).max(500),
    /** Must be true — presets never skip confirmation. */
    confirmed: z.literal(true),
  })
  .strict();
