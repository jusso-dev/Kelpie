CREATE TYPE "public"."improvement_register_type" AS ENUM('detection_gap', 'logging_gap', 'integration_defect', 'playbook_defect', 'security_control_gap', 'process_failure', 'training_need', 'documentation_gap');--> statement-breakpoint
CREATE TYPE "public"."improvement_register_status" AS ENUM('open', 'in_review', 'accepted', 'in_progress', 'validated', 'closed', 'reopened', 'rejected', 'deferred');--> statement-breakpoint
CREATE TYPE "public"."improvement_register_severity" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."improvement_link_kind" AS ENUM('case', 'review', 'review_proposal', 'playbook');--> statement-breakpoint
CREATE TYPE "public"."improvement_source_kind" AS ENUM('case', 'review', 'review_proposal', 'manual');--> statement-breakpoint
CREATE TYPE "public"."improvement_validation_method" AS ENUM('retest', 'monitoring', 'peer_review', 'document_review', 'exercise', 'other');--> statement-breakpoint
CREATE TYPE "public"."improvement_ticket_sync_state" AS ENUM('none', 'linked', 'pending', 'synced', 'conflict', 'failed');--> statement-breakpoint
CREATE TYPE "public"."improvement_register_event_type" AS ENUM('created', 'updated', 'status_changed', 'linked', 'unlinked', 'assigned', 'validated', 'closed', 'reopened', 'ticket_synced', 'ticket_conflict');--> statement-breakpoint
CREATE TABLE "improvement_register_items" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"type" "improvement_register_type" NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sensitive_evidence" jsonb,
	"severity" "improvement_register_severity" DEFAULT 'medium' NOT NULL,
	"residual_risk" text,
	"status" "improvement_register_status" DEFAULT 'open' NOT NULL,
	"owner_id" text,
	"due_at" timestamp with time zone,
	"recurrence_count" integer DEFAULT 0 NOT NULL,
	"linked_playbook_id" text,
	"external_ticket_ref" text,
	"external_ticket_url" text,
	"external_ticket_sync_state" "improvement_ticket_sync_state" DEFAULT 'none' NOT NULL,
	"external_ticket_synced_at" timestamp with time zone,
	"external_ticket_sync_error" text,
	"validation_method" "improvement_validation_method",
	"validation_evidence" text,
	"validated_by" text,
	"validated_at" timestamp with time zone,
	"closed_by" text,
	"closed_at" timestamp with time zone,
	"source_kind" "improvement_source_kind" DEFAULT 'manual' NOT NULL,
	"source_case_id" text,
	"source_review_id" text,
	"source_proposal_id" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "improvement_register_links" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"improvement_id" text NOT NULL,
	"link_kind" "improvement_link_kind" NOT NULL,
	"target_id" text NOT NULL,
	"is_source" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "improvement_register_events" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"improvement_id" text NOT NULL,
	"event_type" "improvement_register_event_type" NOT NULL,
	"from_status" "improvement_register_status",
	"to_status" "improvement_register_status",
	"actor_id" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "improvement_register_items" ADD CONSTRAINT "improvement_register_items_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "improvement_register_items" ADD CONSTRAINT "improvement_register_items_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "improvement_register_items" ADD CONSTRAINT "improvement_register_items_linked_playbook_id_playbooks_id_fk" FOREIGN KEY ("linked_playbook_id") REFERENCES "public"."playbooks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "improvement_register_items" ADD CONSTRAINT "improvement_register_items_validated_by_users_id_fk" FOREIGN KEY ("validated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "improvement_register_items" ADD CONSTRAINT "improvement_register_items_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "improvement_register_items" ADD CONSTRAINT "improvement_register_items_source_case_id_cases_id_fk" FOREIGN KEY ("source_case_id") REFERENCES "public"."cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "improvement_register_items" ADD CONSTRAINT "improvement_register_items_source_review_id_case_post_incident_reviews_id_fk" FOREIGN KEY ("source_review_id") REFERENCES "public"."case_post_incident_reviews"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "improvement_register_items" ADD CONSTRAINT "improvement_register_items_source_proposal_id_review_improvement_proposals_id_fk" FOREIGN KEY ("source_proposal_id") REFERENCES "public"."review_improvement_proposals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "improvement_register_items" ADD CONSTRAINT "improvement_register_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "improvement_register_links" ADD CONSTRAINT "improvement_register_links_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "improvement_register_links" ADD CONSTRAINT "improvement_register_links_improvement_id_improvement_register_items_id_fk" FOREIGN KEY ("improvement_id") REFERENCES "public"."improvement_register_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "improvement_register_links" ADD CONSTRAINT "improvement_register_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "improvement_register_events" ADD CONSTRAINT "improvement_register_events_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "improvement_register_events" ADD CONSTRAINT "improvement_register_events_improvement_id_improvement_register_items_id_fk" FOREIGN KEY ("improvement_id") REFERENCES "public"."improvement_register_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "improvement_register_events" ADD CONSTRAINT "improvement_register_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "improvement_register_items_org_status_idx" ON "improvement_register_items" USING btree ("organisation_id","status");--> statement-breakpoint
CREATE INDEX "improvement_register_items_org_type_idx" ON "improvement_register_items" USING btree ("organisation_id","type");--> statement-breakpoint
CREATE INDEX "improvement_register_items_org_owner_due_idx" ON "improvement_register_items" USING btree ("organisation_id","owner_id","due_at");--> statement-breakpoint
CREATE INDEX "improvement_register_items_source_case_idx" ON "improvement_register_items" USING btree ("source_case_id");--> statement-breakpoint
CREATE INDEX "improvement_register_items_source_proposal_idx" ON "improvement_register_items" USING btree ("source_proposal_id");--> statement-breakpoint
CREATE INDEX "improvement_register_links_improvement_idx" ON "improvement_register_links" USING btree ("improvement_id");--> statement-breakpoint
CREATE INDEX "improvement_register_links_org_kind_target_idx" ON "improvement_register_links" USING btree ("organisation_id","link_kind","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "improvement_register_links_unique_idx" ON "improvement_register_links" USING btree ("improvement_id","link_kind","target_id");--> statement-breakpoint
CREATE INDEX "improvement_register_events_improvement_idx" ON "improvement_register_events" USING btree ("improvement_id","created_at");--> statement-breakpoint
CREATE INDEX "improvement_register_events_org_type_idx" ON "improvement_register_events" USING btree ("organisation_id","event_type");
