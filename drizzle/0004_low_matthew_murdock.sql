CREATE TABLE "case_presence" (
	"id" text PRIMARY KEY NOT NULL,
	"case_id" text NOT NULL,
	"user_id" text NOT NULL,
	"user_name" text NOT NULL,
	"editing_field" text,
	"typing" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_field_definitions" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"entity" text DEFAULT 'case' NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"type" text NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_field_values" (
	"id" text PRIMARY KEY NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"field_id" text NOT NULL,
	"value" jsonb
);
--> statement-breakpoint
CREATE TABLE "response_action_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"action_id" text NOT NULL,
	"case_id" text NOT NULL,
	"requested_by" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"target" text,
	"request" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"response" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "response_actions" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "siem_connectors" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"mapping" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_polled_at" timestamp with time zone,
	"last_error" text,
	"alerts_produced" integer DEFAULT 0 NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "siem_cursors" (
	"connector_id" text PRIMARY KEY NOT NULL,
	"cursor" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sso_login_states" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"kind" text NOT NULL,
	"nonce" text,
	"code_verifier" text,
	"redirect_to" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ti_feeds" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"url" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"poll_interval_minutes" integer DEFAULT 60 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_polled_at" timestamp with time zone,
	"last_error" text,
	"indicator_count" integer DEFAULT 0 NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ti_indicators" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"feed_id" text NOT NULL,
	"value" text NOT NULL,
	"type" text NOT NULL,
	"confidence" integer DEFAULT 50 NOT NULL,
	"first_seen" timestamp with time zone,
	"last_seen" timestamp with time zone,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "case_templates" ADD COLUMN "default_custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "case_presence" ADD CONSTRAINT "case_presence_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_presence" ADD CONSTRAINT "case_presence_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_definitions" ADD CONSTRAINT "custom_field_definitions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_field_id_custom_field_definitions_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."custom_field_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "response_action_runs" ADD CONSTRAINT "response_action_runs_action_id_response_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."response_actions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "response_action_runs" ADD CONSTRAINT "response_action_runs_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "response_action_runs" ADD CONSTRAINT "response_action_runs_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "response_actions" ADD CONSTRAINT "response_actions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "response_actions" ADD CONSTRAINT "response_actions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "siem_connectors" ADD CONSTRAINT "siem_connectors_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "siem_connectors" ADD CONSTRAINT "siem_connectors_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "siem_cursors" ADD CONSTRAINT "siem_cursors_connector_id_siem_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."siem_connectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sso_login_states" ADD CONSTRAINT "sso_login_states_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ti_feeds" ADD CONSTRAINT "ti_feeds_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ti_feeds" ADD CONSTRAINT "ti_feeds_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ti_indicators" ADD CONSTRAINT "ti_indicators_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ti_indicators" ADD CONSTRAINT "ti_indicators_feed_id_ti_feeds_id_fk" FOREIGN KEY ("feed_id") REFERENCES "public"."ti_feeds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "case_presence_case_user_idx" ON "case_presence" USING btree ("case_id","user_id");--> statement-breakpoint
CREATE INDEX "case_presence_case_idx" ON "case_presence" USING btree ("case_id");--> statement-breakpoint
CREATE UNIQUE INDEX "custom_field_defs_org_entity_key_idx" ON "custom_field_definitions" USING btree ("organisation_id","entity","key");--> statement-breakpoint
CREATE UNIQUE INDEX "custom_field_values_entity_field_idx" ON "custom_field_values" USING btree ("entity_id","field_id");--> statement-breakpoint
CREATE INDEX "custom_field_values_field_idx" ON "custom_field_values" USING btree ("field_id");--> statement-breakpoint
CREATE INDEX "response_action_runs_case_idx" ON "response_action_runs" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "response_action_runs_action_idx" ON "response_action_runs" USING btree ("action_id");--> statement-breakpoint
CREATE INDEX "response_actions_org_idx" ON "response_actions" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "siem_connectors_org_idx" ON "siem_connectors" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "ti_feeds_org_idx" ON "ti_feeds" USING btree ("organisation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ti_indicators_feed_value_type_idx" ON "ti_indicators" USING btree ("feed_id","value","type");--> statement-breakpoint
CREATE INDEX "ti_indicators_org_value_idx" ON "ti_indicators" USING btree ("organisation_id","value");--> statement-breakpoint
CREATE INDEX "ti_indicators_org_type_idx" ON "ti_indicators" USING btree ("organisation_id","type");