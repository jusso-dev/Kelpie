CREATE TYPE "public"."kill_switch_scope" AS ENUM('organisation', 'provider', 'action');--> statement-breakpoint
CREATE TABLE "enrichment_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"processed_count" integer DEFAULT 0 NOT NULL,
	"error_category" text,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "kill_switches" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"scope" "kill_switch_scope" NOT NULL,
	"scope_key" text DEFAULT '' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"reason" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "automation_runs_rule_event_idx";--> statement-breakpoint
ALTER TABLE "automation_runs" ADD COLUMN "error_category" text;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD COLUMN "parent_run_id" text;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD COLUMN "root_run_id" text;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD COLUMN "lineage_attempt" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD COLUMN "cancel_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD COLUMN "cancel_requested_by" text;--> statement-breakpoint
ALTER TABLE "response_action_runs" ADD COLUMN "error_category" text;--> statement-breakpoint
ALTER TABLE "response_action_runs" ADD COLUMN "parent_run_id" text;--> statement-breakpoint
ALTER TABLE "response_action_runs" ADD COLUMN "root_run_id" text;--> statement-breakpoint
ALTER TABLE "response_action_runs" ADD COLUMN "attempt" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "response_action_runs" ADD COLUMN "cancel_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "response_action_runs" ADD COLUMN "cancel_requested_by" text;--> statement-breakpoint
ALTER TABLE "enrichment_runs" ADD CONSTRAINT "enrichment_runs_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kill_switches" ADD CONSTRAINT "kill_switches_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kill_switches" ADD CONSTRAINT "kill_switches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kill_switches" ADD CONSTRAINT "kill_switches_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "enrichment_runs_org_idx" ON "enrichment_runs" USING btree ("organisation_id","queued_at");--> statement-breakpoint
CREATE UNIQUE INDEX "kill_switches_org_scope_key_idx" ON "kill_switches" USING btree ("organisation_id","scope","scope_key");--> statement-breakpoint
CREATE INDEX "kill_switches_org_idx" ON "kill_switches" USING btree ("organisation_id");--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_cancel_requested_by_users_id_fk" FOREIGN KEY ("cancel_requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_parent_run_id_automation_runs_id_fk" FOREIGN KEY ("parent_run_id") REFERENCES "public"."automation_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_root_run_id_automation_runs_id_fk" FOREIGN KEY ("root_run_id") REFERENCES "public"."automation_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "response_action_runs" ADD CONSTRAINT "response_action_runs_cancel_requested_by_users_id_fk" FOREIGN KEY ("cancel_requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "response_action_runs" ADD CONSTRAINT "response_action_runs_parent_run_id_response_action_runs_id_fk" FOREIGN KEY ("parent_run_id") REFERENCES "public"."response_action_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "response_action_runs" ADD CONSTRAINT "response_action_runs_root_run_id_response_action_runs_id_fk" FOREIGN KEY ("root_run_id") REFERENCES "public"."response_action_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "automation_runs_root_idx" ON "automation_runs" USING btree ("root_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "automation_runs_parent_idx" ON "automation_runs" USING btree ("parent_run_id") WHERE "automation_runs"."parent_run_id" is not null;--> statement-breakpoint
CREATE INDEX "response_action_runs_root_idx" ON "response_action_runs" USING btree ("root_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "response_action_runs_parent_idx" ON "response_action_runs" USING btree ("parent_run_id") WHERE "response_action_runs"."parent_run_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "automation_runs_rule_event_idx" ON "automation_runs" USING btree ("rule_id","trigger_event_id") WHERE "automation_runs"."parent_run_id" is null;