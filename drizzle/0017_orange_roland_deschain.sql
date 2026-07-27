CREATE TABLE "ti_retired_indicators" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"feed_id" text NOT NULL,
	"value" text NOT NULL,
	"type" text NOT NULL,
	"confidence" integer DEFAULT 50 NOT NULL,
	"first_seen" timestamp with time zone,
	"last_seen" timestamp with time zone,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"retired_reason" text NOT NULL,
	"retired_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ti_feeds" ADD COLUMN "last_run_ingested_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ti_feeds" ADD COLUMN "last_run_skipped_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ti_feeds" ADD COLUMN "last_run_skipped_by_type" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ti_retired_indicators" ADD CONSTRAINT "ti_retired_indicators_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ti_retired_indicators_org_type_idx" ON "ti_retired_indicators" USING btree ("organisation_id","type");--> statement-breakpoint
-- Kelpie threat intelligence is restricted to actionable network/file
-- indicators only (ip, url, file_hash, domain). Archive every existing row
-- outside that contract (cve, cidr, email, or anything else a feed produced)
-- into an audit table before it becomes unrepresentable, so no data is
-- silently destroyed and every removal is countable per organisation/type.
INSERT INTO "ti_retired_indicators"
  ("id", "organisation_id", "feed_id", "value", "type", "confidence", "first_seen", "last_seen", "tags", "attributes", "retired_reason", "retired_at")
SELECT
  'tir_' || replace(gen_random_uuid()::text, '-', ''),
  "organisation_id",
  "feed_id",
  "value",
  "type",
  "confidence",
  "first_seen",
  "last_seen",
  "tags",
  "attributes",
  'retired_0017_strict_indicator_type_contract',
  now()
FROM "ti_indicators"
WHERE "type" NOT IN ('ip', 'url', 'file_hash', 'domain');
--> statement-breakpoint
DELETE FROM "ti_indicators" WHERE "type" NOT IN ('ip', 'url', 'file_hash', 'domain');
--> statement-breakpoint
-- `indicator_count` is a denormalised counter updated on each poll; correct it
-- for every feed that lost rows in the archival step above so it doesn't
-- drift until the feed's next successful poll.
UPDATE "ti_feeds"
SET "indicator_count" = (
  SELECT count(*) FROM "ti_indicators" WHERE "ti_indicators"."feed_id" = "ti_feeds"."id"
)
WHERE "id" IN (
  SELECT DISTINCT "feed_id" FROM "ti_retired_indicators"
  WHERE "retired_reason" = 'retired_0017_strict_indicator_type_contract'
);
--> statement-breakpoint
-- CISA Known Exploited Vulnerabilities only ever produced `cve` indicators
-- and its handler has been removed; halt any existing tenant feed of this
-- kind with a precise reason instead of leaving it to fail on next poll.
UPDATE "ti_feeds"
SET "is_active" = false,
    "last_error" = 'CISA Known Exploited Vulnerabilities was retired: CVE records are not threat-intelligence indicators.'
WHERE "kind" = 'cisa_kev';
--> statement-breakpoint
ALTER TABLE "ti_indicators" ADD CONSTRAINT "ti_indicators_type_allowlist" CHECK ("type" in ('ip', 'url', 'file_hash', 'domain'));
