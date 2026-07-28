CREATE TYPE "public"."access_event_action" AS ENUM('visibility_changed', 'compartment_updated', 'grant_created', 'grant_revoked', 'break_glass', 'sensitive_viewed', 'export_denied', 'access_denied');--> statement-breakpoint
CREATE TYPE "public"."access_object_type" AS ENUM('case', 'custom_field', 'content_block', 'comment', 'evidence', 'alert', 'entity');--> statement-breakpoint
CREATE TYPE "public"."access_permission" AS ENUM('know_exists', 'view_metadata', 'view_sensitive', 'edit', 'export', 'administer_access');--> statement-breakpoint
CREATE TYPE "public"."access_subject_type" AS ENUM('user', 'team');--> statement-breakpoint
CREATE TYPE "public"."case_visibility_mode" AS ENUM('organisation', 'selected_teams', 'explicit_members', 'restricted');--> statement-breakpoint
CREATE TABLE "case_access_events" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"case_id" text NOT NULL,
	"actor_id" text,
	"action" "access_event_action" NOT NULL,
	"subject_type" "access_subject_type",
	"subject_id" text,
	"permissions" jsonb,
	"object_type" "access_object_type",
	"object_id" text,
	"reason" text,
	"grant_id" text,
	"effective_from" timestamp with time zone,
	"effective_until" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "case_access_grants" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"case_id" text NOT NULL,
	"subject_type" "access_subject_type" NOT NULL,
	"subject_id" text NOT NULL,
	"permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"object_type" "access_object_type" DEFAULT 'case' NOT NULL,
	"object_id" text,
	"reason" text NOT NULL,
	"granted_by" text,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by" text,
	"revoke_reason" text,
	"is_break_glass" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "case_compartment_members" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"case_id" text NOT NULL,
	"user_id" text NOT NULL,
	"added_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "case_compartment_teams" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"case_id" text NOT NULL,
	"team_id" text NOT NULL,
	"added_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "sensitive" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "visibility_mode" "case_visibility_mode" DEFAULT 'organisation' NOT NULL;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "access_policy_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "sensitive" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "custom_field_definitions" ADD COLUMN "sensitive" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "case_access_events" ADD CONSTRAINT "case_access_events_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_access_events" ADD CONSTRAINT "case_access_events_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_access_events" ADD CONSTRAINT "case_access_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_access_grants" ADD CONSTRAINT "case_access_grants_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_access_grants" ADD CONSTRAINT "case_access_grants_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_access_grants" ADD CONSTRAINT "case_access_grants_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_access_grants" ADD CONSTRAINT "case_access_grants_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_compartment_members" ADD CONSTRAINT "case_compartment_members_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_compartment_members" ADD CONSTRAINT "case_compartment_members_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_compartment_members" ADD CONSTRAINT "case_compartment_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_compartment_members" ADD CONSTRAINT "case_compartment_members_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_compartment_teams" ADD CONSTRAINT "case_compartment_teams_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_compartment_teams" ADD CONSTRAINT "case_compartment_teams_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_compartment_teams" ADD CONSTRAINT "case_compartment_teams_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_compartment_teams" ADD CONSTRAINT "case_compartment_teams_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "case_access_events_org_case_idx" ON "case_access_events" USING btree ("organisation_id","case_id","occurred_at");--> statement-breakpoint
CREATE INDEX "case_access_events_org_action_idx" ON "case_access_events" USING btree ("organisation_id","action");--> statement-breakpoint
CREATE INDEX "case_access_grants_org_case_idx" ON "case_access_grants" USING btree ("organisation_id","case_id");--> statement-breakpoint
CREATE INDEX "case_access_grants_subject_idx" ON "case_access_grants" USING btree ("organisation_id","subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "case_access_grants_active_idx" ON "case_access_grants" USING btree ("case_id","subject_type","subject_id") WHERE "case_access_grants"."revoked_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "case_compartment_members_case_user_idx" ON "case_compartment_members" USING btree ("case_id","user_id");--> statement-breakpoint
CREATE INDEX "case_compartment_members_org_case_idx" ON "case_compartment_members" USING btree ("organisation_id","case_id");--> statement-breakpoint
CREATE INDEX "case_compartment_members_user_idx" ON "case_compartment_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "case_compartment_teams_case_team_idx" ON "case_compartment_teams" USING btree ("case_id","team_id");--> statement-breakpoint
CREATE INDEX "case_compartment_teams_org_case_idx" ON "case_compartment_teams" USING btree ("organisation_id","case_id");--> statement-breakpoint
CREATE INDEX "case_compartment_teams_team_idx" ON "case_compartment_teams" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "cases_org_visibility_idx" ON "cases" USING btree ("organisation_id","visibility_mode");
