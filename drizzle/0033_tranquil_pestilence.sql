-- Issue #46: saved case views (personal / team / organisation) with defaults.
CREATE TYPE "public"."case_view_visibility" AS ENUM('personal', 'team', 'organisation');--> statement-breakpoint
CREATE TYPE "public"."case_view_default_scope" AS ENUM('personal', 'role', 'team');--> statement-breakpoint
CREATE TABLE "case_views" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"visibility" "case_view_visibility" NOT NULL,
	"owner_user_id" text,
	"team_id" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "case_view_defaults" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"scope" "case_view_default_scope" NOT NULL,
	"user_id" text,
	"role" "role",
	"team_id" text,
	"view_id" text NOT NULL,
	"set_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "case_views" ADD CONSTRAINT "case_views_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_views" ADD CONSTRAINT "case_views_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_views" ADD CONSTRAINT "case_views_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_views" ADD CONSTRAINT "case_views_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_views" ADD CONSTRAINT "case_views_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_view_defaults" ADD CONSTRAINT "case_view_defaults_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_view_defaults" ADD CONSTRAINT "case_view_defaults_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_view_defaults" ADD CONSTRAINT "case_view_defaults_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_view_defaults" ADD CONSTRAINT "case_view_defaults_view_id_case_views_id_fk" FOREIGN KEY ("view_id") REFERENCES "public"."case_views"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_view_defaults" ADD CONSTRAINT "case_view_defaults_set_by_users_id_fk" FOREIGN KEY ("set_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "case_views_org_idx" ON "case_views" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "case_views_org_owner_idx" ON "case_views" USING btree ("organisation_id","owner_user_id");--> statement-breakpoint
CREATE INDEX "case_views_org_team_idx" ON "case_views" USING btree ("organisation_id","team_id");--> statement-breakpoint
CREATE INDEX "case_views_org_visibility_idx" ON "case_views" USING btree ("organisation_id","visibility");--> statement-breakpoint
CREATE INDEX "case_view_defaults_org_idx" ON "case_view_defaults" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "case_view_defaults_view_idx" ON "case_view_defaults" USING btree ("view_id");--> statement-breakpoint
CREATE UNIQUE INDEX "case_view_defaults_personal_uidx" ON "case_view_defaults" USING btree ("organisation_id","user_id") WHERE "case_view_defaults"."scope" = 'personal' and "case_view_defaults"."user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "case_view_defaults_role_uidx" ON "case_view_defaults" USING btree ("organisation_id","role") WHERE "case_view_defaults"."scope" = 'role' and "case_view_defaults"."role" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "case_view_defaults_team_uidx" ON "case_view_defaults" USING btree ("organisation_id","team_id") WHERE "case_view_defaults"."scope" = 'team' and "case_view_defaults"."team_id" is not null;
