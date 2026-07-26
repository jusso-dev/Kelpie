CREATE TABLE "case_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"poll_interval_minutes" integer DEFAULT 5 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"cursor" text,
	"last_polled_at" timestamp with time zone,
	"last_error" text,
	"imported_case_count" integer DEFAULT 0 NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cases" DROP CONSTRAINT IF EXISTS "cases_source_alert_id_alerts_id_fk";
--> statement-breakpoint
ALTER TABLE "alerts" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "siem_connectors" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "siem_cursors" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "alerts" CASCADE;--> statement-breakpoint
DROP TABLE "siem_connectors" CASCADE;--> statement-breakpoint
DROP TABLE "siem_cursors" CASCADE;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "source_system" text;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "source_reference" text;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "source_url" text;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "source" text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "case_sources" ADD CONSTRAINT "case_sources_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_sources" ADD CONSTRAINT "case_sources_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "case_sources_org_idx" ON "case_sources" USING btree ("organisation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cases_org_source_reference_idx" ON "cases" USING btree ("organisation_id","source_system","source_reference") WHERE "cases"."source_system" is not null and "cases"."source_reference" is not null;--> statement-breakpoint
ALTER TABLE "cases" DROP COLUMN "source_alert_id";--> statement-breakpoint
DROP TYPE "public"."alert_status";
