import type { AuditEventFilters } from "./search";

/** Anything shaped like `FormData`/`URLSearchParams` — both expose `.get(key)`. */
export interface AuditFilterSource {
  get(key: string): FormDataEntryValue | null;
}

function trimmedOrUndefined(raw: FormDataEntryValue | null | undefined): string | undefined {
  if (typeof raw !== "string") return undefined;
  const value = raw.trim();
  return value ? value : undefined;
}

function parseFilterDate(raw: FormDataEntryValue | null | undefined): Date | undefined {
  const value = trimmedOrUndefined(raw);
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * The single place `AuditEventFilters` are parsed from user input. Shared by
 * the export server action, the `audit:read` v1 API route, and the admin
 * search page so an export can never see a different set of rows than the
 * equivalent search (issue #45: "Exports enforce identical filters and
 * permissions"). Kept out of `src/actions/audit.ts` because every export of a
 * `"use server"` module must itself be an async Server Action — this is a
 * plain synchronous helper, not an action.
 */
export function auditFiltersFromSource(source: AuditFilterSource): AuditEventFilters {
  return {
    action: trimmedOrUndefined(source.get("action")),
    actorId: trimmedOrUndefined(source.get("actorId")),
    targetType: trimmedOrUndefined(source.get("targetType")),
    targetId: trimmedOrUndefined(source.get("targetId")),
    from: parseFilterDate(source.get("from")),
    to: parseFilterDate(source.get("to")),
    q: trimmedOrUndefined(source.get("q")),
  };
}
