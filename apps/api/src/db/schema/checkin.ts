// A gym's front-desk check-in devices (spec Part 3 §12.3; ROADMAP 16a). Mirrors
// `0063_checkin_desk.sql`.
//
// Staff add a device and get a one-time link; opening it on the tablet gives that
// browser a key that can do one thing, check people in at this gym. Both the link's
// token and the key are random and kept only as SHA-256 hashes.
import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt } from "./common.js";
import { users } from "./identity.js";
import { gyms } from "./tenancy.js";

export const gymCheckinDevices = pgTable(
  "gym_checkin_devices",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** The key the device's browser holds, hashed; null until its link is opened. */
    keyHash: text("key_hash"),
    /** The one-time link's token, hashed; null once opened, run out or replaced. */
    linkHash: text("link_hash"),
    linkExpiresAt: timestamp("link_expires_at", { withTimezone: true }),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    switchedOffAt: timestamp("switched_off_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("gym_checkin_devices_gym_id_uq").on(t.gymId, t.id),
    uniqueIndex("gym_checkin_devices_key_hash_uq").on(t.keyHash).where(sql`${t.keyHash} IS NOT NULL`),
    uniqueIndex("gym_checkin_devices_link_hash_uq").on(t.linkHash).where(sql`${t.linkHash} IS NOT NULL`),
    index("gym_checkin_devices_gym_idx").on(t.gymId, t.createdAt),
    check("gym_checkin_devices_name_check", sql`char_length(${t.name}) BETWEEN 1 AND 60`),
    check("gym_checkin_devices_key_hash_check", sql`${t.keyHash} IS NULL OR ${t.keyHash} ~ '^[0-9a-f]{64}$'`),
    check("gym_checkin_devices_link_hash_check", sql`${t.linkHash} IS NULL OR ${t.linkHash} ~ '^[0-9a-f]{64}$'`),
    check("gym_checkin_devices_link_pairing_check", sql`(${t.linkHash} IS NULL) = (${t.linkExpiresAt} IS NULL)`),
    check(
      "gym_checkin_devices_off_check",
      sql`${t.switchedOffAt} IS NULL OR (${t.keyHash} IS NULL AND ${t.linkHash} IS NULL)`,
    ),
  ],
);
