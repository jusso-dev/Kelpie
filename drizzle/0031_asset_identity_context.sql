CREATE TYPE "public"."asset_context_kind" AS ENUM('asset', 'identity', 'application', 'business_service');--> statement-breakpoint
CREATE TYPE "public"."context_import_run_status" AS ENUM('dry_run', 'completed', 'failed', 'partial');--> statement-breakpoint
CREATE TYPE "public"."context_import_source" AS ENUM('csv', 'rest', 'entra', 'defender', 'cmdb', 'manual');--> statement-breakpoint
CREATE TYPE "public"."context_sync_status" AS ENUM('ok', 'stale', 'failed', 'never_synced');--> statement-breakpoint
CREATE TYPE "public"."criticality_level" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."entity_match_review_status" AS ENUM('pending', 'linked', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."environment_kind" AS ENUM('production', 'staging', 'development', 'test', 'sandbox', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."exposure_level" AS ENUM('internal', 'partner', 'internet_facing', 'public');--> statement-breakpoint
CREATE TYPE "public"."priority_score_band" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."privilege_level" AS ENUM('none', 'standard', 'elevated', 'privileged', 'admin', 'domain_admin');--> statement-breakpoint
CREATE TYPE "public"."recovery_priority" AS ENUM('p1', 'p2', 'p3', 'p4', 'none');--> statement-breakpoint
CREATE TYPE "public"."stale_context_policy" AS ENUM('discount', 'exclude', 'include');--> statement-breakpoint
CREATE TABLE "asset_identity_contexts" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"kind" "asset_context_kind" NOT NULL,
	"entity_id" text,
	"display_name" text NOT NULL,
	"primary_identifier_kind" "entity_identifier_kind" NOT NULL,
	"primary_identifier_value" text NOT NULL,
	"criticality" "criticality_level" DEFAULT 'medium' NOT NULL,
	"privilege_level" "privilege_level" DEFAULT 'none' NOT NULL,
	"exposure" "exposure_level" DEFAULT 'internal' NOT NULL,
	"environment" "environment_kind" DEFAULT 'unknown' NOT NULL,
	"is_crown_jewel" boolean DEFAULT false NOT NULL,
	"recovery_priority" "recovery_priority" DEFAULT 'none' NOT NULL,
	"criticality_override" "criticality_level",
	"privilege_level_override" "privilege_level",
	"exposure_override" "exposure_level",
	"is_crown_jewel_override" boolean,
	"recovery_priority_override" "recovery_priority",
	"owner_team" text,
	"owner_email" text,
	"business_service" text,
	"application_name" text,
	"data_classifications" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"regulatory_scope" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"provider_source" "context_import_source" DEFAULT 'manual' NOT NULL,
	"provider_external_id" text,
	"provider_updated_at" timestamp with time zone,
	"last_sync_at" timestamp with time zone,
	"last_sync_status" "context_sync_status" DEFAULT 'never_synced' NOT NULL,
	"last_sync_error" text,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "case_priority_scores" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"case_id" text NOT NULL,
	"calculated_score" integer NOT NULL,
	"score_band" "priority_score_band" NOT NULL,
	"effective_score" integer NOT NULL,
	"calculation_version" text NOT NULL,
	"factors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"weights_used" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"inputs_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"scoring_enabled" boolean DEFAULT true NOT NULL,
	"stale_context_policy" "stale_context_policy" DEFAULT 'discount' NOT NULL,
	"has_critical_context" boolean DEFAULT false NOT NULL,
	"has_crown_jewel_context" boolean DEFAULT false NOT NULL,
	"has_stale_context" boolean DEFAULT false NOT NULL,
	"analyst_override_score" integer,
	"analyst_override_reason" text,
	"analyst_override_by" text,
	"analyst_override_at" timestamp with time zone,
	"calculated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "case_priority_scores_calc_range" CHECK ("calculated_score" >= 0 and "calculated_score" <= 100),
	CONSTRAINT "case_priority_scores_eff_range" CHECK ("effective_score" >= 0 and "effective_score" <= 100),
	CONSTRAINT "case_priority_scores_override_range" CHECK ("analyst_override_score" is null or ("analyst_override_score" >= 0 and "analyst_override_score" <= 100))
);
--> statement-breakpoint
CREATE TABLE "context_import_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"source" "context_import_source" NOT NULL,
	"status" "context_import_run_status" DEFAULT 'dry_run' NOT NULL,
	"dry_run" boolean DEFAULT true NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"success_count" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"created_count" integer DEFAULT 0 NOT NULL,
	"updated_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_by" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "entity_context_match_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"context_id" text NOT NULL,
	"status" "entity_match_review_status" DEFAULT 'pending' NOT NULL,
	"candidate_entity_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"match_reason" text,
	"resolved_entity_id" text,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "asset_identity_contexts" ADD CONSTRAINT "asset_identity_contexts_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_identity_contexts" ADD CONSTRAINT "asset_identity_contexts_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_identity_contexts" ADD CONSTRAINT "asset_identity_contexts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_identity_contexts" ADD CONSTRAINT "asset_identity_contexts_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_priority_scores" ADD CONSTRAINT "case_priority_scores_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_priority_scores" ADD CONSTRAINT "case_priority_scores_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_priority_scores" ADD CONSTRAINT "case_priority_scores_analyst_override_by_users_id_fk" FOREIGN KEY ("analyst_override_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_import_runs" ADD CONSTRAINT "context_import_runs_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_import_runs" ADD CONSTRAINT "context_import_runs_started_by_users_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_context_match_reviews" ADD CONSTRAINT "entity_context_match_reviews_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_context_match_reviews" ADD CONSTRAINT "entity_context_match_reviews_context_id_asset_identity_contexts_id_fk" FOREIGN KEY ("context_id") REFERENCES "public"."asset_identity_contexts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_context_match_reviews" ADD CONSTRAINT "entity_context_match_reviews_resolved_entity_id_entities_id_fk" FOREIGN KEY ("resolved_entity_id") REFERENCES "public"."entities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_context_match_reviews" ADD CONSTRAINT "entity_context_match_reviews_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "asset_contexts_org_kind_ident_idx" ON "asset_identity_contexts" USING btree ("organisation_id","kind","primary_identifier_kind","primary_identifier_value");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_contexts_org_provider_ext_idx" ON "asset_identity_contexts" USING btree ("organisation_id","provider_source","provider_external_id") WHERE "asset_identity_contexts"."provider_external_id" is not null;--> statement-breakpoint
CREATE INDEX "asset_contexts_org_entity_idx" ON "asset_identity_contexts" USING btree ("organisation_id","entity_id");--> statement-breakpoint
CREATE INDEX "asset_contexts_org_criticality_idx" ON "asset_identity_contexts" USING btree ("organisation_id","criticality");--> statement-breakpoint
CREATE INDEX "asset_contexts_org_crown_idx" ON "asset_identity_contexts" USING btree ("organisation_id") WHERE "asset_identity_contexts"."is_crown_jewel" = true or "asset_identity_contexts"."is_crown_jewel_override" = true;--> statement-breakpoint
CREATE INDEX "asset_contexts_org_sync_idx" ON "asset_identity_contexts" USING btree ("organisation_id","last_sync_status");--> statement-breakpoint
CREATE UNIQUE INDEX "case_priority_scores_case_idx" ON "case_priority_scores" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "case_priority_scores_org_effective_idx" ON "case_priority_scores" USING btree ("organisation_id","effective_score");--> statement-breakpoint
CREATE INDEX "case_priority_scores_org_band_idx" ON "case_priority_scores" USING btree ("organisation_id","score_band");--> statement-breakpoint
CREATE INDEX "context_import_runs_org_started_idx" ON "context_import_runs" USING btree ("organisation_id","started_at");--> statement-breakpoint
CREATE INDEX "entity_match_reviews_org_status_idx" ON "entity_context_match_reviews" USING btree ("organisation_id","status");--> statement-breakpoint
CREATE INDEX "entity_match_reviews_context_idx" ON "entity_context_match_reviews" USING btree ("context_id");