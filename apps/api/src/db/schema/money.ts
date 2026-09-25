// Part 4 §3.3 — Plans, subscriptions, billing. Mirrors the DDL 1:1.
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt } from "./common.js";

export const plans = pgTable(
  "plans",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    code: text("code").unique().notNull(),
    audience: text("audience").notNull(),
    orgTypes: text("org_types").array(), // null = all org types (org plans only)
    nameKey: text("name_key").notNull(),
    priceMinor: integer("price_minor").notNull(),
    currency: text("currency").notNull(),
    interval: text("interval").notNull(),
    seatCap: integer("seat_cap"), // org plans; complimentary members excluded from the count
    trialDays: smallint("trial_days").notNull().default(0), // a gym plan: GYM_TRIAL_DAYS (10); 0 for an individual
    rank: smallint("rank").notNull(), // resolver precedence: free=0, pro=10, org member_entitlements=10
    entitlements: jsonb("entitlements").notNull(), // what the SUBSCRIBER gets
    memberEntitlements: jsonb("member_entitlements"), // org plans: what each MEMBER gets (Pro-level per v1 §9.2)
    active: boolean("active").notNull().default(true),
    /** The Paddle price this plan is sold at (`pri_…`), per environment (`tools/paddle-prices.ts`). */
    paddlePriceId: text("paddle_price_id").unique("plans_paddle_price_id_uq"),
    createdAt: createdAt(),
  },
  (t) => [
    check("plans_audience_check", sql`${t.audience} IN ('consumer','org')`),
    check("plans_interval_check", sql`${t.interval} IN ('month','year')`),
  ],
);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    ownerType: text("owner_type").notNull(),
    ownerId: uuid("owner_id").notNull(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id),
    status: text("status").notNull(),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
    /** WHEN THIS SUBSCRIPTION STOPPED BEING LIVE — the moment the row left
     *  §4.1's granting set, written by whatever moved it (`trialSweep.ts` today;
     *  dunning and cancellation when Part 5 §8 lands).
     *
     *  **IT EXISTS BECAUSE THE PRODUCT WAS THROWING THAT MOMENT AWAY, and one
     *  thing needs it: Kd's ruling of 2026-08-31 that a gym is ARCHIVED four
     *  months after its plan ends.** A clock has to start somewhere and every
     *  date already on this row answers a different question. `trial_ends_at` is
     *  when a trial was DUE to end — the nightly job acts on it up to 24 hours
     *  later, and nothing ever clears it, so a gym that converts to paying and
     *  lapses a year later still carries a date from its trial. An archive clock
     *  keyed on it would close that gym the same night it stopped paying, which
     *  is `gymHasLivePlan`'s recorded warning (:21580 rule (c)) arriving in a
     *  different reader.
     *
     *  **NULLABLE, AND NOT BACKFILLED (R4.4 expand-then-contract).** Nothing
     *  honest can be written onto the rows that expired before this column
     *  existed: the only record of when they moved is an `audit_log` row, and
     *  an ops table is not a place product behaviour should read from. A NULL
     *  here means "we do not know when this ended", and the archive sweep's
     *  comparison filters it out by itself — so those gyms keep their console
     *  until somebody acts, which is the safe direction.
     *
     *  It is NOT `status`'s twin and must not be read as one: a row can be
     *  `expired` with a NULL here (pre-migration), and the STATUS is what every
     *  live/not-live decision asks (:23711 §2(b)). This answers only "when". */
    endedAt: timestamp("ended_at", { withTimezone: true }),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    provider: text("provider").notNull(),
    providerRef: text("provider_ref"),
    /** The provider's own `updated_at` for the record this row was last written from
     *  (migration `0041`): an older answer never overwrites a newer one. */
    providerUpdatedAt: timestamp("provider_updated_at", { withTimezone: true }),
    /** The provider's customer id (Paddle `ctm_…`). */
    providerCustomerRef: text("provider_customer_ref"),
    /** When this row last became past_due (migration `0043`); the worker ends the
     *  grace `PAID_PLAN_GRACE_DAYS` after it. Kept on the row the grace expired. */
    pastDueSince: timestamp("past_due_since", { withTimezone: true }),
    /** A trial the gym paid for keeps its free trial's member limit until the first
     *  payment (migration `0044`); null on every other row. */
    trialSeatCap: integer("trial_seat_cap"),
    /** A smaller size the gym chose (migration `0045`): its limit holds for new joins at
     *  once, and Paddle bills it from `pendingFrom`, the end of the month already paid. */
    pendingPlanId: uuid("pending_plan_id").references(() => plans.id),
    pendingFrom: timestamp("pending_from", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
    createdAt: createdAt(),
  },
  (t) => [
    check("subscriptions_owner_type_check", sql`${t.ownerType} IN ('user','gym')`),
    check(
      "subscriptions_status_check",
      sql`${t.status} IN ('trialing','active','past_due','canceled','expired')`,
    ),
    // `none` = card-less trial, nobody is charging this owner (Part 5 §6.1, and
    // the value list is §0 addendum A's verbatim). Widened by `0015`; the rest
    // of that addendum belongs to the billing card that reads it.
    check(
      "subscriptions_provider_check",
      sql`${t.provider} IN ('none','pilot','razorpay','stripe','revenuecat','paddle')`,
    ),
    uniqueIndex("subscriptions_provider_ref_uq")
      .on(t.provider, t.providerRef)
      .where(sql`${t.providerRef} IS NOT NULL`),
    // Exactly one live sub per owner — double-charging is unrepresentable.
    uniqueIndex("subs_one_live_uq")
      .on(t.ownerType, t.ownerId)
      .where(sql`${t.status} IN ('trialing','active','past_due')`),
    index("subscriptions_status_period_idx").on(t.status, t.currentPeriodEnd), // dunning & expiry sweeps
    check(
      "subscriptions_past_due_since_check",
      sql`${t.pastDueSince} IS NULL OR ${t.status} IN ('past_due','expired')`,
    ),
    check("subscriptions_trial_seat_cap_check", sql`${t.trialSeatCap} IS NULL OR ${t.trialSeatCap} > 0`),
    index("subscriptions_grace_idx").on(t.pastDueSince).where(sql`${t.status} = 'past_due'`),
    check("subscriptions_pending_plan_check", sql`(${t.pendingPlanId} IS NULL) = (${t.pendingFrom} IS NULL)`),
    index("subscriptions_pending_plan_idx").on(t.pendingFrom).where(sql`${t.pendingPlanId} IS NOT NULL`),
  ],
);

