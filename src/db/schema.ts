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
    containedAt: timestamp("contained_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    slaState: jsonb("sla_state").notNull().default(sql`'{}'::jsonb`),
    version: integer("version").notNull().default(0),
    sourceSystem: text("source_system"),
    sourceReference: text("source_reference"),
    sourceUrl: text("source_url"),
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
  defaultTags: jsonb("default_tags").notNull().default(sql`'[]'::jsonb`),
  defaultDataClassificationTags: jsonb("default_data_classification_tags")
    .notNull()
    .default(sql`'[]'::jsonb`),
  defaultTasks: jsonb("default_tasks").notNull().default(sql`'[]'::jsonb`),
  defaultCustomFields: jsonb("default_custom_fields")
    .notNull()
    .default(sql`'{}'::jsonb`),
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
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    request: jsonb("request").notNull(),
    response: jsonb("response").notNull().default(sql`'{}'::jsonb`),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("automation_runs_rule_event_idx").on(
      t.ruleId,
      t.triggerEventId,
    ),
    index("automation_runs_pending_idx").on(t.status, t.nextAttemptAt),
    index("automation_runs_case_idx").on(t.caseId, t.createdAt),
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

export type Organisation = typeof organisations.$inferSelect;
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
export type TiFeed = typeof tiFeeds.$inferSelect;
export type TiIndicator = typeof tiIndicators.$inferSelect;
export type CaseSource = typeof caseSources.$inferSelect;
export type InboundSourceStatus = typeof inboundSourceStatus.$inferSelect;
export type VendorWatch = typeof vendorWatchlist.$inferSelect;
export type CustomFieldDefinition = typeof customFieldDefinitions.$inferSelect;
export type CustomFieldValue = typeof customFieldValues.$inferSelect;
export type CasePresence = typeof casePresence.$inferSelect;
export type SsoLoginState = typeof ssoLoginStates.$inferSelect;

export type PlaybookStep = {
  id: string;
  title: string;
  description?: string;
  defaultAssigneeRole?: "admin" | "analyst" | "read_only";
  offsetMinutes: number;
  isRequired: boolean;
};
