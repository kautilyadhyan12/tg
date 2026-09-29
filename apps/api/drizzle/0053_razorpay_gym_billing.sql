-- An Indian gym pays through Razorpay (ROADMAP Stage 3 item 1d-i; Kd, RULINGS 2026-09-24).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this
-- commit.
--
-- plans.razorpay_plan_id         the Razorpay plan (`plan_…`) a rupee gym plan is sold at,
--                                written by `tools/razorpay-plans.ts` for each account.
-- billing_checkouts.provider     gains 'razorpay': the checkout's `provider_ref` is then the
--                                Razorpay subscription our server created for it.
-- billing_refunds.provider       gains 'razorpay': `transaction_ref` is then a payment (`pay_…`).
-- gyms.billing_mobile            an Indian gym's owner's mobile for its payments (`+91` and ten
--                                digits), given to Razorpay's window so it asks nothing (Kd,
--                                RULINGS 2026-09-29). Null outside India and where none was given.

ALTER TABLE plans ADD COLUMN razorpay_plan_id text;--> statement-breakpoint
ALTER TABLE plans ADD CONSTRAINT plans_razorpay_plan_id_uq UNIQUE (razorpay_plan_id);--> statement-breakpoint
ALTER TABLE billing_checkouts DROP CONSTRAINT billing_checkouts_provider_check;--> statement-breakpoint
ALTER TABLE billing_checkouts ADD CONSTRAINT billing_checkouts_provider_check
  CHECK (provider IN ('paddle','razorpay'));--> statement-breakpoint
ALTER TABLE billing_refunds DROP CONSTRAINT billing_refunds_provider_check;--> statement-breakpoint
ALTER TABLE billing_refunds ADD CONSTRAINT billing_refunds_provider_check
  CHECK (provider IN ('paddle','razorpay'));--> statement-breakpoint
ALTER TABLE gyms ADD COLUMN billing_mobile text;--> statement-breakpoint
ALTER TABLE gyms ADD CONSTRAINT gyms_billing_mobile_check
  CHECK (billing_mobile IS NULL OR billing_mobile ~ '^\+91[6-9][0-9]{9}$');
