// Part 4 §3.2 — Organizations & membership. Mirrors the DDL 1:1.
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt } from "./common.js";
import { users } from "./identity.js";

export const gyms = pgTable(
  "gyms", // the org table; name kept for continuity (v1 §8)
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    slug: text("slug").unique().notNull(),
    name: text("name").notNull(),
    city: text("city"),
    orgType: text("org_type").notNull().default("gym"),
    timezone: text("timezone").notNull().default("Asia/Kolkata"),
    locale: text("locale").notNull().default("en"),
    currencyDisplay: text("currency_display").notNull().default("INR"),
    logoKey: text("logo_key"), // R2 gym-assets/
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id),
    ownerIncludedAsMember: boolean("owner_included_as_member").notNull().default(true),
    activation: jsonb("activation").notNull().default(sql`'{}'`), // Part 3 §5.1 checklist state
    status: text("status").notNull().default("active"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    check("gyms_org_type_check", sql`${t.orgType} IN ('gym','studio','clinic')`),
    check("gyms_status_check", sql`${t.status} IN ('active','archived')`),
  ],
);

export const gymCodes = pgTable("gym_codes", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  gymId: uuid("gym_id")
    .notNull()
    .references(() => gyms.id, { onDelete: "cascade" }),
  code: text("code").unique().notNull(), // 6-char, ambiguity-free alphabet
  label: text("label").notNull().default("Front Desk"), // the group mechanism (Part 3 §2.1)
  maxUses: integer("max_uses"),
  uses: integer("uses").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  paused: boolean("paused").notNull().default(false),
  createdAt: createdAt(),
});

export const gymMembers = pgTable(
  "gym_members",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    codeId: uuid("code_id").references(() => gymCodes.id), // group attribution at join
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    removedAt: timestamp("removed_at", { withTimezone: true }), // membership = [joined_at, removed_at)
    consentAt: timestamp("consent_at", { withTimezone: true }), // clinic join consent (Part 3 §2.4); NOT NULL enforced in service for clinics
    hiddenFromBoards: boolean("hidden_from_boards").notNull().default(false),
    complimentary: boolean("complimentary").notNull().default(false), // owner seat (Part 3 §4.0); excluded from seat counts
    createdAt: createdAt(),
  },
  (t) => [
    // The leave/rejoin design: one LIVE membership per (gym,user); history rows stack.
    uniqueIndex("gym_members_live_uq")
      .on(t.gymId, t.userId)
      .where(sql`${t.removedAt} IS NULL`),
    index("gym_members_gym_removed_idx").on(t.gymId, t.removedAt), // roster & seat count
    index("gym_members_user_removed_idx").on(t.userId, t.removedAt), // entitlement resolver
    index("gym_members_gym_joined_idx").on(t.gymId, t.joinedAt), // interval joins (rollups)
  ],
);

export const gymStaff = pgTable(
  "gym_staff",
  {
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    role: text("role").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.gymId, t.userId] }),
    check("gym_staff_role_check", sql`${t.role} IN ('owner','manager','trainer')`),
  ],
);
