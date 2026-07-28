-- Restricted stakeholder portal (issue #63)
-- External collaborators, invitations, sessions, updates, evidence requests,
-- responses, approvals, read receipts, and access audit.
-- Pure feature SQL (not drizzle-kit generate) to avoid unrelated diffs.

ALTER TYPE "public"."audit_actor_type" ADD VALUE IF NOT EXISTS 'external';--> statement-breakpoint

DO $$ BEGIN
  CREATE TYPE "public"."stakeholder_role" AS ENUM(
    'update_reader',
    'evidence_provider',
    'respondent',
    'approver'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  CREATE TYPE "public"."stakeholder_invite_status" AS ENUM(
    'pending',
    'accepted',
    'revoked',
    'expired'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  CREATE TYPE "public"."stakeholder_evidence_request_status" AS ENUM(
    'open',
    'fulfilled',
    'cancelled',
    'expired'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  CREATE TYPE "public"."stakeholder_approval_status" AS ENUM(
    'pending',
    'approved',
    'rejected',
    'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "external_collaborators" (
  "id" text PRIMARY KEY NOT NULL,
  "organisation_id" text NOT NULL,
  "email" text NOT NULL,
  "display_name" text NOT NULL,
  "organisation_label" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "stakeholder_invitations" (
  "id" text PRIMARY KEY NOT NULL,
  "organisation_id" text NOT NULL,
  "case_id" text NOT NULL,
  "collaborator_id" text NOT NULL,
  "role" "stakeholder_role" NOT NULL,
  "purpose" text NOT NULL,
  "status" "stakeholder_invite_status" DEFAULT 'pending' NOT NULL,
  "token_hash" text NOT NULL,
  "single_use" boolean DEFAULT true NOT NULL,
  "max_tlp" "tlp" DEFAULT 'amber' NOT NULL,
  "max_pap" "pap" DEFAULT 'amber' NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "accepted_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "revoked_by" text,
  "revoke_reason" text,
  "invited_by" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "stakeholder_sessions" (
  "id" text PRIMARY KEY NOT NULL,
  "organisation_id" text NOT NULL,
  "invitation_id" text NOT NULL,
  "collaborator_id" text NOT NULL,
  "case_id" text NOT NULL,
  "token_hash" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone,
  "last_seen_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "stakeholder_updates" (
  "id" text PRIMARY KEY NOT NULL,
  "organisation_id" text NOT NULL,
  "case_id" text NOT NULL,
  "invitation_id" text,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "tlp" "tlp" DEFAULT 'amber' NOT NULL,
  "pap" "pap" DEFAULT 'amber' NOT NULL,
  "published_by" text,
  "published_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "stakeholder_evidence_requests" (
  "id" text PRIMARY KEY NOT NULL,
  "organisation_id" text NOT NULL,
  "case_id" text NOT NULL,
  "invitation_id" text NOT NULL,
  "title" text NOT NULL,
  "instructions" text NOT NULL,
  "status" "stakeholder_evidence_request_status" DEFAULT 'open' NOT NULL,
  "due_at" timestamp with time zone,
  "fulfilled_attachment_id" text,
  "fulfilled_at" timestamp with time zone,
  "requested_by" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "stakeholder_responses" (
  "id" text PRIMARY KEY NOT NULL,
  "organisation_id" text NOT NULL,
  "case_id" text NOT NULL,
  "invitation_id" text NOT NULL,
  "collaborator_id" text NOT NULL,
  "in_reply_to_update_id" text,
  "body" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "stakeholder_approvals" (
  "id" text PRIMARY KEY NOT NULL,
  "organisation_id" text NOT NULL,
  "case_id" text NOT NULL,
  "invitation_id" text NOT NULL,
  "title" text NOT NULL,
  "description" text NOT NULL,
  "status" "stakeholder_approval_status" DEFAULT 'pending' NOT NULL,
  "decision_note" text,
  "decided_at" timestamp with time zone,
  "requested_by" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "stakeholder_read_receipts" (
  "id" text PRIMARY KEY NOT NULL,
  "organisation_id" text NOT NULL,
  "invitation_id" text NOT NULL,
  "collaborator_id" text NOT NULL,
  "update_id" text NOT NULL,
  "read_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "stakeholder_access_events" (
  "id" text PRIMARY KEY NOT NULL,
  "organisation_id" text NOT NULL,
  "case_id" text NOT NULL,
  "invitation_id" text,
  "collaborator_id" text,
  "session_id" text,
  "action" text NOT NULL,
  "target_type" text,
  "target_id" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "source_ip" text,
  "user_agent" text,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "external_collaborators" ADD CONSTRAINT "external_collaborators_organisation_id_organisations_id_fk"
    FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "stakeholder_invitations" ADD CONSTRAINT "stakeholder_invitations_organisation_id_organisations_id_fk"
    FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "stakeholder_invitations" ADD CONSTRAINT "stakeholder_invitations_case_id_cases_id_fk"
    FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "stakeholder_invitations" ADD CONSTRAINT "stakeholder_invitations_collaborator_id_external_collaborators_id_fk"
    FOREIGN KEY ("collaborator_id") REFERENCES "public"."external_collaborators"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "stakeholder_invitations" ADD CONSTRAINT "stakeholder_invitations_revoked_by_users_id_fk"
    FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "stakeholder_invitations" ADD CONSTRAINT "stakeholder_invitations_invited_by_users_id_fk"
    FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "stakeholder_sessions" ADD CONSTRAINT "stakeholder_sessions_organisation_id_organisations_id_fk"
    FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "stakeholder_sessions" ADD CONSTRAINT "stakeholder_sessions_invitation_id_stakeholder_invitations_id_fk"
    FOREIGN KEY ("invitation_id") REFERENCES "public"."stakeholder_invitations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "stakeholder_sessions" ADD CONSTRAINT "stakeholder_sessions_collaborator_id_external_collaborators_id_fk"
    FOREIGN KEY ("collaborator_id") REFERENCES "public"."external_collaborators"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "stakeholder_sessions" ADD CONSTRAINT "stakeholder_sessions_case_id_cases_id_fk"
    FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "stakeholder_updates" ADD CONSTRAINT "stakeholder_updates_organisation_id_organisations_id_fk"
    FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "stakeholder_updates" ADD CONSTRAINT "stakeholder_updates_case_id_cases_id_fk"
    FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "stakeholder_updates" ADD CONSTRAINT "stakeholder_updates_invitation_id_stakeholder_invitations_id_fk"
    FOREIGN KEY ("invitation_id") REFERENCES "public"."stakeholder_invitations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "stakeholder_updates" ADD CONSTRAINT "stakeholder_updates_published_by_users_id_fk"
    FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "stakeholder_evidence_requests" ADD CONSTRAINT "stakeholder_evidence_requests_organisation_id_organisations_id_fk"
    FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "stakeholder_evidence_requests" ADD CONSTRAINT "stakeholder_evidence_requests_case_id_cases_id_fk"
    FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "stakeholder_evidence_requests" ADD CONSTRAINT "stakeholder_evidence_requests_invitation_id_stakeholder_invitations_id_fk"
    FOREIGN KEY ("invitation_id") REFERENCES "public"."stakeholder_invitations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "stakeholder_evidence_requests" ADD CONSTRAINT "stakeholder_evidence_requests_fulfilled_attachment_id_attachments_id_fk"
    FOREIGN KEY ("fulfilled_attachment_id") REFERENCES "public"."attachments"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "stakeholder_evidence_requests" ADD CONSTRAINT "stakeholder_evidence_requests_requested_by_users_id_fk"
    FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "stakeholder_responses" ADD CONSTRAINT "stakeholder_responses_organisation_id_organisations_id_fk"
    FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "stakeholder_responses" ADD CONSTRAINT "stakeholder_responses_case_id_cases_id_fk"
    FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "stakeholder_responses" ADD CONSTRAINT "stakeholder_responses_invitation_id_stakeholder_invitations_id_fk"
    FOREIGN KEY ("invitation_id") REFERENCES "public"."stakeholder_invitations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "stakeholder_responses" ADD CONSTRAINT "stakeholder_responses_collaborator_id_external_collaborators_id_fk"
    FOREIGN KEY ("collaborator_id") REFERENCES "public"."external_collaborators"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "stakeholder_responses" ADD CONSTRAINT "stakeholder_responses_in_reply_to_update_id_stakeholder_updates_id_fk"
    FOREIGN KEY ("in_reply_to_update_id") REFERENCES "public"."stakeholder_updates"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "stakeholder_approvals" ADD CONSTRAINT "stakeholder_approvals_organisation_id_organisations_id_fk"
    FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "stakeholder_approvals" ADD CONSTRAINT "stakeholder_approvals_case_id_cases_id_fk"
    FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "stakeholder_approvals" ADD CONSTRAINT "stakeholder_approvals_invitation_id_stakeholder_invitations_id_fk"
    FOREIGN KEY ("invitation_id") REFERENCES "public"."stakeholder_invitations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "stakeholder_approvals" ADD CONSTRAINT "stakeholder_approvals_requested_by_users_id_fk"
    FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "stakeholder_read_receipts" ADD CONSTRAINT "stakeholder_read_receipts_organisation_id_organisations_id_fk"
    FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "stakeholder_read_receipts" ADD CONSTRAINT "stakeholder_read_receipts_invitation_id_stakeholder_invitations_id_fk"
    FOREIGN KEY ("invitation_id") REFERENCES "public"."stakeholder_invitations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "stakeholder_read_receipts" ADD CONSTRAINT "stakeholder_read_receipts_collaborator_id_external_collaborators_id_fk"
    FOREIGN KEY ("collaborator_id") REFERENCES "public"."external_collaborators"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "stakeholder_read_receipts" ADD CONSTRAINT "stakeholder_read_receipts_update_id_stakeholder_updates_id_fk"
    FOREIGN KEY ("update_id") REFERENCES "public"."stakeholder_updates"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "stakeholder_access_events" ADD CONSTRAINT "stakeholder_access_events_organisation_id_organisations_id_fk"
    FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "stakeholder_access_events" ADD CONSTRAINT "stakeholder_access_events_case_id_cases_id_fk"
    FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "stakeholder_access_events" ADD CONSTRAINT "stakeholder_access_events_invitation_id_stakeholder_invitations_id_fk"
    FOREIGN KEY ("invitation_id") REFERENCES "public"."stakeholder_invitations"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "stakeholder_access_events" ADD CONSTRAINT "stakeholder_access_events_collaborator_id_external_collaborators_id_fk"
    FOREIGN KEY ("collaborator_id") REFERENCES "public"."external_collaborators"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "stakeholder_access_events" ADD CONSTRAINT "stakeholder_access_events_session_id_stakeholder_sessions_id_fk"
    FOREIGN KEY ("session_id") REFERENCES "public"."stakeholder_sessions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "external_collaborators_org_email_idx" ON "external_collaborators" USING btree ("organisation_id","email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "external_collaborators_org_idx" ON "external_collaborators" USING btree ("organisation_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "stakeholder_invitations_token_hash_idx" ON "stakeholder_invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stakeholder_invitations_org_case_idx" ON "stakeholder_invitations" USING btree ("organisation_id","case_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stakeholder_invitations_collaborator_idx" ON "stakeholder_invitations" USING btree ("collaborator_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stakeholder_invitations_org_status_idx" ON "stakeholder_invitations" USING btree ("organisation_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "stakeholder_sessions_token_hash_idx" ON "stakeholder_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stakeholder_sessions_invitation_idx" ON "stakeholder_sessions" USING btree ("invitation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stakeholder_sessions_org_case_idx" ON "stakeholder_sessions" USING btree ("organisation_id","case_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stakeholder_updates_org_case_idx" ON "stakeholder_updates" USING btree ("organisation_id","case_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stakeholder_updates_invitation_idx" ON "stakeholder_updates" USING btree ("invitation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stakeholder_evidence_requests_org_case_idx" ON "stakeholder_evidence_requests" USING btree ("organisation_id","case_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stakeholder_evidence_requests_invitation_idx" ON "stakeholder_evidence_requests" USING btree ("invitation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stakeholder_evidence_requests_status_idx" ON "stakeholder_evidence_requests" USING btree ("organisation_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stakeholder_responses_org_case_idx" ON "stakeholder_responses" USING btree ("organisation_id","case_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stakeholder_responses_invitation_idx" ON "stakeholder_responses" USING btree ("invitation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stakeholder_approvals_org_case_idx" ON "stakeholder_approvals" USING btree ("organisation_id","case_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stakeholder_approvals_invitation_idx" ON "stakeholder_approvals" USING btree ("invitation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stakeholder_approvals_status_idx" ON "stakeholder_approvals" USING btree ("organisation_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "stakeholder_read_receipts_unique_idx" ON "stakeholder_read_receipts" USING btree ("invitation_id","update_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stakeholder_read_receipts_update_idx" ON "stakeholder_read_receipts" USING btree ("update_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stakeholder_access_events_org_case_idx" ON "stakeholder_access_events" USING btree ("organisation_id","case_id","occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stakeholder_access_events_invitation_idx" ON "stakeholder_access_events" USING btree ("invitation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stakeholder_access_events_action_idx" ON "stakeholder_access_events" USING btree ("organisation_id","action");
