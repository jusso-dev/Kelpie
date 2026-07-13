WITH ranked_alerts AS (
	SELECT
		"id",
		row_number() OVER (
			PARTITION BY "organisation_id", "source", "external_ref"
			ORDER BY ("promoted_case_id" IS NOT NULL) DESC, "created_at" ASC, "id" ASC
		) AS "identity_rank"
	FROM "alerts"
	WHERE "external_ref" IS NOT NULL
)
UPDATE "alerts"
SET "external_ref" = NULL
FROM ranked_alerts
WHERE "alerts"."id" = ranked_alerts."id"
	AND ranked_alerts."identity_rank" > 1;
--> statement-breakpoint
CREATE UNIQUE INDEX "alerts_org_source_external_ref_idx" ON "alerts" USING btree ("organisation_id","source","external_ref") WHERE "alerts"."external_ref" is not null;
