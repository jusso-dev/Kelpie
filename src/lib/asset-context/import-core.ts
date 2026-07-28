/**
 * CSV / batch import for asset and identity context (issue #59).
 * Supports dry-run validation, per-row errors, and idempotent upsert.
 * Execution is rollback-safe in the sense that each row is an independent
 * upsert — a mid-run failure leaves previously committed rows intact and
 * reports partial status rather than a half-applied multi-row transaction
 * with no audit trail.
 */

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { contextImportRuns, type ContextImportRun } from "@/db/schema";
import type { EntityIdentifier } from "@/db/schema";
import { newId } from "@/lib/utils";
import { upsertContextFromProvider, type UpsertContextInput } from "./context-core";
import {
  ASSET_CONTEXT_KINDS,
  AssetContextError,
  CRITICALITY_LEVELS,
  ENVIRONMENT_KINDS,
  EXPOSURE_LEVELS,
  PRIVILEGE_LEVELS,
  RECOVERY_PRIORITIES,
  type AssetContextKind,
  type ContextImportSource,
  type CriticalityLevel,
  type EnvironmentKind,
  type ExposureLevel,
  type PrivilegeLevel,
  type RecoveryPriority,
} from "./types";

const IDENTIFIER_KINDS = [
  "email",
  "upn",
  "sid",
  "aad_object_id",
  "device_id",
  "hostname",
  "ip",
  "fqdn",
  "url",
  "sha256",
  "sha1",
  "md5",
  "process_guid",
  "cloud_resource_id",
  "tenant_id",
  "application_id",
  "other",
] as const;

export type ImportRowError = {
  row: number;
  field?: string;
  message: string;
};

export type ParsedContextRow = UpsertContextInput & { rowNumber: number };

export type ImportResult = {
  run: ContextImportRun;
  rows: ParsedContextRow[];
  errors: ImportRowError[];
};

const CSV_HEADERS = [
  "kind",
  "display_name",
  "identifier_kind",
  "identifier_value",
  "criticality",
  "privilege_level",
  "exposure",
  "environment",
  "is_crown_jewel",
  "recovery_priority",
  "owner_team",
  "owner_email",
  "business_service",
  "application_name",
  "data_classifications",
  "regulatory_scope",
  "external_id",
] as const;

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      cells.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells.map((c) => c.trim());
}

function splitCsv(text: string): string[][] {
  return text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0 && !l.startsWith("#"))
    .map(parseCsvLine);
}

function parseBool(raw: string | undefined): boolean {
  if (!raw) return false;
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "y";
}

