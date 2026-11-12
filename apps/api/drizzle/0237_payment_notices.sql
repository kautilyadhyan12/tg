-- Payment received, told to the phone (ROADMAP Stage 5 item 20h). Forward-only.
-- Hand-written, as `0016` onwards are; its journal entry is part of this commit. Renumbered from 0235, then 0236: feature
-- folder 2's 0235_run_heart, then 18k-iv's 0236_app_card_purchases, merged first.
--
-- A payment page Square says was paid, recorded by the worker or by staff's Close payment page rather than by the
-- member's own phone asking, owes the member who pressed Pay one notification (`push_due_at`). The member's phone
-- reading the paid page takes it off; the worker claims it (`push_claimed_at`) before sending, so a second run sends
-- nothing twice. Only a paid page can owe one.
ALTER TABLE "gym_app_payments" ADD COLUMN "push_due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "gym_app_payments" ADD COLUMN "push_claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "gym_app_payments" ADD CONSTRAINT "gym_app_payments_push_check" CHECK (("push_due_at" IS NULL OR "outcome" = 'paid') AND ("push_claimed_at" IS NULL OR "push_due_at" IS NOT NULL));--> statement-breakpoint
CREATE INDEX "gym_app_payments_push_due_idx" ON "gym_app_payments" USING btree ("push_due_at") WHERE "push_due_at" IS NOT NULL;--> statement-breakpoint
-- The person's own switch in Settings, on until they switch it off (19d's rule: one switch for each kind sent).
ALTER TABLE "users" ADD COLUMN "push_payments" boolean DEFAULT true NOT NULL;
