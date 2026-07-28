CREATE TYPE "public"."alert_determination" AS ENUM('unknown', 'true_positive', 'false_positive', 'benign_positive');--> statement-breakpoint
CREATE TYPE "public"."alert_entity_role" AS ENUM('actor', 'target', 'impacted', 'related');--> statement-breakpoint
CREATE TYPE "public"."alert_severity" AS ENUM('informational', 'low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."alert_status" AS ENUM('new', 'in_progress', 'closed', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."entity_identifier_kind" AS ENUM('email', 'upn', 'sid', 'aad_object_id', 'device_id', 'hostname', 'ip', 'fqdn', 'url', 'sha256', 'sha1', 'md5', 'process_guid', 'cloud_resource_id', 'tenant_id', 'application_id', 'other');--> statement-breakpoint
CREATE TYPE "public"."entity_type" AS ENUM('user_identity', 'device_endpoint', 'mailbox', 'email_message', 'ip', 'domain', 'url', 'file', 'file_hash', 'process', 'cloud_resource', 'application', 'tenant', 'network', 'asset');--> statement-breakpoint
CREATE TYPE "public"."evidence_item_remediation" AS ENUM('none', 'pending', 'remediated', 'not_applicable');--> statement-breakpoint
CREATE TYPE "public"."evidence_item_verdict" AS ENUM('unknown', 'clean', 'suspicious', 'malicious');--> statement-breakpoint
CREATE TYPE "public"."evidence_relationship_type" AS ENUM('related_to', 'duplicate_of', 'derived_from');--> statement-breakpoint
CREATE TABLE "alert_entities" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"alert_id" text NOT NULL,
	"entity_id" text NOT NULL,
	"role" "alert_entity_role" DEFAULT 'related' NOT NULL,
	"added_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alert_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"tenant_id" text DEFAULT '' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"source_id" text NOT NULL,
	"tenant_id" text DEFAULT '' NOT NULL,
	"external_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"detection_source" text,
	"detection_product" text,
	"classification" text,
	"severity" "alert_severity" DEFAULT 'medium' NOT NULL,
	"severity_overridden_by_analyst" boolean DEFAULT false NOT NULL,
	"status" "alert_status" DEFAULT 'new' NOT NULL,
	"determination" "alert_determination" DEFAULT 'unknown' NOT NULL,
	"assignee_id" text,
	"analyst_notes" text,
	"dismissed_reason" text,
	"detected_at" timestamp with time zone,
	"provider_created_at" timestamp with time zone,
	"provider_updated_at" timestamp with time zone,
	"source_url" text,
	"normalized_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"attack_techniques" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"derived_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"raw_payload_ref_id" text,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "case_alerts" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"case_id" text NOT NULL,
	"alert_id" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"added_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entities" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"type" "entity_type" NOT NULL,
	"display_name" text NOT NULL,
	"canonical_key" text NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"risk_score" integer,
	"notes" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entities_risk_score_range" CHECK ("risk_score" is null or ("risk_score" >= 0 and "risk_score" <= 100))
);
--> statement-breakpoint
CREATE TABLE "entity_identifiers" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"entity_id" text NOT NULL,
	"kind" "entity_identifier_kind" NOT NULL,
	"value" text NOT NULL,
	"source" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence_items" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"case_id" text NOT NULL,
	"alert_id" text,
	"entity_id" text,
	"attachment_id" text,
	"type" text NOT NULL,
	"value" text,
	"description" text,
	"verdict" "evidence_item_verdict" DEFAULT 'unknown' NOT NULL,
	"remediation_state" "evidence_item_remediation" DEFAULT 'none' NOT NULL,
	"confidence" integer,
	"source" text DEFAULT 'analyst' NOT NULL,
	"first_seen_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"analyst_notes" text,
	"raw_payload_ref_id" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_items_confidence_range" CHECK ("confidence" is null or ("confidence" >= 0 and "confidence" <= 100))
);
--> statement-breakpoint
CREATE TABLE "evidence_relationships" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"source_evidence_id" text NOT NULL,
	"target_evidence_id" text NOT NULL,
	"relationship_type" "evidence_relationship_type" NOT NULL,
	"reason" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_relationships_no_self_link" CHECK ("source_evidence_id" <> "target_evidence_id")
);
--> statement-breakpoint
CREATE TABLE "provider_payload_references" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"source_id" text,
	"external_ref" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"size_bytes" integer DEFAULT 0 NOT NULL,
	"redacted" boolean DEFAULT true NOT NULL,
	"retrieved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alert_entities" ADD CONSTRAINT "alert_entities_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_entities" ADD CONSTRAINT "alert_entities_alert_id_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."alerts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_entities" ADD CONSTRAINT "alert_entities_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_entities" ADD CONSTRAINT "alert_entities_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_sources" ADD CONSTRAINT "alert_sources_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_sources" ADD CONSTRAINT "alert_sources_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_source_id_alert_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."alert_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_raw_payload_ref_id_provider_payload_references_id_fk" FOREIGN KEY ("raw_payload_ref_id") REFERENCES "public"."provider_payload_references"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_alerts" ADD CONSTRAINT "case_alerts_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_alerts" ADD CONSTRAINT "case_alerts_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_alerts" ADD CONSTRAINT "case_alerts_alert_id_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."alerts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_alerts" ADD CONSTRAINT "case_alerts_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_identifiers" ADD CONSTRAINT "entity_identifiers_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_identifiers" ADD CONSTRAINT "entity_identifiers_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_alert_id_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."alerts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_raw_payload_ref_id_provider_payload_references_id_fk" FOREIGN KEY ("raw_payload_ref_id") REFERENCES "public"."provider_payload_references"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_relationships" ADD CONSTRAINT "evidence_relationships_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_relationships" ADD CONSTRAINT "evidence_relationships_source_evidence_id_evidence_items_id_fk" FOREIGN KEY ("source_evidence_id") REFERENCES "public"."evidence_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_relationships" ADD CONSTRAINT "evidence_relationships_target_evidence_id_evidence_items_id_fk" FOREIGN KEY ("target_evidence_id") REFERENCES "public"."evidence_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_relationships" ADD CONSTRAINT "evidence_relationships_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_payload_references" ADD CONSTRAINT "provider_payload_references_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_payload_references" ADD CONSTRAINT "provider_payload_references_source_id_alert_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."alert_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_payload_references" ADD CONSTRAINT "provider_payload_references_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "alert_entities_unique_idx" ON "alert_entities" USING btree ("alert_id","entity_id","role");--> statement-breakpoint
