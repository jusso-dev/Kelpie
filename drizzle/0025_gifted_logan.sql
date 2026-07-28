CREATE TYPE "public"."attack_catalog_source" AS ENUM('bundled_baseline', 'url_import');--> statement-breakpoint
CREATE TYPE "public"."attack_catalog_status" AS ENUM('pending', 'active', 'superseded', 'failed', 'rolled_back');--> statement-breakpoint
CREATE TYPE "public"."attack_domain" AS ENUM('enterprise', 'mobile', 'ics');--> statement-breakpoint
CREATE TYPE "public"."attack_mapping_entity_type" AS ENUM('case', 'alert', 'observable', 'evidence', 'task');--> statement-breakpoint
CREATE TYPE "public"."attack_story_provenance" AS ENUM('analyst', 'provider');--> statement-breakpoint
CREATE TABLE "attack_catalog_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"version" text NOT NULL,
	"source" "attack_catalog_source" NOT NULL,
	"source_url" text,
	"status" "attack_catalog_status" DEFAULT 'pending' NOT NULL,
	"technique_count" integer DEFAULT 0 NOT NULL,
	"tactic_count" integer DEFAULT 0 NOT NULL,
	"error" text,
	"imported_by" text,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone,
	"superseded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "attack_story_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"case_id" text NOT NULL,
	"mapping_id" text,
	"technique_id" text,
	"sequence_index" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"provenance" "attack_story_provenance" DEFAULT 'analyst' NOT NULL,
	"source_ref" text,
	"occurred_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attack_technique_mappings" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"entity_type" "attack_mapping_entity_type" NOT NULL,
	"entity_id" text NOT NULL,
	"case_id" text,
	"technique_id" text NOT NULL,
	"catalog_version_id" text,
	"confidence" integer,
	"source" text DEFAULT 'analyst' NOT NULL,
	"notes" text,
	"detection_notes" text,
	"response_notes" text,
	"actor_attribution" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attack_mappings_confidence_range" CHECK ("confidence" is null or ("confidence" >= 0 and "confidence" <= 100))
);
--> statement-breakpoint
CREATE TABLE "attack_techniques" (
	"id" text PRIMARY KEY NOT NULL,
	"catalog_version_id" text NOT NULL,
	"technique_id" text NOT NULL,
	"name" text NOT NULL,
	"domain" "attack_domain" DEFAULT 'enterprise' NOT NULL,
	"tactics" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_subtechnique" boolean DEFAULT false NOT NULL,
	"parent_technique_id" text,
	"platforms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"data_sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"description" text,
	"url" text,
	"deprecated" boolean DEFAULT false NOT NULL,
	"revoked" boolean DEFAULT false NOT NULL,
	"superseded_by_technique_id" text,
	"attack_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "d3fend_mappings" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"catalog_version" text NOT NULL,
	"d3fend_technique_id" text NOT NULL,
	"d3fend_technique_name" text NOT NULL,
	"attack_technique_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"playbook_id" text,
	"playbook_step_id" text,
	"response_action_id" text,
	"notes" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "d3fend_mappings_scope_target" CHECK ("playbook_id" is not null or "response_action_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "attack_catalog_versions" ADD CONSTRAINT "attack_catalog_versions_imported_by_users_id_fk" FOREIGN KEY ("imported_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attack_story_entries" ADD CONSTRAINT "attack_story_entries_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attack_story_entries" ADD CONSTRAINT "attack_story_entries_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attack_story_entries" ADD CONSTRAINT "attack_story_entries_mapping_id_attack_technique_mappings_id_fk" FOREIGN KEY ("mapping_id") REFERENCES "public"."attack_technique_mappings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attack_story_entries" ADD CONSTRAINT "attack_story_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attack_technique_mappings" ADD CONSTRAINT "attack_technique_mappings_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attack_technique_mappings" ADD CONSTRAINT "attack_technique_mappings_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attack_technique_mappings" ADD CONSTRAINT "attack_technique_mappings_catalog_version_id_attack_catalog_versions_id_fk" FOREIGN KEY ("catalog_version_id") REFERENCES "public"."attack_catalog_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attack_technique_mappings" ADD CONSTRAINT "attack_technique_mappings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attack_technique_mappings" ADD CONSTRAINT "attack_technique_mappings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attack_techniques" ADD CONSTRAINT "attack_techniques_catalog_version_id_attack_catalog_versions_id_fk" FOREIGN KEY ("catalog_version_id") REFERENCES "public"."attack_catalog_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "d3fend_mappings" ADD CONSTRAINT "d3fend_mappings_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "d3fend_mappings" ADD CONSTRAINT "d3fend_mappings_playbook_id_playbooks_id_fk" FOREIGN KEY ("playbook_id") REFERENCES "public"."playbooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "d3fend_mappings" ADD CONSTRAINT "d3fend_mappings_response_action_id_response_actions_id_fk" FOREIGN KEY ("response_action_id") REFERENCES "public"."response_actions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "d3fend_mappings" ADD CONSTRAINT "d3fend_mappings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attack_catalog_versions_status_idx" ON "attack_catalog_versions" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "attack_catalog_versions_version_idx" ON "attack_catalog_versions" USING btree ("version");--> statement-breakpoint
CREATE UNIQUE INDEX "attack_story_case_sequence_idx" ON "attack_story_entries" USING btree ("case_id","sequence_index");--> statement-breakpoint
CREATE INDEX "attack_story_org_case_idx" ON "attack_story_entries" USING btree ("organisation_id","case_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attack_mappings_unique_idx" ON "attack_technique_mappings" USING btree ("organisation_id","entity_type","entity_id","technique_id");--> statement-breakpoint
CREATE INDEX "attack_mappings_org_technique_idx" ON "attack_technique_mappings" USING btree ("organisation_id","technique_id");--> statement-breakpoint
CREATE INDEX "attack_mappings_org_entity_idx" ON "attack_technique_mappings" USING btree ("organisation_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "attack_mappings_case_idx" ON "attack_technique_mappings" USING btree ("case_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attack_techniques_version_technique_idx" ON "attack_techniques" USING btree ("catalog_version_id","technique_id");--> statement-breakpoint
CREATE INDEX "attack_techniques_technique_idx" ON "attack_techniques" USING btree ("technique_id");--> statement-breakpoint
CREATE INDEX "d3fend_mappings_org_idx" ON "d3fend_mappings" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "d3fend_mappings_playbook_idx" ON "d3fend_mappings" USING btree ("playbook_id");--> statement-breakpoint
CREATE INDEX "d3fend_mappings_response_action_idx" ON "d3fend_mappings" USING btree ("response_action_id");