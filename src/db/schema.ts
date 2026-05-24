import {
  pgTable,
  text,
  timestamp,
  integer,
  boolean,
  bigint,
  jsonb,
  index,
  uniqueIndex,
  pgEnum,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/* ────────────────────────────────────────────────────────────────────────── */
/* Enums                                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

export const roleEnum = pgEnum("role", ["admin", "analyst", "read_only"]);

export const alertStatusEnum = pgEnum("alert_status", [
  "new",
  "triaged",
  "dismissed",
  "promoted",
]);

export const caseStatusEnum = pgEnum("case_status", [
  "open",
  "in_progress",
  "contained",
  "eradicated",
  "recovered",
  "closed",
]);

export const severityEnum = pgEnum("severity", [
  "low",
  "medium",
  "high",
  "critical",
]);

export const tlpEnum = pgEnum("tlp", [
  "clear",
  "green",
  "amber",
  "amber_strict",
  "red",
]);

export const papEnum = pgEnum("pap", ["clear", "green", "amber", "red"]);

export const taskStatusEnum = pgEnum("task_status", [
  "todo",
  "in_progress",
  "done",
  "blocked",
]);

export const observableTypeEnum = pgEnum("observable_type", [
  "ip",
  "domain",
  "url",
  "file_hash",
  "email",
  "hostname",
  "username",
  "registry_key",
  "other",
]);

export const classificationEnum = pgEnum("classification", [
  "malware",
  "phishing",
  "unauthorised_access",
  "data_breach",
  "dos",
  "policy_violation",
  "other",
]);

/* ────────────────────────────────────────────────────────────────────────── */
/* Organisations + BetterAuth tables                                          */
/* ────────────────────────────────────────────────────────────────────────── */

export const organisations = pgTable("organisations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  settings: jsonb("settings").notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  organisationId: text("organisation_id").references(() => organisations.id, {
    onDelete: "set null",
  }),
  role: roleEnum("role").notNull().default("analyst"),
  timezone: text("timezone").notNull().default("Australia/Sydney"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const accounts = pgTable("accounts", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", {
    withTimezone: true,
  }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
    withTimezone: true,
  }),
  scope: text("scope"),
  idToken: text("id_token"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const verifications = pgTable("verifications", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/* ────────────────────────────────────────────────────────────────────────── */
/* Alerts                                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

export const alerts = pgTable(
  "alerts",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    externalRef: text("external_ref"),
    title: text("title").notNull(),
    description: text("description"),
    severity: severityEnum("severity").notNull().default("medium"),
    status: alertStatusEnum("status").notNull().default("new"),
    rawPayload: jsonb("raw_payload").notNull().default(sql`'{}'::jsonb`),
    observables: jsonb("observables").notNull().default(sql`'[]'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    triagedBy: text("triaged_by").references(() => users.id, {
      onDelete: "set null",
    }),
    triagedAt: timestamp("triaged_at", { withTimezone: true }),
    promotedCaseId: text("promoted_case_id"),
  },
  (t) => [
    index("alerts_org_status_idx").on(t.organisationId, t.status),
    index("alerts_org_created_idx").on(t.organisationId, t.createdAt),
  ],
);

/* ────────────────────────────────────────────────────────────────────────── */
/* Cases                                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

export const caseSequences = pgTable("case_sequences", {
  organisationId: text("organisation_id")
    .primaryKey()
    .references(() => organisations.id, { onDelete: "cascade" }),
  year: integer("year").notNull(),
  lastNumber: integer("last_number").notNull().default(0),
});

export const cases = pgTable(
  "cases",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    caseNumber: text("case_number").notNull(),
    title: text("title").notNull(),
    summary: text("summary"),
    status: caseStatusEnum("status").notNull().default("open"),
    severity: severityEnum("severity").notNull().default("medium"),
    tlp: tlpEnum("tlp").notNull().default("amber"),
    pap: papEnum("pap").notNull().default("amber"),
    assigneeId: text("assignee_id").references(() => users.id, {
      onDelete: "set null",
    }),
    reporterId: text("reporter_id").references(() => users.id, {
      onDelete: "set null",
    }),
    classification: classificationEnum("classification")
      .notNull()
      .default("other"),
    sourceAlertId: text("source_alert_id").references(() => alerts.id, {
      onDelete: "set null",
    }),
    openedAt: timestamp("opened_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closureReason: text("closure_reason"),
    closureSummary: text("closure_summary"),
    mitreTechniques: jsonb("mitre_techniques")
      .notNull()
      .default(sql`'[]'::jsonb`),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    containedAt: timestamp("contained_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    slaState: jsonb("sla_state").notNull().default(sql`'{}'::jsonb`),
  },
  (t) => [
    uniqueIndex("cases_org_number_idx").on(t.organisationId, t.caseNumber),
    index("cases_org_status_idx").on(t.organisationId, t.status),
    index("cases_org_opened_idx").on(t.organisationId, t.openedAt),
  ],
);

/* ────────────────────────────────────────────────────────────────────────── */
/* Playbooks                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

export const playbooks = pgTable("playbooks", {
  id: text("id").primaryKey(),
  organisationId: text("organisation_id")
    .notNull()
    .references(() => organisations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  classification: classificationEnum("classification")
    .notNull()
    .default("other"),
  isActive: boolean("is_active").notNull().default(true),
  steps: jsonb("steps").notNull().default(sql`'[]'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const playbookRuns = pgTable("playbook_runs", {
  id: text("id").primaryKey(),
  caseId: text("case_id")
    .notNull()
    .references(() => cases.id, { onDelete: "cascade" }),
  playbookId: text("playbook_id")
    .notNull()
    .references(() => playbooks.id, { onDelete: "restrict" }),
  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  startedBy: text("started_by").references(() => users.id, {
    onDelete: "set null",
  }),
});

/* ────────────────────────────────────────────────────────────────────────── */
/* Case tasks                                                                 */
/* ────────────────────────────────────────────────────────────────────────── */

export const caseTasks = pgTable(
  "case_tasks",
  {
    id: text("id").primaryKey(),
    caseId: text("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    status: taskStatusEnum("status").notNull().default("todo"),
    assigneeId: text("assignee_id").references(() => users.id, {
      onDelete: "set null",
    }),
    dueAt: timestamp("due_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedBy: text("completed_by").references(() => users.id, {
      onDelete: "set null",
    }),
    orderIndex: integer("order_index").notNull().default(0),
    playbookRunId: text("playbook_run_id").references(() => playbookRuns.id, {
      onDelete: "set null",
    }),
    playbookStepId: text("playbook_step_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("case_tasks_case_idx").on(t.caseId)],
);

/* ────────────────────────────────────────────────────────────────────────── */
/* Observables                                                                */
/* ────────────────────────────────────────────────────────────────────────── */

export const observables = pgTable(
  "observables",
  {
    id: text("id").primaryKey(),
    caseId: text("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    type: observableTypeEnum("type").notNull(),
    value: text("value").notNull(),
    tlp: tlpEnum("tlp").notNull().default("amber"),
    isIoc: boolean("is_ioc").notNull().default(false),
    description: text("description"),
    firstSeen: timestamp("first_seen", { withTimezone: true }),
    tags: jsonb("tags").notNull().default(sql`'[]'::jsonb`),
    enrichment: jsonb("enrichment").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (t) => [
    index("observables_value_idx").on(t.value),
    index("observables_case_idx").on(t.caseId),
  ],
);

/* ────────────────────────────────────────────────────────────────────────── */
/* Timeline                                                                   */
/* ────────────────────────────────────────────────────────────────────────── */

export const timelineEvents = pgTable(
  "timeline_events",
  {
    id: text("id").primaryKey(),
    caseId: text("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    actorId: text("actor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("timeline_case_idx").on(t.caseId, t.occurredAt)],
);

/* ────────────────────────────────────────────────────────────────────────── */
/* Comments                                                                   */
/* ────────────────────────────────────────────────────────────────────────── */

export const comments = pgTable(
  "comments",
  {
    id: text("id").primaryKey(),
    caseId: text("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    authorId: text("author_id").references(() => users.id, {
      onDelete: "set null",
    }),
    body: text("body").notNull(),
    mentions: jsonb("mentions").notNull().default(sql`'[]'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    editedAt: timestamp("edited_at", { withTimezone: true }),
  },
  (t) => [index("comments_case_idx").on(t.caseId, t.createdAt)],
);

/* ────────────────────────────────────────────────────────────────────────── */
/* Attachments                                                                */
/* ────────────────────────────────────────────────────────────────────────── */

export const attachments = pgTable(
  "attachments",
  {
    id: text("id").primaryKey(),
    caseId: text("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    storageKey: text("storage_key").notNull(),
    sha256: text("sha256").notNull(),
    uploadedBy: text("uploaded_by").references(() => users.id, {
      onDelete: "set null",
    }),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("attachments_case_idx").on(t.caseId)],
);

/* ────────────────────────────────────────────────────────────────────────── */
/* SLA policies (foundation for phase 2 work)                                 */
/* ────────────────────────────────────────────────────────────────────────── */

export const slaPolicies = pgTable(
  "sla_policies",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    severity: severityEnum("severity").notNull(),
    timeToAcknowledgeMinutes: integer("time_to_acknowledge_minutes").notNull(),
    timeToContainMinutes: integer("time_to_contain_minutes").notNull(),
    timeToResolveMinutes: integer("time_to_resolve_minutes").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("sla_policies_org_severity_idx").on(
      t.organisationId,
      t.severity,
    ),
  ],
);

/* ────────────────────────────────────────────────────────────────────────── */
/* Case templates                                                             */
/* ────────────────────────────────────────────────────────────────────────── */

export const caseTemplates = pgTable("case_templates", {
  id: text("id").primaryKey(),
  organisationId: text("organisation_id")
    .notNull()
    .references(() => organisations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  classification: classificationEnum("classification")
    .notNull()
    .default("other"),
  defaultSeverity: severityEnum("default_severity").notNull().default("medium"),
  defaultTlp: tlpEnum("default_tlp").notNull().default("amber"),
  summaryTemplate: text("summary_template"),
  defaultPlaybookId: text("default_playbook_id").references(() => playbooks.id, {
    onDelete: "set null",
  }),
  defaultTasks: jsonb("default_tasks").notNull().default(sql`'[]'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/* ────────────────────────────────────────────────────────────────────────── */
/* API tokens                                                                 */
/* ────────────────────────────────────────────────────────────────────────── */

export const apiTokens = pgTable("api_tokens", {
  id: text("id").primaryKey(),
  organisationId: text("organisation_id")
    .notNull()
    .references(() => organisations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  scopes: jsonb("scopes").notNull().default(sql`'[]'::jsonb`),
  createdBy: text("created_by").references(() => users.id, {
    onDelete: "set null",
  }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  lastUsedIp: text("last_used_ip"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  deprecatedAt: timestamp("deprecated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/* ────────────────────────────────────────────────────────────────────────── */
/* Webhooks                                                                   */
/* ────────────────────────────────────────────────────────────────────────── */

export const webhooks = pgTable("webhooks", {
  id: text("id").primaryKey(),
  organisationId: text("organisation_id")
    .notNull()
    .references(() => organisations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  url: text("url").notNull(),
  secret: text("secret").notNull(),
  events: jsonb("events").notNull().default(sql`'[]'::jsonb`),
  isActive: boolean("is_active").notNull().default(true),
  createdBy: text("created_by").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: text("id").primaryKey(),
    webhookId: text("webhook_id")
      .notNull()
      .references(() => webhooks.id, { onDelete: "cascade" }),
    event: text("event").notNull(),
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
    status: text("status").notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    lastResponseCode: integer("last_response_code"),
    lastResponseBody: text("last_response_body"),
    lastError: text("last_error"),
    latencyMs: integer("latency_ms"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("webhook_deliveries_pending_idx").on(t.status, t.nextAttemptAt),
    index("webhook_deliveries_webhook_idx").on(t.webhookId, t.createdAt),
  ],
);

/* ────────────────────────────────────────────────────────────────────────── */
/* Enrichment cache                                                           */
/* ────────────────────────────────────────────────────────────────────────── */

export const enrichmentCache = pgTable(
  "enrichment_cache",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull(),
    valueHash: text("value_hash").notNull(),
    type: text("type").notNull(),
    response: jsonb("response").notNull().default(sql`'{}'::jsonb`),
    fetchedAt: timestamp("fetched_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("enrichment_cache_provider_type_value_idx").on(
      t.provider,
      t.type,
      t.valueHash,
    ),
    index("enrichment_cache_expires_idx").on(t.expiresAt),
  ],
);

export type Organisation = typeof organisations.$inferSelect;
export type User = typeof users.$inferSelect;
export type Alert = typeof alerts.$inferSelect;
export type Case = typeof cases.$inferSelect;
export type CaseTask = typeof caseTasks.$inferSelect;
export type Observable = typeof observables.$inferSelect;
export type TimelineEvent = typeof timelineEvents.$inferSelect;
export type Comment = typeof comments.$inferSelect;
export type Attachment = typeof attachments.$inferSelect;
export type Playbook = typeof playbooks.$inferSelect;
export type PlaybookRun = typeof playbookRuns.$inferSelect;
export type SlaPolicy = typeof slaPolicies.$inferSelect;
export type CaseTemplate = typeof caseTemplates.$inferSelect;
export type ApiToken = typeof apiTokens.$inferSelect;
export type Webhook = typeof webhooks.$inferSelect;
export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;
export type EnrichmentCacheRow = typeof enrichmentCache.$inferSelect;

export type PlaybookStep = {
  id: string;
  title: string;
  description?: string;
  defaultAssigneeRole?: "admin" | "analyst" | "read_only";
  offsetMinutes: number;
  isRequired: boolean;
};
