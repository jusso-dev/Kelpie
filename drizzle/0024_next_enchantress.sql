CREATE TYPE "public"."bulk_operation_type" AS ENUM('assign_queue', 'assign_analyst', 'add_watcher', 'remove_watcher', 'add_tag', 'remove_tag', 'set_severity', 'set_status', 'acknowledge');--> statement-breakpoint
CREATE TYPE "public"."case_waiting_reason" AS ENUM('none', 'third_party', 'approval');--> statement-breakpoint
CREATE TABLE "bulk_operations" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"actor_id" text,
	"operation_type" "bulk_operation_type" NOT NULL,
	"case_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"success_count" integer DEFAULT 0 NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "case_assignees" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"case_id" text NOT NULL,
	"user_id" text NOT NULL,
	"added_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "case_watchers" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"case_id" text NOT NULL,
	"user_id" text NOT NULL,
	"notify_on_comment" boolean DEFAULT true NOT NULL,
	"notify_on_status_change" boolean DEFAULT true NOT NULL,
	"notify_on_assignment" boolean DEFAULT true NOT NULL,
	"notify_on_sla_risk" boolean DEFAULT true NOT NULL,
	"added_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "escalation_policies" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"revision" integer DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"queue_id" text,
	"conditions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notify_enabled" boolean DEFAULT false NOT NULL,
	"notify_targets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reassign_enabled" boolean DEFAULT false NOT NULL,
	"reassign_to_queue_id" text,
	"reassign_to_user_id" text,
	"raise_severity_enabled" boolean DEFAULT false NOT NULL,
	"raise_severity_to" "severity",
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "escalation_policies_reassign_target" CHECK ("reassign_enabled" = false or "reassign_to_queue_id" is not null or "reassign_to_user_id" is not null),
	CONSTRAINT "escalation_policies_raise_severity_target" CHECK ("raise_severity_enabled" = false or "raise_severity_to" is not null)
);
--> statement-breakpoint
CREATE TABLE "escalation_policy_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"policy_id" text NOT NULL,
	"policy_revision" integer NOT NULL,
	"case_id" text NOT NULL,
	"trigger_reason" text NOT NULL,
	"notify_sent" boolean DEFAULT false NOT NULL,
	"reassigned_to_queue_id" text,
	"reassigned_to_user_id" text,
	"severity_raised_to" "severity",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "queues" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"team_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shift_handoffs" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"case_id" text NOT NULL,
	"from_user_id" text,
	"to_user_id" text,
	"from_queue_id" text,
	"to_queue_id" text,
	"summary" text NOT NULL,
	"key_actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"open_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"team_id" text NOT NULL,
	"user_id" text NOT NULL,
	"added_by" text,
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
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "acknowledged_by" text;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "queue_id" text;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "queue_assigned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "queue_assigned_by" text;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "assignee_assigned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "assignee_assigned_by" text;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "waiting_reason" "case_waiting_reason" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "waiting_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "last_activity_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "last_reopened_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bulk_operations" ADD CONSTRAINT "bulk_operations_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulk_operations" ADD CONSTRAINT "bulk_operations_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_assignees" ADD CONSTRAINT "case_assignees_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_assignees" ADD CONSTRAINT "case_assignees_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_assignees" ADD CONSTRAINT "case_assignees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_assignees" ADD CONSTRAINT "case_assignees_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_watchers" ADD CONSTRAINT "case_watchers_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_watchers" ADD CONSTRAINT "case_watchers_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_watchers" ADD CONSTRAINT "case_watchers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_watchers" ADD CONSTRAINT "case_watchers_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalation_policies" ADD CONSTRAINT "escalation_policies_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalation_policies" ADD CONSTRAINT "escalation_policies_queue_id_queues_id_fk" FOREIGN KEY ("queue_id") REFERENCES "public"."queues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalation_policies" ADD CONSTRAINT "escalation_policies_reassign_to_queue_id_queues_id_fk" FOREIGN KEY ("reassign_to_queue_id") REFERENCES "public"."queues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalation_policies" ADD CONSTRAINT "escalation_policies_reassign_to_user_id_users_id_fk" FOREIGN KEY ("reassign_to_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalation_policies" ADD CONSTRAINT "escalation_policies_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalation_policy_runs" ADD CONSTRAINT "escalation_policy_runs_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalation_policy_runs" ADD CONSTRAINT "escalation_policy_runs_policy_id_escalation_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."escalation_policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalation_policy_runs" ADD CONSTRAINT "escalation_policy_runs_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queues" ADD CONSTRAINT "queues_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queues" ADD CONSTRAINT "queues_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queues" ADD CONSTRAINT "queues_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_handoffs" ADD CONSTRAINT "shift_handoffs_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_handoffs" ADD CONSTRAINT "shift_handoffs_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_handoffs" ADD CONSTRAINT "shift_handoffs_from_user_id_users_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_handoffs" ADD CONSTRAINT "shift_handoffs_to_user_id_users_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_handoffs" ADD CONSTRAINT "shift_handoffs_from_queue_id_queues_id_fk" FOREIGN KEY ("from_queue_id") REFERENCES "public"."queues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_handoffs" ADD CONSTRAINT "shift_handoffs_to_queue_id_queues_id_fk" FOREIGN KEY ("to_queue_id") REFERENCES "public"."queues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_handoffs" ADD CONSTRAINT "shift_handoffs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bulk_operations_org_created_idx" ON "bulk_operations" USING btree ("organisation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "case_assignees_case_user_idx" ON "case_assignees" USING btree ("case_id","user_id");--> statement-breakpoint
CREATE INDEX "case_assignees_org_user_idx" ON "case_assignees" USING btree ("organisation_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "case_watchers_case_user_idx" ON "case_watchers" USING btree ("case_id","user_id");--> statement-breakpoint
CREATE INDEX "case_watchers_org_user_idx" ON "case_watchers" USING btree ("organisation_id","user_id");--> statement-breakpoint
CREATE INDEX "escalation_policies_org_active_idx" ON "escalation_policies" USING btree ("organisation_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "escalation_policy_runs_policy_rev_case_idx" ON "escalation_policy_runs" USING btree ("policy_id","policy_revision","case_id");--> statement-breakpoint
CREATE INDEX "escalation_policy_runs_org_idx" ON "escalation_policy_runs" USING btree ("organisation_id","created_at");--> statement-breakpoint
CREATE INDEX "escalation_policy_runs_case_idx" ON "escalation_policy_runs" USING btree ("case_id");--> statement-breakpoint
CREATE UNIQUE INDEX "queues_team_name_idx" ON "queues" USING btree ("team_id","name");--> statement-breakpoint
CREATE INDEX "queues_org_idx" ON "queues" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "queues_team_idx" ON "queues" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "shift_handoffs_case_idx" ON "shift_handoffs" USING btree ("case_id","created_at");--> statement-breakpoint
CREATE INDEX "shift_handoffs_org_idx" ON "shift_handoffs" USING btree ("organisation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "team_members_team_user_idx" ON "team_members" USING btree ("team_id","user_id");--> statement-breakpoint
CREATE INDEX "team_members_org_user_idx" ON "team_members" USING btree ("organisation_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "teams_org_name_idx" ON "teams" USING btree ("organisation_id","name");--> statement-breakpoint
CREATE INDEX "teams_org_idx" ON "teams" USING btree ("organisation_id");--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_acknowledged_by_users_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_queue_id_queues_id_fk" FOREIGN KEY ("queue_id") REFERENCES "public"."queues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_queue_assigned_by_users_id_fk" FOREIGN KEY ("queue_assigned_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_assignee_assigned_by_users_id_fk" FOREIGN KEY ("assignee_assigned_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cases_org_assignee_status_idx" ON "cases" USING btree ("organisation_id","assignee_id","status");--> statement-breakpoint
CREATE INDEX "cases_org_queue_status_idx" ON "cases" USING btree ("organisation_id","queue_id","status");--> statement-breakpoint
CREATE INDEX "cases_org_last_activity_idx" ON "cases" USING btree ("organisation_id","last_activity_at");--> statement-breakpoint
CREATE INDEX "cases_org_waiting_idx" ON "cases" USING btree ("organisation_id","waiting_reason") WHERE "cases"."waiting_reason" <> 'none';--> statement-breakpoint
CREATE INDEX "cases_org_reopened_idx" ON "cases" USING btree ("organisation_id","last_reopened_at") WHERE "cases"."last_reopened_at" is not null;--> statement-breakpoint
-- Shift hand-off snapshots are append-only: application code never updates a
-- hand-off after it is written, and a correction is recorded as a new
-- hand-off row, not an edit to the old one. The single narrow exception,
-- mirroring audit_events (migration 0020), is the created_by -> NULL
-- transition that FK's own ON DELETE SET NULL action performs when the
-- authoring user is deleted; every other column, and every other kind of
-- update, is rejected even for the app's own DB role.
CREATE OR REPLACE FUNCTION shift_handoffs_block_update() RETURNS trigger AS $$
BEGIN
  IF NEW.created_by IS NULL AND OLD.created_by IS NOT NULL
     AND NEW.organisation_id = OLD.organisation_id
     AND NEW.case_id = OLD.case_id
     AND NEW.from_user_id IS NOT DISTINCT FROM OLD.from_user_id
     AND NEW.to_user_id IS NOT DISTINCT FROM OLD.to_user_id
     AND NEW.from_queue_id IS NOT DISTINCT FROM OLD.from_queue_id
     AND NEW.to_queue_id IS NOT DISTINCT FROM OLD.to_queue_id
     AND NEW.summary = OLD.summary
     AND NEW.key_actions IS NOT DISTINCT FROM OLD.key_actions
     AND NEW.open_items IS NOT DISTINCT FROM OLD.open_items
     AND NEW.created_at = OLD.created_at
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'shift_handoffs rows are immutable snapshots and cannot be updated';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER shift_handoffs_no_update
  BEFORE UPDATE ON "shift_handoffs"
  FOR EACH ROW EXECUTE FUNCTION shift_handoffs_block_update();--> statement-breakpoint
-- pg_trigger_depth() > 1 means this DELETE is nested inside another
-- trigger's execution -- in practice, the owning case's (and, transitively,
-- organisation's) ON DELETE CASCADE. A direct, top-level DELETE is always
-- rejected: there is no legitimate reason for application code to remove a
-- hand-off snapshot other than the case itself going away.
--
-- Known residual gaps, both requiring privileges an ordinary application DB
-- role does not hold, so left undefended here rather than adding complexity
-- for a threat this table's actual callers cannot reach:
--   1. This depth check is a generic "nested in some trigger" signal, not a
--      cascade-specific one; a role with TRIGGER-creation privileges could
--      wrap a delete in its own trigger to slip past it.
--   2. TRUNCATE bypasses per-row triggers entirely in Postgres; only a role
--      holding TRUNCATE on this table (the app's runtime role is not granted
--      it) could use this path.
CREATE OR REPLACE FUNCTION shift_handoffs_block_delete() RETURNS trigger AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'shift_handoffs rows cannot be deleted directly';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER shift_handoffs_no_delete
  BEFORE DELETE ON "shift_handoffs"
  FOR EACH ROW EXECUTE FUNCTION shift_handoffs_block_delete();