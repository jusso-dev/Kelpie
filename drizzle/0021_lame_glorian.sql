CREATE TYPE "public"."bulk_operation_type" AS ENUM('queue_assign', 'analyst_assign', 'watcher_add', 'watcher_remove', 'tag_add', 'tag_remove', 'severity_change', 'status_change', 'acknowledge');--> statement-breakpoint
CREATE TYPE "public"."escalation_action_type" AS ENUM('notify', 'reassign', 'raise_severity');--> statement-breakpoint
CREATE TYPE "public"."escalation_trigger_type" AS ENUM('age_minutes', 'sla_warning', 'sla_breached', 'stale_status');--> statement-breakpoint
CREATE TYPE "public"."team_member_role" AS ENUM('lead', 'member');--> statement-breakpoint
CREATE TABLE "bulk_operations" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"actor_id" text,
	"operation_type" "bulk_operation_type" NOT NULL,
	"idempotency_key" text NOT NULL,
	"requested_count" integer NOT NULL,
	"success_count" integer DEFAULT 0 NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"outcomes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "case_assignees" (
	"id" text PRIMARY KEY NOT NULL,
	"case_id" text NOT NULL,
	"organisation_id" text NOT NULL,
	"user_id" text NOT NULL,
	"added_by" text,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "case_handoffs" (
	"id" text PRIMARY KEY NOT NULL,
	"case_id" text NOT NULL,
	"organisation_id" text NOT NULL,
	"from_user_id" text,
	"to_user_id" text,
	"to_queue_id" text,
	"note" text NOT NULL,
	"snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "case_watchers" (
	"id" text PRIMARY KEY NOT NULL,
	"case_id" text NOT NULL,
	"organisation_id" text NOT NULL,
	"user_id" text NOT NULL,
	"notify_on_comment" boolean DEFAULT true NOT NULL,
	"notify_on_status_change" boolean DEFAULT true NOT NULL,
	"notify_on_assignment" boolean DEFAULT true NOT NULL,
	"notify_on_escalation" boolean DEFAULT true NOT NULL,
	"added_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "escalation_policies" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"trigger_type" "escalation_trigger_type" NOT NULL,
	"trigger_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disabled_at" timestamp with time zone,
	"disabled_by" text
);
--> statement-breakpoint
CREATE TABLE "escalation_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"policy_id" text,
	"policy_version" integer NOT NULL,
	"case_id" text NOT NULL,
	"organisation_id" text NOT NULL,
	"action_type" "escalation_action_type" NOT NULL,
	"outcome" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"triggered_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" "team_member_role" DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "assignee_assigned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "queue_id" text;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "queue_assigned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "queue_assigned_by" text;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "acknowledged_by" text;--> statement-breakpoint
