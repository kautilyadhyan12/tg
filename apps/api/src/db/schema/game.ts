// Part 4 §3.8 — Gamification. Mirrors the DDL 1:1.
import { sql } from "drizzle-orm";
import {
  check,
  date,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt } from "./common.js";
import { gyms } from "./tenancy.js";
import { users } from "./identity.js";

export const streaks = pgTable("streaks", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  current: integer("current").notNull().default(0),
  longest: integer("longest").notNull().default(0),
  lastActivityDate: date("last_activity_date"),
  freezesAvailable: smallint("freezes_available").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(),
});

export const achievements = pgTable("achievements", {
  // seeded from badges.py port
  code: text("code").primaryKey(),
  nameKey: text("name_key").notNull(),
  criteria: jsonb("criteria").notNull(),
  icon: text("icon"),
  createdAt: createdAt(),
});

export const userAchievements = pgTable(
  "user_achievements",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    code: text("code")
      .notNull()
      .references(() => achievements.code),
    earnedAt: timestamp("earned_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.code] })],
);

export const challenges = pgTable(
  "challenges", // v1.1 (Part 3 §2.3); tables now, screens later
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    scope: text("scope").notNull(),
    gymId: uuid("gym_id").references(() => gyms.id),
    templateCode: text("template_code").notNull(),
    startsOn: date("starts_on").notNull(),
    endsOn: date("ends_on").notNull(),
    config: jsonb("config").notNull().default(sql`'{}'`),
    status: text("status").notNull().default("active"),
    createdAt: createdAt(),
  },
  (t) => [
    check("challenges_scope_check", sql`${t.scope} IN ('user','org','global')`),
    check("challenges_status_check", sql`${t.status} IN ('active','ended','canceled')`),
  ],
);

export const challengeParticipants = pgTable(
  "challenge_participants",
  {
    challengeId: uuid("challenge_id")
      .notNull()
      .references(() => challenges.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    progress: jsonb("progress").notNull().default(sql`'{}'`),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.challengeId, t.userId] })],
);

export const leaderboardSnapshots = pgTable(
  "leaderboard_snapshots", // weekly persistence of Redis ZSETs (v1 §7.2); Redis stays rebuildable
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    gymId: uuid("gym_id").references(() => gyms.id), // null = global board
    board: text("board").notNull(),
    period: text("period").notNull(), // '2026-07'
    entries: jsonb("entries").notNull(), // [{user_id, display_name, value, rank}] — display_name scrubbed on account deletion (§5.2)
    createdAt: createdAt(),
  },
  (t) => [unique("leaderboard_snapshots_gym_board_period_uq").on(t.gymId, t.board, t.period)],
);
