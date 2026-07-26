CREATE TABLE "vendor_watchlist" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"catalog_slug" text NOT NULL,
	"display_name" text NOT NULL,
	"legal_name" text NOT NULL,
	"website" text NOT NULL,
	"category" text NOT NULL,
	"aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vendor_watchlist" ADD CONSTRAINT "vendor_watchlist_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_watchlist" ADD CONSTRAINT "vendor_watchlist_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "vendor_watchlist_org_slug_idx" ON "vendor_watchlist" USING btree ("organisation_id","catalog_slug");--> statement-breakpoint
CREATE INDEX "vendor_watchlist_org_idx" ON "vendor_watchlist" USING btree ("organisation_id");