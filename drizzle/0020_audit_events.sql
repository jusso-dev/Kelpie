CREATE TYPE "public"."audit_actor_type" AS ENUM('user', 'api_token', 'system');--> statement-breakpoint
CREATE TYPE "public"."audit_export_format" AS ENUM('csv', 'ndjson');--> statement-breakpoint
CREATE TYPE "public"."audit_export_status" AS ENUM('pending', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"actor_id" text,
	"actor_type" "audit_actor_type" DEFAULT 'user' NOT NULL,
	"actor_label" text,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text,
	"target_label" text,
	"request_id" text,
	"source_ip" text,
	"user_agent" text,
	"before" jsonb,
	"after" jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_export_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"requested_by" text,
	"format" "audit_export_format" NOT NULL,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "audit_export_status" DEFAULT 'pending' NOT NULL,
	"storage_key" text,
	"row_count" integer,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_export_jobs" ADD CONSTRAINT "audit_export_jobs_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_export_jobs" ADD CONSTRAINT "audit_export_jobs_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_org_occurred_idx" ON "audit_events" USING btree ("organisation_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_events_org_action_idx" ON "audit_events" USING btree ("organisation_id","action");--> statement-breakpoint
CREATE INDEX "audit_events_org_actor_idx" ON "audit_events" USING btree ("organisation_id","actor_id");--> statement-breakpoint
CREATE INDEX "audit_events_org_target_idx" ON "audit_events" USING btree ("organisation_id","target_type","target_id");--> statement-breakpoint
CREATE INDEX "audit_export_jobs_org_idx" ON "audit_export_jobs" USING btree ("organisation_id","created_at");--> statement-breakpoint
-- Append-only enforcement: audit_events rows are never updated, and are only
-- ever deleted by the retention purge job (src/lib/audit/retention.ts), which
-- sets `kelpie.audit_retention_purge = 'on'` for the duration of its own
-- transaction. This holds even for the app's own DB role, since Postgres
-- table owners are otherwise exempt from REVOKE-based restrictions.
--
-- One narrow exception: the `actor_id` FK's own `ON DELETE SET NULL` action
-- issues an UPDATE when a referenced user is deleted, to anonymize past
-- events rather than block deleting the user. That specific transition
-- (actor_id -> NULL, every other column unchanged) is allowed; any other
-- UPDATE, including one that also nulls actor_id but changes anything else,
-- is still rejected.
CREATE OR REPLACE FUNCTION audit_events_block_update() RETURNS trigger AS $$
BEGIN
  IF NEW.actor_id IS NULL AND OLD.actor_id IS NOT NULL
     AND NEW.organisation_id = OLD.organisation_id
     AND NEW.actor_type = OLD.actor_type
     AND NEW.actor_label IS NOT DISTINCT FROM OLD.actor_label
     AND NEW.action = OLD.action
     AND NEW.target_type = OLD.target_type
     AND NEW.target_id IS NOT DISTINCT FROM OLD.target_id
     AND NEW.target_label IS NOT DISTINCT FROM OLD.target_label
     AND NEW.request_id IS NOT DISTINCT FROM OLD.request_id
     AND NEW.source_ip IS NOT DISTINCT FROM OLD.source_ip
     AND NEW.user_agent IS NOT DISTINCT FROM OLD.user_agent
     AND NEW.before IS NOT DISTINCT FROM OLD.before
     AND NEW.after IS NOT DISTINCT FROM OLD.after
     AND NEW.metadata IS NOT DISTINCT FROM OLD.metadata
     AND NEW.occurred_at = OLD.occurred_at
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'audit_events rows are append-only and cannot be updated';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER audit_events_no_update
  BEFORE UPDATE ON "audit_events"
  FOR EACH ROW EXECUTE FUNCTION audit_events_block_update();--> statement-breakpoint
-- pg_trigger_depth() > 1 means this DELETE is nested inside another trigger's
-- execution — in practice, the owning organisation's `ON DELETE CASCADE`
-- removing this row along with the rest of that tenant's data. A direct,
-- top-level `DELETE FROM audit_events` (depth = 1) still requires the
-- retention purge job's session-local escape hatch.
CREATE OR REPLACE FUNCTION audit_events_block_delete() RETURNS trigger AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  IF current_setting('kelpie.audit_retention_purge', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'audit_events rows can only be removed by the retention purge job';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER audit_events_no_delete
  BEFORE DELETE ON "audit_events"
  FOR EACH ROW EXECUTE FUNCTION audit_events_block_delete();