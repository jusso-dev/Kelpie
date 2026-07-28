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
  check,
  foreignKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { PlaybookGuidanceCategory } from "@/lib/attack/playbook-guidance";

/* ────────────────────────────────────────────────────────────────────────── */
/* Enums                                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

export const roleEnum = pgEnum("role", ["admin", "analyst", "read_only"]);

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

/**
 * Canonical storage form only has three directional/symmetric shapes.
 * `child_of` is a user-facing/API-facing spelling that is canonicalised to
 * `parent_of` with source/target swapped before storage, so a parent/child
 * pair can never be stored twice under two different type spellings.
 */
export const caseRelationshipTypeEnum = pgEnum("case_relationship_type", [
  "duplicate_of",
  "related_to",
  "parent_of",
]);

export const caseRelationshipOriginEnum = pgEnum("case_relationship_origin", [
  "analyst",
  "provider",
  "rule",
]);

export const evidenceStatusEnum = pgEnum("evidence_status", [
  "pending_scan",
  "available",
  "quarantined",
  "scan_failed",
]);

export const evidenceRelevanceEnum = pgEnum("evidence_relevance", [
  "unknown",
  "relevant",
  "not_relevant",
]);

/**
 * What a case is currently blocked on, set explicitly by an analyst. This is
 * deliberately separate from `case_status` (the incident lifecycle) so
 * "awaiting third party" / "awaiting approval" built-in views can be
 * indexed queries rather than a guess derived from status or free-text.
 */
export const caseWaitingReasonEnum = pgEnum("case_waiting_reason", [
  "none",
  "third_party",
  "approval",
]);

/**
 * `alert` maps to #55's normalized `alerts` table (`mapping-core.ts`'s
 * `resolveEntityCase` verifies the alert belongs to the caller's
 * organisation the same way every other entity type does before allowing a
 * write against it).
 */
export const attackMappingEntityTypeEnum = pgEnum("attack_mapping_entity_type", [
  "case",
  "alert",
  "observable",
  "evidence",
  "task",
]);

export const attackDomainEnum = pgEnum("attack_domain", [
  "enterprise",
  "mobile",
  "ics",
]);

export const attackCatalogSourceEnum = pgEnum("attack_catalog_source", [
  "bundled_baseline",
  "url_import",
]);

export const attackCatalogStatusEnum = pgEnum("attack_catalog_status", [
  "pending",
  "active",
  "superseded",
  "failed",
  "rolled_back",
]);

export const attackStoryProvenanceEnum = pgEnum("attack_story_provenance", [
  "analyst",
  "provider",
]);

export const assetContextKindEnum = pgEnum("asset_context_kind", [
  "asset",
  "identity",
  "application",
  "business_service",
]);

export const privilegeLevelEnum = pgEnum("privilege_level", [
  "none",
  "standard",
  "elevated",
  "privileged",
  "admin",
  "domain_admin",
]);

export const recoveryPriorityEnum = pgEnum("recovery_priority", [
  "p1",
  "p2",
  "p3",
  "p4",
  "none",
]);

export const contextSyncStatusEnum = pgEnum("context_sync_status", [
  "ok",
  "stale",
  "failed",
  "never_synced",
]);

export const contextImportSourceEnum = pgEnum("context_import_source", [
  "csv",
  "rest",
  "entra",
  "defender",
  "cmdb",
  "manual",
]);

export const contextImportRunStatusEnum = pgEnum("context_import_run_status", [
  "dry_run",
  "completed",
  "failed",
  "partial",
]);

export const priorityScoreBandEnum = pgEnum("priority_score_band", [
  "low",
  "medium",
  "high",
  "critical",
]);

export const staleContextPolicyEnum = pgEnum("stale_context_policy", [
  "discount",
  "exclude",
  "include",
]);

export const entityMatchReviewStatusEnum = pgEnum("entity_match_review_status", [
  "pending",
  "linked",
  "dismissed",
]);

/* ────────────────────────────────────────────────────────────────────────── */
/* Investigation data model: alerts, entities, evidence items (issue #55)    */
/* ────────────────────────────────────────────────────────────────────────── */

export const entityTypeEnum = pgEnum("entity_type", [
  "user_identity",
  "device_endpoint",
  "mailbox",
  "email_message",
  "ip",
  "domain",
  "url",
  "file",
  "file_hash",
  "process",
  "cloud_resource",
  "application",
  "tenant",
  "network",
  "asset",
]);

export const entityIdentifierKindEnum = pgEnum("entity_identifier_kind", [
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
]);

export const alertSeverityEnum = pgEnum("alert_severity", [
  "informational",
  "low",
  "medium",
  "high",
  "critical",
]);

export const alertStatusEnum = pgEnum("alert_status", [
  "new",
  "in_progress",
  "closed",
  "dismissed",
]);

export const alertDeterminationEnum = pgEnum("alert_determination", [
  "unknown",
  "true_positive",
  "false_positive",
  "benign_positive",
]);

export const alertEntityRoleEnum = pgEnum("alert_entity_role", [
  "actor",
  "target",
  "impacted",
  "related",
]);

export const evidenceItemVerdictEnum = pgEnum("evidence_item_verdict", [
  "unknown",
  "clean",
  "suspicious",
  "malicious",
]);

export const evidenceItemRemediationEnum = pgEnum("evidence_item_remediation", [
  "none",
  "pending",
  "remediated",
  "not_applicable",
]);

export const evidenceRelationshipTypeEnum = pgEnum("evidence_relationship_type", [
  "related_to",
  "duplicate_of",
  "derived_from",
]);

/**
 * Ordered case narrative content blocks (issue #58). Separate from conversational
 * comments and raw timeline noise: findings, decisions, and report sections that
 * analysts deliberately promote into the investigation record.
 */
export const caseContentBlockTypeEnum = pgEnum("case_content_block_type", [
  "investigation_note",
  "finding",
  "hypothesis",
  "decision",
  "evidence_summary",
  "containment_record",
  "eradication_record",
  "recovery_validation",
  "stakeholder_update",
  "code_query",
  "table",
  "checklist",
  "external_reference",
  "report_section",
]);

export const caseContentBlockLinkTypeEnum = pgEnum("case_content_block_link_type", [
  "alert",
  "entity",
  "evidence_item",
  "task",
  "attack_technique",
  "attack_mapping",
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
  banned: boolean("banned").notNull().default(false),
  banReason: text("ban_reason"),
  banExpires: timestamp("ban_expires", { withTimezone: true }),
  passwordResetRequired: boolean("password_reset_required")
    .notNull()
    .default(false),
  mfaRequired: boolean("mfa_required").notNull().default(false),
  twoFactorEnabled: boolean("two_factor_enabled").notNull().default(false),
  invitedAt: timestamp("invited_at", { withTimezone: true }),
  invitedBy: text("invited_by"),
  lastPasswordResetAt: timestamp("last_password_reset_at", {
    withTimezone: true,
  }),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
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

export const twoFactors = pgTable(
  "two_factor",
  {
    id: text("id").primaryKey(),
    secret: text("secret").notNull(),
    backupCodes: text("backup_codes").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    verified: boolean("verified").notNull().default(true),
    failedVerificationCount: integer("failed_verification_count")
      .notNull()
      .default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
  },
  (t) => [index("two_factor_user_idx").on(t.userId)],
);

export const passkeys = pgTable(
  "passkey",
  {
    id: text("id").primaryKey(),
    name: text("name"),
    publicKey: text("public_key").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    credentialID: text("credential_id").notNull(),
    counter: bigint("counter", { mode: "number" }).notNull(),
    deviceType: text("device_type").notNull(),
    backedUp: boolean("backed_up").notNull(),
    transports: text("transports"),
    createdAt: timestamp("created_at", { withTimezone: true }),
    aaguid: text("aaguid"),
  },
  (t) => [
    index("passkey_user_id_idx").on(t.userId),
    uniqueIndex("passkey_credential_id_idx").on(t.credentialID),
  ],
);

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
    openedAt: timestamp("opened_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closureReason: text("closure_reason"),
    closureSummary: text("closure_summary"),
    mitreTechniques: jsonb("mitre_techniques")
      .notNull()
      .default(sql`'[]'::jsonb`),
    tags: jsonb("tags").notNull().default(sql`'[]'::jsonb`),
    dataClassificationTags: jsonb("data_classification_tags")
      .notNull()
      .default(sql`'[]'::jsonb`),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    // Who explicitly acknowledged the case. Distinct from the automatic
    // acknowledgedAt stamp that setCaseStatusCore still applies on the first
    // open -> in_progress transition: the explicit `acknowledgeCase` action
    // (src/actions/queues.ts) only sets acknowledgedAt/acknowledgedBy when
    // neither is already set, so whichever happens first wins.
    acknowledgedBy: text("acknowledged_by").references(() => users.id, {
      onDelete: "set null",
    }),
    containedAt: timestamp("contained_at", { withTimezone: true }),
    // Set on first transition into eradicated (mirrors containedAt / resolvedAt).
    eradicatedAt: timestamp("eradicated_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    slaState: jsonb("sla_state").notNull().default(sql`'{}'::jsonb`),
    version: integer("version").notNull().default(0),
    sourceSystem: text("source_system"),
    sourceReference: text("source_reference"),
    sourceUrl: text("source_url"),
    // Template the case was opened from, when known. Used to resolve
    // template-scoped case-closure policies (issue #57). Null for free-form
    // or connector-created cases.
    templateId: text("template_id").references(() => caseTemplates.id, {
      onDelete: "set null",
    }),
    // Denormalised latest-closure fields for list/detail display. Full
    // history lives in case_closure_snapshots and survives reopen.
    closureDetermination: text("closure_determination"),
    rootCause: text("root_cause"),
    businessImpact: text("business_impact"),
    lessonsLearned: text("lessons_learned"),
    closedBy: text("closed_by").references(() => users.id, {
      onDelete: "set null",
    }),
    activeClosureSnapshotId: text("active_closure_snapshot_id"),
    // Team queue ownership, distinct from `assigneeId` (the individual
    // primary owner). A case can sit in a queue with no individual owner at
    // all.
    queueId: text("queue_id").references(() => queues.id, {
      onDelete: "set null",
    }),
    queueAssignedAt: timestamp("queue_assigned_at", { withTimezone: true }),
    queueAssignedBy: text("queue_assigned_by").references(() => users.id, {
      onDelete: "set null",
    }),
    // When the current `assigneeId` was set, distinct from both
    // `queueAssignedAt` and `acknowledgedAt`.
    assigneeAssignedAt: timestamp("assignee_assigned_at", {
      withTimezone: true,
    }),
    assigneeAssignedBy: text("assignee_assigned_by").references(
      () => users.id,
      { onDelete: "set null" },
    ),
    waitingReason: caseWaitingReasonEnum("waiting_reason")
      .notNull()
      .default("none"),
    waitingSince: timestamp("waiting_since", { withTimezone: true }),
    // Bumped on every timeline event for this case (see writeTimelineEvent);
    // backs the "stale investigation" built-in view and per-queue aging
    // buckets without recomputing from the timeline table on every read.
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Set when status transitions away from `closed` back to an open state;
    // backs the "recently reopened" built-in view as an indexed column
    // instead of a timeline scan.
    lastReopenedAt: timestamp("last_reopened_at", { withTimezone: true }),
    // Set when this case was merged into another as a non-canonical source
    // (issue #56). Source cases are never deleted; they stay navigable with
    // this pointer to the surviving canonical case. Null while the case is
    // active / not superseded.
    supersededByCaseId: text("superseded_by_case_id"),
  },
  (t) => [
    uniqueIndex("cases_org_number_idx").on(t.organisationId, t.caseNumber),
    uniqueIndex("cases_org_source_reference_idx")
      .on(t.organisationId, t.sourceSystem, t.sourceReference)
      .where(
        sql`${t.sourceSystem} is not null and ${t.sourceReference} is not null`,
      ),
    index("cases_org_status_idx").on(t.organisationId, t.status),
    index("cases_org_opened_idx").on(t.organisationId, t.openedAt),
    index("cases_org_assignee_status_idx").on(
      t.organisationId,
      t.assigneeId,
      t.status,
    ),
    index("cases_org_queue_status_idx").on(
      t.organisationId,
      t.queueId,
      t.status,
    ),
    index("cases_org_last_activity_idx").on(
      t.organisationId,
      t.lastActivityAt,
    ),
    index("cases_org_waiting_idx")
      .on(t.organisationId, t.waitingReason)
      .where(sql`${t.waitingReason} <> 'none'`),
    index("cases_org_reopened_idx")
      .on(t.organisationId, t.lastReopenedAt)
      .where(sql`${t.lastReopenedAt} is not null`),
    index("cases_org_superseded_idx")
      .on(t.organisationId, t.supersededByCaseId)
      .where(sql`${t.supersededByCaseId} is not null`),
    foreignKey({
      columns: [t.supersededByCaseId],
      foreignColumns: [t.id],
      name: "cases_superseded_by_case_id_fk",
    }).onDelete("set null"),
  ],
);

/* ────────────────────────────────────────────────────────────────────────── */
/* Teams, queues, watchers, hand-offs                                         */
/* ────────────────────────────────────────────────────────────────────────── */

export const teams = pgTable(
  "teams",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("teams_org_name_idx").on(t.organisationId, t.name),
    index("teams_org_idx").on(t.organisationId),
  ],
);

export const teamMembers = pgTable(
  "team_members",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    addedBy: text("added_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("team_members_team_user_idx").on(t.teamId, t.userId),
    index("team_members_org_user_idx").on(t.organisationId, t.userId),
  ],
);

/**
 * A specialised queue belongs to exactly one team. Queue ownership on a case
 * (`cases.queueId`) is separate from individual ownership (`cases.assigneeId`)
 * so work can sit with a team before any analyst picks it up.
 */
export const queues = pgTable(
  "queues",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("queues_team_name_idx").on(t.teamId, t.name),
    index("queues_org_idx").on(t.organisationId),
    index("queues_team_idx").on(t.teamId),
  ],
);

