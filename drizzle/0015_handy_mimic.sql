CREATE TABLE "automation_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"name" text NOT NULL,
	"trigger_event" text NOT NULL,
	"conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"destination_url" text NOT NULL,
	"secret" text NOT NULL,
	"key_id" text NOT NULL,
	"target_profile" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"rule_id" text NOT NULL,
	"case_id" text NOT NULL,
	"trigger_event_id" text NOT NULL,
	"trigger_event" text NOT NULL,
	"trace_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"request" jsonb NOT NULL,
	"response" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "response_action_runs" ALTER COLUMN "status" SET DEFAULT 'awaiting_approval';--> statement-breakpoint
ALTER TABLE "response_action_runs" ADD COLUMN "organisation_id" text;--> statement-breakpoint
ALTER TABLE "response_action_runs" ADD COLUMN "approved_by" text;--> statement-breakpoint
ALTER TABLE "response_action_runs" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "response_action_runs" ADD COLUMN "rejected_by" text;--> statement-breakpoint
ALTER TABLE "response_action_runs" ADD COLUMN "rejected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "response_action_runs" ADD COLUMN "rejection_reason" text;--> statement-breakpoint
ALTER TABLE "response_action_runs" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "response_action_runs" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
UPDATE "response_action_runs"
SET "organisation_id" = "response_actions"."organisation_id"
FROM "response_actions"
WHERE "response_action_runs"."action_id" = "response_actions"."id";--> statement-breakpoint
UPDATE "response_action_runs"
SET "idempotency_key" = 'legacy:' || "id";--> statement-breakpoint
ALTER TABLE "response_action_runs" ALTER COLUMN "organisation_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "response_action_runs" ALTER COLUMN "idempotency_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_rule_id_automation_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."automation_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_trigger_event_id_timeline_events_id_fk" FOREIGN KEY ("trigger_event_id") REFERENCES "public"."timeline_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "automation_rules_org_trigger_idx" ON "automation_rules" USING btree ("organisation_id","trigger_event","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "automation_runs_rule_event_idx" ON "automation_runs" USING btree ("rule_id","trigger_event_id");--> statement-breakpoint
CREATE INDEX "automation_runs_pending_idx" ON "automation_runs" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "automation_runs_case_idx" ON "automation_runs" USING btree ("case_id","created_at");--> statement-breakpoint
ALTER TABLE "response_action_runs" ADD CONSTRAINT "response_action_runs_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "response_action_runs" ADD CONSTRAINT "response_action_runs_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "response_action_runs" ADD CONSTRAINT "response_action_runs_rejected_by_users_id_fk" FOREIGN KEY ("rejected_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "response_action_runs_org_status_idx" ON "response_action_runs" USING btree ("organisation_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "response_action_runs_idempotency_key_idx" ON "response_action_runs" USING btree ("idempotency_key");
