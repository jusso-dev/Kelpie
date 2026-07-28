/**
 * Strict schema for saved case-view configuration (issue #46).
 *
 * Unknown filter / widget / bulk-action fields are rejected so a view can
 * never smuggle arbitrary predicates or action payloads past the allow-list.
 * Column keys, page sizes, and operational view names are also closed sets.
 */
import { z } from "zod";
import { BULK_OPERATION_TYPES } from "@/lib/bulk-operations-core";

export const CASE_VIEW_STATUSES = [
  "open",
  "in_progress",
  "contained",
  "eradicated",
  "recovered",
  "closed",
] as const;

export const CASE_VIEW_SEVERITIES = ["low", "medium", "high", "critical"] as const;

export const CASE_VIEW_CLASSIFICATIONS = [
  "malware",
  "phishing",
  "unauthorised_access",
  "data_breach",
  "dos",
  "policy_violation",
  "other",
] as const;

export const CASE_VIEW_TLPS = ["clear", "green", "amber", "amber_strict", "red"] as const;

export const CASE_VIEW_SORTS = ["priority", "recent", "oldest", "severity"] as const;

/** Built-in operational predicates from #54 (queue views). */
export const CASE_VIEW_OPERATIONAL_VIEWS = [
  "unassigned",
  "mine",
  "watched",
  "sla_warning",
  "sla_breached",
  "awaiting_third_party",
  "awaiting_approval",
  "stale_investigation",
  "recently_reopened",
] as const;

export const CASE_VIEW_PAGE_SIZES = [10, 25, 50, 100] as const;

export const CASE_VIEW_COLUMNS = [
  "number",
  "title",
  "status",
  "severity",
  "sla",
  "tlp",
  "classification",
  "tags",
  "queue",
  "assignee",
  "opened",
  "priority",
] as const;

export const DEFAULT_CASE_VIEW_COLUMNS: CaseViewColumn[] = [
  "number",
  "title",
  "status",
  "severity",
  "sla",
  "tlp",
  "classification",
  "tags",
  "queue",
  "assignee",
  "opened",
];

export const CASE_VIEW_WIDGETS = [
  "severity_breakdown",
  "status_breakdown",
  "sla_summary",
  "workload_summary",
] as const;

export const CASE_VIEW_VISIBILITIES = ["personal", "team", "organisation"] as const;

export const CASE_VIEW_DEFAULT_SCOPES = ["personal", "role", "team"] as const;

export const CASE_VIEW_ROLES = ["admin", "analyst", "read_only"] as const;

export const CASE_VIEW_PRIORITY_BANDS = ["low", "medium", "high", "critical"] as const;

const SOURCE_PATTERN = /^[a-z0-9][a-z0-9_:-]*$/;

const optionalTrimmed = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined));

const bulkPresetParamsSchema = z
  .object({
    queueId: z.string().trim().min(1).max(80).nullable().optional(),
    assigneeId: z.string().trim().min(1).max(80).nullable().optional(),
    userId: z.string().trim().min(1).max(80).optional(),
    tag: z.string().trim().min(1).max(60).optional(),
    severity: z.enum(CASE_VIEW_SEVERITIES).optional(),
    status: z.enum(CASE_VIEW_STATUSES).optional(),
  })
  .strict();

export const bulkPresetSchema = z
  .object({
    id: z.string().trim().min(1).max(80),
    name: z.string().trim().min(1).max(80),
    operationType: z.enum(BULK_OPERATION_TYPES),
    params: bulkPresetParamsSchema.default({}),
  })
  .strict();

/**
 * Full allow-listed view config. `.strict()` rejects unknown keys at every
 * nesting level that uses it.
 */
