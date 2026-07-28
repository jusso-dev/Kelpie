CREATE TYPE "public"."evidence_relevance" AS ENUM('unknown', 'relevant', 'not_relevant');--> statement-breakpoint
CREATE TYPE "public"."evidence_status" AS ENUM('pending_scan', 'available', 'quarantined', 'scan_failed');--> statement-breakpoint
CREATE TABLE "evidence_collections" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"case_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence_custody_events" (
	"id" text PRIMARY KEY NOT NULL,
	"evidence_id" text NOT NULL,
	"organisation_id" text NOT NULL,
	"actor_id" text,
	"event_type" text NOT NULL,
	"reason" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence_legal_holds" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"case_id" text,
	"evidence_id" text,
	"reason" text NOT NULL,
	"applied_by" text,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_by" text,
	"released_at" timestamp with time zone,
	"release_reason" text,
	CONSTRAINT "evidence_legal_holds_scope_target" CHECK ("case_id" is not null or "evidence_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "organisation_id" text;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "original_filename" text;--> statement-breakpoint
UPDATE "attachments" SET "organisation_id" = "cases"."organisation_id" FROM "cases" WHERE "cases"."id" = "attachments"."case_id" AND "attachments"."organisation_id" IS NULL;--> statement-breakpoint
UPDATE "attachments" SET "original_filename" = "attachments"."filename" WHERE "attachments"."original_filename" IS NULL;--> statement-breakpoint
ALTER TABLE "attachments" ALTER COLUMN "organisation_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "attachments" ALTER COLUMN "original_filename" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "declared_content_type" text;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "status" "evidence_status" DEFAULT 'pending_scan' NOT NULL;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "source" text DEFAULT 'analyst_upload' NOT NULL;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "scanner_name" text;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "scan_verdict" text;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "scan_detail" text;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "scanned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "overridden_by" text;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "overridden_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "override_reason" text;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "is_archive" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "archive_kind" text;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "archive_entry_count" integer;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "archive_password_protected" boolean;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "parent_evidence_id" text;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "collection_id" text;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "relevance" "evidence_relevance" DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "acquisition_source" text;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "acquired_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "examiner_notes" text;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "labels" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "deleted_by" text;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "deletion_reason" text;--> statement-breakpoint
ALTER TABLE "evidence_collections" ADD CONSTRAINT "evidence_collections_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_collections" ADD CONSTRAINT "evidence_collections_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_collections" ADD CONSTRAINT "evidence_collections_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_custody_events" ADD CONSTRAINT "evidence_custody_events_evidence_id_attachments_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."attachments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_custody_events" ADD CONSTRAINT "evidence_custody_events_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_custody_events" ADD CONSTRAINT "evidence_custody_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_legal_holds" ADD CONSTRAINT "evidence_legal_holds_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_legal_holds" ADD CONSTRAINT "evidence_legal_holds_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_legal_holds" ADD CONSTRAINT "evidence_legal_holds_evidence_id_attachments_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."attachments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_legal_holds" ADD CONSTRAINT "evidence_legal_holds_applied_by_users_id_fk" FOREIGN KEY ("applied_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_legal_holds" ADD CONSTRAINT "evidence_legal_holds_released_by_users_id_fk" FOREIGN KEY ("released_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "evidence_collections_case_idx" ON "evidence_collections" USING btree ("case_id");--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_collections_case_name_idx" ON "evidence_collections" USING btree ("case_id","name");--> statement-breakpoint
CREATE INDEX "evidence_custody_events_evidence_idx" ON "evidence_custody_events" USING btree ("evidence_id","occurred_at");--> statement-breakpoint
CREATE INDEX "evidence_custody_events_org_idx" ON "evidence_custody_events" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "evidence_legal_holds_org_idx" ON "evidence_legal_holds" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "evidence_legal_holds_case_idx" ON "evidence_legal_holds" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "evidence_legal_holds_evidence_idx" ON "evidence_legal_holds" USING btree ("evidence_id");--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_overridden_by_users_id_fk" FOREIGN KEY ("overridden_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_collection_id_evidence_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."evidence_collections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_parent_evidence_id_attachments_id_fk" FOREIGN KEY ("parent_evidence_id") REFERENCES "public"."attachments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachments_org_idx" ON "attachments" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "attachments_org_status_idx" ON "attachments" USING btree ("organisation_id","status");--> statement-breakpoint
CREATE INDEX "attachments_parent_idx" ON "attachments" USING btree ("parent_evidence_id");--> statement-breakpoint
CREATE INDEX "attachments_collection_idx" ON "attachments" USING btree ("collection_id");