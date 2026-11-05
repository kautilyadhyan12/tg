// The meal plans a gym gives its members (migration 0210; ROADMAP Stage 2 24a-i). A plan is the
// gym's: who wrote it and who changed it last are `ON DELETE set null`, on gym_posts' footing, so
// the table is on `USER_LINKED_NOT_PURGED_TABLES`.
import { sql } from "drizzle-orm";
import { check, foreignKey, index, jsonb, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { gymMemberListEntries, gymMemberTags } from "./memberList.js";
import { gymMembershipTypes } from "./memberships.js";
import { createdAt } from "./common.js";
import { users } from "./identity.js";
import { gyms } from "./tenancy.js";

export const gymMealPlans = pgTable(
  "gym_meal_plans",
  {
    // The browser's own id for the plan: a new plan sent twice is one plan.
    id: uuid("id").primaryKey(),
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // Seven days, Monday first; each a list of meals with their priced foods, as `diet_plans.days`.
    days: jsonb("days").notNull(),
    // The ids of the last changes made, newest first: a change sent twice is made once.
    recentChanges: uuid("recent_changes").array().notNull().default(sql`'{}'::uuid[]`),
    writtenByUserId: uuid("written_by_user_id").references(() => users.id, { onDelete: "set null" }),
    changedByUserId: uuid("changed_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("gym_meal_plans_days_check", sql`jsonb_typeof(${t.days}) = 'array' AND jsonb_array_length(${t.days}) = 7`),
    check("gym_meal_plans_name_check", sql`char_length(${t.name}) BETWEEN 1 AND 60`),
    uniqueIndex("gym_meal_plans_gym_name_uq").on(t.gymId, sql`lower(${t.name})`),
    // What an audience row's plan key points at, with its gym (0211).
    unique("gym_meal_plans_gym_id_uq").on(t.gymId, t.id),
  ],
);

// Who gets a plan (migration 0211; ROADMAP Stage 2 24a-ii): one row a group, each group one plan.
// `gymMealPlanAudienceRepo.ts` is the only file that reads or writes it.
export const gymMealPlanAudiences = pgTable(
  "gym_meal_plan_audiences",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    planId: uuid("plan_id").notNull(),
    kind: text("kind").notNull(),
    membershipTypeId: uuid("membership_type_id"),
    tagId: uuid("tag_id"),
    entryId: uuid("entry_id"),
    givenByUserId: uuid("given_by_user_id").references(() => users.id, { onDelete: "set null" }),
    givenAt: timestamp("given_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "gym_meal_plan_audiences_kind_check",
      sql`(${t.kind} = 'everyone' AND ${t.membershipTypeId} IS NULL AND ${t.tagId} IS NULL AND ${t.entryId} IS NULL)
        OR (${t.kind} = 'membership_type' AND ${t.membershipTypeId} IS NOT NULL AND ${t.tagId} IS NULL AND ${t.entryId} IS NULL)
        OR (${t.kind} = 'tag' AND ${t.tagId} IS NOT NULL AND ${t.membershipTypeId} IS NULL AND ${t.entryId} IS NULL)
        OR (${t.kind} = 'member' AND ${t.entryId} IS NOT NULL AND ${t.membershipTypeId} IS NULL AND ${t.tagId} IS NULL)`,
    ),
    foreignKey({ name: "gym_meal_plan_audiences_plan_fk", columns: [t.gymId, t.planId], foreignColumns: [gymMealPlans.gymId, gymMealPlans.id] }).onDelete("cascade"),
    foreignKey({ name: "gym_meal_plan_audiences_type_fk", columns: [t.gymId, t.membershipTypeId], foreignColumns: [gymMembershipTypes.gymId, gymMembershipTypes.id] }).onDelete("cascade"),
    foreignKey({ name: "gym_meal_plan_audiences_tag_fk", columns: [t.gymId, t.tagId], foreignColumns: [gymMemberTags.gymId, gymMemberTags.id] }).onDelete("cascade"),
    foreignKey({ name: "gym_meal_plan_audiences_entry_fk", columns: [t.gymId, t.entryId], foreignColumns: [gymMemberListEntries.gymId, gymMemberListEntries.id] }).onDelete("cascade"),
    index("gym_meal_plan_audiences_plan_idx").on(t.gymId, t.planId),
    index("gym_meal_plan_audiences_given_by_idx").on(t.givenByUserId),
    uniqueIndex("gym_meal_plan_audiences_everyone_uq").on(t.gymId).where(sql`${t.kind} = 'everyone'`),
    uniqueIndex("gym_meal_plan_audiences_type_uq").on(t.gymId, t.membershipTypeId).where(sql`${t.kind} = 'membership_type'`),
    uniqueIndex("gym_meal_plan_audiences_tag_uq").on(t.gymId, t.tagId).where(sql`${t.kind} = 'tag'`),
    uniqueIndex("gym_meal_plan_audiences_entry_uq").on(t.gymId, t.entryId).where(sql`${t.kind} = 'member'`),
  ],
);
