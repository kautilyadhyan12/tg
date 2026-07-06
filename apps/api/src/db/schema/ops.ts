// Part 4 §3.12 — Platform / ops. Mirrors the DDL 1:1.
// BRIN index on audit_log(at) added as raw SQL in the migration.
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt } from "./common.js";
import { users } from "./identity.js";

export const pushTokens = pgTable("push_tokens", {
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  token: text("token").primaryKey(),
  platform: text("platform").notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const featureFlags = pgTable("feature_flags", {
  key: text("key").primaryKey(),
  rules: jsonb("rules").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(),
});

export const auditLog = pgTable(
  "audit_log",
  {
    id: bigint("id", { mode: "bigint" }).primaryKey().generatedAlwaysAsIdentity(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    actorUserId: uuid("actor_user_id"),
    gymId: uuid("gym_id"),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    meta: jsonb("meta").notNull().default(sql`'{}'`),
  },
  (t) => [index("audit_log_gym_at_idx").on(t.gymId, t.at.desc())],
);

export const traceSamples = pgTable(
  "trace_samples", // v1 §14 anti-cheat audits; R2 90-day lifecycle
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id").notNull(),
    exerciseId: uuid("exercise_id").notNull(),
    r2Key: text("r2_key").notNull(),
    engineVersion: text("engine_version").notNull(),
    verdict: text("verdict").notNull().default("pending"),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      "trace_samples_verdict_check",
      sql`${t.verdict} IN ('pending','match','mismatch','error')`,
    ),
  ],
);