export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => subscriptions.id),
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull(),
    status: text("status").notNull(),
    providerRef: text("provider_ref").unique(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
    pdfKey: text("pdf_key"),
    createdAt: createdAt(),
  },
  (t) => [
    check("invoices_status_check", sql`${t.status} IN ('paid','failed','refunded','void')`),
  ],
);

export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    provider: text("provider").notNull(),
    eventId: text("event_id").notNull(),
    payload: jsonb("payload").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    status: text("status").notNull().default("pending"),
    createdAt: createdAt(),
    /** The claim's number, the tries at confirming the event, and when the next may be
     *  made (migration `0039`). */
    attempts: integer("attempts").notNull().default(0),
    tries: integer("tries").notNull().default(0),
    notBefore: timestamp("not_before", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("webhook_events_status_check", sql`${t.status} IN ('pending','done','failed')`),
    check("webhook_events_attempts_check", sql`${t.attempts} >= 0`),
    check("webhook_events_tries_check", sql`${t.tries} >= 0`),
    index("webhook_events_due_idx").on(t.provider, t.notBefore).where(sql`${t.status} = 'pending'`),
    index("webhook_events_processed_idx").on(t.processedAt).where(sql`${t.status} <> 'pending'`),
    unique("webhook_events_provider_event_uq").on(t.provider, t.eventId), // the dedupe that makes v1 §10's enqueue-then-ack safe
  ],
);
