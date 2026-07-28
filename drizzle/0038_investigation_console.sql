CREATE TYPE "public"."investigation_access_class" AS ENUM('read', 'write');--> statement-breakpoint
CREATE TYPE "public"."investigation_execution_status" AS ENUM('queued', 'running', 'awaiting_approval', 'succeeded', 'failed', 'cancelled', 'rejected', 'timed_out');--> statement-breakpoint
CREATE TYPE "public"."investigation_result_renderer" AS ENUM('table', 'json', 'markdown');--> statement-breakpoint
CREATE TABLE "investigation_command_favourites" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"user_id" text NOT NULL,
	"command_name" text NOT NULL,
	"label" text NOT NULL,
	"params_template" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "investigation_executions" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"case_id" text,
	"entity_id" text,
	"evidence_id" text,
	"alert_id" text,
	"command_name" text NOT NULL,
	"command_version" text NOT NULL,
	"access_class" "investigation_access_class" NOT NULL,
	"status" "investigation_execution_status" DEFAULT 'queued' NOT NULL,
	"result_renderer" "investigation_result_renderer" DEFAULT 'json' NOT NULL,
	"params_redacted" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result_summary" jsonb,
	"result_storage_key" text,
	"result_sha256" text,
	"result_size_bytes" integer,
	"provider_request_id" text,
	"requested_by" text,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"rejected_by" text,
	"rejected_at" timestamp with time zone,
	"rejection_reason" text,
	"expires_at" timestamp with time zone,
	"cancel_requested_at" timestamp with time zone,
	"cancel_requested_by" text,
	"error_summary" text,
	"idempotency_key" text NOT NULL,
"params_sealed" jsonb,
	"saved_evidence_id" text,
	"linked_entity_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"linked_alert_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "investigation_result_refs" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"execution_id" text NOT NULL,
	"storage_key" text NOT NULL,
	"sha256" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"content_type" text DEFAULT 'application/json' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "investigation_command_favourites" ADD CONSTRAINT "investigation_command_favourites_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investigation_command_favourites" ADD CONSTRAINT "investigation_command_favourites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investigation_executions" ADD CONSTRAINT "investigation_executions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investigation_executions" ADD CONSTRAINT "investigation_executions_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investigation_executions" ADD CONSTRAINT "investigation_executions_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investigation_executions" ADD CONSTRAINT "investigation_executions_evidence_id_attachments_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investigation_executions" ADD CONSTRAINT "investigation_executions_alert_id_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."alerts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investigation_executions" ADD CONSTRAINT "investigation_executions_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investigation_executions" ADD CONSTRAINT "investigation_executions_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investigation_executions" ADD CONSTRAINT "investigation_executions_rejected_by_users_id_fk" FOREIGN KEY ("rejected_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investigation_executions" ADD CONSTRAINT "investigation_executions_cancel_requested_by_users_id_fk" FOREIGN KEY ("cancel_requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investigation_executions" ADD CONSTRAINT "investigation_executions_saved_evidence_id_attachments_id_fk" FOREIGN KEY ("saved_evidence_id") REFERENCES "public"."attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investigation_result_refs" ADD CONSTRAINT "investigation_result_refs_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investigation_result_refs" ADD CONSTRAINT "investigation_result_refs_execution_id_investigation_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."investigation_executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "investigation_command_favourites_user_idx" ON "investigation_command_favourites" USING btree ("organisation_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "investigation_command_favourites_user_label_idx" ON "investigation_command_favourites" USING btree ("organisation_id","user_id","label");--> statement-breakpoint
CREATE INDEX "investigation_executions_org_started_idx" ON "investigation_executions" USING btree ("organisation_id","started_at");--> statement-breakpoint
CREATE INDEX "investigation_executions_case_idx" ON "investigation_executions" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "investigation_executions_org_status_idx" ON "investigation_executions" USING btree ("organisation_id","status");--> statement-breakpoint
CREATE INDEX "investigation_executions_command_idx" ON "investigation_executions" USING btree ("organisation_id","command_name");--> statement-breakpoint
CREATE UNIQUE INDEX "investigation_executions_org_idempotency_idx" ON "investigation_executions" USING btree ("organisation_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "investigation_result_refs_execution_idx" ON "investigation_result_refs" USING btree ("execution_id");--> statement-breakpoint
CREATE INDEX "investigation_result_refs_org_idx" ON "investigation_result_refs" USING btree ("organisation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "investigation_result_refs_storage_key_idx" ON "investigation_result_refs" USING btree ("storage_key");
