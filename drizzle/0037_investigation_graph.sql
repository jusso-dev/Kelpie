CREATE TYPE "public"."investigation_graph_edge_type" AS ENUM('observed_on', 'communicated_with', 'executed', 'downloaded', 'sent_by', 'received_by', 'authenticated_to', 'resolved_to', 'parent_process', 'triggered_alert', 'belongs_to_case', 'related_to', 'derived_from', 'duplicate_of', 'maps_to_technique');--> statement-breakpoint
CREATE TYPE "public"."investigation_graph_node_type" AS ENUM('case', 'alert', 'identity', 'device', 'mailbox', 'file', 'process', 'ip', 'domain', 'url', 'cloud_resource', 'evidence', 'technique', 'email_message', 'application', 'tenant', 'network', 'asset', 'other');--> statement-breakpoint
CREATE TYPE "public"."investigation_graph_provenance" AS ENUM('provider', 'analyst', 'rule');--> statement-breakpoint
CREATE TABLE "investigation_graph_edges" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"case_id" text NOT NULL,
	"source_node_type" "investigation_graph_node_type" NOT NULL,
	"source_node_id" text NOT NULL,
	"target_node_type" "investigation_graph_node_type" NOT NULL,
	"target_node_id" text NOT NULL,
	"edge_type" "investigation_graph_edge_type" NOT NULL,
	"confidence" integer,
	"provenance" "investigation_graph_provenance" NOT NULL,
	"source" text NOT NULL,
	"observed_at_start" timestamp with time zone,
	"observed_at_end" timestamp with time zone,
	"creator_id" text,
	"rule_id" text,
	"rule_version" text,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "investigation_graph_edges_confidence_range" CHECK ("confidence" is null or ("confidence" >= 0 and "confidence" <= 100)),
	CONSTRAINT "investigation_graph_edges_no_self_link" CHECK (not ("source_node_type" = "target_node_type" and "source_node_id" = "target_node_id")),
	CONSTRAINT "investigation_graph_edges_observed_range" CHECK ("observed_at_start" is null or "observed_at_end" is null or "observed_at_start" <= "observed_at_end")
);
--> statement-breakpoint
ALTER TABLE "investigation_graph_edges" ADD CONSTRAINT "investigation_graph_edges_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investigation_graph_edges" ADD CONSTRAINT "investigation_graph_edges_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investigation_graph_edges" ADD CONSTRAINT "investigation_graph_edges_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "investigation_graph_edges_org_case_idx" ON "investigation_graph_edges" USING btree ("organisation_id","case_id");--> statement-breakpoint
CREATE INDEX "investigation_graph_edges_source_idx" ON "investigation_graph_edges" USING btree ("case_id","source_node_type","source_node_id");--> statement-breakpoint
CREATE INDEX "investigation_graph_edges_target_idx" ON "investigation_graph_edges" USING btree ("case_id","target_node_type","target_node_id");--> statement-breakpoint
CREATE UNIQUE INDEX "investigation_graph_edges_unique_idx" ON "investigation_graph_edges" USING btree ("organisation_id","case_id","source_node_type","source_node_id","target_node_type","target_node_id","edge_type","provenance","source");