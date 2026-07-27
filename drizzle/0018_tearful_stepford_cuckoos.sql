CREATE TYPE "public"."case_relationship_origin" AS ENUM('analyst', 'provider', 'rule');--> statement-breakpoint
CREATE TYPE "public"."case_relationship_type" AS ENUM('duplicate_of', 'related_to', 'parent_of');--> statement-breakpoint
CREATE TABLE "case_relationship_dismissals" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"case_id_a" text NOT NULL,
	"case_id_b" text NOT NULL,
	"reason" text NOT NULL,
	"dismissed_by" text,
	"dismissed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "case_relationship_dismissals_canonical_order" CHECK ("case_id_a" < "case_id_b")
);
--> statement-breakpoint
CREATE TABLE "case_relationships" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"source_case_id" text NOT NULL,
	"target_case_id" text NOT NULL,
	"relationship_type" "case_relationship_type" NOT NULL,
	"confidence" integer,
	"origin" "case_relationship_origin" DEFAULT 'analyst' NOT NULL,
	"rule_id" text,
	"rule_version" text,
	"reason" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "case_relationships_no_self_link" CHECK ("source_case_id" <> "target_case_id"),
	CONSTRAINT "case_relationships_confidence_range" CHECK ("confidence" is null or ("confidence" >= 0 and "confidence" <= 100))
);
--> statement-breakpoint
ALTER TABLE "case_relationship_dismissals" ADD CONSTRAINT "case_relationship_dismissals_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_relationship_dismissals" ADD CONSTRAINT "case_relationship_dismissals_case_id_a_cases_id_fk" FOREIGN KEY ("case_id_a") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_relationship_dismissals" ADD CONSTRAINT "case_relationship_dismissals_case_id_b_cases_id_fk" FOREIGN KEY ("case_id_b") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_relationship_dismissals" ADD CONSTRAINT "case_relationship_dismissals_dismissed_by_users_id_fk" FOREIGN KEY ("dismissed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_relationships" ADD CONSTRAINT "case_relationships_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_relationships" ADD CONSTRAINT "case_relationships_source_case_id_cases_id_fk" FOREIGN KEY ("source_case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_relationships" ADD CONSTRAINT "case_relationships_target_case_id_cases_id_fk" FOREIGN KEY ("target_case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_relationships" ADD CONSTRAINT "case_relationships_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "case_relationship_dismissals_pair_idx" ON "case_relationship_dismissals" USING btree ("organisation_id","case_id_a","case_id_b");--> statement-breakpoint
CREATE INDEX "case_relationship_dismissals_org_idx" ON "case_relationship_dismissals" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "case_relationships_org_idx" ON "case_relationships" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "case_relationships_source_idx" ON "case_relationships" USING btree ("source_case_id");--> statement-breakpoint
CREATE INDEX "case_relationships_target_idx" ON "case_relationships" USING btree ("target_case_id");--> statement-breakpoint
CREATE UNIQUE INDEX "case_relationships_unique_edge_idx" ON "case_relationships" USING btree ("organisation_id","source_case_id","target_case_id","relationship_type");