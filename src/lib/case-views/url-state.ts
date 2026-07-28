/**
 * URL serialisation for case-list filter state (issue #46).
 *
 * Unsaved result sets stay linkable as ordinary query strings. A saved view
 * is referenced with `savedView=<id>`; when the view is applied its config
 * is also expanded into query params so backwards-compatible links and
 * shareable unsaved edits both work.
 */
import {
  CASE_VIEW_CLASSIFICATIONS,
  CASE_VIEW_COLUMNS,
  CASE_VIEW_OPERATIONAL_VIEWS,
  CASE_VIEW_PAGE_SIZES,
  CASE_VIEW_PRIORITY_BANDS,
  CASE_VIEW_SEVERITIES,
  CASE_VIEW_SORTS,
  CASE_VIEW_STATUSES,
  CASE_VIEW_TLPS,
  type CaseViewColumn,
  type CaseViewConfig,
  compactCaseViewConfig,
  parseCaseViewConfig,
} from "./config";

export type CaseListUrlState = {
  q?: string;
  status?: (typeof CASE_VIEW_STATUSES)[number];
  severity?: (typeof CASE_VIEW_SEVERITIES)[number];
  classification?: (typeof CASE_VIEW_CLASSIFICATIONS)[number];
  tlp?: (typeof CASE_VIEW_TLPS)[number];
  assignee?: string;
  queueId?: string;
  view?: (typeof CASE_VIEW_OPERATIONAL_VIEWS)[number];
  tag?: string;
  dataTag?: string;
  source?: string;
  technique?: string;
  tactic?: string;
  sla?: "risk";
  priorityBand?: (typeof CASE_VIEW_PRIORITY_BANDS)[number];
  minPriorityScore?: number;
  sort: (typeof CASE_VIEW_SORTS)[number];
  pageSize: (typeof CASE_VIEW_PAGE_SIZES)[number];
  page: number;
  /** Optional reference to a saved view; missing/inaccessible → standard list. */
  savedView?: string;
  columns?: CaseViewColumn[];
};

const SOURCE_PATTERN = /^[a-z0-9][a-z0-9_:-]*$/;

function first(
  raw: string | string[] | undefined | null,
): string | undefined {
  if (raw == null) return undefined;
  return Array.isArray(raw) ? raw[0] : raw;
}

function pick<const T extends readonly string[]>(
  values: T,
  raw: string | undefined,
): T[number] | undefined {
  return raw && (values as readonly string[]).includes(raw)
    ? (raw as T[number])
    : undefined;
}

function cleanText(raw: string | undefined, max: number): string | undefined {
  const value = raw?.trim().slice(0, max);
  return value || undefined;
}

function normaliseSource(raw: string | undefined): string | undefined {
  const value = raw?.trim().toLowerCase().slice(0, 64);
  return value && SOURCE_PATTERN.test(value) ? value : undefined;
}

function parseColumns(raw: string | undefined): CaseViewColumn[] | undefined {
  if (!raw) return undefined;
  const parts = raw
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  const cols: CaseViewColumn[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    if (!(CASE_VIEW_COLUMNS as readonly string[]).includes(part)) continue;
    if (seen.has(part)) continue;
    seen.add(part);
    cols.push(part as CaseViewColumn);
  }
  return cols.length > 0 ? cols : undefined;
}

/**
 * Parse search params into a normalised case-list URL state.
 * Unknown / invalid values are dropped (backwards-compatible with old links).
 */
export function parseCaseListUrlState(
  raw: Record<string, string | string[] | undefined> | URLSearchParams,
): CaseListUrlState {
  const get = (key: string): string | undefined => {
    if (raw instanceof URLSearchParams) return raw.get(key) ?? undefined;
    return first(raw[key]);
  };

  const rawPage = Number(get("page"));
  const rawPageSize = Number(get("pageSize"));
  const rawMinPriority = Number(get("minPriorityScore"));

  return {
    q: cleanText(get("q"), 120),
    status: pick(CASE_VIEW_STATUSES, get("status")),
    severity: pick(CASE_VIEW_SEVERITIES, get("severity")),
    classification: pick(CASE_VIEW_CLASSIFICATIONS, get("classification")),
    tlp: pick(CASE_VIEW_TLPS, get("tlp")),
    assignee: cleanText(get("assignee"), 80),
    queueId: cleanText(get("queueId"), 80),
    view: pick(CASE_VIEW_OPERATIONAL_VIEWS, get("view")),
    tag: cleanText(get("tag"), 60),
    dataTag: cleanText(get("dataTag"), 60),
    source: normaliseSource(get("source")),
    technique: cleanText(get("technique"), 32)?.toUpperCase(),
    tactic: cleanText(get("tactic"), 64),
    sla: get("sla") === "risk" ? "risk" : undefined,
    priorityBand: pick(CASE_VIEW_PRIORITY_BANDS, get("priorityBand")),
    minPriorityScore:
      Number.isInteger(rawMinPriority) &&
      rawMinPriority >= 0 &&
      rawMinPriority <= 100
        ? rawMinPriority
        : undefined,
    sort: pick(CASE_VIEW_SORTS, get("sort")) ?? "priority",
    pageSize:
      (CASE_VIEW_PAGE_SIZES as readonly number[]).includes(rawPageSize)
        ? (rawPageSize as (typeof CASE_VIEW_PAGE_SIZES)[number])
        : 50,
    page:
      Number.isInteger(rawPage) && rawPage > 0
        ? Math.min(rawPage, 10_000)
        : 1,
    savedView: cleanText(get("savedView"), 80),
    columns: parseColumns(get("columns")),
  };
}

