-- A gym pays through Paddle (ROADMAP Stage 3 item 1a). Forward-only. Hand-written, as
-- `0016` onwards are; its journal entry is part of this commit.
--
-- subscriptions.provider         gains 'paddle'.
-- subscriptions.provider_updated_at
--                                Paddle's own `updated_at` for the subscription this row
--                                was last written from, so an older answer from Paddle
--                                never overwrites a newer one.
-- subscriptions.provider_customer_ref
--                                Paddle's customer id (`ctm_…`), for managing the plan later.
-- subscriptions_provider_ref_uq  one row per Paddle subscription.
-- plans.paddle_price_id          the Paddle price (`pri_…`) a plan is sold at, written by
--                                `tools/paddle-prices.ts` for each environment.
-- billing_checkouts              every checkout our server asked Paddle for: which gym, which
--                                plan, who pressed it. A Paddle subscription is placed on a gym
--                                only through one of these rows, never through what the
--                                payment says about itself.

ALTER TABLE subscriptions DROP CONSTRAINT subscriptions_provider_check;--> statement-breakpoint
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_provider_check
  CHECK (provider IN ('none','pilot','razorpay','stripe','revenuecat','paddle'));--> statement-breakpoint
ALTER TABLE subscriptions ADD COLUMN provider_updated_at timestamptz;--> statement-breakpoint
ALTER TABLE subscriptions ADD COLUMN provider_customer_ref text;--> statement-breakpoint
CREATE UNIQUE INDEX subscriptions_provider_ref_uq ON subscriptions (provider, provider_ref)
  WHERE provider_ref IS NOT NULL;--> statement-breakpoint

ALTER TABLE plans ADD COLUMN paddle_price_id text;--> statement-breakpoint
ALTER TABLE plans ADD CONSTRAINT plans_paddle_price_id_uq UNIQUE (paddle_price_id);--> statement-breakpoint

CREATE TABLE billing_checkouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id uuid NOT NULL REFERENCES gyms(id),
  plan_id uuid NOT NULL REFERENCES plans(id),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  idempotency_key text NOT NULL,
  provider text NOT NULL,
  provider_ref text,
  state text NOT NULL DEFAULT 'creating',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_checkouts_provider_check CHECK (provider IN ('paddle')),
  CONSTRAINT billing_checkouts_state_check
    CHECK (state IN ('creating','open','superseded','failed','paid')),
  CONSTRAINT billing_checkouts_key_check CHECK (length(idempotency_key) BETWEEN 1 AND 100),
  CONSTRAINT billing_checkouts_ref_check CHECK (state IN ('creating','failed','superseded') OR provider_ref IS NOT NULL),
  CONSTRAINT billing_checkouts_gym_key_uq UNIQUE (gym_id, idempotency_key),
  CONSTRAINT billing_checkouts_provider_ref_uq UNIQUE (provider, provider_ref)
);--> statement-breakpoint
CREATE INDEX billing_checkouts_gym_open_idx ON billing_checkouts (gym_id)
  WHERE state IN ('creating','open');
