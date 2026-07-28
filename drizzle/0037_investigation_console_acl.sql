ALTER TABLE "investigation_executions" ADD COLUMN "params_sealed" jsonb;--> statement-breakpoint
DROP INDEX IF EXISTS "investigation_executions_idempotency_key_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "investigation_executions_org_idempotency_idx" ON "investigation_executions" USING btree ("organisation_id","idempotency_key");
