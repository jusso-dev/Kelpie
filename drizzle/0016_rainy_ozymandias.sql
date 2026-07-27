CREATE TABLE "inbound_source_status" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"source_system" text NOT NULL,
	"last_delivery_at" timestamp with time zone,
	"last_case_created_at" timestamp with time zone,
	"last_error_at" timestamp with time zone,
	"last_error_message" text,
	"last_error_status" integer,
	"delivery_count" integer DEFAULT 0 NOT NULL,
	"created_case_count" integer DEFAULT 0 NOT NULL,
	"duplicate_count" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inbound_source_status" ADD CONSTRAINT "inbound_source_status_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inbound_source_status_org_system_idx" ON "inbound_source_status" USING btree ("organisation_id","source_system");