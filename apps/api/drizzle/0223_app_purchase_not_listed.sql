-- Buy in the app for a member not on the gym's list yet (ROADMAP Stage 2 item 18k-iii-b; Kd, 2026-11-07). Forward-only.
-- Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- A member with no record of their own is put on the list by what they buy, once Square may have taken their money, so
-- while their payment page is open it names no record. One such page is open for an account at a time, as one is for a
-- record (`gym_app_payments_purchase_uq`).
CREATE UNIQUE INDEX "gym_app_payments_purchase_account_uq" ON "gym_app_payments" USING btree ("gym_id","opened_by") WHERE "state" = 'open' AND "membership_type_id" IS NOT NULL AND "entry_id" IS NULL;
