CREATE TYPE "public"."alert_membership_operation" AS ENUM('link', 'unlink', 'move', 'merge', 'split', 'create_case', 'reverse_merge');--> statement-breakpoint
CREATE TYPE "public"."case_merge_status" AS ENUM('active', 'reversed');--> statement-breakpoint
CREATE TYPE "public"."correlation_rule_status" AS ENUM('draft', 'active', 'disabled', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."correlation_suggestion_kind" AS ENUM('group_alerts', 'attach_to_case', 'merge_cases');--> statement-breakpoint
CREATE TYPE "public"."correlation_suggestion_status" AS ENUM('pending', 'accepting', 'accepted', 'rejected', 'expired', 'auto_applied');--> statement-breakpoint
CREATE TABLE "alert_membership_history" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"alert_id" text NOT NULL,
	"operation" "alert_membership_operation" NOT NULL,
	"from_case_id" text,
	"to_case_id" text,
	"reason" text NOT NULL,
	"actor_id" text,
	"operation_id" text NOT NULL,
	"suggestion_id" text,
	"merge_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "case_merges" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"canonical_case_id" text NOT NULL,
	"source_case_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"moved_alert_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"alert_origin_by_id" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reason" text NOT NULL,
	"actor_id" text,
	"status" "case_merge_status" DEFAULT 'active' NOT NULL,
	"suggestion_id" text,
	"merged_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reverse_deadline" timestamp with time zone NOT NULL,
	"reversed_at" timestamp with time zone,
	"reversed_by" text,
	"reverse_reason" text,
	"case_versions" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "correlation_rule_metrics" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"rule_key" text NOT NULL,
	"rule_version" integer NOT NULL,
	"suggestion_count" integer DEFAULT 0 NOT NULL,
	"accepted_count" integer DEFAULT 0 NOT NULL,
	"rejected_count" integer DEFAULT 0 NOT NULL,
	"auto_applied_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "correlation_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"rule_key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"version" integer DEFAULT 1 NOT NULL,
	"status" "correlation_rule_status" DEFAULT 'draft' NOT NULL,
	"dry_run" boolean DEFAULT true NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"score_threshold" integer DEFAULT 40 NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"superseded_at" timestamp with time zone,
	CONSTRAINT "correlation_rules_score_threshold_range" CHECK ("score_threshold" >= 0 and "score_threshold" <= 100),
	CONSTRAINT "correlation_rules_version_positive" CHECK ("version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "correlation_suggestions" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"rule_id" text,
	"rule_key" text NOT NULL,
	"rule_version" integer NOT NULL,
	"kind" "correlation_suggestion_kind" NOT NULL,
	"status" "correlation_suggestion_status" DEFAULT 'pending' NOT NULL,
	"score" integer NOT NULL,
	"contributing_signals" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"alert_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"case_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"target_case_id" text,
	"explanation" text DEFAULT '' NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" text,
	"resolve_reason" text,
	"fingerprint" text NOT NULL,
	CONSTRAINT "correlation_suggestions_score_range" CHECK ("score" >= 0 and "score" <= 100)
);
--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "superseded_by_case_id" text;--> statement-breakpoint
ALTER TABLE "alert_membership_history" ADD CONSTRAINT "alert_membership_history_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_membership_history" ADD CONSTRAINT "alert_membership_history_alert_id_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."alerts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_membership_history" ADD CONSTRAINT "alert_membership_history_from_case_id_cases_id_fk" FOREIGN KEY ("from_case_id") REFERENCES "public"."cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_membership_history" ADD CONSTRAINT "alert_membership_history_to_case_id_cases_id_fk" FOREIGN KEY ("to_case_id") REFERENCES "public"."cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_membership_history" ADD CONSTRAINT "alert_membership_history_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_membership_history" ADD CONSTRAINT "alert_membership_history_suggestion_id_correlation_suggestions_id_fk" FOREIGN KEY ("suggestion_id") REFERENCES "public"."correlation_suggestions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_merges" ADD CONSTRAINT "case_merges_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_merges" ADD CONSTRAINT "case_merges_canonical_case_id_cases_id_fk" FOREIGN KEY ("canonical_case_id") REFERENCES "public"."cases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_merges" ADD CONSTRAINT "case_merges_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_merges" ADD CONSTRAINT "case_merges_suggestion_id_correlation_suggestions_id_fk" FOREIGN KEY ("suggestion_id") REFERENCES "public"."correlation_suggestions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_merges" ADD CONSTRAINT "case_merges_reversed_by_users_id_fk" FOREIGN KEY ("reversed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "correlation_rule_metrics" ADD CONSTRAINT "correlation_rule_metrics_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "correlation_rules" ADD CONSTRAINT "correlation_rules_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "correlation_rules" ADD CONSTRAINT "correlation_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "correlation_suggestions" ADD CONSTRAINT "correlation_suggestions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "correlation_suggestions" ADD CONSTRAINT "correlation_suggestions_rule_id_correlation_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."correlation_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "correlation_suggestions" ADD CONSTRAINT "correlation_suggestions_target_case_id_cases_id_fk" FOREIGN KEY ("target_case_id") REFERENCES "public"."cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "correlation_suggestions" ADD CONSTRAINT "correlation_suggestions_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alert_membership_history_alert_idx" ON "alert_membership_history" USING btree ("alert_id","created_at");--> statement-breakpoint
CREATE INDEX "alert_membership_history_org_idx" ON "alert_membership_history" USING btree ("organisation_id","created_at");--> statement-breakpoint
CREATE INDEX "alert_membership_history_operation_idx" ON "alert_membership_history" USING btree ("operation_id");--> statement-breakpoint
CREATE INDEX "alert_membership_history_from_case_idx" ON "alert_membership_history" USING btree ("from_case_id");--> statement-breakpoint
CREATE INDEX "alert_membership_history_to_case_idx" ON "alert_membership_history" USING btree ("to_case_id");--> statement-breakpoint
CREATE INDEX "case_merges_org_idx" ON "case_merges" USING btree ("organisation_id","merged_at");--> statement-breakpoint
CREATE INDEX "case_merges_canonical_idx" ON "case_merges" USING btree ("canonical_case_id");--> statement-breakpoint
CREATE INDEX "case_merges_status_idx" ON "case_merges" USING btree ("organisation_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "correlation_rule_metrics_org_key_version_idx" ON "correlation_rule_metrics" USING btree ("organisation_id","rule_key","rule_version");--> statement-breakpoint
CREATE UNIQUE INDEX "correlation_rules_org_key_version_idx" ON "correlation_rules" USING btree ("organisation_id","rule_key","version");--> statement-breakpoint
CREATE INDEX "correlation_rules_org_status_idx" ON "correlation_rules" USING btree ("organisation_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "correlation_suggestions_org_fingerprint_pending_idx" ON "correlation_suggestions" USING btree ("organisation_id","fingerprint") WHERE "correlation_suggestions"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "correlation_suggestions_org_status_idx" ON "correlation_suggestions" USING btree ("organisation_id","status");--> statement-breakpoint
CREATE INDEX "correlation_suggestions_org_generated_idx" ON "correlation_suggestions" USING btree ("organisation_id","generated_at");--> statement-breakpoint
CREATE INDEX "correlation_suggestions_rule_idx" ON "correlation_suggestions" USING btree ("rule_id");--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_superseded_by_case_id_fk" FOREIGN KEY ("superseded_by_case_id") REFERENCES "public"."cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cases_org_superseded_idx" ON "cases" USING btree ("organisation_id","superseded_by_case_id") WHERE "cases"."superseded_by_case_id" is not null;