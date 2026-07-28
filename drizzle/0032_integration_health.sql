CREATE TABLE "integration_connection_states" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"connection_kind" text NOT NULL,
	"connection_id" text NOT NULL,
	"display_name" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'unknown' NOT NULL,
	"error_category" text,
	"error_summary" text,
	"last_attempt_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"rate_limit_remaining" integer,
	"rate_limit_reset_at" timestamp with time zone,
	"queue_depth" integer,
	"polling_lag_seconds" integer,
	"webhook_subscription_expires_at" timestamp with time zone,
	"backfill_state" text DEFAULT 'idle' NOT NULL,
	"last_source_cursor" text,
	"read_permission_ok" boolean,
	"write_permission_ok" boolean,
	"write_enabled" boolean DEFAULT false NOT NULL,
	"is_paused" boolean DEFAULT false NOT NULL,
	"paused_at" timestamp with time zone,
	"paused_by" text,
	"last_test_at" timestamp with time zone,
	"last_test_result" text,
	"last_test_error_category" text,
	"last_test_error_summary" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"connection_kind" text NOT NULL,
	"connection_id" text NOT NULL,
	"label" text NOT NULL,
	"reference" text NOT NULL,
	"fingerprint" text,
	"consented_scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"expires_at" timestamp with time zone,
	"rotated_at" timestamp with time zone,
	"rotation_state" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_sync_conflicts" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"connection_kind" text NOT NULL,
	"connection_id" text NOT NULL,
	"case_id" text,
	"field_name" text NOT NULL,
	"kelpie_value" jsonb,
	"source_value" jsonb,
	"kelpie_updated_at" timestamp with time zone,
	"source_updated_at" timestamp with time zone,
	"kelpie_provenance" text,
	"source_provenance" text,
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_sync_policies" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"connection_kind" text NOT NULL,
	"connection_id" text NOT NULL,
	"field_policies" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"outbound_enabled" boolean DEFAULT false NOT NULL,
	"outbound_scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"freshness_threshold_minutes" integer DEFAULT 60 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_sync_writes" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"connection_kind" text NOT NULL,
	"connection_id" text NOT NULL,
	"case_id" text,
	"field_name" text NOT NULL,
	"direction" text DEFAULT 'outbound' NOT NULL,
	"idempotency_key" text NOT NULL,
	"provider_request_id" text,
	"request_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"response_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"parent_write_id" text,
	"root_write_id" text,
	"source_version" text,
	"last_error_category" text,
	"last_error_summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "integration_connection_states" ADD CONSTRAINT "integration_connection_states_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_connection_states" ADD CONSTRAINT "integration_connection_states_paused_by_users_id_fk" FOREIGN KEY ("paused_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_credentials" ADD CONSTRAINT "integration_credentials_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_sync_conflicts" ADD CONSTRAINT "integration_sync_conflicts_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_sync_conflicts" ADD CONSTRAINT "integration_sync_conflicts_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_sync_conflicts" ADD CONSTRAINT "integration_sync_conflicts_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_sync_policies" ADD CONSTRAINT "integration_sync_policies_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_sync_writes" ADD CONSTRAINT "integration_sync_writes_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_sync_writes" ADD CONSTRAINT "integration_sync_writes_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "integration_connection_states_org_kind_id_idx" ON "integration_connection_states" USING btree ("organisation_id","connection_kind","connection_id");--> statement-breakpoint
CREATE INDEX "integration_connection_states_org_status_idx" ON "integration_connection_states" USING btree ("organisation_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_credentials_org_kind_id_label_idx" ON "integration_credentials" USING btree ("organisation_id","connection_kind","connection_id","label");--> statement-breakpoint
CREATE INDEX "integration_credentials_org_expires_idx" ON "integration_credentials" USING btree ("organisation_id","expires_at");--> statement-breakpoint
CREATE INDEX "integration_sync_conflicts_org_status_idx" ON "integration_sync_conflicts" USING btree ("organisation_id","status");--> statement-breakpoint
CREATE INDEX "integration_sync_conflicts_case_idx" ON "integration_sync_conflicts" USING btree ("case_id");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_sync_policies_org_kind_id_idx" ON "integration_sync_policies" USING btree ("organisation_id","connection_kind","connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_sync_writes_org_idempotency_idx" ON "integration_sync_writes" USING btree ("organisation_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "integration_sync_writes_org_status_idx" ON "integration_sync_writes" USING btree ("organisation_id","status");--> statement-breakpoint
CREATE INDEX "integration_sync_writes_case_idx" ON "integration_sync_writes" USING btree ("case_id");