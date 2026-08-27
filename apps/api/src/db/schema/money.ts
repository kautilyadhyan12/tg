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
    trialDays: smallint("trial_days").notNull().default(0), // 7 for org self-serve (Part 3 §4.0)
    rank: smallint("rank").notNull(), // resolver precedence: free=0, pro=10, org member_entitlements=10
    entitlements: jsonb("entitlements").notNull(), // what the SUBSCRIBER gets
    memberEntitlements: jsonb("member_entitlements"), // org plans: what each MEMBER gets (Pro-level per v1 §9.2)
    active: boolean("active").notNull().default(true),
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
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    provider: text("provider").notNull(),
    providerRef: text("provider_ref"),
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
      sql`${t.provider} IN ('none','pilot','razorpay','stripe','revenuecat')`,
    ),
    // Exactly one live sub per owner — double-charging is unrepresentable.
    uniqueIndex("subs_one_live_uq")
      .on(t.ownerType, t.ownerId)
      .where(sql`${t.status} IN ('trialing','active','past_due')`),
    index("subscriptions_status_period_idx").on(t.status, t.currentPeriodEnd), // dunning & expiry sweeps
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
  },
  (t) => [
    check("webhook_events_status_check", sql`${t.status} IN ('pending','done','failed')`),
    unique("webhook_events_provider_event_uq").on(t.provider, t.eventId), // the dedupe that makes v1 §10's enqueue-then-ack safe
  ],
);
