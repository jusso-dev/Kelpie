CREATE TYPE "public"."knowledge_article_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."post_incident_review_status" AS ENUM('draft', 'in_progress', 'pending_approval', 'approved', 'published', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."review_approval_decision" AS ENUM('approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."review_follow_up_status" AS ENUM('open', 'in_progress', 'done', 'cancelled', 'deferred');--> statement-breakpoint
CREATE TYPE "public"."review_improvement_kind" AS ENUM('playbook_revision', 'detection_improvement', 'integration_backlog', 'control_gap', 'process_gap', 'communication_gap', 'other');--> statement-breakpoint
CREATE TYPE "public"."review_improvement_status" AS ENUM('proposed', 'accepted', 'in_progress', 'done', 'rejected', 'deferred');--> statement-breakpoint
CREATE TABLE "case_post_incident_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"case_id" text NOT NULL,
	"template_id" text,
	"template_version_id" text,
	"status" "post_incident_review_status" DEFAULT 'draft' NOT NULL,
	"required_by_policy" boolean DEFAULT false NOT NULL,
	"policy_reason" text,
	"due_at" timestamp with time zone,
	"current_revision_id" text,
	"approved_revision_id" text,
	"title" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "knowledge_articles" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"source_review_id" text,
	"source_case_id" text,
	"source_revision_id" text,
	"title" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"body" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "knowledge_article_status" DEFAULT 'draft' NOT NULL,
	"includes_sensitive" boolean DEFAULT false NOT NULL,
	"themes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" text,
	"published_by" text,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_follow_up_actions" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"review_id" text NOT NULL,
	"case_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" "review_follow_up_status" DEFAULT 'open' NOT NULL,
	"owner_id" text,
	"due_at" timestamp with time zone,
	"theme" text,
	"completed_at" timestamp with time zone,
	"completed_by" text,
	"external_ticket_ref" text,
	"external_ticket_url" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_improvement_proposals" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"review_id" text NOT NULL,
	"case_id" text NOT NULL,
	"kind" "review_improvement_kind" NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" "review_improvement_status" DEFAULT 'proposed' NOT NULL,
	"linked_playbook_id" text,
	"external_ticket_ref" text,
	"external_ticket_url" text,
	"owner_id" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"review_id" text NOT NULL,
	"organisation_id" text NOT NULL,
	"revision" integer NOT NULL,
	"content" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"content_fingerprint" text NOT NULL,
	"is_approved" boolean DEFAULT false NOT NULL,
	"approval_decision" "review_approval_decision",
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"approval_notes" text,
	"bound_content_fingerprint" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_template_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"template_id" text NOT NULL,
	"organisation_id" text NOT NULL,
	"version" integer NOT NULL,
	"sections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"require_approval" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"required_severities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"required_classifications" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"catalogue_key" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "case_post_incident_reviews" ADD CONSTRAINT "case_post_incident_reviews_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_post_incident_reviews" ADD CONSTRAINT "case_post_incident_reviews_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_post_incident_reviews" ADD CONSTRAINT "case_post_incident_reviews_template_id_review_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."review_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_post_incident_reviews" ADD CONSTRAINT "case_post_incident_reviews_template_version_id_review_template_versions_id_fk" FOREIGN KEY ("template_version_id") REFERENCES "public"."review_template_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_post_incident_reviews" ADD CONSTRAINT "case_post_incident_reviews_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_articles" ADD CONSTRAINT "knowledge_articles_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_articles" ADD CONSTRAINT "knowledge_articles_source_review_id_case_post_incident_reviews_id_fk" FOREIGN KEY ("source_review_id") REFERENCES "public"."case_post_incident_reviews"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_articles" ADD CONSTRAINT "knowledge_articles_source_case_id_cases_id_fk" FOREIGN KEY ("source_case_id") REFERENCES "public"."cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_articles" ADD CONSTRAINT "knowledge_articles_source_revision_id_review_revisions_id_fk" FOREIGN KEY ("source_revision_id") REFERENCES "public"."review_revisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_articles" ADD CONSTRAINT "knowledge_articles_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_articles" ADD CONSTRAINT "knowledge_articles_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_follow_up_actions" ADD CONSTRAINT "review_follow_up_actions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_follow_up_actions" ADD CONSTRAINT "review_follow_up_actions_review_id_case_post_incident_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."case_post_incident_reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_follow_up_actions" ADD CONSTRAINT "review_follow_up_actions_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_follow_up_actions" ADD CONSTRAINT "review_follow_up_actions_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_follow_up_actions" ADD CONSTRAINT "review_follow_up_actions_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_follow_up_actions" ADD CONSTRAINT "review_follow_up_actions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_improvement_proposals" ADD CONSTRAINT "review_improvement_proposals_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_improvement_proposals" ADD CONSTRAINT "review_improvement_proposals_review_id_case_post_incident_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."case_post_incident_reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_improvement_proposals" ADD CONSTRAINT "review_improvement_proposals_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_improvement_proposals" ADD CONSTRAINT "review_improvement_proposals_linked_playbook_id_playbooks_id_fk" FOREIGN KEY ("linked_playbook_id") REFERENCES "public"."playbooks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_improvement_proposals" ADD CONSTRAINT "review_improvement_proposals_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_improvement_proposals" ADD CONSTRAINT "review_improvement_proposals_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_revisions" ADD CONSTRAINT "review_revisions_review_id_case_post_incident_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."case_post_incident_reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_revisions" ADD CONSTRAINT "review_revisions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_revisions" ADD CONSTRAINT "review_revisions_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_revisions" ADD CONSTRAINT "review_revisions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_template_versions" ADD CONSTRAINT "review_template_versions_template_id_review_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."review_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_template_versions" ADD CONSTRAINT "review_template_versions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_template_versions" ADD CONSTRAINT "review_template_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_templates" ADD CONSTRAINT "review_templates_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_templates" ADD CONSTRAINT "review_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "case_post_incident_reviews_org_status_idx" ON "case_post_incident_reviews" USING btree ("organisation_id","status");--> statement-breakpoint
