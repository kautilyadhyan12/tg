// Part 4 §3.1 — Identity & auth. Mirrors the DDL 1:1.
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  inet,
  integer,
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
    check("one_time_tokens_purpose_check", sql`${t.purpose} IN ('verify_email','password_reset','restore_account')`),
    index("one_time_tokens_user_purpose_idx").on(t.userId, t.purpose),
  ],
);

// Sign-in by 6-digit email code (Kd 2026-09-07; migration 0023). Keyed on the
// ADDRESS, not a user: the account is created when the code is proved. The
// stored value is an HMAC under a server secret, never the code. Rows are
// pruned two days after creation on every send — see the migration.
export const signInCodes = pgTable(
  "sign_in_codes",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    email: citext("email").notNull(),
    purpose: text("purpose").notNull(),
    codeHash: text("code_hash").notNull(),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    check("sign_in_codes_purpose_check", sql`${t.purpose} IN ('sign_in','delete_account')`),
    check("sign_in_codes_attempts_check", sql`${t.attempts} >= 0`),
    index("sign_in_codes_email_purpose_created_idx").on(t.email, t.purpose, t.createdAt.desc()),
    index("sign_in_codes_created_idx").on(t.createdAt),
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

// onboarding-storage card (DECISIONS 2026-07-15): the onboarding/fitness
// profile. v1 §6.1:442 assigns "onboarding data" to the `users` module but
// Part 4 defines NO storage for it, so the P2.7 migration DROPped these Mongo
// fields (tools/migrate-mongo/INVENTORY.md:45) and Part 2B §4.1:358's scorer
// (goal 40 · difficulty 20 · equipment 20 · duration 10) has nothing to read.
// This table is that storage. Kd-approved shape; every value set is PORTED
// verbatim from the salvage source (backend-auth/src/models/User.js:44-98) —
// none re-derived (R0.2).
//
// 1:1 with users (user_id is the PK, not a surrogate id). ON DELETE CASCADE is
// FLAGGED per Part 4 §1's deletion policy: a fitness profile is meaningless
// without its user. NOTE it is defense-in-depth ONLY, never the DPDP mechanism:
// §5.2 ANONYMIZES the users row to a tombstone rather than deleting it, so this
// cascade never fires on account deletion. This table MUST be added to the
// §5.2 Day-14 explicit DELETE list and to the JSON-export list — both owned by
// the queued Day-14/export worker card (DECISIONS 2026-07-11). It holds
// medical_conditions (health data, sensitive under DPDP).
//
// Units are normalized to metric at the boundary, matching users.weight_kg
// (Part 4 §3.1) and the INVENTORY.md:45 XFORM convention; users.units drives
// display. Weight lives on users.weight_kg and is NOT duplicated here.
export const userFitnessProfiles = pgTable(
  "user_fitness_profiles",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    age: integer("age"),
    gender: text("gender"),
    heightCm: numeric("height_cm", { precision: 5, scale: 2 }),
    targetWeightKg: numeric("target_weight_kg", { precision: 5, scale: 2 }),
    fitnessLevel: text("fitness_level"), // NULL until answered — unanswered is not 'beginner' (Kd-approved)
    fitnessGoals: text("fitness_goals").array(), // value set enforced in Zod, per the catalog.ts equipment/muscles precedent
    exerciseFrequency: integer("exercise_frequency"), // days per week
    availableEquipment: text("available_equipment").array(), // value set enforced in Zod
    sessionDurationMin: integer("session_duration_min"), // minutes
    preferredWorkoutTime: text("preferred_workout_time"),
    medicalConditions: text("medical_conditions"), // health data — see the DPDP note above
    onboardingCompleted: boolean("onboarding_completed").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    // Part 4 §1: enums are text + CHECK, never PG enums. NULL passes each CHECK
    // (IN yields NULL, not false) — deliberate: the wizard may be partial.
    check("user_fitness_profiles_gender_check", sql`${t.gender} IN ('male','female','other','prefer_not_to_say')`),
    check("user_fitness_profiles_fitness_level_check", sql`${t.fitnessLevel} IN ('beginner','intermediate','advanced')`),
    check(
      "user_fitness_profiles_preferred_workout_time_check",
      sql`${t.preferredWorkoutTime} IN ('morning','afternoon','evening')`,
    ),
  ],
);