export const caseViewConfigSchema = z
  .object({
    q: optionalTrimmed(120),
    status: z.enum(CASE_VIEW_STATUSES).optional(),
    severity: z.enum(CASE_VIEW_SEVERITIES).optional(),
    classification: z.enum(CASE_VIEW_CLASSIFICATIONS).optional(),
    tlp: z.enum(CASE_VIEW_TLPS).optional(),
    /** User id, or special tokens "mine" / "unassigned". */
    assignee: optionalTrimmed(80),
    /** Queue id, or special token "none". */
    queueId: optionalTrimmed(80),
    /** Built-in operational view key (#54). */
    view: z.enum(CASE_VIEW_OPERATIONAL_VIEWS).optional(),
    tag: optionalTrimmed(60),
    dataTag: optionalTrimmed(60),
    source: z
      .string()
      .trim()
      .toLowerCase()
      .max(64)
      .regex(SOURCE_PATTERN, "Invalid source")
      .optional()
      .transform((v) => (v && v.length > 0 ? v : undefined)),
    technique: z
      .string()
      .trim()
      .max(32)
      .optional()
      .transform((v) => (v && v.length > 0 ? v.toUpperCase() : undefined)),
    tactic: optionalTrimmed(64),
    sla: z.literal("risk").optional(),
    /** Optional #59 priority band filter. */
    priorityBand: z.enum(CASE_VIEW_PRIORITY_BANDS).optional(),
    /** Optional minimum effective priority score (0–100). */
    minPriorityScore: z.number().int().min(0).max(100).optional(),
    sort: z.enum(CASE_VIEW_SORTS).default("priority"),
    pageSize: z
      .union([
        z.literal(10),
        z.literal(25),
        z.literal(50),
        z.literal(100),
      ])
      .default(50),
    columns: z
      .array(z.enum(CASE_VIEW_COLUMNS))
      .max(CASE_VIEW_COLUMNS.length)
      .superRefine((cols, ctx) => {
        const seen = new Set<string>();
        for (const col of cols) {
          if (seen.has(col)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Duplicate column "${col}"`,
            });
          }
          seen.add(col);
        }
      })
      .default([...DEFAULT_CASE_VIEW_COLUMNS]),
    widgets: z
      .array(z.enum(CASE_VIEW_WIDGETS))
      .max(CASE_VIEW_WIDGETS.length)
      .superRefine((widgets, ctx) => {
        const seen = new Set<string>();
        for (const w of widgets) {
          if (seen.has(w)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Duplicate widget "${w}"`,
            });
          }
          seen.add(w);
        }
      })
      .default([]),
    bulkPresets: z.array(bulkPresetSchema).max(20).default([]),
  })
  .strict();

export type CaseViewConfig = z.infer<typeof caseViewConfigSchema>;
export type CaseViewColumn = (typeof CASE_VIEW_COLUMNS)[number];
export type CaseViewWidget = (typeof CASE_VIEW_WIDGETS)[number];
export type CaseViewVisibility = (typeof CASE_VIEW_VISIBILITIES)[number];
export type CaseViewDefaultScope = (typeof CASE_VIEW_DEFAULT_SCOPES)[number];
export type BulkPreset = z.infer<typeof bulkPresetSchema>;

export function parseCaseViewConfig(input: unknown): CaseViewConfig {
  return caseViewConfigSchema.parse(input ?? {});
}

export function safeParseCaseViewConfig(input: unknown) {
  return caseViewConfigSchema.safeParse(input ?? {});
}

/** Strip undefined keys for stable storage / comparison. */
export function compactCaseViewConfig(config: CaseViewConfig): CaseViewConfig {
  const out: Record<string, unknown> = {
    sort: config.sort,
    pageSize: config.pageSize,
    columns: config.columns,
    widgets: config.widgets,
    bulkPresets: config.bulkPresets,
  };
  for (const key of [
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
  ] as const) {
    const value = config[key];
    if (value !== undefined) out[key] = value;
  }
  return out as CaseViewConfig;
}

export const createCaseViewBodySchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2000).optional().nullable(),
    visibility: z.enum(CASE_VIEW_VISIBILITIES),
    teamId: z.string().trim().min(1).max(80).optional().nullable(),
    config: caseViewConfigSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.visibility === "team" && !value.teamId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "teamId is required for team views",
        path: ["teamId"],
      });
    }
    if (value.visibility !== "team" && value.teamId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "teamId is only valid for team views",
        path: ["teamId"],
      });
    }
  });

export const updateCaseViewBodySchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(2000).optional().nullable(),
    config: caseViewConfigSchema.optional(),
  })
  .strict();

export const setCaseViewDefaultBodySchema = z
  .object({
    scope: z.enum(CASE_VIEW_DEFAULT_SCOPES),
    viewId: z.string().trim().min(1).max(80).nullable(),
    role: z.enum(CASE_VIEW_ROLES).optional(),
    teamId: z.string().trim().min(1).max(80).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.scope === "role" && !value.role) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "role is required for role defaults",
        path: ["role"],
      });
    }
    if (value.scope === "team" && !value.teamId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "teamId is required for team defaults",
        path: ["teamId"],
      });
    }
  });