CREATE INDEX "case_post_incident_reviews_case_idx" ON "case_post_incident_reviews" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "case_post_incident_reviews_org_due_idx" ON "case_post_incident_reviews" USING btree ("organisation_id","due_at");--> statement-breakpoint
CREATE INDEX "knowledge_articles_org_status_idx" ON "knowledge_articles" USING btree ("organisation_id","status");--> statement-breakpoint
CREATE INDEX "knowledge_articles_source_review_idx" ON "knowledge_articles" USING btree ("source_review_id");--> statement-breakpoint
CREATE INDEX "knowledge_articles_source_case_idx" ON "knowledge_articles" USING btree ("source_case_id");--> statement-breakpoint
CREATE INDEX "review_follow_up_actions_org_status_idx" ON "review_follow_up_actions" USING btree ("organisation_id","status");--> statement-breakpoint
CREATE INDEX "review_follow_up_actions_review_idx" ON "review_follow_up_actions" USING btree ("review_id");--> statement-breakpoint
CREATE INDEX "review_follow_up_actions_case_idx" ON "review_follow_up_actions" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "review_follow_up_actions_owner_due_idx" ON "review_follow_up_actions" USING btree ("owner_id","due_at");--> statement-breakpoint
CREATE INDEX "review_improvement_proposals_org_status_idx" ON "review_improvement_proposals" USING btree ("organisation_id","status");--> statement-breakpoint
CREATE INDEX "review_improvement_proposals_review_idx" ON "review_improvement_proposals" USING btree ("review_id");--> statement-breakpoint
CREATE INDEX "review_improvement_proposals_kind_idx" ON "review_improvement_proposals" USING btree ("organisation_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "review_revisions_review_rev_idx" ON "review_revisions" USING btree ("review_id","revision");--> statement-breakpoint
CREATE INDEX "review_revisions_org_idx" ON "review_revisions" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "review_revisions_review_idx" ON "review_revisions" USING btree ("review_id");--> statement-breakpoint
CREATE UNIQUE INDEX "review_template_versions_template_ver_idx" ON "review_template_versions" USING btree ("template_id","version");--> statement-breakpoint
CREATE INDEX "review_template_versions_org_idx" ON "review_template_versions" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "review_templates_org_idx" ON "review_templates" USING btree ("organisation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "review_templates_org_catalogue_key_idx" ON "review_templates" USING btree ("organisation_id","catalogue_key");