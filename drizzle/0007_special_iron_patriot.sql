CREATE TABLE "mobile_devices" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"environment" text DEFAULT 'sandbox' NOT NULL,
	"bundle_id" text DEFAULT 'dev.kelpie.mobile' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mobile_notification_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"device_id" text NOT NULL,
	"organisation_id" text NOT NULL,
	"user_id" text NOT NULL,
	"event" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"destination_type" text NOT NULL,
	"destination_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"apns_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "mobile_notification_deliveries_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
ALTER TABLE "mobile_devices" ADD CONSTRAINT "mobile_devices_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mobile_devices" ADD CONSTRAINT "mobile_devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mobile_notification_deliveries" ADD CONSTRAINT "mobile_notification_deliveries_device_id_mobile_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."mobile_devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mobile_notification_deliveries" ADD CONSTRAINT "mobile_notification_deliveries_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mobile_notification_deliveries" ADD CONSTRAINT "mobile_notification_deliveries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mobile_devices_token_environment_idx" ON "mobile_devices" USING btree ("token","environment");--> statement-breakpoint
CREATE INDEX "mobile_devices_user_active_idx" ON "mobile_devices" USING btree ("user_id","is_active");--> statement-breakpoint
CREATE INDEX "mobile_notification_pending_idx" ON "mobile_notification_deliveries" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "mobile_notification_user_created_idx" ON "mobile_notification_deliveries" USING btree ("user_id","created_at");