// A gym paying us (ROADMAP Stage 3 item 1a). Mirrors `0041_paddle_billing.sql`.
import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { createdAt } from "./common.js";
import { users } from "./identity.js";
import { plans } from "./money.js";
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