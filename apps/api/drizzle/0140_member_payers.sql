-- Family plans: one person on a gym's list pays for others (ROADMAP Stage 2 item 18i).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this
-- commit.
--
-- One row a person who is paid for, naming the record that pays. Both records are the
-- gym's own (the two foreign keys carry the gym), a record never pays for itself, and a
-- record deleted for good takes its rows with it: the person it paid for pays for
-- themselves again. One level only (a payer is paid for by nobody) is kept by the write,
-- under the gym's lock.
CREATE TABLE "gym_member_payers" (
	"gym_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"payer_entry_id" uuid NOT NULL,
	"set_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gym_member_payers_pk" PRIMARY KEY("gym_id","entry_id"),
	CONSTRAINT "gym_member_payers_self_check" CHECK ("entry_id" <> "payer_entry_id")
);--> statement-breakpoint
ALTER TABLE "gym_member_payers" ADD CONSTRAINT "gym_member_payers_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_member_payers" ADD CONSTRAINT "gym_member_payers_entry_fk" FOREIGN KEY ("gym_id","entry_id") REFERENCES "public"."gym_member_list_entries"("gym_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_member_payers" ADD CONSTRAINT "gym_member_payers_payer_fk" FOREIGN KEY ("gym_id","payer_entry_id") REFERENCES "public"."gym_member_list_entries"("gym_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_member_payers" ADD CONSTRAINT "gym_member_payers_set_by_users_id_fk" FOREIGN KEY ("set_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Who a payer pays for, read on the payer's page and by the morning's messages.
CREATE INDEX "gym_member_payers_payer_idx" ON "gym_member_payers" USING btree ("gym_id","payer_entry_id");--> statement-breakpoint
-- Who paid, as that record was named the moment the payment was recorded: a receipt and
-- the download say it after the link or the name changes. NULL where the person paid for
-- themselves; '' for a payer whose record has no name. `paid_by_entry_id` is that record
-- while it is on the gym's list, moved by a join of two records; a record deleted for good
-- blanks the name first (`deleteEntry`) and is then let go, and `paid_by_deleted` says a
-- deleted member paid, as a payment's own person deleted reads (`0116`).
ALTER TABLE "gym_member_payments" ADD COLUMN "paid_by_name" text;--> statement-breakpoint
ALTER TABLE "gym_member_payments" ADD COLUMN "paid_by_entry_id" uuid;--> statement-breakpoint
ALTER TABLE "gym_member_payments" ADD COLUMN "paid_by_deleted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "gym_member_payments" ADD CONSTRAINT "gym_member_payments_paid_by_fk" FOREIGN KEY ("gym_id","paid_by_entry_id") REFERENCES "public"."gym_member_list_entries"("gym_id","id") ON DELETE SET NULL ("paid_by_entry_id");--> statement-breakpoint
ALTER TABLE "gym_member_payments" ADD CONSTRAINT "gym_member_payments_paid_by_name_check" CHECK ("paid_by_name" IS NULL OR char_length("paid_by_name") <= 120);--> statement-breakpoint
ALTER TABLE "gym_member_payments" ADD CONSTRAINT "gym_member_payments_paid_by_check" CHECK (NOT "paid_by_deleted" OR ("paid_by_name" IS NULL AND "paid_by_entry_id" IS NULL));--> statement-breakpoint
-- A record deleted for good finds the payments it made.
CREATE INDEX "gym_member_payments_paid_by_idx" ON "gym_member_payments" USING btree ("gym_id","paid_by_entry_id") WHERE "paid_by_entry_id" IS NOT NULL;