/**
 * Additional assignees on a case, on top of the single primary owner
 * (`cases.assigneeId`). Deliberately its own table rather than an array
 * column so "cases I'm an additional assignee on" stays a plain indexed join.
 */
export const caseAssignees = pgTable(
  "case_assignees",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    caseId: text("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    addedBy: text("added_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("case_assignees_case_user_idx").on(t.caseId, t.userId),
    index("case_assignees_org_user_idx").on(t.organisationId, t.userId),
  ],
);

/**
 * Watching/subscribing to a case is purely a notification preference. It
 * never grants read/write access on its own: access remains governed by
 * organisation membership and role, exactly as for any other case. Every
 * watcher row is scoped to a case the watcher's organisation already owns
 * (enforced at the action/API layer), so this table cannot be used to leak
 * cross-tenant visibility.
 */
export const caseWatchers = pgTable(
  "case_watchers",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    caseId: text("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    notifyOnComment: boolean("notify_on_comment").notNull().default(true),
    notifyOnStatusChange: boolean("notify_on_status_change")
      .notNull()
      .default(true),
    notifyOnAssignment: boolean("notify_on_assignment")
      .notNull()
      .default(true),
    notifyOnSlaRisk: boolean("notify_on_sla_risk").notNull().default(true),
    addedBy: text("added_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("case_watchers_case_user_idx").on(t.caseId, t.userId),
    index("case_watchers_org_user_idx").on(t.organisationId, t.userId),
  ],
);

/**
 * Immutable shift hand-off snapshots. Never updated or deleted by application
 * code (see migration 0021's `shift_handoffs_no_update` /
 * `shift_handoffs_no_delete` triggers) -- a correction is a new hand-off, not
 * an edit, so the record an analyst read at shift start can never be
 * silently rewritten later.
 */
export const shiftHandoffs = pgTable(
  "shift_handoffs",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    caseId: text("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    fromUserId: text("from_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    toUserId: text("to_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    fromQueueId: text("from_queue_id").references(() => queues.id, {
      onDelete: "set null",
    }),
    toQueueId: text("to_queue_id").references(() => queues.id, {
      onDelete: "set null",
    }),
    summary: text("summary").notNull(),
    keyActions: jsonb("key_actions").notNull().default(sql`'[]'::jsonb`),
    openItems: jsonb("open_items").notNull().default(sql`'[]'::jsonb`),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("shift_handoffs_case_idx").on(t.caseId, t.createdAt),
    index("shift_handoffs_org_idx").on(t.organisationId),
  ],
);

/* ────────────────────────────────────────────────────────────────────────── */
/* Escalation policies                                                       */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Versioned, safely-disableable escalation policies. Every field this policy
 * can act through is a typed, fixed column (notify / reassign / raise
 * severity) rather than a free-form action list, so a destructive response
 * action is not merely disallowed by convention -- it has no column to be
 * stored in. `revision` is bumped on every edit (see updateEscalationPolicy
 * in src/lib/escalation-core.ts) and `escalationPolicyRuns` records which
 * revision fired, so a policy's behaviour history stays reconstructable.
 * `isActive` defaults to false: new and edited policies start disabled and
 * must be turned on deliberately.
 */
export const escalationPolicies = pgTable(
  "escalation_policies",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    revision: integer("revision").notNull().default(1),
    isActive: boolean("is_active").notNull().default(false),
    // Scope: apply only to cases in this queue, or organisation-wide when null.
    queueId: text("queue_id").references(() => queues.id, {
      onDelete: "set null",
    }),
    /** See EscalationConditions in src/lib/escalation-core.ts for the validated shape. */
    conditions: jsonb("conditions").notNull().default(sql`'{}'::jsonb`),
    notifyEnabled: boolean("notify_enabled").notNull().default(false),
    /** Subset of "assignee" | "queue_members" | "watchers". */
    notifyTargets: jsonb("notify_targets").notNull().default(sql`'[]'::jsonb`),
    reassignEnabled: boolean("reassign_enabled").notNull().default(false),
    reassignToQueueId: text("reassign_to_queue_id").references(
      () => queues.id,
      { onDelete: "set null" },
    ),
    reassignToUserId: text("reassign_to_user_id").references(
      () => users.id,
      { onDelete: "set null" },
    ),
    raiseSeverityEnabled: boolean("raise_severity_enabled")
      .notNull()
      .default(false),
    raiseSeverityTo: severityEnum("raise_severity_to"),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("escalation_policies_org_active_idx").on(
      t.organisationId,
      t.isActive,
    ),
    check(
      "escalation_policies_reassign_target",
      sql.raw(
        `"reassign_enabled" = false or "reassign_to_queue_id" is not null or "reassign_to_user_id" is not null`,
      ),
    ),
    check(
      "escalation_policies_raise_severity_target",
      sql.raw(
        `"raise_severity_enabled" = false or "raise_severity_to" is not null`,
      ),
    ),
  ],
);

