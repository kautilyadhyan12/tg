// Refer a friend (ROADMAP 20e-ii-a; spec Part 3 §16.3). Mirrors `0114_refer_a_friend.sql`.
//
// A business's offer (its switch and the two promo codes it gives), and each member's own
// invite link at that business. The lead a link brings keeps who sent it on `gym_leads`.
import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, pgTable, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { createdAt } from "./common.js";
import { users } from "./identity.js";
import { gymDiscounts } from "./register.js";
import { gyms } from "./tenancy.js";

export const gymReferralSettings = pgTable(
  "gym_referral_settings",
  {
    gymId: uuid("gym_id")
      .primaryKey()
      .references(() => gyms.id, { onDelete: "cascade" }),
    switchedOn: boolean("switched_on").notNull().default(false),
    /** The promo code the member who invites is given; null for none. */
    memberDiscountId: uuid("member_discount_id"),
    /** The promo code the invited friend is shown; null for none. */
    friendDiscountId: uuid("friend_discount_id"),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("gym_referral_settings_gift_check", sql`NOT ${t.switchedOn} OR ${t.memberDiscountId} IS NOT NULL OR ${t.friendDiscountId} IS NOT NULL`),
    foreignKey({
      name: "gym_referral_settings_member_discount_fk",
      columns: [t.gymId, t.memberDiscountId],
      foreignColumns: [gymDiscounts.gymId, gymDiscounts.id],
    }),
    foreignKey({
      name: "gym_referral_settings_friend_discount_fk",
      columns: [t.gymId, t.friendDiscountId],
      foreignColumns: [gymDiscounts.gymId, gymDiscounts.id],
    }),
  ],
);

export const gymReferralLinks = pgTable(
  "gym_referral_links",
  {
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** 16 of `a-z2-7`: 80 random bits. */
    code: text("code").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: "gym_referral_links_pk", columns: [t.gymId, t.userId] }),
    unique("gym_referral_links_code_uq").on(t.code),
    check("gym_referral_links_code_check", sql`${t.code} ~ '^[a-z2-7]{16}$'`),
  ],
);
