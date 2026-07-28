CREATE TABLE "case_closure_policies" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"template_id" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "case_closure_policy_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"policy_id" text NOT NULL,
	"organisation_id" text NOT NULL,
	"version" integer NOT NULL,
	"requirements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"require_two_person_override" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "case_closure_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"case_id" text NOT NULL,
	"policy_id" text,
	"policy_version_id" text,
	"policy_version" integer,
	"disposition" text NOT NULL,
	"determination" text,
	"root_cause" text,
	"conclusion" text NOT NULL,
	"business_impact" text,
	"lessons_learned" text,
	"requirements_evaluated" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"failed_requirements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"closed_by" text,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approver_id" text,
	"approved_at" timestamp with time zone,
	"was_override" boolean DEFAULT false NOT NULL,
	"override_reason" text,
	"override_actor_id" text,
	"override_failed_snapshot" jsonb,
	"case_version_at_close" integer NOT NULL,
	"reopened_at" timestamp with time zone,
	"reopened_by" text,
	"reopen_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "case_tasks" ADD COLUMN "is_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "eradicated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "template_id" text;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "closure_determination" text;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "root_cause" text;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "business_impact" text;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "lessons_learned" text;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "closed_by" text;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "active_closure_snapshot_id" text;--> statement-breakpoint
ALTER TABLE "case_closure_policies" ADD CONSTRAINT "case_closure_policies_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_closure_policies" ADD CONSTRAINT "case_closure_policies_template_id_case_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."case_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_closure_policies" ADD CONSTRAINT "case_closure_policies_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_closure_policy_versions" ADD CONSTRAINT "case_closure_policy_versions_policy_id_case_closure_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."case_closure_policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_closure_policy_versions" ADD CONSTRAINT "case_closure_policy_versions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_closure_policy_versions" ADD CONSTRAINT "case_closure_policy_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_closure_snapshots" ADD CONSTRAINT "case_closure_snapshots_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_closure_snapshots" ADD CONSTRAINT "case_closure_snapshots_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_closure_snapshots" ADD CONSTRAINT "case_closure_snapshots_policy_id_case_closure_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."case_closure_policies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_closure_snapshots" ADD CONSTRAINT "case_closure_snapshots_policy_version_id_case_closure_policy_versions_id_fk" FOREIGN KEY ("policy_version_id") REFERENCES "public"."case_closure_policy_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_closure_snapshots" ADD CONSTRAINT "case_closure_snapshots_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_closure_snapshots" ADD CONSTRAINT "case_closure_snapshots_approver_id_users_id_fk" FOREIGN KEY ("approver_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_closure_snapshots" ADD CONSTRAINT "case_closure_snapshots_override_actor_id_users_id_fk" FOREIGN KEY ("override_actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_closure_snapshots" ADD CONSTRAINT "case_closure_snapshots_reopened_by_users_id_fk" FOREIGN KEY ("reopened_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "case_closure_policies_org_idx" ON "case_closure_policies" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "case_closure_policies_org_template_idx" ON "case_closure_policies" USING btree ("organisation_id","template_id");--> statement-breakpoint
CREATE UNIQUE INDEX "case_closure_policies_org_default_idx" ON "case_closure_policies" USING btree ("organisation_id") WHERE "case_closure_policies"."is_default" = true and "case_closure_policies"."is_active" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "case_closure_policies_org_template_active_idx" ON "case_closure_policies" USING btree ("organisation_id","template_id") WHERE "case_closure_policies"."template_id" is not null and "case_closure_policies"."is_active" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "case_closure_policy_versions_policy_ver_idx" ON "case_closure_policy_versions" USING btree ("policy_id","version");--> statement-breakpoint
CREATE INDEX "case_closure_policy_versions_org_idx" ON "case_closure_policy_versions" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "case_closure_snapshots_case_idx" ON "case_closure_snapshots" USING btree ("case_id","closed_at");--> statement-breakpoint
CREATE INDEX "case_closure_snapshots_org_idx" ON "case_closure_snapshots" USING btree ("organisation_id","closed_at");--> statement-breakpoint
CREATE INDEX "case_closure_snapshots_active_idx" ON "case_closure_snapshots" USING btree ("case_id") WHERE "case_closure_snapshots"."reopened_at" is null;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_template_id_case_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."case_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;