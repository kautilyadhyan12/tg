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
  smallint,
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
    // Body weight is NOT here: it lives only in body_measurements (RULINGS
    // 2026-09-10; the cache column was dropped by migration 0027).
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
// Units are normalized to metric at the boundary (the INVENTORY.md:45 XFORM
// convention); users.units drives display. Body weight is NOT here: it lives
// only in body_measurements (RULINGS 2026-09-10).
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
    // Onboarding v2 (migration 0026; ROADMAP 4a). The ONE main goal of screen 1
    // — the weight direction the plan maths works in is DERIVED from it
    // (@app/shared PLAN_GOAL_BY_MAIN_GOAL), never stored. The v1 `fitnessGoals`
    // array above is what Settings' goal chips show: screen 1 puts its goal
    // first, a Settings save keeps the chips' order, and neither leaves a goal
    // that moves the weight other than the main goal. Both save routes keep the
    // two in step (users/repo.ts) until 4a-iv replaces them. Training days and
    // session minutes are NOT duplicated here: they are `exerciseFrequency` and
    // `sessionDurationMin`.
    mainGoal: text("main_goal"),
    pace: text("pace"),
    dayActivity: text("day_activity"),
    // Screen 5's two checks; NULL when skipped ("I'll rate myself"). Never an
    // input to the calorie plan — the plan builder (6a) reads them.
    pushUpsMax: smallint("push_ups_max"),
    plankHoldSeconds: smallint("plank_hold_seconds"),
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
    check(
      "user_fitness_profiles_main_goal_check",
      sql`${t.mainGoal} IN ('weight_loss','muscle_gain','general_fitness','flexibility','endurance','posture','stress_relief')`,
    ),
    check("user_fitness_profiles_pace_check", sql`${t.pace} IN ('gentle','steady','brisk')`),
    check(
      "user_fitness_profiles_day_activity_check",
      sql`${t.dayActivity} IN ('sitting','on_feet','active','very_active')`,
    ),
    check("user_fitness_profiles_push_ups_max_check", sql`${t.pushUpsMax} >= 0 AND ${t.pushUpsMax} <= 500`),
    check(
      "user_fitness_profiles_plank_hold_seconds_check",
      sql`${t.plankHoldSeconds} >= 0 AND ${t.plankHoldSeconds} <= 3600`,
    ),
  ],
);

// Health screening (migration 0025; Kd 2026-09-07 / 2026-09-09). ONE general
// question, never a named condition: `has_condition` is the yes/no, and
// `check_first` the choice a yes opens. Safe mode and "no calorie cut" are
// derived in code (@app/shared `deriveHealthFlags`), never stored. Health data
// in the broad sense: on the Day-14 delete list and in the export.
export const userHealthScreenings = pgTable(
  "user_health_screenings",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    hasCondition: boolean("has_condition").notNull(),
    checkFirst: text("check_first"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    check("user_health_screenings_check_first_check", sql`${t.checkFirst} IN ('cleared','not_yet')`),
    check(
      "user_health_screenings_check_first_required",
      sql`(${t.hasCondition} AND ${t.checkFirst} IS NOT NULL) OR (NOT ${t.hasCondition} AND ${t.checkFirst} IS NULL)`,
    ),
  ],
);

// The consent log (migration 0025; RULINGS 2026-09-07): one append-only row per
// disclaimer tap, wording copied verbatim. Kept after a purge like audit_log
// (no name, address or health fact on the row); exported.
export const consentLog = pgTable(
  "consent_log",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    purpose: text("purpose").notNull(),
    wordingVersion: text("wording_version").notNull(),
    wording: text("wording").notNull(),
    appVersion: text("app_version").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("consent_log_purpose_check", sql`${t.purpose} IN ('sign_up','health_step','plan_screen')`),
    index("consent_log_user_recorded_idx").on(t.userId, t.recordedAt.desc()),
  ],
);
