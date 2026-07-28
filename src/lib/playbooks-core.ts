/**
 * Read-only playbook catalogue queries, shared by the browser UI, the REST
 * API (`/api/v1/playbooks`), and the MCP `playbooks_list` / `playbooks_get`
 * tools. Every function requires an already-resolved `organisationId` and
 * only ever reads rows scoped to it — this is the sole data path agents and
 * scoped API tokens use to discover playbooks, so it must never leak another
 * organisation's catalogue.
 */
import { db } from "@/db";
import { playbooks } from "@/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { normalizeTag } from "./tags";

export type PlaybookListFilter = {
  /** Baseline catalogue scenario key (`playbooks.catalogue_key`), exact match. */
  scenario?: string;
  classification?: string;
  severity?: string;
  /** Exact tag match (normalised the same way tags are stored). */
  tag?: string;
  /** Required observable type, exact match against `requiredObservableTypes`. */
  observableType?: string;
  /** Case-insensitive substring match against name/description. */
  q?: string;
  /** Include deactivated playbooks. Defaults to active-only. */
  includeInactive?: boolean;
};

export type PlaybookSummary = {
  id: string;
  name: string;
  description: string | null;
  classification: string;
  defaultSeverity: string | null;
  isActive: boolean;
  tags: string[];
  requiredObservableTypes: string[];
  catalogueKey: string | null;
  catalogueVersion: number | null;
  /** Provenance: `true` for a baseline-catalogue playbook (has a catalogue
   * key), `false` for an organisation-authored custom playbook. A baseline
   * playbook that has since been edited is still `isBaseline: true` — this
   * reflects where it came from, not whether it has been customised. */
  isBaseline: boolean;
  stepCount: number;
  createdAt: string;
};

export type PlaybookDetail = PlaybookSummary & {
  steps: unknown[];
  content: Record<string, unknown>;
};

type PlaybookRow = typeof playbooks.$inferSelect;

function toSummary(row: PlaybookRow): PlaybookSummary {
  const steps = Array.isArray(row.steps) ? row.steps : [];
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    classification: row.classification,
    defaultSeverity: row.defaultSeverity,
    isActive: row.isActive,
    tags: Array.isArray(row.tags) ? (row.tags as string[]) : [],
    requiredObservableTypes: Array.isArray(row.requiredObservableTypes)
      ? (row.requiredObservableTypes as string[])
      : [],
    catalogueKey: row.catalogueKey,
    catalogueVersion: row.catalogueVersion,
    isBaseline: row.catalogueKey !== null,
    stepCount: steps.length,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listPlaybooksCore(
  organisationId: string,
  filter: PlaybookListFilter = {},
): Promise<PlaybookSummary[]> {
  const rows = await db
    .select()
    .from(playbooks)
    .where(eq(playbooks.organisationId, organisationId))
    .orderBy(asc(playbooks.name));

  const q = filter.q?.trim().toLowerCase() || undefined;
  const tag = filter.tag ? normalizeTag(filter.tag) : undefined;

  return rows
    .filter((row) => filter.includeInactive || row.isActive)
    .filter((row) => !filter.scenario || row.catalogueKey === filter.scenario)
    .filter(
      (row) => !filter.classification || row.classification === filter.classification,
    )
    .filter((row) => !filter.severity || row.defaultSeverity === filter.severity)
    .filter((row) => {
      if (!tag) return true;
      const tags = Array.isArray(row.tags) ? (row.tags as string[]) : [];
      return tags.includes(tag);
    })
    .filter((row) => {
      if (!filter.observableType) return true;
      const types = Array.isArray(row.requiredObservableTypes)
        ? (row.requiredObservableTypes as string[])
        : [];
      return types.includes(filter.observableType);
    })
    .filter((row) => {
      if (!q) return true;
      const haystack = `${row.name} ${row.description ?? ""}`.toLowerCase();
      return haystack.includes(q);
    })
    .map(toSummary);
}

export async function getPlaybookCore(
  organisationId: string,
  playbookId: string,
): Promise<PlaybookDetail | null> {
  const [row] = await db
    .select()
    .from(playbooks)
    .where(and(eq(playbooks.id, playbookId), eq(playbooks.organisationId, organisationId)))
    .limit(1);
  if (!row) return null;
  return {
    ...toSummary(row),
    steps: Array.isArray(row.steps) ? row.steps : [],
    content:
      row.content && typeof row.content === "object" && !Array.isArray(row.content)
        ? (row.content as Record<string, unknown>)
        : {},
  };
}