CREATE INDEX "alert_entities_entity_idx" ON "alert_entities" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "alert_entities_org_idx" ON "alert_entities" USING btree ("organisation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "alert_sources_org_kind_tenant_idx" ON "alert_sources" USING btree ("organisation_id","kind","tenant_id");--> statement-breakpoint
CREATE INDEX "alert_sources_org_idx" ON "alert_sources" USING btree ("organisation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "alerts_org_source_tenant_external_idx" ON "alerts" USING btree ("organisation_id","source_id","tenant_id","external_id");--> statement-breakpoint
CREATE INDEX "alerts_org_status_idx" ON "alerts" USING btree ("organisation_id","status");--> statement-breakpoint
CREATE INDEX "alerts_org_detected_idx" ON "alerts" USING btree ("organisation_id","detected_at");--> statement-breakpoint
CREATE INDEX "alerts_source_idx" ON "alerts" USING btree ("source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "case_alerts_unique_idx" ON "case_alerts" USING btree ("case_id","alert_id");--> statement-breakpoint
CREATE INDEX "case_alerts_alert_idx" ON "case_alerts" USING btree ("alert_id");--> statement-breakpoint
CREATE INDEX "case_alerts_org_idx" ON "case_alerts" USING btree ("organisation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entities_org_type_canonical_idx" ON "entities" USING btree ("organisation_id","type","canonical_key");--> statement-breakpoint
CREATE INDEX "entities_org_idx" ON "entities" USING btree ("organisation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entity_identifiers_org_kind_value_idx" ON "entity_identifiers" USING btree ("organisation_id","kind","value");--> statement-breakpoint
CREATE INDEX "entity_identifiers_entity_idx" ON "entity_identifiers" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "evidence_items_case_idx" ON "evidence_items" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "evidence_items_alert_idx" ON "evidence_items" USING btree ("alert_id");--> statement-breakpoint
CREATE INDEX "evidence_items_entity_idx" ON "evidence_items" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "evidence_items_org_idx" ON "evidence_items" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "evidence_relationships_org_idx" ON "evidence_relationships" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "evidence_relationships_source_idx" ON "evidence_relationships" USING btree ("source_evidence_id");--> statement-breakpoint
CREATE INDEX "evidence_relationships_target_idx" ON "evidence_relationships" USING btree ("target_evidence_id");--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_relationships_unique_edge_idx" ON "evidence_relationships" USING btree ("organisation_id","source_evidence_id","target_evidence_id","relationship_type");--> statement-breakpoint
CREATE INDEX "provider_payload_references_org_idx" ON "provider_payload_references" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "provider_payload_references_source_idx" ON "provider_payload_references" USING btree ("source_id");