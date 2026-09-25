// A gym paying us (ROADMAP Stage 3 items 1a, 1c-ii and 1c-iii). Mirrors `0041_paddle_billing.sql`,
// `0044_paddle_plan_changes.sql` and `0045_paddle_smaller_size.sql`.
import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt } from "./common.js";
import { users } from "./identity.js";
import { plans, subscriptions } from "./money.js";
import { gyms } from "./tenancy.js";

/** Every checkout our server asked the payment company for. A paid subscription is
 *  placed on the gym named HERE, never on what the payment says about itself. */
export const billingCheckouts = pgTable(
  "billing_checkouts",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    idempotencyKey: text("idempotency_key").notNull(),
    provider: text("provider").notNull(),
    /** Paddle's transaction id (`txn_…`), once Paddle has made it. */
    providerRef: text("provider_ref"),
    state: text("state").notNull().default("creating"),
    /** A trial checkout's gym's own trial end (`0044`): after it, the checkout is cancelled. */
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("billing_checkouts_provider_check", sql`${t.provider} IN ('paddle')`),
    check(
      "billing_checkouts_state_check",
      sql`${t.state} IN ('creating','open','superseded','failed','paid')`,
    ),
    check("billing_checkouts_key_check", sql`length(${t.idempotencyKey}) BETWEEN 1 AND 100`),
    check(
      "billing_checkouts_ref_check",
      sql`${t.state} IN ('creating','failed','superseded') OR ${t.providerRef} IS NOT NULL`,
    ),
    unique("billing_checkouts_gym_key_uq").on(t.gymId, t.idempotencyKey),
    unique("billing_checkouts_provider_ref_uq").on(t.provider, t.providerRef),
    index("billing_checkouts_gym_open_idx")
      .on(t.gymId)
      .where(sql`${t.state} IN ('creating','open')`),
    index("billing_checkouts_trial_open_idx")
      .on(t.trialEndsAt)
      .where(sql`${t.state} = 'open' AND ${t.trialEndsAt} IS NOT NULL`),
  ],
);

/** A refund we owe for a subscription set aside (`service.ts`), one per Paddle
 *  transaction, retried by the worker until Paddle holds a refund for it. */
export const billingRefunds = pgTable(
  "billing_refunds",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    /** Null for a subscription no checkout of ours made. */
    gymId: uuid("gym_id").references(() => gyms.id),
    provider: text("provider").notNull(),
    subscriptionRef: text("subscription_ref").notNull(),
    transactionRef: text("transaction_ref").notNull(),
    reason: text("reason").notNull(),
    state: text("state").notNull().default("owed"),
    tries: integer("tries").notNull().default(0),
    notBefore: timestamp("not_before", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("billing_refunds_provider_check", sql`${t.provider} IN ('paddle')`),
    check("billing_refunds_reason_check", sql`${t.reason} IN ('duplicate','unmatched')`),
    check("billing_refunds_state_check", sql`${t.state} IN ('owed','requested','not_needed','failed')`),
    check("billing_refunds_tries_check", sql`${t.tries} >= 0`),
    check("billing_refunds_gym_check", sql`(${t.reason} = 'unmatched') = (${t.gymId} IS NULL)`),
    unique("billing_refunds_transaction_uq").on(t.provider, t.transactionRef),
    index("billing_refunds_due_idx").on(t.notBefore).where(sql`${t.state} = 'owed'`),
  ],
);
/** A size change a gym's billing staff asked for (ROADMAP Stage 3 item 1c-ii): at most one
 *  pending per gym, so two presses cannot both ask Paddle to charge. */
export const billingPlanChanges = pgTable(
  "billing_plan_changes",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => subscriptions.id),
    fromPlanId: uuid("from_plan_id")
      .notNull()
      .references(() => plans.id),
    toPlanId: uuid("to_plan_id")
      .notNull()
      .references(() => plans.id),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    idempotencyKey: text("idempotency_key").notNull(),
    provider: text("provider").notNull(),
    state: text("state").notNull().default("pending"),
    /** Why a failed change failed: the code the console was answered with. */
    failure: text("failure"),
    /** The members counted when a smaller size waiting was decided (`0045`). */
    membersCounted: integer("members_counted"),
    /** The smaller size asked for, when a bigger one the members fit was made instead. */
    requestedPlanId: uuid("requested_plan_id").references(() => plans.id),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("billing_plan_changes_provider_check", sql`${t.provider} IN ('paddle')`),
    check("billing_plan_changes_state_check", sql`${t.state} IN ('pending','done','failed')`),
    check("billing_plan_changes_failure_check", sql`(${t.state} = 'failed') = (${t.failure} IS NOT NULL)`),
    check("billing_plan_changes_key_check", sql`length(${t.idempotencyKey}) BETWEEN 1 AND 100`),
    unique("billing_plan_changes_gym_key_uq").on(t.gymId, t.idempotencyKey),
    uniqueIndex("billing_plan_changes_one_pending_uq")
      .on(t.gymId)
      .where(sql`${t.state} = 'pending'`),
    check("billing_plan_changes_members_counted_check", sql`${t.membersCounted} IS NULL OR ${t.membersCounted} >= 0`),
    index("billing_plan_changes_subscription_idx").on(t.subscriptionId, t.createdAt),
  ],
);
