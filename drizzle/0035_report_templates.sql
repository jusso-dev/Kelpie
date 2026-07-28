CREATE TYPE "public"."report_approval_status" AS ENUM('pending', 'approved', 'rejected', 'invalidated');--> statement-breakpoint
CREATE TYPE "public"."report_export_format" AS ENUM('pdf', 'json');--> statement-breakpoint
CREATE TYPE "public"."report_export_status" AS ENUM('pending', 'processing', 'awaiting_approval', 'completed', 'released', 'failed');--> statement-breakpoint
CREATE TYPE "public"."report_variant" AS ENUM('executive', 'technical', 'regulatory', 'post_incident');--> statement-breakpoint
CREATE TABLE "report_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"variant" "report_variant" NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"catalogue_key" text,
	"catalogue_version" integer,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_template_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"template_id" text NOT NULL,
	"organisation_id" text NOT NULL,
	"version" integer NOT NULL,
	"sections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"inclusion_rules" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"require_approval" boolean DEFAULT false NOT NULL,
	"max_tlp" "tlp" DEFAULT 'amber' NOT NULL,
	"max_pap" "pap" DEFAULT 'amber' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_exports" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"case_id" text NOT NULL,
	"template_id" text,
	"template_version_id" text,
	"template_version_number" integer NOT NULL,
	"variant" "report_variant" NOT NULL,
	"format" "report_export_format" NOT NULL,
	"status" "report_export_status" DEFAULT 'pending' NOT NULL,
	"selected_sections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"content_fingerprint" text,
	"data_revision" text,
	"max_tlp" "tlp" NOT NULL,
	"max_pap" "pap" NOT NULL,
	"require_approval" boolean DEFAULT false NOT NULL,
	"storage_key" text,
	"sha256" text,
	"size_bytes" integer,
	"redaction_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"requested_by" text,
	"released_by" text,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"schedule_id" text
);
--> statement-breakpoint
CREATE TABLE "report_export_approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"export_id" text NOT NULL,
	"organisation_id" text NOT NULL,
	"status" "report_approval_status" DEFAULT 'pending' NOT NULL,
	"bound_content_fingerprint" text NOT NULL,
	"bound_template_version_id" text NOT NULL,
	"bound_data_revision" text NOT NULL,
	"requested_by" text,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"invalidate_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_schedules" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"template_id" text NOT NULL,
	"case_id" text,
	"format" "report_export_format" DEFAULT 'pdf' NOT NULL,
	"destination_policy" jsonb DEFAULT '{"kind":"export_history"}'::jsonb NOT NULL,
	"section_overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"interval_minutes" integer DEFAULT 1440 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"next_run_at" timestamp with time zone NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_export_id" text,
	"last_error" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "report_templates" ADD CONSTRAINT "report_templates_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_templates" ADD CONSTRAINT "report_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_template_versions" ADD CONSTRAINT "report_template_versions_template_id_report_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."report_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_template_versions" ADD CONSTRAINT "report_template_versions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_template_versions" ADD CONSTRAINT "report_template_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_exports" ADD CONSTRAINT "report_exports_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_exports" ADD CONSTRAINT "report_exports_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_exports" ADD CONSTRAINT "report_exports_template_id_report_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."report_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_exports" ADD CONSTRAINT "report_exports_template_version_id_report_template_versions_id_fk" FOREIGN KEY ("template_version_id") REFERENCES "public"."report_template_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_exports" ADD CONSTRAINT "report_exports_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_exports" ADD CONSTRAINT "report_exports_released_by_users_id_fk" FOREIGN KEY ("released_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_export_approvals" ADD CONSTRAINT "report_export_approvals_export_id_report_exports_id_fk" FOREIGN KEY ("export_id") REFERENCES "public"."report_exports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_export_approvals" ADD CONSTRAINT "report_export_approvals_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_export_approvals" ADD CONSTRAINT "report_export_approvals_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_export_approvals" ADD CONSTRAINT "report_export_approvals_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_template_id_report_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."report_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "report_templates_org_idx" ON "report_templates" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "report_templates_org_variant_idx" ON "report_templates" USING btree ("organisation_id","variant");--> statement-breakpoint
CREATE UNIQUE INDEX "report_templates_org_catalogue_key_idx" ON "report_templates" USING btree ("organisation_id","catalogue_key");--> statement-breakpoint
CREATE UNIQUE INDEX "report_template_versions_template_ver_idx" ON "report_template_versions" USING btree ("template_id","version");--> statement-breakpoint
CREATE INDEX "report_template_versions_org_idx" ON "report_template_versions" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "report_exports_org_case_idx" ON "report_exports" USING btree ("organisation_id","case_id","created_at");--> statement-breakpoint
CREATE INDEX "report_exports_org_status_idx" ON "report_exports" USING btree ("organisation_id","status");--> statement-breakpoint
CREATE INDEX "report_exports_template_idx" ON "report_exports" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "report_export_approvals_export_idx" ON "report_export_approvals" USING btree ("export_id");--> statement-breakpoint
CREATE INDEX "report_export_approvals_org_status_idx" ON "report_export_approvals" USING btree ("organisation_id","status");--> statement-breakpoint
CREATE INDEX "report_schedules_org_active_idx" ON "report_schedules" USING btree ("organisation_id","is_active");--> statement-breakpoint
CREATE INDEX "report_schedules_next_run_idx" ON "report_schedules" USING btree ("next_run_at");
