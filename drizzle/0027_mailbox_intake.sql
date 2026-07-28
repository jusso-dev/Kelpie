CREATE TABLE "mailbox_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"name" text NOT NULL,
	"provider" text NOT NULL,
	"folder" text DEFAULT 'INBOX' NOT NULL,
	"poll_interval_minutes" integer DEFAULT 5 NOT NULL,
	"intake_mode" text DEFAULT 'review' NOT NULL,
	"default_severity" "severity" DEFAULT 'medium' NOT NULL,
	"default_classification" "classification" DEFAULT 'other' NOT NULL,
	"default_assignee_id" text,
	"default_template_id" text,
	"default_tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"credentials_encrypted" text NOT NULL,
	"connection_meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"cursor" text,
	"last_polled_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_error" text,
	"last_error_at" timestamp with time zone,
	"poll_lock_until" timestamp with time zone,
	"imported_message_count" integer DEFAULT 0 NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mailbox_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"provider_message_id" text NOT NULL,
	"received_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"from_address" text,
	"from_name" text,
	"to_addresses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cc_addresses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"subject" text,
	"body_text" text,
	"body_html_sanitized" text,
	"attachment_meta" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'pending_review' NOT NULL,
	"failure_reason" text,
	"dismiss_reason" text,
	"case_id" text,
	"original_evidence_id" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mailbox_connections" ADD CONSTRAINT "mailbox_connections_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailbox_connections" ADD CONSTRAINT "mailbox_connections_default_assignee_id_users_id_fk" FOREIGN KEY ("default_assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailbox_connections" ADD CONSTRAINT "mailbox_connections_default_template_id_case_templates_id_fk" FOREIGN KEY ("default_template_id") REFERENCES "public"."case_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailbox_connections" ADD CONSTRAINT "mailbox_connections_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailbox_messages" ADD CONSTRAINT "mailbox_messages_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailbox_messages" ADD CONSTRAINT "mailbox_messages_connection_id_mailbox_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."mailbox_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailbox_messages" ADD CONSTRAINT "mailbox_messages_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailbox_messages" ADD CONSTRAINT "mailbox_messages_original_evidence_id_attachments_id_fk" FOREIGN KEY ("original_evidence_id") REFERENCES "public"."attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mailbox_connections_org_idx" ON "mailbox_connections" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "mailbox_connections_active_idx" ON "mailbox_connections" USING btree ("is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "mailbox_messages_connection_provider_idx" ON "mailbox_messages" USING btree ("connection_id","provider_message_id");--> statement-breakpoint
CREATE INDEX "mailbox_messages_org_status_idx" ON "mailbox_messages" USING btree ("organisation_id","status");--> statement-breakpoint
CREATE INDEX "mailbox_messages_connection_idx" ON "mailbox_messages" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "mailbox_messages_case_idx" ON "mailbox_messages" USING btree ("case_id");