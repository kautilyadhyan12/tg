// Part 4 §3.1 — Identity & auth. Mirrors the DDL 1:1.
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  inet,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { citext, createdAt } from "./common.js";

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    email: citext("email").unique(), // null allowed: OAuth-only accounts
    passwordHash: text("password_hash"),
    hashAlgo: text("hash_algo"),
    displayName: text("display_name").notNull(), // leaderboard identity; profanity-filtered at write
    leaderboardOptOut: boolean("leaderboard_opt_out").notNull().default(false), // Part 3 §4.4
    locale: text("locale").notNull().default("en"),
    units: text("units").notNull().default("metric"),
    timezone: text("timezone"), // recaps only; quotas stay UTC (v1)
    weightKg: numeric("weight_kg", { precision: 5, scale: 2 }), // calorie lever (2B §2.3); history in body_measurements
    status: text("status").notNull().default("active"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    legacyMongoId: text("legacy_mongo_id").unique(), // migration traceability (§7); drop after 6 months
    lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    check("users_hash_algo_check", sql`${t.hashAlgo} IN ('bcrypt','argon2id')`),
    check("users_status_check", sql`${t.status} IN ('active','deleted')`),
  ],
);

export const authIdentities = pgTable(
  "auth_identities", // Google today; providers later
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    subject: text("subject").notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique("auth_identities_provider_subject_uq").on(t.provider, t.subject)],
);

// P2.1 GAP-3 (DECISIONS 2026-07-11): storage for hashed one-time tokens
// (email verification, password reset — R3.7: stored as SHA-256, raw token
// only ever in the email link). Part 4 §3.1 had no columns for these; the
// old Mongo User model did. Approved migration 0003.
export const oneTimeTokens = pgTable(
  "one_time_tokens",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    purpose: text("purpose").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    check("one_time_tokens_purpose_check", sql`${t.purpose} IN ('verify_email','password_reset')`),
    index("one_time_tokens_user_purpose_idx").on(t.userId, t.purpose),
  ],
);

export const refreshTokens = pgTable(
  "refresh_tokens", // rotation + reuse detection (v1 §6.1)
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    familyId: uuid("family_id").notNull(), // a login session; reuse of a revoked member kills the family
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    replacedBy: uuid("replaced_by"),
    ip: inet("ip"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
  },
  (t) => [index("refresh_tokens_user_family_idx").on(t.userId, t.familyId)],
);