/** One row per (policy revision, case) that actually fired -- the idempotency key that stops a policy re-escalating the same case on every evaluation tick. */
export const escalationPolicyRuns = pgTable(
  "escalation_policy_runs",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    policyId: text("policy_id")
      .notNull()
      .references(() => escalationPolicies.id, { onDelete: "cascade" }),
    policyRevision: integer("policy_revision").notNull(),
    caseId: text("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    triggerReason: text("trigger_reason").notNull(),
    notifySent: boolean("notify_sent").notNull().default(false),
    reassignedToQueueId: text("reassigned_to_queue_id"),
    reassignedToUserId: text("reassigned_to_user_id"),
    severityRaisedTo: severityEnum("severity_raised_to"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("escalation_policy_runs_policy_rev_case_idx").on(
      t.policyId,
      t.policyRevision,
      t.caseId,
    ),
    index("escalation_policy_runs_org_idx").on(t.organisationId, t.createdAt),
    index("escalation_policy_runs_case_idx").on(t.caseId),
  ],
);

/* ────────────────────────────────────────────────────────────────────────── */
/* Bulk case operations                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

export const bulkOperationTypeEnum = pgEnum("bulk_operation_type", [
  "assign_queue",
  "assign_analyst",
  "add_watcher",
  "remove_watcher",
  "add_tag",
  "remove_tag",
  "set_severity",
  "set_status",
  "acknowledge",
]);

/**
 * One row per bulk action a user runs against a set of cases -- the "one
 * batch audit record" acceptance criterion. Concise per-case timeline
 * entries are written alongside this through the normal
 * `writeTimelineEvent` path so each affected case's own history stays
 * readable without replaying the batch.
 */
export const bulkOperations = pgTable(
  "bulk_operations",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    actorId: text("actor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    operationType: bulkOperationTypeEnum("operation_type").notNull(),
    caseIds: jsonb("case_ids").notNull().default(sql`'[]'::jsonb`),
    params: jsonb("params").notNull().default(sql`'{}'::jsonb`),
    successCount: integer("success_count").notNull().default(0),
    failureCount: integer("failure_count").notNull().default(0),
    errors: jsonb("errors").notNull().default(sql`'[]'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("bulk_operations_org_created_idx").on(
      t.organisationId,
      t.createdAt,
    ),
  ],
);

/* ────────────────────────────────────────────────────────────────────────── */
/* Playbooks                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

export const playbooks = pgTable(
  "playbooks",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    classification: classificationEnum("classification")
      .notNull()
      .default("other"),
    /** Typical/expected severity for this scenario. Used for catalogue search
     * and filtering; the actual case severity is still set by the analyst. */
    defaultSeverity: severityEnum("default_severity"),
    isActive: boolean("is_active").notNull().default(true),
    steps: jsonb("steps").notNull().default(sql`'[]'::jsonb`),
    /** Structured operational detail (purpose, triggers, evidence to
     * preserve, decision points, closure criteria, ATT&CK references, etc).
     * See `PlaybookContent`. Custom playbooks may leave this `{}`. */
    content: jsonb("content").notNull().default(sql`'{}'::jsonb`),
    /** Free-form catalogue tags for search/filter (e.g. "identity", "email"). */
    tags: jsonb("tags").notNull().default(sql`'[]'::jsonb`),
    /** Observable types (see `observableTypeEnum`) an analyst should expect to
     * capture when running this playbook. Used for catalogue filtering only —
     * not enforced against the case's actual observables. */
    requiredObservableTypes: jsonb("required_observable_types")
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** Stable identifier for a baseline catalogue scenario (e.g.
     * "business_email_compromise"). `null` for organisation-authored custom
     * playbooks. Seeding looks up existing rows by
     * `(organisationId, catalogueKey)` so re-seeding never overwrites a row
     * that already exists, whether or not it has since been edited. */
    catalogueKey: text("catalogue_key"),
    /** Version of the baseline catalogue definition this row was created
     * from. Only stamped at insert time; never updated by re-seeding, so it
     * reflects provenance rather than a live sync target. `null` for custom
     * playbooks. */
    catalogueVersion: integer("catalogue_version"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("playbooks_org_classification_idx").on(t.organisationId, t.classification),
    index("playbooks_org_severity_idx").on(t.organisationId, t.defaultSeverity),
    // Postgres treats every NULL as distinct in a unique index, so custom
    // playbooks (catalogueKey null) never collide here; only a duplicate
    // non-null key within the same organisation would.
    uniqueIndex("playbooks_org_catalogue_key_idx").on(
      t.organisationId,
      t.catalogueKey,
    ),
  ],
);

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
    // When true, a case-closure policy with `required_tasks_complete` will
    // refuse close until this task is `done` (issue #57). Playbook steps
    // that carry `isRequired: true` stamp this on task creation.
    isRequired: boolean("is_required").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("case_tasks_case_idx").on(t.caseId),
    index("case_tasks_status_due_idx").on(t.status, t.dueAt),
    index("case_tasks_assignee_status_idx").on(t.assigneeId, t.status),
  ],
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
/* Case relationships                                                        */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Confirmed, typed links between two cases in the same organisation.
 * `organisationId` is denormalised onto the row (rather than inferred by
 * joining through both `cases` rows) so every query can filter on a single
 * indexed column and so cross-tenant leakage requires an explicit bug in the
 * write path, not a missed join leg on read.
 */
export const caseRelationships = pgTable(
  "case_relationships",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    sourceCaseId: text("source_case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    targetCaseId: text("target_case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    relationshipType: caseRelationshipTypeEnum("relationship_type").notNull(),
    confidence: integer("confidence"),
    origin: caseRelationshipOriginEnum("origin").notNull().default("analyst"),
    ruleId: text("rule_id"),
    ruleVersion: text("rule_version"),
    reason: text("reason").notNull(),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("case_relationships_org_idx").on(t.organisationId),
    index("case_relationships_source_idx").on(t.sourceCaseId),
    index("case_relationships_target_idx").on(t.targetCaseId),
    // A given directional edge can only be recorded once per type. Combined
    // with canonicalisation at the application layer (child_of -> parent_of
    // with swapped endpoints, related_to sorted by id), this also blocks the
    // reverse-spelled duplicate for parent/child and symmetric edges.
    uniqueIndex("case_relationships_unique_edge_idx").on(
      t.organisationId,
      t.sourceCaseId,
      t.targetCaseId,
      t.relationshipType,
    ),
    check(
      "case_relationships_no_self_link",
      sql.raw(`"source_case_id" <> "target_case_id"`),
    ),
    check(
      "case_relationships_confidence_range",
      sql.raw(
        `"confidence" is null or ("confidence" >= 0 and "confidence" <= 100)`,
      ),
    ),
  ],
);

/**
 * Persisted "not a match" decisions for a candidate pairing. Suggestion
 * scores themselves are always computed on demand from live case data (they
 * would go stale if cached), so the only fact worth storing is that an
 * analyst already looked at this pair and rejected it. Canonically ordered
 * (`case_id_a < case_id_b`) so a dismissal recorded from either case's
 * overview suppresses the suggestion on both sides.
 */
export const caseRelationshipDismissals = pgTable(
  "case_relationship_dismissals",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    caseIdA: text("case_id_a")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    caseIdB: text("case_id_b")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    dismissedBy: text("dismissed_by").references(() => users.id, {
      onDelete: "set null",
    }),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("case_relationship_dismissals_pair_idx").on(
      t.organisationId,
      t.caseIdA,
      t.caseIdB,
    ),
    index("case_relationship_dismissals_org_idx").on(t.organisationId),
    check(
      "case_relationship_dismissals_canonical_order",
      sql.raw(`"case_id_a" < "case_id_b"`),
    ),
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
    source: text("source").notNull().default("user"),
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
/* Attachments (evidence)                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Case evidence, formerly a bare attachment record. `organisationId` is
 * denormalised (same rationale as `caseRelationships`) so every evidence
 * query can filter on one indexed column instead of relying on an
 * `innerJoin` through `cases` to be present on every call site. The row is
 * never mutated to point at different bytes: renames only change `filename`,
 * and a re-acquired/processed copy is a new row via `parentEvidenceId`.
 */
export const attachments = pgTable(
  "attachments",
  {
    id: text("id").primaryKey(),
    caseId: text("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    originalFilename: text("original_filename").notNull(),
    contentType: text("content_type").notNull(),
    declaredContentType: text("declared_content_type"),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    storageKey: text("storage_key").notNull(),
    sha256: text("sha256").notNull(),
    uploadedBy: text("uploaded_by").references(() => users.id, {
      onDelete: "set null",
    }),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    status: evidenceStatusEnum("status").notNull().default("pending_scan"),
    source: text("source").notNull().default("analyst_upload"),
    scannerName: text("scanner_name"),
    scanVerdict: text("scan_verdict"),
    scanDetail: text("scan_detail"),
    scannedAt: timestamp("scanned_at", { withTimezone: true }),
    overriddenBy: text("overridden_by").references(() => users.id, {
      onDelete: "set null",
    }),
    overriddenAt: timestamp("overridden_at", { withTimezone: true }),
    overrideReason: text("override_reason"),
    isArchive: boolean("is_archive").notNull().default(false),
    archiveKind: text("archive_kind"),
    archiveEntryCount: integer("archive_entry_count"),
    archivePasswordProtected: boolean("archive_password_protected"),
    parentEvidenceId: text("parent_evidence_id"),
    collectionId: text("collection_id").references(() => evidenceCollections.id, {
      onDelete: "set null",
    }),
    relevance: evidenceRelevanceEnum("relevance").notNull().default("unknown"),
    acquisitionSource: text("acquisition_source"),
    acquiredAt: timestamp("acquired_at", { withTimezone: true }),
    examinerNotes: text("examiner_notes"),
    labels: jsonb("labels").notNull().default(sql`'[]'::jsonb`),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: text("deleted_by").references(() => users.id, {
      onDelete: "set null",
    }),
    deletionReason: text("deletion_reason"),
  },
  (t) => [
    index("attachments_case_idx").on(t.caseId),
    index("attachments_org_idx").on(t.organisationId),
    index("attachments_org_status_idx").on(t.organisationId, t.status),
    index("attachments_parent_idx").on(t.parentEvidenceId),
    index("attachments_collection_idx").on(t.collectionId),
    foreignKey({
      columns: [t.parentEvidenceId],
      foreignColumns: [t.id],
      name: "attachments_parent_evidence_id_attachments_id_fk",
    }).onDelete("restrict"),
  ],
);

/**
 * Append-only chain-of-custody ledger for evidence. Application code only
 * ever inserts here; rows are never updated or deleted, including when the
 * evidence row itself is soft-deleted.
 */
export const evidenceCustodyEvents = pgTable(
  "evidence_custody_events",
  {
    id: text("id").primaryKey(),
    evidenceId: text("evidence_id")
      .notNull()
      .references(() => attachments.id, { onDelete: "cascade" }),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    actorId: text("actor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    eventType: text("event_type").notNull(),
    reason: text("reason"),
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("evidence_custody_events_evidence_idx").on(
      t.evidenceId,
      t.occurredAt,
    ),
    index("evidence_custody_events_org_idx").on(t.organisationId),
  ],
);

/** Analyst-defined groupings of evidence within a case (e.g. "host triage"). */
export const evidenceCollections = pgTable(
  "evidence_collections",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    caseId: text("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("evidence_collections_case_idx").on(t.caseId),
    uniqueIndex("evidence_collections_case_name_idx").on(t.caseId, t.name),
  ],
);

/**
 * A hold can target either an entire case (every current and future item of
 * evidence on it) or one evidence item; exactly one of the two must be set.
 * Deletion and retention cleanup must refuse to act while any row for the
 * relevant case/evidence has `releasedAt` still null.
 */
export const evidenceLegalHolds = pgTable(
  "evidence_legal_holds",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    caseId: text("case_id").references(() => cases.id, {
      onDelete: "cascade",
    }),
    evidenceId: text("evidence_id").references(() => attachments.id, {
      onDelete: "cascade",
    }),
    reason: text("reason").notNull(),
    appliedBy: text("applied_by").references(() => users.id, {
      onDelete: "set null",
    }),
    appliedAt: timestamp("applied_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    releasedBy: text("released_by").references(() => users.id, {
      onDelete: "set null",
    }),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    releaseReason: text("release_reason"),
  },
  (t) => [
    index("evidence_legal_holds_org_idx").on(t.organisationId),
    index("evidence_legal_holds_case_idx").on(t.caseId),
    index("evidence_legal_holds_evidence_idx").on(t.evidenceId),
    check(
      "evidence_legal_holds_scope_target",
      sql.raw(`"case_id" is not null or "evidence_id" is not null`),
    ),
  ],
);

/* ────────────────────────────────────────────────────────────────────────── */
/* Investigation model: alerts, entities, evidence items (issue #55)         */
/*                                                                            */
/* Field ownership contract (enforced in src/lib/investigations, not just    */
/* documented here):                                                         */
/*   - Provider-owned fields (title, description, detectionSource/Product,   */
/*     classification, severity until analyst override, detectedAt,          */
/*     providerCreatedAt/providerUpdatedAt, sourceUrl, normalizedFields,      */
/*     attackTechniques) are refreshed on every poll/push from the source.   */
/*   - Analyst-owned fields (status, determination, assigneeId,              */
/*     analystNotes, dismissedReason, and severity once                      */
/*     severityOverriddenByAnalyst is set) are only ever written by an       */
/*     explicit analyst action and are never overwritten by provider sync.   */
/*   - Derived fields (derivedFields jsonb) are recomputable from other      */
/*     columns and always carry provenance: { value, method, computedAt }.  */
/*   - Raw provider payloads are never inlined on the alert/evidence row or  */
/*     in timeline events; they live in provider_payload_references as a     */
/*     bounded (<=256KB), redacted, access-controlled reference.            */
/* ────────────────────────────────────────────────────────────────────────── */

/** Provenance registry for a producer of alerts (a connector + tenant pair, or "manual" for analyst-authored alerts). Distinct from `case_sources`, which owns case-level polling schedules; an `alert_source` only identifies who an alert came from. */
export const alertSources = pgTable(
  "alert_sources",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    tenantId: text("tenant_id").notNull().default(""),
    config: jsonb("config").notNull().default(sql`'{}'::jsonb`),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("alert_sources_org_kind_tenant_idx").on(
      t.organisationId,
      t.kind,
      t.tenantId,
    ),
    index("alert_sources_org_idx").on(t.organisationId),
  ],
);

/** Bounded, access-controlled reference to a raw provider payload. Never the payload inline on an alert/evidence row or in a timeline event; a dedicated, scope-gated endpoint is the only read path. */
export const providerPayloadReferences = pgTable(
  "provider_payload_references",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    sourceId: text("source_id").references(() => alertSources.id, {
      onDelete: "set null",
    }),
    externalRef: text("external_ref").notNull(),
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
    sizeBytes: integer("size_bytes").notNull().default(0),
    redacted: boolean("redacted").notNull().default(true),
    retrievedAt: timestamp("retrieved_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("provider_payload_references_org_idx").on(t.organisationId),
    index("provider_payload_references_source_idx").on(t.sourceId),
  ],
);

/**
 * An independently addressable detection. `(organisationId, sourceId,
 * tenantId, externalId)` is unique, so re-polling the same source never
 * creates a duplicate alert — the same idempotent-ingestion guarantee
 * `cases` already has for `(organisationId, sourceSystem, sourceReference)`.
 */
export const alerts = pgTable(
  "alerts",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    sourceId: text("source_id")
      .notNull()
      .references(() => alertSources.id, { onDelete: "restrict" }),
    tenantId: text("tenant_id").notNull().default(""),
    externalId: text("external_id").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    detectionSource: text("detection_source"),
    detectionProduct: text("detection_product"),
    classification: text("classification"),
    severity: alertSeverityEnum("severity").notNull().default("medium"),
    severityOverriddenByAnalyst: boolean("severity_overridden_by_analyst")
      .notNull()
      .default(false),
    status: alertStatusEnum("status").notNull().default("new"),
    determination: alertDeterminationEnum("determination")
      .notNull()
      .default("unknown"),
    assigneeId: text("assignee_id").references(() => users.id, {
      onDelete: "set null",
    }),
    analystNotes: text("analyst_notes"),
    dismissedReason: text("dismissed_reason"),
    detectedAt: timestamp("detected_at", { withTimezone: true }),
    providerCreatedAt: timestamp("provider_created_at", { withTimezone: true }),
    providerUpdatedAt: timestamp("provider_updated_at", { withTimezone: true }),
    sourceUrl: text("source_url"),
    normalizedFields: jsonb("normalized_fields").notNull().default(sql`'{}'::jsonb`),
    attackTechniques: jsonb("attack_techniques").notNull().default(sql`'[]'::jsonb`),
    derivedFields: jsonb("derived_fields").notNull().default(sql`'{}'::jsonb`),
    rawPayloadRefId: text("raw_payload_ref_id").references(
      () => providerPayloadReferences.id,
      { onDelete: "set null" },
    ),
    version: integer("version").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("alerts_org_source_tenant_external_idx").on(
      t.organisationId,
      t.sourceId,
      t.tenantId,
      t.externalId,
    ),
    index("alerts_org_status_idx").on(t.organisationId, t.status),
    index("alerts_org_detected_idx").on(t.organisationId, t.detectedAt),
    index("alerts_source_idx").on(t.sourceId),
  ],
);

/**
 * A deduplicated, organisation-scoped subject: a user/identity, device,
 * mailbox, email message, IP, domain, URL, file/hash, process, cloud
 * resource, application, tenant, network, or generic asset. Deduplication is
 * type-aware: `(organisationId, type, canonicalKey)` is unique, where
 * `canonicalKey` is a normalised form of the entity's primary identifier
 * (lower-cased email, upper-cased hash, etc.) computed in
 * `src/lib/investigations/entities-core.ts`.
 */
export const entities = pgTable(
  "entities",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    type: entityTypeEnum("type").notNull(),
    displayName: text("display_name").notNull(),
    canonicalKey: text("canonical_key").notNull(),
    attributes: jsonb("attributes").notNull().default(sql`'{}'::jsonb`),
    riskScore: integer("risk_score"),
    notes: text("notes"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("entities_org_type_canonical_idx").on(
      t.organisationId,
      t.type,
      t.canonicalKey,
    ),
    index("entities_org_idx").on(t.organisationId),
    check(
      "entities_risk_score_range",
      sql.raw(`"risk_score" is null or ("risk_score" >= 0 and "risk_score" <= 100)`),
    ),
  ],
);

/**
 * Every raw value ever seen for an entity (an email may also appear as an
 * `upn`, a hostname may resolve through several `ip` sightings, etc).
 * `(organisationId, kind, value)` is unique so a given raw value always
 * resolves back to the same entity.
 */
export const entityIdentifiers = pgTable(
  "entity_identifiers",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    entityId: text("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    kind: entityIdentifierKindEnum("kind").notNull(),
    value: text("value").notNull(),
    source: text("source"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("entity_identifiers_org_kind_value_idx").on(
      t.organisationId,
      t.kind,
      t.value,
    ),
    index("entity_identifiers_entity_idx").on(t.entityId),
  ],
);

/** Links an alert to every entity it involves, with the entity's role in that alert. */
export const alertEntities = pgTable(
  "alert_entities",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    alertId: text("alert_id")
      .notNull()
      .references(() => alerts.id, { onDelete: "cascade" }),
    entityId: text("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    role: alertEntityRoleEnum("role").notNull().default("related"),
    addedBy: text("added_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("alert_entities_unique_idx").on(t.alertId, t.entityId, t.role),
    index("alert_entities_entity_idx").on(t.entityId),
    index("alert_entities_org_idx").on(t.organisationId),
  ],
);

/** Links an alert into a case's investigation. One case can hold many alerts; `isPrimary` marks the alert (if any) that the case was originally opened from. */
export const caseAlerts = pgTable(
  "case_alerts",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    caseId: text("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    alertId: text("alert_id")
      .notNull()
      .references(() => alerts.id, { onDelete: "cascade" }),
    isPrimary: boolean("is_primary").notNull().default(false),
    addedBy: text("added_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("case_alerts_unique_idx").on(t.caseId, t.alertId),
    index("case_alerts_alert_idx").on(t.alertId),
    index("case_alerts_org_idx").on(t.organisationId),
  ],
);

/* ────────────────────────────────────────────────────────────────────────── */
/* Alert correlation (issue #56): rules, suggestions, membership lineage     */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Organisation-scoped, versioned correlation rules. A rule key identifies a
 * logical rule across versions; enabling a new version supersedes the prior
 * row for that key. Rules never mutate cases by themselves — they only
 * produce suggestions unless the org policy explicitly enables auto-merge
 * (disabled by default) and the rule is not in dry-run mode.
 */
export const correlationRuleStatusEnum = pgEnum("correlation_rule_status", [
  "draft",
  "active",
  "disabled",
  "superseded",
]);

export const correlationSuggestionStatusEnum = pgEnum(
  "correlation_suggestion_status",
  // `accepting` is a short-lived claim so concurrent accepts cannot both
  // mutate membership before the suggestion is resolved.
  ["pending", "accepting", "accepted", "rejected", "expired", "auto_applied"],
);

export const correlationSuggestionKindEnum = pgEnum(
  "correlation_suggestion_kind",
  ["group_alerts", "attach_to_case", "merge_cases"],
);

export const alertMembershipOperationEnum = pgEnum(
  "alert_membership_operation",
  ["link", "unlink", "move", "merge", "split", "create_case", "reverse_merge"],
);

export const caseMergeStatusEnum = pgEnum("case_merge_status", [
  "active",
  "reversed",
]);

export const correlationRules = pgTable(
  "correlation_rules",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    /** Stable identity across versions (e.g. `shared-entity-window`). */
    ruleKey: text("rule_key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    version: integer("version").notNull().default(1),
    status: correlationRuleStatusEnum("status").notNull().default("draft"),
    /**
     * When true, evaluation records suggestions only and never triggers
     * automatic membership changes even if org policy would allow them.
     * Default true so enabling a rule is always safe to inspect first.
     */
    dryRun: boolean("dry_run").notNull().default(true),
    /**
     * Signal weights, time window, threshold, and filters. Shape is owned by
     * `src/lib/correlation/scoring.ts` (`CorrelationRuleConfig`).
     */
    config: jsonb("config").notNull().default(sql`'{}'::jsonb`),
    scoreThreshold: integer("score_threshold").notNull().default(40),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("correlation_rules_org_key_version_idx").on(
      t.organisationId,
      t.ruleKey,
      t.version,
    ),
    index("correlation_rules_org_status_idx").on(t.organisationId, t.status),
    check(
      "correlation_rules_score_threshold_range",
      sql.raw(
        `"score_threshold" >= 0 and "score_threshold" <= 100`,
      ),
    ),
    check(
      "correlation_rules_version_positive",
      sql.raw(`"version" >= 1`),
    ),
  ],
);

/**
 * Transparent correlation suggestions. Every row carries score, contributing
 * signals, rule/version, and status so analysts can accept/reject with full
 * provenance. Suggestions never mutate membership without an explicit
 * analyst action (or an org policy that explicitly enables auto-apply).
 */
export const correlationSuggestions = pgTable(
  "correlation_suggestions",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    ruleId: text("rule_id").references(() => correlationRules.id, {
      onDelete: "set null",
    }),
    ruleKey: text("rule_key").notNull(),
    ruleVersion: integer("rule_version").notNull(),
    kind: correlationSuggestionKindEnum("kind").notNull(),
    status: correlationSuggestionStatusEnum("status")
      .notNull()
      .default("pending"),
    score: integer("score").notNull(),
    /** Contributing signal detail: shared entities, products, techniques, etc. */
    contributingSignals: jsonb("contributing_signals")
      .notNull()
      .default(sql`'{}'::jsonb`),
    alertIds: jsonb("alert_ids").notNull().default(sql`'[]'::jsonb`),
    caseIds: jsonb("case_ids").notNull().default(sql`'[]'::jsonb`),
    /** Canonical target case when the suggestion is attach/merge. */
    targetCaseId: text("target_case_id").references(() => cases.id, {
      onDelete: "set null",
    }),
    explanation: text("explanation").notNull().default(""),
    generatedAt: timestamp("generated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: text("resolved_by").references(() => users.id, {
      onDelete: "set null",
    }),
    resolveReason: text("resolve_reason"),
    /** Fingerprint of the alert set + kind so re-eval does not spam duplicates. */
    fingerprint: text("fingerprint").notNull(),
  },
  (t) => [
    uniqueIndex("correlation_suggestions_org_fingerprint_pending_idx")
      .on(t.organisationId, t.fingerprint)
      .where(sql`${t.status} = 'pending'`),
    index("correlation_suggestions_org_status_idx").on(
      t.organisationId,
      t.status,
    ),
    index("correlation_suggestions_org_generated_idx").on(
      t.organisationId,
      t.generatedAt,
    ),
    index("correlation_suggestions_rule_idx").on(t.ruleId),
    check(
      "correlation_suggestions_score_range",
      sql.raw(`"score" >= 0 and "score" <= 100`),
    ),
  ],
);

/**
 * Immutable lineage of every alert membership change (link/unlink/move/
 * merge/split). Preserves origin case, destination, actor, reason, and the
 * correlation operation that caused the change.
 */
export const alertMembershipHistory = pgTable(
  "alert_membership_history",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    alertId: text("alert_id")
      .notNull()
      .references(() => alerts.id, { onDelete: "cascade" }),
    operation: alertMembershipOperationEnum("operation").notNull(),
    fromCaseId: text("from_case_id").references(() => cases.id, {
      onDelete: "set null",
    }),
    toCaseId: text("to_case_id").references(() => cases.id, {
      onDelete: "set null",
    }),
    reason: text("reason").notNull(),
    actorId: text("actor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    /** Groups rows that belong to the same analyst/system operation. */
    operationId: text("operation_id").notNull(),
    suggestionId: text("suggestion_id").references(
      () => correlationSuggestions.id,
      { onDelete: "set null" },
    ),
    mergeId: text("merge_id"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("alert_membership_history_alert_idx").on(t.alertId, t.createdAt),
    index("alert_membership_history_org_idx").on(t.organisationId, t.createdAt),
    index("alert_membership_history_operation_idx").on(t.operationId),
    index("alert_membership_history_from_case_idx").on(t.fromCaseId),
    index("alert_membership_history_to_case_idx").on(t.toCaseId),
  ],
);

/**
 * Case merge records. Source cases are never deleted — they are marked
 * superseded and remain navigable. Reversal is allowed until
 * `reverseDeadline` when no incompatible downstream mutation blocks it.
 */
export const caseMerges = pgTable(
  "case_merges",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    canonicalCaseId: text("canonical_case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "restrict" }),
    /** Ordered list of source case ids that were merged into the canonical. */
    sourceCaseIds: jsonb("source_case_ids").notNull().default(sql`'[]'::jsonb`),
    /** Alert ids moved as part of this merge (for reverse). */
    movedAlertIds: jsonb("moved_alert_ids").notNull().default(sql`'[]'::jsonb`),
    /**
     * Snapshot of which case each alert came from, keyed by alert id, so
     * reverse can restore membership accurately.
     */
    alertOriginById: jsonb("alert_origin_by_id")
      .notNull()
      .default(sql`'{}'::jsonb`),
    reason: text("reason").notNull(),
    actorId: text("actor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    status: caseMergeStatusEnum("status").notNull().default("active"),
    suggestionId: text("suggestion_id").references(
      () => correlationSuggestions.id,
      { onDelete: "set null" },
    ),
    mergedAt: timestamp("merged_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    reverseDeadline: timestamp("reverse_deadline", {
      withTimezone: true,
    }).notNull(),
    reversedAt: timestamp("reversed_at", { withTimezone: true }),
    reversedBy: text("reversed_by").references(() => users.id, {
      onDelete: "set null",
    }),
    reverseReason: text("reverse_reason"),
    /** Case versions observed at merge time (for concurrency diagnostics). */
    caseVersions: jsonb("case_versions").notNull().default(sql`'{}'::jsonb`),
  },
  (t) => [
    index("case_merges_org_idx").on(t.organisationId, t.mergedAt),
    index("case_merges_canonical_idx").on(t.canonicalCaseId),
    index("case_merges_status_idx").on(t.organisationId, t.status),
  ],
);

/**
 * Per-rule acceptance metrics used as precision proxies (suggestion count,
 * accept, reject, auto-applied). Updated when suggestions are created or
 * resolved; not a separate time-series table for v1.
 */
export const correlationRuleMetrics = pgTable(
  "correlation_rule_metrics",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    ruleKey: text("rule_key").notNull(),
    ruleVersion: integer("rule_version").notNull(),
    suggestionCount: integer("suggestion_count").notNull().default(0),
    acceptedCount: integer("accepted_count").notNull().default(0),
    rejectedCount: integer("rejected_count").notNull().default(0),
    autoAppliedCount: integer("auto_applied_count").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("correlation_rule_metrics_org_key_version_idx").on(
      t.organisationId,
      t.ruleKey,
      t.ruleVersion,
    ),
  ],
);

/**
 * An investigation-level evidence record: an indicator, log excerpt, finding,
 * or provider record, with a verdict and remediation state independent of any
 * binary file. May optionally point at a binary `attachments` row (issue #44)
 * via `attachmentId`, but never duplicates that table's storage/integrity
 * responsibilities.
 */
export const evidenceItems = pgTable(
  "evidence_items",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    caseId: text("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    alertId: text("alert_id").references(() => alerts.id, {
      onDelete: "set null",
    }),
    entityId: text("entity_id").references(() => entities.id, {
      onDelete: "set null",
    }),
    attachmentId: text("attachment_id").references(() => attachments.id, {
      onDelete: "set null",
    }),
    type: text("type").notNull(),
    value: text("value"),
    description: text("description"),
    verdict: evidenceItemVerdictEnum("verdict").notNull().default("unknown"),
    remediationState: evidenceItemRemediationEnum("remediation_state")
      .notNull()
      .default("none"),
    confidence: integer("confidence"),
    source: text("source").notNull().default("analyst"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    analystNotes: text("analyst_notes"),
    rawPayloadRefId: text("raw_payload_ref_id").references(
      () => providerPayloadReferences.id,
      { onDelete: "set null" },
    ),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("evidence_items_case_idx").on(t.caseId),
    index("evidence_items_alert_idx").on(t.alertId),
    index("evidence_items_entity_idx").on(t.entityId),
    index("evidence_items_org_idx").on(t.organisationId),
    check(
      "evidence_items_confidence_range",
      sql.raw(`"confidence" is null or ("confidence" >= 0 and "confidence" <= 100)`),
    ),
  ],
);

/** Typed relationships between evidence items, canonicalised the same way as `case_relationships` (symmetric types sorted by id) so an edge can never be stored twice. */
export const evidenceRelationships = pgTable(
  "evidence_relationships",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    sourceEvidenceId: text("source_evidence_id")
      .notNull()
      .references(() => evidenceItems.id, { onDelete: "cascade" }),
    targetEvidenceId: text("target_evidence_id")
      .notNull()
      .references(() => evidenceItems.id, { onDelete: "cascade" }),
    relationshipType: evidenceRelationshipTypeEnum("relationship_type").notNull(),
    reason: text("reason").notNull(),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("evidence_relationships_org_idx").on(t.organisationId),
    index("evidence_relationships_source_idx").on(t.sourceEvidenceId),
    index("evidence_relationships_target_idx").on(t.targetEvidenceId),
    uniqueIndex("evidence_relationships_unique_edge_idx").on(
      t.organisationId,
      t.sourceEvidenceId,
      t.targetEvidenceId,
      t.relationshipType,
    ),
    check(
      "evidence_relationships_no_self_link",
      sql.raw(`"source_evidence_id" <> "target_evidence_id"`),
    ),
  ],
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

export const caseTemplates = pgTable(
  "case_templates",
  {
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
    defaultTags: jsonb("default_tags").notNull().default(sql`'[]'::jsonb`),
    defaultDataClassificationTags: jsonb("default_data_classification_tags")
      .notNull()
      .default(sql`'[]'::jsonb`),
    defaultTasks: jsonb("default_tasks").notNull().default(sql`'[]'::jsonb`),
    defaultCustomFields: jsonb("default_custom_fields")
      .notNull()
      .default(sql`'{}'::jsonb`),
    /** Same provenance/idempotency contract as `playbooks.catalogueKey`. */
    catalogueKey: text("catalogue_key"),
    catalogueVersion: integer("catalogue_version"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("case_templates_org_catalogue_key_idx").on(
      t.organisationId,
      t.catalogueKey,
    ),
  ],
);

/* ────────────────────────────────────────────────────────────────────────── */
/* Case closure policies (issue #57)                                          */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Versioned case-closure policies. Behaviour lives only on immutable
 * `case_closure_policy_versions` rows: editing requirements always inserts a
 * new version and bumps `currentVersion`. Historical closes keep the version
 * id they evaluated, so a later edit never silently rewrites past requirements.
 * A policy is either org-default (`templateId` null + `isDefault`) or
 * template-scoped (`templateId` set). Only one default per org, and only one
 * active policy per template, are enforced at the application layer.
 */
export const caseClosurePolicies = pgTable(
  "case_closure_policies",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    templateId: text("template_id").references(() => caseTemplates.id, {
      onDelete: "cascade",
    }),
    isDefault: boolean("is_default").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    currentVersion: integer("current_version").notNull().default(1),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("case_closure_policies_org_idx").on(t.organisationId),
    index("case_closure_policies_org_template_idx").on(
      t.organisationId,
      t.templateId,
    ),
    uniqueIndex("case_closure_policies_org_default_idx")
      .on(t.organisationId)
      .where(sql`${t.isDefault} = true and ${t.isActive} = true`),
    uniqueIndex("case_closure_policies_org_template_active_idx")
      .on(t.organisationId, t.templateId)
      .where(sql`${t.templateId} is not null and ${t.isActive} = true`),
  ],
);

/**
 * Immutable snapshot of a policy's requirements at a point in time. The
 * `requirements` JSON is the only shape the shared closure evaluator reads —
 * UI, REST, and automation all resolve a version row and pass it through the
 * same path. See `src/lib/closure/types.ts`.
 */
export const caseClosurePolicyVersions = pgTable(
  "case_closure_policy_versions",
  {
    id: text("id").primaryKey(),
    policyId: text("policy_id")
      .notNull()
      .references(() => caseClosurePolicies.id, { onDelete: "cascade" }),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    /** Array of ClosureRequirementConfig (validated in policy-core). */
    requirements: jsonb("requirements").notNull().default(sql`'[]'::jsonb`),
    /**
     * When true, a privileged override also needs a second distinct approver
     * (two-person rule). Configured per version so historical closes keep the
     * gate they were closed under.
     */
    requireTwoPersonOverride: boolean("require_two_person_override")
      .notNull()
      .default(false),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("case_closure_policy_versions_policy_ver_idx").on(
      t.policyId,
      t.version,
    ),
    index("case_closure_policy_versions_org_idx").on(t.organisationId),
  ],
);

/**
 * One row per successful close. Reopen never deletes or mutates the
 * evaluation payload — it only stamps reopenedAt/reopenedBy/reopenReason so
 * prior closure decisions stay reportable and auditable.
 */
export const caseClosureSnapshots = pgTable(
  "case_closure_snapshots",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    caseId: text("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    policyId: text("policy_id").references(() => caseClosurePolicies.id, {
      onDelete: "set null",
    }),
    policyVersionId: text("policy_version_id").references(
      () => caseClosurePolicyVersions.id,
      { onDelete: "set null" },
    ),
    policyVersion: integer("policy_version"),
    disposition: text("disposition").notNull(),
    determination: text("determination"),
    rootCause: text("root_cause"),
    conclusion: text("conclusion").notNull(),
    businessImpact: text("business_impact"),
    lessonsLearned: text("lessons_learned"),
    /** Full evaluated checklist: ClosureRequirementResult[]. */
    requirementsEvaluated: jsonb("requirements_evaluated")
      .notNull()
      .default(sql`'[]'::jsonb`),
    failedRequirements: jsonb("failed_requirements")
      .notNull()
      .default(sql`'[]'::jsonb`),
    closedBy: text("closed_by").references(() => users.id, {
      onDelete: "set null",
    }),
    closedAt: timestamp("closed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    approverId: text("approver_id").references(() => users.id, {
      onDelete: "set null",
    }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    wasOverride: boolean("was_override").notNull().default(false),
    overrideReason: text("override_reason"),
    overrideActorId: text("override_actor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    /** Failed-requirement checklist captured at override time. */
    overrideFailedSnapshot: jsonb("override_failed_snapshot"),
    caseVersionAtClose: integer("case_version_at_close").notNull(),
    reopenedAt: timestamp("reopened_at", { withTimezone: true }),
    reopenedBy: text("reopened_by").references(() => users.id, {
      onDelete: "set null",
    }),
    reopenReason: text("reopen_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("case_closure_snapshots_case_idx").on(t.caseId, t.closedAt),
    index("case_closure_snapshots_org_idx").on(t.organisationId, t.closedAt),
    index("case_closure_snapshots_active_idx")
      .on(t.caseId)
      .where(sql`${t.reopenedAt} is null`),
  ],
);

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
/* Organisation audit trail                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

export const auditActorTypeEnum = pgEnum("audit_actor_type", [
  "user",
  "api_token",
  "system",
]);

export const auditExportFormatEnum = pgEnum("audit_export_format", [
  "csv",
  "ndjson",
]);

export const auditExportStatusEnum = pgEnum("audit_export_status", [
  "pending",
  "processing",
  "completed",
  "failed",
]);

/**
 * Append-only organisation-wide audit trail. A `BEFORE UPDATE` trigger (see
 * migration 0020) rejects every update except the `actor_id -> NULL`
 * transition the `actor_id` FK's own `ON DELETE SET NULL` action performs
 * when a referenced user is deleted (anonymizing past events rather than
 * blocking user deletion) — no other column may ever change. A
 * `BEFORE DELETE` trigger rejects direct deletes unless the
 * `kelpie.audit_retention_purge` session setting is `'on'` for the current
 * transaction (only `runAuditRetention()`, src/lib/audit/retention.ts, sets
 * it), but allows a delete nested inside another trigger — in practice, the
 * owning organisation's `ON DELETE CASCADE` removing this row along with the
 * rest of that tenant's data. No application role, including admin routes,
 * can update or delete a row through a direct query; this holds even though
 * the app's runtime DB role owns the table.
 */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    actorId: text("actor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    actorType: auditActorTypeEnum("actor_type").notNull().default("user"),
    actorLabel: text("actor_label"),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id"),
    targetLabel: text("target_label"),
    requestId: text("request_id"),
    sourceIp: text("source_ip"),
    userAgent: text("user_agent"),
    before: jsonb("before"),
    after: jsonb("after"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("audit_events_org_occurred_idx").on(t.organisationId, t.occurredAt),
    index("audit_events_org_action_idx").on(t.organisationId, t.action),
    index("audit_events_org_actor_idx").on(t.organisationId, t.actorId),
    index("audit_events_org_target_idx").on(
      t.organisationId,
      t.targetType,
      t.targetId,
    ),
  ],
);

/** Tracks one requested CSV/NDJSON export of `audit_events`; the file itself lives in blob storage. */
export const auditExportJobs = pgTable(
  "audit_export_jobs",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    requestedBy: text("requested_by").references(() => users.id, {
      onDelete: "set null",
    }),
    format: auditExportFormatEnum("format").notNull(),
    filters: jsonb("filters").notNull().default(sql`'{}'::jsonb`),
    status: auditExportStatusEnum("status").notNull().default("pending"),
    storageKey: text("storage_key"),
    rowCount: integer("row_count"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (t) => [
    index("audit_export_jobs_org_idx").on(t.organisationId, t.createdAt),
  ],
);

/* ────────────────────────────────────────────────────────────────────────── */
/* Mobile devices + push delivery outbox                                      */
/* ────────────────────────────────────────────────────────────────────────── */

export const mobileDevices = pgTable(
  "mobile_devices",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    environment: text("environment").notNull().default("sandbox"),
    bundleId: text("bundle_id").notNull().default("dev.kelpie.mobile"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("mobile_devices_token_environment_idx").on(
      t.token,
      t.environment,
    ),
    index("mobile_devices_user_active_idx").on(t.userId, t.isActive),
  ],
);

export const mobileNotificationDeliveries = pgTable(
  "mobile_notification_deliveries",
  {
    id: text("id").primaryKey(),
    deviceId: text("device_id")
      .notNull()
      .references(() => mobileDevices.id, { onDelete: "cascade" }),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    event: text("event").notNull(),
    dedupeKey: text("dedupe_key").notNull().unique(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    destinationType: text("destination_type").notNull(),
    destinationId: text("destination_id").notNull(),
    status: text("status").notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastError: text("last_error"),
    apnsId: text("apns_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [
    index("mobile_notification_pending_idx").on(t.status, t.nextAttemptAt),
    index("mobile_notification_user_created_idx").on(t.userId, t.createdAt),
  ],
);

/* ────────────────────────────────────────────────────────────────────────── */
/* Webhooks                                                                   */
/* ────────────────────────────────────────────────────────────────────────── */

export const webhooks = pgTable("webhooks", {
  id: text("id").primaryKey(),
  organisationId: text("organisation_id")
    .notNull()
    .references(() => organisations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  kind: text("kind").notNull().default("generic"),
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

/* ────────────────────────────────────────────────────────────────────────── */
/* Phase 3: SOAR response actions                                             */
/* ────────────────────────────────────────────────────────────────────────── */

export const responseActions = pgTable(
  "response_actions",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    config: jsonb("config").notNull().default(sql`'{}'::jsonb`),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("response_actions_org_idx").on(t.organisationId)],
);

export const responseActionRuns = pgTable(
  "response_action_runs",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    actionId: text("action_id")
      .notNull()
      .references(() => responseActions.id, { onDelete: "cascade" }),
    caseId: text("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    requestedBy: text("requested_by").references(() => users.id, {
      onDelete: "set null",
    }),
    approvedBy: text("approved_by").references(() => users.id, {
      onDelete: "set null",
    }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    rejectedBy: text("rejected_by").references(() => users.id, {
      onDelete: "set null",
    }),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    rejectionReason: text("rejection_reason"),
    status: text("status").notNull().default("awaiting_approval"),
    idempotencyKey: text("idempotency_key").notNull(),
    target: text("target"),
    request: jsonb("request").notNull().default(sql`'{}'::jsonb`),
    response: jsonb("response").notNull().default(sql`'{}'::jsonb`),
    /**
     * Typed classification of a failed/cancelled run, used by the run console
     * so operators can filter/triage without parsing free-text errors. See
     * `src/lib/run-console/error-category.ts`.
     */
    errorCategory: text("error_category"),
    /**
     * Retry lineage: a manual retry never rewrites this row. Instead it
     * inserts a new run with `parentRunId` pointing here and `rootRunId`
     * pointing at the original (first) attempt in the chain. A partial
     * unique index (below) guarantees at most one child per parent, so a
     * concurrent double-retry can never race into two children.
     */
    parentRunId: text("parent_run_id"),
    rootRunId: text("root_run_id"),
    attempt: integer("attempt").notNull().default(1),
    /**
     * Best-effort cancel marker. Never rewritten to imply a provider effect
     * was reversed; a run already `running` still completes with its true
     * provider outcome, this only records that cancellation was requested.
     */
    cancelRequestedAt: timestamp("cancel_requested_at", { withTimezone: true }),
    cancelRequestedBy: text("cancel_requested_by").references(() => users.id, {
      onDelete: "set null",
    }),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("response_action_runs_case_idx").on(t.caseId),
    index("response_action_runs_action_idx").on(t.actionId),
    index("response_action_runs_org_status_idx").on(t.organisationId, t.status),
    uniqueIndex("response_action_runs_idempotency_key_idx").on(t.idempotencyKey),
    index("response_action_runs_root_idx").on(t.rootRunId),
    uniqueIndex("response_action_runs_parent_idx")
      .on(t.parentRunId)
      .where(sql`${t.parentRunId} is not null`),
    foreignKey({
      columns: [t.parentRunId],
      foreignColumns: [t.id],
      name: "response_action_runs_parent_run_id_response_action_runs_id_fk",
    }).onDelete("set null"),
    foreignKey({
      columns: [t.rootRunId],
      foreignColumns: [t.id],
      name: "response_action_runs_root_run_id_response_action_runs_id_fk",
    }).onDelete("set null"),
  ],
);

/* ────────────────────────────────────────────────────────────────────────── */
/* Governed event automations                                                 */
/* ────────────────────────────────────────────────────────────────────────── */

export const automationRules = pgTable(
  "automation_rules",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    triggerEvent: text("trigger_event").notNull(),
    conditions: jsonb("conditions").notNull().default(sql`'[]'::jsonb`),
    destinationUrl: text("destination_url").notNull(),
    secret: text("secret").notNull(),
    keyId: text("key_id").notNull(),
    targetProfile: text("target_profile").notNull(),
    revision: integer("revision").notNull().default(1),
    isActive: boolean("is_active").notNull().default(false),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("automation_rules_org_trigger_idx").on(
      t.organisationId,
      t.triggerEvent,
      t.isActive,
    ),
  ],
);

export const automationRuns = pgTable(
  "automation_runs",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    ruleId: text("rule_id")
      .notNull()
      .references(() => automationRules.id, { onDelete: "cascade" }),
    caseId: text("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    triggerEventId: text("trigger_event_id")
      .notNull()
      .references(() => timelineEvents.id, { onDelete: "cascade" }),
    triggerEvent: text("trigger_event").notNull(),
    traceId: text("trace_id").notNull(),
    status: text("status").notNull().default("pending"),
    /** Automatic in-place backoff retries within this same row (see `dispatch.ts`). */
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    request: jsonb("request").notNull(),
    response: jsonb("response").notNull().default(sql`'{}'::jsonb`),
    lastError: text("last_error"),
    errorCategory: text("error_category"),
    /**
     * Manual retry lineage (distinct from `attemptCount`'s automatic
     * backoff): a manual retry after a terminal failure/cancellation inserts
     * a new row rather than rewriting this one. See `response_action_runs`
     * for the identical pattern and the partial unique index below.
     */
    parentRunId: text("parent_run_id"),
    rootRunId: text("root_run_id"),
    lineageAttempt: integer("lineage_attempt").notNull().default(1),
    cancelRequestedAt: timestamp("cancel_requested_at", { withTimezone: true }),
    cancelRequestedBy: text("cancel_requested_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    /**
     * Only the original (root) attempt for a given (rule, triggering event)
     * is deduplicated here; a manual retry child is exempt so retrying a
     * failed run never collides with the row this constraint already
     * protects (issue #67: retry must never rewrite prior history).
     */
    uniqueIndex("automation_runs_rule_event_idx")
      .on(t.ruleId, t.triggerEventId)
      .where(sql`${t.parentRunId} is null`),
    index("automation_runs_pending_idx").on(t.status, t.nextAttemptAt),
    index("automation_runs_case_idx").on(t.caseId, t.createdAt),
    index("automation_runs_root_idx").on(t.rootRunId),
    uniqueIndex("automation_runs_parent_idx")
      .on(t.parentRunId)
      .where(sql`${t.parentRunId} is not null`),
    foreignKey({
      columns: [t.parentRunId],
      foreignColumns: [t.id],
      name: "automation_runs_parent_run_id_automation_runs_id_fk",
    }).onDelete("set null"),
    foreignKey({
      columns: [t.rootRunId],
      foreignColumns: [t.id],
      name: "automation_runs_root_run_id_automation_runs_id_fk",
    }).onDelete("set null"),
  ],
);

/* ────────────────────────────────────────────────────────────────────────── */
/* Run console: kill switches and enrichment batch runs                       */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * A kill switch stops a category of automated/governed work before it is
 * claimed or executed (see `src/lib/run-console/kill-switch.ts`). Always
 * organisation-scoped; `scope` narrows it further to a single provider
 * (e.g. `cloudflare`, `microsoft_entra`) or a single action/rule id.
 * `scopeKey` is `''` (never null) for organisation-wide switches so the
 * unique index below has one well-defined row per switch identity.
 */
export const killSwitchScopeEnum = pgEnum("kill_switch_scope", [
  "organisation",
  "provider",
  "action",
]);

export const killSwitches = pgTable(
  "kill_switches",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    scope: killSwitchScopeEnum("scope").notNull(),
    scopeKey: text("scope_key").notNull().default(""),
    enabled: boolean("enabled").notNull().default(true),
    reason: text("reason").notNull(),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedBy: text("updated_by").references(() => users.id, {
      onDelete: "set null",
    }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("kill_switches_org_scope_key_idx").on(
      t.organisationId,
      t.scope,
      t.scopeKey,
    ),
    index("kill_switches_org_idx").on(t.organisationId),
  ],
);

/**
 * One row per scheduled per-organisation enrichment sweep
 * (`enrichPendingCases` in `src/lib/jobs/handlers.ts`). Enrichment itself
 * writes results straight onto `observables.enrichment`; this table exists
 * only so the run console has a durable, queryable record of each sweep
 * (queued/started/finished, how many observables were processed) rather than
 * inventing a generic execution log.
 */
export const enrichmentRuns = pgTable(
  "enrichment_runs",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("running"),
    queuedAt: timestamp("queued_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    processedCount: integer("processed_count").notNull().default(0),
    errorCategory: text("error_category"),
    lastError: text("last_error"),
  },
  (t) => [
    index("enrichment_runs_org_idx").on(t.organisationId, t.queuedAt),
  ],
);

/* ────────────────────────────────────────────────────────────────────────── */
/* Phase 3: Threat intelligence                                               */
/* ────────────────────────────────────────────────────────────────────────── */

export const tiFeeds = pgTable(
  "ti_feeds",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    url: text("url"),
    config: jsonb("config").notNull().default(sql`'{}'::jsonb`),
    pollIntervalMinutes: integer("poll_interval_minutes").notNull().default(60),
    isActive: boolean("is_active").notNull().default(true),
    lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
    lastError: text("last_error"),
    indicatorCount: integer("indicator_count").notNull().default(0),
    lastRunIngestedCount: integer("last_run_ingested_count")
      .notNull()
      .default(0),
    lastRunSkippedCount: integer("last_run_skipped_count").notNull().default(0),
    /** Skip tally from the last poll, keyed by rejected type or skip reason. */
    lastRunSkippedByType: jsonb("last_run_skipped_by_type")
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("ti_feeds_org_idx").on(t.organisationId)],
);

export const tiIndicators = pgTable(
  "ti_indicators",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    feedId: text("feed_id")
      .notNull()
      .references(() => tiFeeds.id, { onDelete: "cascade" }),
    value: text("value").notNull(),
    type: text("type").notNull(),
    confidence: integer("confidence").notNull().default(50),
    firstSeen: timestamp("first_seen", { withTimezone: true }),
    lastSeen: timestamp("last_seen", { withTimezone: true }),
    tags: jsonb("tags").notNull().default(sql`'[]'::jsonb`),
    attributes: jsonb("attributes").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("ti_indicators_feed_value_type_idx").on(
      t.feedId,
      t.value,
      t.type,
    ),
    index("ti_indicators_org_value_idx").on(t.organisationId, t.value),
    index("ti_indicators_org_type_idx").on(t.organisationId, t.type),
    index("ti_indicators_org_confidence_idx").on(
      t.organisationId,
      t.confidence,
    ),
    // Database-level guarantee that only the four supported indicator types
    // can ever be stored, independent of which code path writes the row.
    // Kept literal so drizzle-kit can read it without path-alias resolution;
    // `scripts/test-ti-indicator-types.ts` asserts it matches
    // `TI_INDICATOR_TYPES` in `src/lib/ti/indicator-types.ts`.
    check(
      "ti_indicators_type_allowlist",
      sql.raw(`"type" in ('ip', 'url', 'file_hash', 'domain')`),
    ),
  ],
);

/**
 * Audit trail for indicators removed from the live store because their type is
 * outside the supported contract. `feed_id` is intentionally an unconstrained
 * text copy so the record survives deletion of the originating feed.
 */
export const tiRetiredIndicators = pgTable(
  "ti_retired_indicators",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    feedId: text("feed_id").notNull(),
    value: text("value").notNull(),
    type: text("type").notNull(),
    confidence: integer("confidence").notNull().default(50),
    firstSeen: timestamp("first_seen", { withTimezone: true }),
    lastSeen: timestamp("last_seen", { withTimezone: true }),
    tags: jsonb("tags").notNull().default(sql`'[]'::jsonb`),
    attributes: jsonb("attributes").notNull().default(sql`'{}'::jsonb`),
    retiredReason: text("retired_reason").notNull(),
    retiredAt: timestamp("retired_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("ti_retired_indicators_org_type_idx").on(t.organisationId, t.type),
  ],
);

/* ────────────────────────────────────────────────────────────────────────── */
/* External case sources                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

export const caseSources = pgTable(
  "case_sources",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    config: jsonb("config").notNull().default(sql`'{}'::jsonb`),
    pollIntervalMinutes: integer("poll_interval_minutes").notNull().default(5),
    isActive: boolean("is_active").notNull().default(true),
    cursor: text("cursor"),
    lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
    lastError: text("last_error"),
    importedCaseCount: integer("imported_case_count").notNull().default(0),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("case_sources_org_idx").on(t.organisationId)],
);

/* ────────────────────────────────────────────────────────────────────────── */
/* Inbound mailbox intake (issue #42)                                         */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Organisation-scoped mailbox connection. Secrets live only in
 * `credentialsEncrypted` (AES-256-GCM); never select that column into API/UI
 * responses. Non-secret connection metadata (host, tenant, mailbox address)
 * lives in `connectionMeta`.
 */
export const mailboxConnections = pgTable(
  "mailbox_connections",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** `imap` | `microsoft_graph` */
    provider: text("provider").notNull(),
    folder: text("folder").notNull().default("INBOX"),
    pollIntervalMinutes: integer("poll_interval_minutes").notNull().default(5),
    /** `auto_create` | `review` */
    intakeMode: text("intake_mode").notNull().default("review"),
    defaultSeverity: severityEnum("default_severity").notNull().default("medium"),
    defaultClassification: classificationEnum("default_classification")
      .notNull()
      .default("other"),
    defaultAssigneeId: text("default_assignee_id").references(() => users.id, {
      onDelete: "set null",
    }),
    defaultTemplateId: text("default_template_id").references(
      () => caseTemplates.id,
      { onDelete: "set null" },
    ),
    defaultTags: jsonb("default_tags").notNull().default(sql`'[]'::jsonb`),
    /**
     * AES-256-GCM sealed credentials (`v1:<iv>:<tag>:<ciphertext>` base64).
     * Never returned after save.
     */
    credentialsEncrypted: text("credentials_encrypted").notNull(),
    /** Non-secret provider settings (host/port/username, tenant/client/mailbox). */
    connectionMeta: jsonb("connection_meta").notNull().default(sql`'{}'::jsonb`),
    isActive: boolean("is_active").notNull().default(true),
    cursor: text("cursor"),
    lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    lastError: text("last_error"),
    lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
    /** Distributed poll lock: workers skip while this is in the future. */
    pollLockUntil: timestamp("poll_lock_until", { withTimezone: true }),
    importedMessageCount: integer("imported_message_count").notNull().default(0),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("mailbox_connections_org_idx").on(t.organisationId),
    index("mailbox_connections_active_idx").on(t.isActive),
  ],
);

/**
 * Normalised inbound message records. Deduplicated by
 * `(connection_id, provider_message_id)`. Bodies are stored as plain text plus
 * sanitised HTML only — never unsanitised HTML. Attachments route through the
 * evidence pipeline when a case is created.
 */
export const mailboxMessages = pgTable(
  "mailbox_messages",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    connectionId: text("connection_id")
      .notNull()
      .references(() => mailboxConnections.id, { onDelete: "cascade" }),
    providerMessageId: text("provider_message_id").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    fromAddress: text("from_address"),
    fromName: text("from_name"),
    toAddresses: jsonb("to_addresses").notNull().default(sql`'[]'::jsonb`),
    ccAddresses: jsonb("cc_addresses").notNull().default(sql`'[]'::jsonb`),
    subject: text("subject"),
    bodyText: text("body_text"),
    bodyHtmlSanitized: text("body_html_sanitized"),
    /** Attachment descriptors only (filename, size, contentType) — no bytes. */
    attachmentMeta: jsonb("attachment_meta").notNull().default(sql`'[]'::jsonb`),
    /**
     * `pending_review` | `imported` | `dismissed` | `failed` | `duplicate`
     */
    status: text("status").notNull().default("pending_review"),
    failureReason: text("failure_reason"),
    dismissReason: text("dismiss_reason"),
    caseId: text("case_id").references(() => cases.id, { onDelete: "set null" }),
    originalEvidenceId: text("original_evidence_id").references(
      () => attachments.id,
      { onDelete: "set null" },
    ),
    retryCount: integer("retry_count").notNull().default(0),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("mailbox_messages_connection_provider_idx").on(
      t.connectionId,
      t.providerMessageId,
    ),
    index("mailbox_messages_org_status_idx").on(t.organisationId, t.status),
    index("mailbox_messages_connection_idx").on(t.connectionId),
    index("mailbox_messages_case_idx").on(t.caseId),
  ],
);

/* ────────────────────────────────────────────────────────────────────────── */
/* Inbound push source delivery health                                        */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Delivery health for push producers (such as Tawny) that create cases through
 * `POST /api/v1/cases`. Polled connectors keep the equivalent state on their
 * own `case_sources` row; push producers have no such row, so health is tracked
 * per (organisation, source system).
 */
export const inboundSourceStatus = pgTable(
  "inbound_source_status",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    sourceSystem: text("source_system").notNull(),
    lastDeliveryAt: timestamp("last_delivery_at", { withTimezone: true }),
    lastCaseCreatedAt: timestamp("last_case_created_at", {
      withTimezone: true,
    }),
    lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
    lastErrorMessage: text("last_error_message"),
    lastErrorStatus: integer("last_error_status"),
    deliveryCount: integer("delivery_count").notNull().default(0),
    createdCaseCount: integer("created_case_count").notNull().default(0),
    duplicateCount: integer("duplicate_count").notNull().default(0),
    errorCount: integer("error_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("inbound_source_status_org_system_idx").on(
      t.organisationId,
      t.sourceSystem,
    ),
  ],
);

/* ────────────────────────────────────────────────────────────────────────── */
/* Vendor news watchlist                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

export const vendorWatchlist = pgTable(
  "vendor_watchlist",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    catalogSlug: text("catalog_slug").notNull(),
    displayName: text("display_name").notNull(),
    legalName: text("legal_name").notNull(),
    website: text("website").notNull(),
    category: text("category").notNull(),
    aliases: jsonb("aliases").notNull().default(sql`'[]'::jsonb`),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("vendor_watchlist_org_slug_idx").on(
      t.organisationId,
      t.catalogSlug,
    ),
    index("vendor_watchlist_org_idx").on(t.organisationId),
  ],
);

/* ────────────────────────────────────────────────────────────────────────── */
/* Phase 3: Custom field builder                                              */
/* ────────────────────────────────────────────────────────────────────────── */

export const customFieldDefinitions = pgTable(
  "custom_field_definitions",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    entity: text("entity").notNull().default("case"),
    key: text("key").notNull(),
    label: text("label").notNull(),
    type: text("type").notNull(),
    options: jsonb("options").notNull().default(sql`'[]'::jsonb`),
    required: boolean("required").notNull().default(false),
    orderIndex: integer("order_index").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("custom_field_defs_org_entity_key_idx").on(
      t.organisationId,
      t.entity,
      t.key,
    ),
  ],
);

export const customFieldValues = pgTable(
  "custom_field_values",
  {
    id: text("id").primaryKey(),
    entity: text("entity").notNull(),
    entityId: text("entity_id").notNull(),
    fieldId: text("field_id")
      .notNull()
      .references(() => customFieldDefinitions.id, { onDelete: "cascade" }),
    value: jsonb("value"),
  },
  (t) => [
    uniqueIndex("custom_field_values_entity_field_idx").on(
      t.entityId,
      t.fieldId,
    ),
    index("custom_field_values_field_idx").on(t.fieldId),
  ],
);

/* ────────────────────────────────────────────────────────────────────────── */
/* Phase 3: Real-time presence                                                */
/* ────────────────────────────────────────────────────────────────────────── */

export const casePresence = pgTable(
  "case_presence",
  {
    id: text("id").primaryKey(),
    caseId: text("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    userName: text("user_name").notNull(),
    editingField: text("editing_field"),
    typing: boolean("typing").notNull().default(false),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("case_presence_case_user_idx").on(t.caseId, t.userId),
    index("case_presence_case_idx").on(t.caseId),
  ],
);

/* ────────────────────────────────────────────────────────────────────────── */
/* Phase 3: SSO transient login state                                         */
/* ────────────────────────────────────────────────────────────────────────── */

export const ssoLoginStates = pgTable("sso_login_states", {
  id: text("id").primaryKey(),
  organisationId: text("organisation_id")
    .notNull()
    .references(() => organisations.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  nonce: text("nonce"),
  codeVerifier: text("code_verifier"),
  redirectTo: text("redirect_to"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/* ────────────────────────────────────────────────────────────────────────── */
/* ATT&CK technique mapping and investigation coverage (issue #48)           */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * One imported snapshot of the (organisation-independent) ATT&CK technique
 * catalog. Each version is a self-contained, complete snapshot: an import
 * carries forward every technique id ever seen in an earlier active version
 * that is absent from the new source, marking it `deprecated` on the new
 * technique row rather than dropping it — this is what keeps a deprecated
 * technique readable on a historical case mapping without any fallback join
 * across versions. Exactly one row is ever `active` at a time; a failed
 * import is rolled back (the pending version and its technique rows deleted
 * in the same transaction) rather than left half-written.
 */
export const attackCatalogVersions = pgTable(
  "attack_catalog_versions",
  {
    id: text("id").primaryKey(),
    version: text("version").notNull(),
    source: attackCatalogSourceEnum("source").notNull(),
    sourceUrl: text("source_url"),
    status: attackCatalogStatusEnum("status").notNull().default("pending"),
    techniqueCount: integer("technique_count").notNull().default(0),
    tacticCount: integer("tactic_count").notNull().default(0),
    error: text("error"),
    importedBy: text("imported_by").references(() => users.id, {
      onDelete: "set null",
    }),
    importedAt: timestamp("imported_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
  },
  (t) => [
    index("attack_catalog_versions_status_idx").on(t.status),
    uniqueIndex("attack_catalog_versions_version_idx").on(t.version),
    // At most one active catalog version at a time (global singleton).
    uniqueIndex("attack_catalog_versions_one_active_idx")
      .on(sql`(true)`)
      .where(sql`${t.status} = 'active'`),
  ],
);

/**
 * A technique row scoped to one catalog version. `techniqueId` (e.g.
 * `T1059.001`) is the stable, organisation-independent ATT&CK identifier —
 * `attackTechniqueMappings.techniqueId` references this string directly
 * rather than this table's surrogate `id`, so a mapping keeps resolving
 * across catalog version changes without a migration.
 */
export const attackTechniques = pgTable(
  "attack_techniques",
  {
    id: text("id").primaryKey(),
    catalogVersionId: text("catalog_version_id")
      .notNull()
      .references(() => attackCatalogVersions.id, { onDelete: "cascade" }),
    techniqueId: text("technique_id").notNull(),
    name: text("name").notNull(),
    domain: attackDomainEnum("domain").notNull().default("enterprise"),
    /** Array of `{ id: string, name: string }` tactic references. */
    tactics: jsonb("tactics").notNull().default(sql`'[]'::jsonb`),
    isSubtechnique: boolean("is_subtechnique").notNull().default(false),
    parentTechniqueId: text("parent_technique_id"),
    platforms: jsonb("platforms").notNull().default(sql`'[]'::jsonb`),
    dataSources: jsonb("data_sources").notNull().default(sql`'[]'::jsonb`),
    description: text("description"),
    url: text("url"),
    deprecated: boolean("deprecated").notNull().default(false),
    revoked: boolean("revoked").notNull().default(false),
    supersededByTechniqueId: text("superseded_by_technique_id"),
    attackVersion: text("attack_version"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("attack_techniques_version_technique_idx").on(
      t.catalogVersionId,
      t.techniqueId,
    ),
    index("attack_techniques_technique_idx").on(t.techniqueId),
  ],
);

/**
 * An analyst-recorded link between one ATT&CK technique and one entity
 * (case, observable, evidence item, task, or alert).
 * `techniqueId` is the stable ATT&CK id (not a foreign key to
 * `attack_techniques.id`), so a mapping keeps resolving after a catalog
 * refresh retires the technique row it was created against; `catalogVersionId`
 * is kept only as best-effort provenance of which catalog was active at
 * mapping time. The unique index is the duplicate-mapping guard the
 * acceptance criteria require.
 */
export const attackTechniqueMappings = pgTable(
  "attack_technique_mappings",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    entityType: attackMappingEntityTypeEnum("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    caseId: text("case_id").references(() => cases.id, {
      onDelete: "cascade",
    }),
    techniqueId: text("technique_id").notNull(),
    catalogVersionId: text("catalog_version_id").references(
      () => attackCatalogVersions.id,
      { onDelete: "set null" },
    ),
    confidence: integer("confidence"),
    source: text("source").notNull().default("analyst"),
    notes: text("notes"),
    detectionNotes: text("detection_notes"),
    responseNotes: text("response_notes"),
    /** Analyst-entered free text only — never populated automatically. */
    actorAttribution: text("actor_attribution"),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedBy: text("updated_by").references(() => users.id, {
      onDelete: "set null",
    }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("attack_mappings_unique_idx").on(
      t.organisationId,
      t.entityType,
      t.entityId,
      t.techniqueId,
    ),
    index("attack_mappings_org_technique_idx").on(
      t.organisationId,
      t.techniqueId,
    ),
    index("attack_mappings_org_entity_idx").on(
      t.organisationId,
      t.entityType,
      t.entityId,
    ),
    index("attack_mappings_case_idx").on(t.caseId),
    check(
      "attack_mappings_confidence_range",
      sql.raw(
        `"confidence" is null or ("confidence" >= 0 and "confidence" <= 100)`,
      ),
    ),
  ],
);

/**
 * One explicit step in a case's analyst/provider-ordered "attack story".
 * `sequenceIndex` is the only thing that determines display order — it is
 * set by an analyst (or copied from a provider-supplied sequence) and is
 * never inferred from `occurredAt`, which is kept only as optional
 * contextual timing, per the acceptance criterion that ordering must not
 * claim causality from timestamps alone.
 */
export const attackStoryEntries = pgTable(
  "attack_story_entries",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    caseId: text("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    mappingId: text("mapping_id").references(() => attackTechniqueMappings.id, {
      onDelete: "set null",
    }),
    techniqueId: text("technique_id"),
    sequenceIndex: integer("sequence_index").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    provenance: attackStoryProvenanceEnum("provenance").notNull().default("analyst"),
    sourceRef: text("source_ref"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("attack_story_case_sequence_idx").on(t.caseId, t.sequenceIndex),
    index("attack_story_org_case_idx").on(t.organisationId, t.caseId),
  ],
);

/**
 * Optional, versioned D3FEND countermeasure mapping. Links a D3FEND
 * technique to this organisation's own playbook step and/or response action,
 * so playbook/response guidance can be cross-referenced against a defensive
 * countermeasure catalog without Kelpie ever inferring the link itself.
 */
export const d3fendMappings = pgTable(
  "d3fend_mappings",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    catalogVersion: text("catalog_version").notNull(),
    d3fendTechniqueId: text("d3fend_technique_id").notNull(),
    d3fendTechniqueName: text("d3fend_technique_name").notNull(),
    attackTechniqueIds: jsonb("attack_technique_ids")
      .notNull()
      .default(sql`'[]'::jsonb`),
    playbookId: text("playbook_id").references(() => playbooks.id, {
      onDelete: "cascade",
    }),
    playbookStepId: text("playbook_step_id"),
    responseActionId: text("response_action_id").references(
      () => responseActions.id,
      { onDelete: "cascade" },
    ),
    notes: text("notes"),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("d3fend_mappings_org_idx").on(t.organisationId),
    index("d3fend_mappings_playbook_idx").on(t.playbookId),
    index("d3fend_mappings_response_action_idx").on(t.responseActionId),
    check(
      "d3fend_mappings_scope_target",
      sql.raw(`"playbook_id" is not null or "response_action_id" is not null`),
    ),
  ],
);

/* ────────────────────────────────────────────────────────────────────────── */
/* Case content blocks — structured investigation narrative (issue #58)       */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Head state of one ordered case content block. Body is sanitised Markdown
 * (no active HTML); structured payload is optional JSON for table/checklist
 * types. `revisionNumber` is the head revision; every write appends a row to
 * `case_content_block_revisions` and never rewrites prior history. Restoring
 * an earlier revision creates a new head revision rather than deleting later
 * ones. Soft-archive via `archivedAt` keeps the row for history.
 */
export const caseContentBlocks = pgTable(
  "case_content_blocks",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    caseId: text("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    type: caseContentBlockTypeEnum("type").notNull(),
    title: text("title").notNull(),
    content: text("content").notNull().default(""),
    contentStructured: jsonb("content_structured"),
    sequenceIndex: integer("sequence_index").notNull(),
    groupKey: text("group_key"),
    collapsed: boolean("collapsed").notNull().default(false),
    tlp: tlpEnum("tlp").notNull().default("amber"),
    pap: papEnum("pap").notNull().default("amber"),
    sensitive: boolean("sensitive").notNull().default(false),
    /** When false, reports exclude this block. Sensitive blocks default false. */
    includeInReport: boolean("include_in_report").notNull().default(true),
    authorId: text("author_id").references(() => users.id, {
      onDelete: "set null",
    }),
    lastEditorId: text("last_editor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    revisionNumber: integer("revision_number").notNull().default(1),
    /** Comment this block was promoted from, if any. Preserved forever. */
    sourceCommentId: text("source_comment_id").references(() => comments.id, {
      onDelete: "set null",
    }),
    /** Actor who promoted the comment into a block. */
    promotedById: text("promoted_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    promotedAt: timestamp("promoted_at", { withTimezone: true }),
    /** Original comment author at promotion time (attribution survives user deletion via name snapshot in revision). */
    originalAuthorId: text("original_author_id").references(() => users.id, {
      onDelete: "set null",
    }),
    originalCreatedAt: timestamp("original_created_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    archivedById: text("archived_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Sequence uniqueness only among active (non-archived) blocks so archive
    // + reorder cannot collide on a freed index held by an archived row.
    uniqueIndex("case_content_blocks_case_sequence_idx")
      .on(t.caseId, t.sequenceIndex)
      .where(sql`${t.archivedAt} is null`),
    index("case_content_blocks_org_case_idx").on(t.organisationId, t.caseId),
    index("case_content_blocks_source_comment_idx").on(t.sourceCommentId),
  ],
);

/**
 * Append-only revision history for a content block. Rows are never updated or
 * deleted by application code. Restoring revision N inserts revision M+1 with
 * the restored body and `restoredFromRevision = N`.
 */
export const caseContentBlockRevisions = pgTable(
  "case_content_block_revisions",
  {
    id: text("id").primaryKey(),
    blockId: text("block_id")
      .notNull()
      .references(() => caseContentBlocks.id, { onDelete: "cascade" }),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    caseId: text("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    revisionNumber: integer("revision_number").notNull(),
    type: caseContentBlockTypeEnum("type").notNull(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    contentStructured: jsonb("content_structured"),
    tlp: tlpEnum("tlp").notNull(),
    pap: papEnum("pap").notNull(),
    sensitive: boolean("sensitive").notNull(),
    includeInReport: boolean("include_in_report").notNull(),
    editorId: text("editor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    changeSummary: text("change_summary"),
    restoredFromRevision: integer("restored_from_revision"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("case_content_block_revisions_block_rev_idx").on(
      t.blockId,
      t.revisionNumber,
    ),
    index("case_content_block_revisions_case_idx").on(t.caseId),
  ],
);

/**
 * Authorised links from a content block to investigation records. Every link
 * is re-checked for organisation + case membership on write so a guessed id
 * from another org or case cannot be attached.
 */
export const caseContentBlockLinks = pgTable(
  "case_content_block_links",
  {
    id: text("id").primaryKey(),
    blockId: text("block_id")
      .notNull()
      .references(() => caseContentBlocks.id, { onDelete: "cascade" }),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    caseId: text("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    linkType: caseContentBlockLinkTypeEnum("link_type").notNull(),
    targetId: text("target_id").notNull(),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("case_content_block_links_unique_idx").on(
      t.blockId,
      t.linkType,
      t.targetId,
    ),
    index("case_content_block_links_case_idx").on(t.caseId),
    index("case_content_block_links_target_idx").on(t.linkType, t.targetId),
  ],
);

export type Organisation = typeof organisations.$inferSelect;

/* Asset / identity context records (issue #59)                               */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Organisation-scoped business context for an asset, identity, application,
 * or business service. Provider-owned fields (`criticality`, `privilegeLevel`,
 * …) are updated by imports; analyst override columns are never written by
 * providers. Effective values are `coalesce(override, provider)`.
 *
 * Optionally linked to a normalised investigation `entities` row. Ambiguous
 * matches go to `entity_context_match_reviews` rather than auto-linking.
 */
export const assetIdentityContexts = pgTable(
  "asset_identity_contexts",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    kind: assetContextKindEnum("kind").notNull(),
    entityId: text("entity_id").references(() => entities.id, {
      onDelete: "set null",
    }),
    displayName: text("display_name").notNull(),
    primaryIdentifierKind: entityIdentifierKindEnum(
      "primary_identifier_kind",
    ).notNull(),
    primaryIdentifierValue: text("primary_identifier_value").notNull(),
    // Provider-owned fields
    criticality: criticalityLevelEnum("criticality").notNull().default("medium"),
    privilegeLevel: privilegeLevelEnum("privilege_level")
      .notNull()
      .default("none"),
    exposure: exposureLevelEnum("exposure").notNull().default("internal"),
    environment: environmentKindEnum("environment")
      .notNull()
      .default("unknown"),
    isCrownJewel: boolean("is_crown_jewel").notNull().default(false),
    recoveryPriority: recoveryPriorityEnum("recovery_priority")
      .notNull()
      .default("none"),
    // Analyst overrides — never silently overwritten by provider sync
    criticalityOverride: criticalityLevelEnum("criticality_override"),
    privilegeLevelOverride: privilegeLevelEnum("privilege_level_override"),
    exposureOverride: exposureLevelEnum("exposure_override"),
    isCrownJewelOverride: boolean("is_crown_jewel_override"),
    recoveryPriorityOverride: recoveryPriorityEnum(
      "recovery_priority_override",
    ),
    ownerTeam: text("owner_team"),
    ownerEmail: text("owner_email"),
    businessService: text("business_service"),
    applicationName: text("application_name"),
    dataClassifications: jsonb("data_classifications")
      .notNull()
      .default(sql`'[]'::jsonb`),
    regulatoryScope: jsonb("regulatory_scope")
      .notNull()
      .default(sql`'[]'::jsonb`),
    attributes: jsonb("attributes").notNull().default(sql`'{}'::jsonb`),
    providerSource: contextImportSourceEnum("provider_source")
      .notNull()
      .default("manual"),
    providerExternalId: text("provider_external_id"),
    providerUpdatedAt: timestamp("provider_updated_at", {
      withTimezone: true,
    }),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    lastSyncStatus: contextSyncStatusEnum("last_sync_status")
      .notNull()
      .default("never_synced"),
    lastSyncError: text("last_sync_error"),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    updatedBy: text("updated_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("asset_contexts_org_kind_ident_idx").on(
      t.organisationId,
      t.kind,
      t.primaryIdentifierKind,
      t.primaryIdentifierValue,
    ),
    uniqueIndex("asset_contexts_org_provider_ext_idx")
      .on(t.organisationId, t.providerSource, t.providerExternalId)
      .where(sql`${t.providerExternalId} is not null`),
    index("asset_contexts_org_entity_idx").on(t.organisationId, t.entityId),
    index("asset_contexts_org_criticality_idx").on(
      t.organisationId,
      t.criticality,
    ),
    index("asset_contexts_org_crown_idx")
      .on(t.organisationId)
      .where(
        sql`${t.isCrownJewel} = true or ${t.isCrownJewelOverride} = true`,
      ),
    index("asset_contexts_org_sync_idx").on(
      t.organisationId,
      t.lastSyncStatus,
    ),
  ],
);

/**
 * Ambiguous entity matches held for analyst review instead of auto-link.
 * `candidateEntityIds` is a jsonb string array of entity ids in this org.
 */
export const entityContextMatchReviews = pgTable(
  "entity_context_match_reviews",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    contextId: text("context_id")
      .notNull()
      .references(() => assetIdentityContexts.id, { onDelete: "cascade" }),
    status: entityMatchReviewStatusEnum("status").notNull().default("pending"),
    candidateEntityIds: jsonb("candidate_entity_ids")
      .notNull()
      .default(sql`'[]'::jsonb`),
    matchReason: text("match_reason"),
    resolvedEntityId: text("resolved_entity_id").references(() => entities.id, {
      onDelete: "set null",
    }),
    resolvedBy: text("resolved_by").references(() => users.id, {
      onDelete: "set null",
    }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("entity_match_reviews_org_status_idx").on(
      t.organisationId,
      t.status,
    ),
    index("entity_match_reviews_context_idx").on(t.contextId),
  ],
);

/** One CSV / Entra / Defender / REST import attempt (including dry-runs). */
export const contextImportRuns = pgTable(
  "context_import_runs",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    source: contextImportSourceEnum("source").notNull(),
    status: contextImportRunStatusEnum("status").notNull().default("dry_run"),
    dryRun: boolean("dry_run").notNull().default(true),
    rowCount: integer("row_count").notNull().default(0),
    successCount: integer("success_count").notNull().default(0),
    errorCount: integer("error_count").notNull().default(0),
    createdCount: integer("created_count").notNull().default(0),
    updatedCount: integer("updated_count").notNull().default(0),
    skippedCount: integer("skipped_count").notNull().default(0),
    /** Per-row errors: `[{ row, field?, message }]`. */
    errors: jsonb("errors").notNull().default(sql`'[]'::jsonb`),
    summary: jsonb("summary").notNull().default(sql`'{}'::jsonb`),
    startedBy: text("started_by").references(() => users.id, {
      onDelete: "set null",
    }),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    index("context_import_runs_org_started_idx").on(
      t.organisationId,
      t.startedAt,
    ),
  ],
);

/**
 * Explainable case priority score, kept separate from source `cases.severity`.
 * Every calculation stores factors, weights, and a calculation version so
 * analysts can see why a case ranks where it does.
 *
 * `analystOverrideScore` wins over `calculatedScore` for `effectiveScore`;
 * recalculation never clears the override.
 */
export const casePriorityScores = pgTable(
  "case_priority_scores",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    caseId: text("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    calculatedScore: integer("calculated_score").notNull(),
    scoreBand: priorityScoreBandEnum("score_band").notNull(),
    effectiveScore: integer("effective_score").notNull(),
    calculationVersion: text("calculation_version").notNull(),
    /** Array of factor objects: id, label, inputValue, normalisedScore, weight, contribution, detail, staleDiscountApplied. */
    factors: jsonb("factors").notNull().default(sql`'[]'::jsonb`),
    weightsUsed: jsonb("weights_used").notNull().default(sql`'{}'::jsonb`),
    inputsSnapshot: jsonb("inputs_snapshot")
      .notNull()
      .default(sql`'{}'::jsonb`),
    scoringEnabled: boolean("scoring_enabled").notNull().default(true),
    staleContextPolicy: staleContextPolicyEnum("stale_context_policy")
      .notNull()
      .default("discount"),
    hasCriticalContext: boolean("has_critical_context").notNull().default(false),
    hasCrownJewelContext: boolean("has_crown_jewel_context")
      .notNull()
      .default(false),
    hasStaleContext: boolean("has_stale_context").notNull().default(false),
    analystOverrideScore: integer("analyst_override_score"),
    analystOverrideReason: text("analyst_override_reason"),
    analystOverrideBy: text("analyst_override_by").references(() => users.id, {
      onDelete: "set null",
    }),
    analystOverrideAt: timestamp("analyst_override_at", {
      withTimezone: true,
    }),
    calculatedAt: timestamp("calculated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("case_priority_scores_case_idx").on(t.caseId),
    index("case_priority_scores_org_effective_idx").on(
      t.organisationId,
      t.effectiveScore,
    ),
    index("case_priority_scores_org_band_idx").on(
      t.organisationId,
      t.scoreBand,
    ),
    check(
      "case_priority_scores_calc_range",
      sql.raw(
        `"calculated_score" >= 0 and "calculated_score" <= 100`,
      ),
    ),
    check(
      "case_priority_scores_eff_range",
      sql.raw(`"effective_score" >= 0 and "effective_score" <= 100`),
    ),
    check(
      "case_priority_scores_override_range",
      sql.raw(
        `"analyst_override_score" is null or ("analyst_override_score" >= 0 and "analyst_override_score" <= 100)`,
      ),
    ),
  ],
);

export type Organisation = typeof organisations.$inferSelect;

export type AssetIdentityContext = typeof assetIdentityContexts.$inferSelect;
export type EntityContextMatchReview =
  typeof entityContextMatchReviews.$inferSelect;
export type ContextImportRun = typeof contextImportRuns.$inferSelect;
export type CasePriorityScore = typeof casePriorityScores.$inferSelect;

export type User = typeof users.$inferSelect;
export type TwoFactor = typeof twoFactors.$inferSelect;
export type Case = typeof cases.$inferSelect;
export type CaseTask = typeof caseTasks.$inferSelect;
export type Observable = typeof observables.$inferSelect;
export type CaseRelationship = typeof caseRelationships.$inferSelect;
export type CaseRelationshipDismissal =
  typeof caseRelationshipDismissals.$inferSelect;
export type TimelineEvent = typeof timelineEvents.$inferSelect;
export type Comment = typeof comments.$inferSelect;
export type Attachment = typeof attachments.$inferSelect;
export type EvidenceCustodyEvent = typeof evidenceCustodyEvents.$inferSelect;
export type EvidenceCollection = typeof evidenceCollections.$inferSelect;
export type EvidenceLegalHold = typeof evidenceLegalHolds.$inferSelect;
export type Playbook = typeof playbooks.$inferSelect;
export type PlaybookRun = typeof playbookRuns.$inferSelect;
export type SlaPolicy = typeof slaPolicies.$inferSelect;
export type CaseTemplate = typeof caseTemplates.$inferSelect;
export type ApiToken = typeof apiTokens.$inferSelect;
export type MobileDevice = typeof mobileDevices.$inferSelect;
export type MobileNotificationDelivery =
  typeof mobileNotificationDeliveries.$inferSelect;
export type Webhook = typeof webhooks.$inferSelect;
export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;
export type EnrichmentCacheRow = typeof enrichmentCache.$inferSelect;
export type ResponseAction = typeof responseActions.$inferSelect;
export type ResponseActionRun = typeof responseActionRuns.$inferSelect;
export type AutomationRuleRow = typeof automationRules.$inferSelect;
export type AutomationRunRow = typeof automationRuns.$inferSelect;
export type KillSwitchRow = typeof killSwitches.$inferSelect;
export type EnrichmentRunRow = typeof enrichmentRuns.$inferSelect;
export type AuditExportJobRow = typeof auditExportJobs.$inferSelect;
export type TiFeed = typeof tiFeeds.$inferSelect;
export type TiIndicator = typeof tiIndicators.$inferSelect;
export type CaseSource = typeof caseSources.$inferSelect;
export type MailboxConnection = typeof mailboxConnections.$inferSelect;
export type MailboxMessage = typeof mailboxMessages.$inferSelect;
export type InboundSourceStatus = typeof inboundSourceStatus.$inferSelect;
export type VendorWatch = typeof vendorWatchlist.$inferSelect;
export type CustomFieldDefinition = typeof customFieldDefinitions.$inferSelect;
export type CustomFieldValue = typeof customFieldValues.$inferSelect;
export type CasePresence = typeof casePresence.$inferSelect;
export type SsoLoginState = typeof ssoLoginStates.$inferSelect;
export type AlertSource = typeof alertSources.$inferSelect;
export type ProviderPayloadReference = typeof providerPayloadReferences.$inferSelect;
export type Alert = typeof alerts.$inferSelect;
export type Entity = typeof entities.$inferSelect;
export type EntityIdentifier = typeof entityIdentifiers.$inferSelect;
export type AlertEntity = typeof alertEntities.$inferSelect;
export type CaseAlert = typeof caseAlerts.$inferSelect;
export type CorrelationRule = typeof correlationRules.$inferSelect;
export type CorrelationSuggestion = typeof correlationSuggestions.$inferSelect;
export type AlertMembershipHistoryRow = typeof alertMembershipHistory.$inferSelect;
export type CaseMerge = typeof caseMerges.$inferSelect;
export type CorrelationRuleMetrics = typeof correlationRuleMetrics.$inferSelect;
export type EvidenceItem = typeof evidenceItems.$inferSelect;
export type EvidenceRelationship = typeof evidenceRelationships.$inferSelect;
export type Team = typeof teams.$inferSelect;
export type TeamMember = typeof teamMembers.$inferSelect;
export type Queue = typeof queues.$inferSelect;
export type CaseAssignee = typeof caseAssignees.$inferSelect;
export type CaseWatcher = typeof caseWatchers.$inferSelect;
export type ShiftHandoff = typeof shiftHandoffs.$inferSelect;
export type EscalationPolicy = typeof escalationPolicies.$inferSelect;
export type EscalationPolicyRun = typeof escalationPolicyRuns.$inferSelect;
export type CaseClosurePolicy = typeof caseClosurePolicies.$inferSelect;
export type CaseClosurePolicyVersion =
  typeof caseClosurePolicyVersions.$inferSelect;
export type CaseClosureSnapshot = typeof caseClosureSnapshots.$inferSelect;
export type BulkOperation = typeof bulkOperations.$inferSelect;
export type AttackCatalogVersion = typeof attackCatalogVersions.$inferSelect;
export type AttackTechniqueRow = typeof attackTechniques.$inferSelect;
export type AttackTechniqueMapping = typeof attackTechniqueMappings.$inferSelect;
export type AttackStoryEntry = typeof attackStoryEntries.$inferSelect;
export type D3fendMapping = typeof d3fendMappings.$inferSelect;
export type CaseContentBlock = typeof caseContentBlocks.$inferSelect;
export type CaseContentBlockRevision =
  typeof caseContentBlockRevisions.$inferSelect;
export type CaseContentBlockLink = typeof caseContentBlockLinks.$inferSelect;

export type PlaybookStepPhase =
  | "triage"
  | "scoping"
  | "containment"
  | "eradication"
  | "recovery"
  | "communications"
  | "closure";

/** Documented guidance categories a playbook step's description covers. */
export { PLAYBOOK_GUIDANCE_CATEGORIES } from "@/lib/attack/playbook-guidance";
export type { PlaybookGuidanceCategory } from "@/lib/attack/playbook-guidance";

export type PlaybookStep = {
  id: string;
  title: string;
  description?: string;
  defaultAssigneeRole?: "admin" | "analyst" | "read_only";
  offsetMinutes: number;
  isRequired: boolean;
  /** Response-lifecycle phase this step belongs to. Optional for
   * hand-authored custom playbooks; the baseline catalogue sets it on every
   * step so the UI can group steps by phase. */
  phase?: PlaybookStepPhase;
  /** True when this step is (or triggers) an action that must not run without
   * a human approval — e.g. isolating a host or disabling an account. This is
   * a display/planning hint only: Kelpie never executes response actions
   * automatically from a playbook step, and the response-action approval gate
   * (see `responseActionRuns`) is enforced independently. */
  requiresApproval?: boolean;
  /** ATT&CK technique ids this step's guidance addresses. */
  attackTechniqueIds?: string[];
  /** Which of investigation/detection/containment/recovery this step documents. */
  guidanceCategories?: PlaybookGuidanceCategory[];
};

/**
 * Structured operational detail for a playbook, beyond its ordered task
 * `steps`. Every field is optional so custom, organisation-authored
 * playbooks can start from `{}` and grow over time; the baseline catalogue
 * (`src/lib/playbook-catalogue.ts`) populates all of them.
 */
export type PlaybookContent = {
  purpose?: string;
  triggers?: string[];
  exclusions?: string[];
  severityGuidance?: string;
  evidenceToPreserve?: string[];
  initialQuestions?: string[];
  decisionPoints?: string[];
  /** Actions that require explicit human/approval-gate sign-off before they
   * run (containment/eradication actions, account disablement, etc). */
  approvalActions?: string[];
  communicationsOwners?: string[];
  closureCriteria?: string[];
  followUpImprovements?: string[];
  /** Plain-text MITRE ATT&CK technique IDs (e.g. "T1566.001"). Kept as plain
   * strings rather than a structured reference so this catalogue does not
   * depend on the ATT&CK mapping work landing separately. */
  mitreTechniques?: string[];
  /** Case fields/custom fields an analyst should capture while working this
   * scenario (plain descriptive labels, not schema-bound). */
  caseFieldsToCapture?: string[];
};
