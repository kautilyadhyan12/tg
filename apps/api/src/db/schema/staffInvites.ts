// Staff invited by email (Part 3 §10.3; ROADMAP 4a-i). Mirrors `0058_staff_invites.sql`.
//
// The address is kept readable: the owner must see whom they invited. It is the gym's
// record, so the table is on `USER_LINKED_NOT_PURGED_TABLES` (who sent it, who answered
// it) and a closed gym's invitations are deleted with its list (`archiveSweep.ts`).
import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { citext } from "./common.js";
import { users } from "./identity.js";
import { gyms } from "./tenancy.js";

/** One row an invitation. Open: `pending` or `declined`, not cleared. */
export const gymStaffInvites = pgTable(
  "gym_staff_invites",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    email: citext("email").notNull(),
    role: text("role").notNull(),
    invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    state: text("state").notNull().default("pending"),
    /** When it was accepted, declined or cancelled, and by whom. */
    answeredAt: timestamp("answered_at", { withTimezone: true }),
    answeredBy: uuid("answered_by").references(() => users.id, { onDelete: "set null" }),
    /** An ended or declined invitation the owner took off the list, or a newer
     *  invitation to the same address replaced. */
    clearedAt: timestamp("cleared_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("gym_staff_invites_open_uq")
      .on(t.gymId, t.email)
      .where(sql`${t.state} IN ('pending','declined') AND ${t.clearedAt} IS NULL`),
    index("gym_staff_invites_email_idx").on(t.email).where(sql`${t.state} IN ('pending','declined') AND ${t.clearedAt} IS NULL`),
    index("gym_staff_invites_gym_idx").on(t.gymId, t.createdAt),
    check("gym_staff_invites_role_check", sql`${t.role} IN ('manager','trainer')`),
    check("gym_staff_invites_state_check", sql`${t.state} IN ('pending','accepted','declined','cancelled')`),
    check("gym_staff_invites_answered_check", sql`(${t.state} = 'pending') = (${t.answeredAt} IS NULL)`),
    check("gym_staff_invites_cleared_check", sql`${t.clearedAt} IS NULL OR ${t.state} IN ('pending','declined')`),
    check("gym_staff_invites_expires_check", sql`${t.expiresAt} > ${t.createdAt}`),
    check("gym_staff_invites_email_length_check", sql`length(${t.email}) BETWEEN 3 AND 254`),
  ],
);

/** Each staff invitation email: queued with the invitation, sent (or skipped) by the
 *  worker. The address is held only until the email is finished. */
export const gymStaffInviteSends = pgTable(
  "gym_staff_invite_sends",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    inviteId: uuid("invite_id")
      .notNull()
      .references(() => gymStaffInvites.id, { onDelete: "cascade" }),
    email: citext("email"),
    state: text("state").notNull().default("queued"),
    reason: text("reason"),
    attempts: integer("attempts").notNull().default(0),
    notBefore: timestamp("not_before", { withTimezone: true }).notNull(),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    /** When an attempt was first handed to Resend without a clear answer. */
    maybeSentAt: timestamp("maybe_sent_at", { withTimezone: true }),
    providerId: text("provider_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    index("gym_staff_invite_sends_due_idx").on(t.notBefore, t.createdAt, t.id).where(sql`${t.state} IN ('queued','sending')`),
    index("gym_staff_invite_sends_gym_idx").on(t.gymId, t.createdAt),
    index("gym_staff_invite_sends_invite_idx").on(t.inviteId, t.createdAt.desc()),
    index("gym_staff_invite_sends_sent_idx").on(t.finishedAt).where(sql`${t.state} = 'sent'`),
    check("gym_staff_invite_sends_state_check", sql`${t.state} IN ('queued','sending','sent','skipped','failed')`),
    check("gym_staff_invite_sends_email_check", sql`${t.state} IN ('queued','sending') OR ${t.email} IS NULL`),
    check("gym_staff_invite_sends_email_length_check", sql`${t.email} IS NULL OR length(${t.email}) <= 254`),
    check("gym_staff_invite_sends_lease_check", sql`(${t.state} = 'sending') = (${t.leaseUntil} IS NOT NULL)`),
    check("gym_staff_invite_sends_finished_check", sql`(${t.state} IN ('sent','skipped','failed')) = (${t.finishedAt} IS NOT NULL)`),
    check("gym_staff_invite_sends_reason_check", sql`(${t.state} IN ('skipped','failed')) = (${t.reason} IS NOT NULL)`),
    check("gym_staff_invite_sends_reason_shape_check", sql`${t.reason} IS NULL OR ${t.reason} ~ '^[a-z_]{1,40}$'`),
    check("gym_staff_invite_sends_provider_check", sql`${t.providerId} IS NULL OR (${t.state} = 'sent' AND length(${t.providerId}) <= 100)`),
    check("gym_staff_invite_sends_attempts_check", sql`${t.attempts} >= 0`),
  ],
);
