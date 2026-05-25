ALTER TABLE "case_templates" ADD COLUMN "default_tags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "case_templates" ADD COLUMN "default_data_classification_tags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "tags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "data_classification_tags" jsonb DEFAULT '[]'::jsonb NOT NULL;