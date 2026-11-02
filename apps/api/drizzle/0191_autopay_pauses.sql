-- Pause automatic payments (ROADMAP 18d-iv-f): staff paused the app charging a record's saved card by itself. One open pause a record;
-- Resume closes it, and the row stays to say when it stood.
CREATE TABLE "gym_autopay_pauses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"paused_at" timestamp with time zone NOT NULL,
	"paused_by" uuid,
	"resumed_at" timestamp with time zone,
	"resumed_by" uuid,
	CONSTRAINT "gym_autopay_pauses_order_check" CHECK ("resumed_at" IS NULL OR "resumed_at" >= "paused_at")
);--> statement-breakpoint
ALTER TABLE "gym_autopay_pauses" ADD CONSTRAINT "gym_autopay_pauses_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_autopay_pauses" ADD CONSTRAINT "gym_autopay_pauses_paused_by_users_id_fk" FOREIGN KEY ("paused_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_autopay_pauses" ADD CONSTRAINT "gym_autopay_pauses_resumed_by_users_id_fk" FOREIGN KEY ("resumed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_autopay_pauses" ADD CONSTRAINT "gym_autopay_pauses_entry_fk" FOREIGN KEY ("gym_id","entry_id") REFERENCES "public"."gym_member_list_entries"("gym_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gym_autopay_pauses_open_idx" ON "gym_autopay_pauses" USING btree ("gym_id","entry_id") WHERE "gym_autopay_pauses"."resumed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "gym_autopay_pauses_entry_idx" ON "gym_autopay_pauses" USING btree ("gym_id","entry_id");