function parseList(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(/[|;]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function inList<T extends string>(
  value: string,
  allowed: readonly T[],
): value is T {
  return (allowed as readonly string[]).includes(value);
}

/**
 * Parse and validate CSV text into rows + errors without writing anything.
 */
export function parseContextCsv(
  csvText: string,
  organisationId: string,
  providerSource: ContextImportSource = "csv",
): { rows: ParsedContextRow[]; errors: ImportRowError[] } {
  const table = splitCsv(csvText);
  if (table.length === 0) {
    return {
      rows: [],
      errors: [{ row: 0, message: "CSV is empty" }],
    };
  }

  const header = table[0]!.map((h) => h.trim().toLowerCase());
  const required = [
    "kind",
    "display_name",
    "identifier_kind",
    "identifier_value",
  ] as const;
  for (const col of required) {
    if (!header.includes(col)) {
      return {
        rows: [],
        errors: [{ row: 0, field: col, message: `Missing required column: ${col}` }],
      };
    }
  }

  const idx = (name: string) => header.indexOf(name);
  const rows: ParsedContextRow[] = [];
  const errors: ImportRowError[] = [];

  for (let i = 1; i < table.length; i++) {
    const line = table[i]!;
    const rowNumber = i + 1; // 1-based including header
    const cell = (name: string) => {
      const j = idx(name);
      return j >= 0 ? (line[j] ?? "").trim() : "";
    };

    const kindRaw = cell("kind").toLowerCase();
    if (!inList(kindRaw, ASSET_CONTEXT_KINDS)) {
      errors.push({
        row: rowNumber,
        field: "kind",
        message: `Invalid kind "${kindRaw}"`,
      });
      continue;
    }
    const kind = kindRaw as AssetContextKind;

    const displayName = cell("display_name");
    if (!displayName) {
      errors.push({
        row: rowNumber,
        field: "display_name",
        message: "display_name is required",
      });
      continue;
    }

    const identKindRaw = cell("identifier_kind").toLowerCase();
    if (!inList(identKindRaw, IDENTIFIER_KINDS)) {
      errors.push({
        row: rowNumber,
        field: "identifier_kind",
        message: `Invalid identifier_kind "${identKindRaw}"`,
      });
      continue;
    }

    const identValue = cell("identifier_value");
    if (!identValue) {
      errors.push({
        row: rowNumber,
        field: "identifier_value",
        message: "identifier_value is required",
      });
      continue;
    }

    const critRaw = (cell("criticality") || "medium").toLowerCase();
    if (!inList(critRaw, CRITICALITY_LEVELS)) {
      errors.push({
        row: rowNumber,
        field: "criticality",
        message: `Invalid criticality "${critRaw}"`,
      });
      continue;
    }

    const privRaw = (cell("privilege_level") || "none").toLowerCase();
    if (!inList(privRaw, PRIVILEGE_LEVELS)) {
      errors.push({
        row: rowNumber,
        field: "privilege_level",
        message: `Invalid privilege_level "${privRaw}"`,
      });
      continue;
    }

    const expRaw = (cell("exposure") || "internal").toLowerCase();
    if (!inList(expRaw, EXPOSURE_LEVELS)) {
      errors.push({
        row: rowNumber,
        field: "exposure",
        message: `Invalid exposure "${expRaw}"`,
      });
      continue;
    }

    const envRaw = (cell("environment") || "unknown").toLowerCase();
    if (!inList(envRaw, ENVIRONMENT_KINDS)) {
      errors.push({
        row: rowNumber,
        field: "environment",
        message: `Invalid environment "${envRaw}"`,
      });
      continue;
    }

    const recRaw = (cell("recovery_priority") || "none").toLowerCase();
    if (!inList(recRaw, RECOVERY_PRIORITIES)) {
      errors.push({
        row: rowNumber,
        field: "recovery_priority",
        message: `Invalid recovery_priority "${recRaw}"`,
      });
      continue;
    }

    rows.push({
      rowNumber,
      organisationId,
      kind,
      displayName,
      primaryIdentifierKind: identKindRaw as EntityIdentifier["kind"],
      primaryIdentifierValue: identValue,
      criticality: critRaw as CriticalityLevel,
      privilegeLevel: privRaw as PrivilegeLevel,
      exposure: expRaw as ExposureLevel,
      environment: envRaw as EnvironmentKind,
      isCrownJewel: parseBool(cell("is_crown_jewel")),
      recoveryPriority: recRaw as RecoveryPriority,
      ownerTeam: cell("owner_team") || null,
      ownerEmail: cell("owner_email") || null,
      businessService: cell("business_service") || null,
      applicationName: cell("application_name") || null,
      dataClassifications: parseList(cell("data_classifications")),
      regulatoryScope: parseList(cell("regulatory_scope")),
      providerSource,
      providerExternalId: cell("external_id") || null,
    });
  }

  return { rows, errors };
}

export async function runContextImport(opts: {
  organisationId: string;
  source: ContextImportSource;
  actorId: string | null;
  dryRun: boolean;
  /** Pre-parsed rows (REST/Entra/Defender) or CSV text. */
  csvText?: string;
  rows?: UpsertContextInput[];
}): Promise<ImportResult> {
  let parsedRows: ParsedContextRow[] = [];
  let parseErrors: ImportRowError[] = [];

  if (opts.csvText != null) {
    const parsed = parseContextCsv(opts.csvText, opts.organisationId, opts.source);
    parsedRows = parsed.rows;
    parseErrors = parsed.errors;
  } else if (opts.rows) {
    parsedRows = opts.rows.map((r, i) => ({ ...r, rowNumber: i + 1 }));
  } else {
    throw new AssetContextError("csvText or rows is required");
  }

  const runId = newId("cirun");
  const [run] = await db
    .insert(contextImportRuns)
    .values({
      id: runId,
      organisationId: opts.organisationId,
      source: opts.source,
      status: opts.dryRun ? "dry_run" : "completed",
      dryRun: opts.dryRun,
      rowCount: parsedRows.length + parseErrors.length,
      successCount: 0,
      errorCount: parseErrors.length,
      createdCount: 0,
      updatedCount: 0,
      skippedCount: 0,
      errors: parseErrors,
      summary: {},
      startedBy: opts.actorId,
    })
    .returning();

  if (opts.dryRun) {
    const [finished] = await db
      .update(contextImportRuns)
      .set({
        finishedAt: new Date(),
        successCount: parsedRows.length,
        summary: {
          wouldCreateOrUpdate: parsedRows.length,
          validationErrors: parseErrors.length,
        },
      })
      .where(eq(contextImportRuns.id, runId))
      .returning();
    return { run: finished ?? run!, rows: parsedRows, errors: parseErrors };
  }

  let createdCount = 0;
  let updatedCount = 0;
  const runtimeErrors: ImportRowError[] = [...parseErrors];

  for (const row of parsedRows) {
    try {
      const { created } = await upsertContextFromProvider({
        ...row,
        actorId: opts.actorId,
        markSyncOk: true,
      });
      if (created) createdCount++;
      else updatedCount++;
    } catch (err) {
      runtimeErrors.push({
        row: row.rowNumber,
        message: err instanceof Error ? err.message : "Unknown import error",
      });
    }
  }

  const successCount = createdCount + updatedCount;
  const status =
    runtimeErrors.length === 0
      ? "completed"
      : successCount > 0
        ? "partial"
        : "failed";

  const [finished] = await db
    .update(contextImportRuns)
    .set({
      status,
      successCount,
      errorCount: runtimeErrors.length,
      createdCount,
      updatedCount,
      errors: runtimeErrors,
      finishedAt: new Date(),
      summary: { createdCount, updatedCount, errorCount: runtimeErrors.length },
    })
    .where(eq(contextImportRuns.id, runId))
    .returning();

  return {
    run: finished ?? run!,
    rows: parsedRows,
    errors: runtimeErrors,
  };
}

export function csvTemplateHeader(): string {
  return CSV_HEADERS.join(",");
}
