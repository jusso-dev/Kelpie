ALTER TABLE "case_templates" ADD COLUMN "catalogue_key" text;--> statement-breakpoint
ALTER TABLE "case_templates" ADD COLUMN "catalogue_version" integer;--> statement-breakpoint
ALTER TABLE "playbooks" ADD COLUMN "default_severity" "severity";--> statement-breakpoint
ALTER TABLE "playbooks" ADD COLUMN "content" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "playbooks" ADD COLUMN "tags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "playbooks" ADD COLUMN "required_observable_types" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "playbooks" ADD COLUMN "catalogue_key" text;--> statement-breakpoint
ALTER TABLE "playbooks" ADD COLUMN "catalogue_version" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "case_templates_org_catalogue_key_idx" ON "case_templates" USING btree ("organisation_id","catalogue_key");--> statement-breakpoint
CREATE INDEX "playbooks_org_classification_idx" ON "playbooks" USING btree ("organisation_id","classification");--> statement-breakpoint
CREATE INDEX "playbooks_org_severity_idx" ON "playbooks" USING btree ("organisation_id","default_severity");--> statement-breakpoint
CREATE UNIQUE INDEX "playbooks_org_catalogue_key_idx" ON "playbooks" USING btree ("organisation_id","catalogue_key");