ALTER TABLE "bulk_operations" ADD CONSTRAINT "bulk_operations_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulk_operations" ADD CONSTRAINT "bulk_operations_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_assignees" ADD CONSTRAINT "case_assignees_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_assignees" ADD CONSTRAINT "case_assignees_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_assignees" ADD CONSTRAINT "case_assignees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_assignees" ADD CONSTRAINT "case_assignees_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_handoffs" ADD CONSTRAINT "case_handoffs_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_handoffs" ADD CONSTRAINT "case_handoffs_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_handoffs" ADD CONSTRAINT "case_handoffs_from_user_id_users_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_handoffs" ADD CONSTRAINT "case_handoffs_to_user_id_users_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_handoffs" ADD CONSTRAINT "case_handoffs_to_queue_id_teams_id_fk" FOREIGN KEY ("to_queue_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_handoffs" ADD CONSTRAINT "case_handoffs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_watchers" ADD CONSTRAINT "case_watchers_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_watchers" ADD CONSTRAINT "case_watchers_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_watchers" ADD CONSTRAINT "case_watchers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_watchers" ADD CONSTRAINT "case_watchers_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalation_policies" ADD CONSTRAINT "escalation_policies_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalation_policies" ADD CONSTRAINT "escalation_policies_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalation_policies" ADD CONSTRAINT "escalation_policies_disabled_by_users_id_fk" FOREIGN KEY ("disabled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalation_runs" ADD CONSTRAINT "escalation_runs_policy_id_escalation_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."escalation_policies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalation_runs" ADD CONSTRAINT "escalation_runs_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalation_runs" ADD CONSTRAINT "escalation_runs_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bulk_operations_org_idempotency_idx" ON "bulk_operations" USING btree ("organisation_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "bulk_operations_org_created_idx" ON "bulk_operations" USING btree ("organisation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "case_assignees_case_user_idx" ON "case_assignees" USING btree ("case_id","user_id");--> statement-breakpoint
CREATE INDEX "case_assignees_org_user_idx" ON "case_assignees" USING btree ("organisation_id","user_id");--> statement-breakpoint
CREATE INDEX "case_handoffs_case_idx" ON "case_handoffs" USING btree ("case_id","created_at");--> statement-breakpoint
CREATE INDEX "case_handoffs_org_idx" ON "case_handoffs" USING btree ("organisation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "case_watchers_case_user_idx" ON "case_watchers" USING btree ("case_id","user_id");--> statement-breakpoint
CREATE INDEX "case_watchers_org_user_idx" ON "case_watchers" USING btree ("organisation_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "escalation_policies_org_name_idx" ON "escalation_policies" USING btree ("organisation_id","name");--> statement-breakpoint
CREATE INDEX "escalation_policies_org_active_idx" ON "escalation_policies" USING btree ("organisation_id","is_active");--> statement-breakpoint
CREATE INDEX "escalation_runs_case_idx" ON "escalation_runs" USING btree ("case_id","triggered_at");--> statement-breakpoint
CREATE INDEX "escalation_runs_policy_idx" ON "escalation_runs" USING btree ("policy_id");--> statement-breakpoint
CREATE INDEX "escalation_runs_org_idx" ON "escalation_runs" USING btree ("organisation_id","triggered_at");--> statement-breakpoint
CREATE UNIQUE INDEX "team_members_team_user_idx" ON "team_members" USING btree ("team_id","user_id");--> statement-breakpoint
CREATE INDEX "team_members_user_idx" ON "team_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "teams_org_name_idx" ON "teams" USING btree ("organisation_id","name");--> statement-breakpoint
CREATE INDEX "teams_org_active_idx" ON "teams" USING btree ("organisation_id","is_active");--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_queue_id_teams_id_fk" FOREIGN KEY ("queue_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_queue_assigned_by_users_id_fk" FOREIGN KEY ("queue_assigned_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_acknowledged_by_users_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cases_org_assignee_status_idx" ON "cases" USING btree ("organisation_id","assignee_id","status");--> statement-breakpoint
CREATE INDEX "cases_org_queue_status_idx" ON "cases" USING btree ("organisation_id","queue_id","status");--> statement-breakpoint
-- Append-only enforcement for case_handoffs: hand-off notes are immutable
-- snapshots, never editable comments. The only allowed UPDATE is the
-- from_user_id/to_user_id/created_by -> NULL transition each FK's own
-- ON DELETE SET NULL performs when a referenced user is deleted; every other
-- UPDATE, and every top-level DELETE, is rejected even for the app's own
-- DB role. A DELETE nested inside another trigger (an owning case's or
-- organisation's ON DELETE CASCADE) is still allowed.
CREATE OR REPLACE FUNCTION case_handoffs_block_update() RETURNS trigger AS $$
BEGIN
  IF NEW.case_id = OLD.case_id
     AND NEW.organisation_id = OLD.organisation_id
     AND NEW.note = OLD.note
     AND NEW.snapshot IS NOT DISTINCT FROM OLD.snapshot
     AND NEW.created_at = OLD.created_at
     AND NEW.to_queue_id IS NOT DISTINCT FROM OLD.to_queue_id
     AND (NEW.from_user_id = OLD.from_user_id OR (NEW.from_user_id IS NULL AND OLD.from_user_id IS NOT NULL))
     AND (NEW.to_user_id = OLD.to_user_id OR (NEW.to_user_id IS NULL AND OLD.to_user_id IS NOT NULL))
     AND (NEW.created_by = OLD.created_by OR (NEW.created_by IS NULL AND OLD.created_by IS NOT NULL))
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'case_handoffs rows are append-only and cannot be updated';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER case_handoffs_no_update
  BEFORE UPDATE ON "case_handoffs"
  FOR EACH ROW EXECUTE FUNCTION case_handoffs_block_update();--> statement-breakpoint
CREATE OR REPLACE FUNCTION case_handoffs_block_delete() RETURNS trigger AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'case_handoffs rows are append-only and cannot be deleted directly';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER case_handoffs_no_delete
  BEFORE DELETE ON "case_handoffs"
  FOR EACH ROW EXECUTE FUNCTION case_handoffs_block_delete();--> statement-breakpoint
-- Append-only enforcement for escalation_runs, mirroring audit_events: this is
-- the execution log an escalation policy's safety story depends on, so it
-- must never be edited after the fact. Only policy_id -> NULL (the policy's
-- own ON DELETE SET NULL) is an allowed UPDATE.
CREATE OR REPLACE FUNCTION escalation_runs_block_update() RETURNS trigger AS $$
BEGIN
  IF NEW.policy_version = OLD.policy_version
     AND NEW.case_id = OLD.case_id
     AND NEW.organisation_id = OLD.organisation_id
     AND NEW.action_type = OLD.action_type
     AND NEW.outcome = OLD.outcome
     AND NEW.detail IS NOT DISTINCT FROM OLD.detail
     AND NEW.triggered_at = OLD.triggered_at
     AND (NEW.policy_id = OLD.policy_id OR (NEW.policy_id IS NULL AND OLD.policy_id IS NOT NULL))
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'escalation_runs rows are append-only and cannot be updated';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER escalation_runs_no_update
  BEFORE UPDATE ON "escalation_runs"
  FOR EACH ROW EXECUTE FUNCTION escalation_runs_block_update();--> statement-breakpoint
CREATE OR REPLACE FUNCTION escalation_runs_block_delete() RETURNS trigger AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'escalation_runs rows are append-only and cannot be deleted directly';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER escalation_runs_no_delete
  BEFORE DELETE ON "escalation_runs"
  FOR EACH ROW EXECUTE FUNCTION escalation_runs_block_delete();--> statement-breakpoint
-- Append-only enforcement for bulk_operations: this is the batch audit
-- record required alongside each affected case's timeline entry, so it must
-- never be edited after the fact. Only actor_id -> NULL (the actor's own
-- ON DELETE SET NULL) is an allowed UPDATE.
CREATE OR REPLACE FUNCTION bulk_operations_block_update() RETURNS trigger AS $$
BEGIN
  IF NEW.organisation_id = OLD.organisation_id
     AND NEW.operation_type = OLD.operation_type
     AND NEW.idempotency_key = OLD.idempotency_key
     AND NEW.requested_count = OLD.requested_count
     AND NEW.success_count = OLD.success_count
     AND NEW.failure_count = OLD.failure_count
     AND NEW.outcomes IS NOT DISTINCT FROM OLD.outcomes
     AND NEW.created_at = OLD.created_at
     AND (NEW.actor_id = OLD.actor_id OR (NEW.actor_id IS NULL AND OLD.actor_id IS NOT NULL))
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'bulk_operations rows are append-only and cannot be updated';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER bulk_operations_no_update
  BEFORE UPDATE ON "bulk_operations"
  FOR EACH ROW EXECUTE FUNCTION bulk_operations_block_update();--> statement-breakpoint
CREATE OR REPLACE FUNCTION bulk_operations_block_delete() RETURNS trigger AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'bulk_operations rows are append-only and cannot be deleted directly';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER bulk_operations_no_delete
  BEFORE DELETE ON "bulk_operations"
  FOR EACH ROW EXECUTE FUNCTION bulk_operations_block_delete();