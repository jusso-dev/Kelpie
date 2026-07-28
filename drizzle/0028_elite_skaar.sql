CREATE TYPE "public"."case_content_block_link_type" AS ENUM('alert', 'entity', 'evidence_item', 'task', 'attack_technique', 'attack_mapping');--> statement-breakpoint
CREATE TYPE "public"."case_content_block_type" AS ENUM('investigation_note', 'finding', 'hypothesis', 'decision', 'evidence_summary', 'containment_record', 'eradication_record', 'recovery_validation', 'stakeholder_update', 'code_query', 'table', 'checklist', 'external_reference', 'report_section');--> statement-breakpoint
CREATE TABLE "case_content_block_links" (
	"id" text PRIMARY KEY NOT NULL,
	"block_id" text NOT NULL,
	"organisation_id" text NOT NULL,
	"case_id" text NOT NULL,
	"link_type" "case_content_block_link_type" NOT NULL,
	"target_id" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "case_content_block_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"block_id" text NOT NULL,
	"organisation_id" text NOT NULL,
	"case_id" text NOT NULL,
	"revision_number" integer NOT NULL,
	"type" "case_content_block_type" NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"content_structured" jsonb,
	"tlp" "tlp" NOT NULL,
	"pap" "pap" NOT NULL,
	"sensitive" boolean NOT NULL,
	"include_in_report" boolean NOT NULL,
	"editor_id" text,
	"change_summary" text,
	"restored_from_revision" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "case_content_blocks" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"case_id" text NOT NULL,
	"type" "case_content_block_type" NOT NULL,
	"title" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"content_structured" jsonb,
	"sequence_index" integer NOT NULL,
	"group_key" text,
	"collapsed" boolean DEFAULT false NOT NULL,
	"tlp" "tlp" DEFAULT 'amber' NOT NULL,
	"pap" "pap" DEFAULT 'amber' NOT NULL,
	"sensitive" boolean DEFAULT false NOT NULL,
	"include_in_report" boolean DEFAULT true NOT NULL,
	"author_id" text,
	"last_editor_id" text,
	"revision_number" integer DEFAULT 1 NOT NULL,
	"source_comment_id" text,
	"promoted_by_id" text,
	"promoted_at" timestamp with time zone,
	"original_author_id" text,
	"original_created_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"archived_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "case_content_block_links" ADD CONSTRAINT "case_content_block_links_block_id_case_content_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."case_content_blocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_content_block_links" ADD CONSTRAINT "case_content_block_links_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_content_block_links" ADD CONSTRAINT "case_content_block_links_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_content_block_links" ADD CONSTRAINT "case_content_block_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_content_block_revisions" ADD CONSTRAINT "case_content_block_revisions_block_id_case_content_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."case_content_blocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_content_block_revisions" ADD CONSTRAINT "case_content_block_revisions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_content_block_revisions" ADD CONSTRAINT "case_content_block_revisions_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_content_block_revisions" ADD CONSTRAINT "case_content_block_revisions_editor_id_users_id_fk" FOREIGN KEY ("editor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_content_blocks" ADD CONSTRAINT "case_content_blocks_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_content_blocks" ADD CONSTRAINT "case_content_blocks_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_content_blocks" ADD CONSTRAINT "case_content_blocks_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_content_blocks" ADD CONSTRAINT "case_content_blocks_last_editor_id_users_id_fk" FOREIGN KEY ("last_editor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_content_blocks" ADD CONSTRAINT "case_content_blocks_source_comment_id_comments_id_fk" FOREIGN KEY ("source_comment_id") REFERENCES "public"."comments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_content_blocks" ADD CONSTRAINT "case_content_blocks_promoted_by_id_users_id_fk" FOREIGN KEY ("promoted_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_content_blocks" ADD CONSTRAINT "case_content_blocks_original_author_id_users_id_fk" FOREIGN KEY ("original_author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_content_blocks" ADD CONSTRAINT "case_content_blocks_archived_by_id_users_id_fk" FOREIGN KEY ("archived_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "case_content_block_links_unique_idx" ON "case_content_block_links" USING btree ("block_id","link_type","target_id");--> statement-breakpoint
CREATE INDEX "case_content_block_links_case_idx" ON "case_content_block_links" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "case_content_block_links_target_idx" ON "case_content_block_links" USING btree ("link_type","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "case_content_block_revisions_block_rev_idx" ON "case_content_block_revisions" USING btree ("block_id","revision_number");--> statement-breakpoint
CREATE INDEX "case_content_block_revisions_case_idx" ON "case_content_block_revisions" USING btree ("case_id");--> statement-breakpoint
CREATE UNIQUE INDEX "case_content_blocks_case_sequence_idx" ON "case_content_blocks" USING btree ("case_id","sequence_index") WHERE "case_content_blocks"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "case_content_blocks_org_case_idx" ON "case_content_blocks" USING btree ("organisation_id","case_id");--> statement-breakpoint
CREATE INDEX "case_content_blocks_source_comment_idx" ON "case_content_blocks" USING btree ("source_comment_id");