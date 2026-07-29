-- CISA KEV was already retired (handler gone, feeds deactivated in 0017).
-- Remove remaining tenant feed rows so they no longer appear in TI settings.
-- Live indicators cascade from ti_feeds; retired-indicator audit rows keep a
-- free-text feed_id and must be cleared separately.
DELETE FROM "ti_retired_indicators"
WHERE "feed_id" IN (
  SELECT "id" FROM "ti_feeds" WHERE "kind" = 'cisa_kev'
);
--> statement-breakpoint
DELETE FROM "ti_feeds" WHERE "kind" = 'cisa_kev';