/** Serialise state to a query string (including leading `?`, or empty). */
export function serializeCaseListUrlState(
  state: CaseListUrlState,
  updates: Partial<Record<keyof CaseListUrlState, string | number | string[] | undefined>> = {},
): string {
  const merged: CaseListUrlState = { ...state, ...updates } as CaseListUrlState;
  const params = new URLSearchParams();

  const setIf = (key: string, value: string | number | undefined) => {
    if (value === undefined || value === "") return;
    if (key === "sort" && value === "priority") return;
    if (key === "pageSize" && value === 50) return;
    if (key === "page" && value === 1) return;
    params.set(key, String(value));
  };

  setIf("q", merged.q);
  setIf("status", merged.status);
  setIf("severity", merged.severity);
  setIf("classification", merged.classification);
  setIf("tlp", merged.tlp);
  setIf("assignee", merged.assignee);
  setIf("queueId", merged.queueId);
  setIf("view", merged.view);
  setIf("tag", merged.tag);
  setIf("dataTag", merged.dataTag);
  setIf("source", merged.source);
  setIf("technique", merged.technique);
  setIf("tactic", merged.tactic);
  setIf("sla", merged.sla);
  setIf("priorityBand", merged.priorityBand);
  setIf("minPriorityScore", merged.minPriorityScore);
  setIf("sort", merged.sort);
  setIf("pageSize", merged.pageSize);
  setIf("page", merged.page);
  setIf("savedView", merged.savedView);
  if (merged.columns && merged.columns.length > 0) {
    params.set("columns", merged.columns.join(","));
  }

  const value = params.toString();
  return value ? `?${value}` : "";
}

/** Project URL state into a CaseViewConfig (drops page / savedView). */
export function urlStateToConfig(state: CaseListUrlState): CaseViewConfig {
  return compactCaseViewConfig(
    parseCaseViewConfig({
      q: state.q,
      status: state.status,
      severity: state.severity,
      classification: state.classification,
      tlp: state.tlp,
      assignee: state.assignee,
      queueId: state.queueId,
      view: state.view,
      tag: state.tag,
      dataTag: state.dataTag,
      source: state.source,
      technique: state.technique,
      tactic: state.tactic,
      sla: state.sla,
      priorityBand: state.priorityBand,
      minPriorityScore: state.minPriorityScore,
      sort: state.sort,
      pageSize: state.pageSize,
      columns: state.columns,
    }),
  );
}

/** Expand a saved config into URL state (page resets to 1). */
export function configToUrlState(
  config: CaseViewConfig,
  opts: { savedViewId?: string; page?: number } = {},
): CaseListUrlState {
  return {
    q: config.q,
    status: config.status,
    severity: config.severity,
    classification: config.classification,
    tlp: config.tlp,
    assignee: config.assignee,
    queueId: config.queueId,
    view: config.view,
    tag: config.tag,
    dataTag: config.dataTag,
    source: config.source,
    technique: config.technique,
    tactic: config.tactic,
    sla: config.sla,
    priorityBand: config.priorityBand,
    minPriorityScore: config.minPriorityScore,
    sort: config.sort,
    pageSize: config.pageSize,
    page: opts.page ?? 1,
    savedView: opts.savedViewId,
    columns: config.columns,
  };
}

/**
 * True when the active URL filters still match the saved view config
 * (ignoring page). Used to show a "dirty" / unsaved-edits indicator.
 */
export function urlStateMatchesConfig(
  state: CaseListUrlState,
  config: CaseViewConfig,
): boolean {
  const fromUrl = urlStateToConfig(state);
  const baseline = compactCaseViewConfig(config);
  // Compare filter fields only; widgets/presets are not in the URL.
  const keys = [
    "q",
    "status",
    "severity",
    "classification",
    "tlp",
    "assignee",
    "queueId",
    "view",
    "tag",
    "dataTag",
    "source",
    "technique",
    "tactic",
    "sla",
    "priorityBand",
    "minPriorityScore",
    "sort",
    "pageSize",
  ] as const;
  for (const key of keys) {
    if (fromUrl[key] !== baseline[key]) return false;
  }
  const urlCols = (fromUrl.columns ?? []).join(",");
  const baseCols = (baseline.columns ?? []).join(",");
  return urlCols === baseCols;
}
