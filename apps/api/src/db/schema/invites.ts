// Member invitations (Part 3 §9.12; ROADMAP 3b-i-a). Mirrors `0038_member_invites.sql`.
//
// No row here holds a user id, and none holds an address for longer than it takes to
// send the email: an invitation and a suppression are keyed by an HMAC of the
// lower-cased address, and a send's `email` is cleared when it finishes (a CHECK).
import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { citext, createdAt } from "./common.js";
import { gyms } from "./tenancy.js";

/** One row per address a gym has invited, ever. */
export const gymInvites = pgTable(
  "gym_invites",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    emailHmac: text("email_hmac").notNull(),
    state: text("state").notNull().default("pending"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("gym_invites_address_uq").on(t.gymId, t.emailHmac),
    check("gym_invites_email_hmac_check", sql`${t.emailHmac} ~ '^[0-9a-f]{64}$'`),
    check("gym_invites_state_check", sql`${t.state} IN ('pending','accepted','declined','withdrawn')`),
  ],
);

/** Each invitation email: queued by a press, sent (or skipped) by the worker. */
export const gymInviteSends = pgTable(
  "gym_invite_sends",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    inviteId: uuid("invite_id")
      .notNull()
      .references(() => gymInvites.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
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
    /** What Resend reported about an email that went, once Resend's record agreed. */
    result: text("result"),
    resultAt: timestamp("result_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("gym_invite_sends_first_uq")
      .on(t.inviteId)
      .where(sql`${t.kind} = 'first' AND (${t.state} IN ('queued','sending','sent') OR ${t.reason} = 'send_unknown')`),
    index("gym_invite_sends_due_idx").on(t.notBefore, t.createdAt, t.id).where(sql`${t.state} IN ('queued','sending')`),
    index("gym_invite_sends_retry_idx")
      .on(t.notBefore, t.id)
      .where(sql`${t.state} IN ('queued','sending') AND ${t.maybeSentAt} IS NOT NULL`),
    index("gym_invite_sends_gym_sent_idx").on(t.gymId, t.finishedAt).where(sql`${t.state} = 'sent'`),
    index("gym_invite_sends_sent_idx").on(t.finishedAt).where(sql`${t.state} = 'sent'`),
    index("gym_invite_sends_invite_idx").on(t.inviteId, t.createdAt.desc()),
    index("gym_invite_sends_gym_again_idx").on(t.gymId, t.createdAt).where(sql`${t.kind} = 'again'`),
    check("gym_invite_sends_kind_check", sql`${t.kind} IN ('first','again')`),
    check("gym_invite_sends_state_check", sql`${t.state} IN ('queued','sending','sent','skipped','failed')`),
    check("gym_invite_sends_email_check", sql`${t.state} IN ('queued','sending') OR ${t.email} IS NULL`),
    check("gym_invite_sends_email_length_check", sql`${t.email} IS NULL OR length(${t.email}) <= 254`),
    check("gym_invite_sends_lease_check", sql`(${t.state} = 'sending') = (${t.leaseUntil} IS NOT NULL)`),
    check("gym_invite_sends_finished_check", sql`(${t.state} IN ('sent','skipped','failed')) = (${t.finishedAt} IS NOT NULL)`),
    check("gym_invite_sends_reason_check", sql`(${t.state} IN ('skipped','failed')) = (${t.reason} IS NOT NULL)`),
    check("gym_invite_sends_reason_shape_check", sql`${t.reason} IS NULL OR ${t.reason} ~ '^[a-z_]{1,40}$'`),
    check(
      "gym_invite_sends_provider_check",
      sql`${t.providerId} IS NULL OR (${t.state} = 'sent' AND length(${t.providerId}) <= 100)`,
    ),
    check("gym_invite_sends_attempts_check", sql`${t.attempts} >= 0`),
    index("gym_invite_sends_provider_idx").on(t.providerId).where(sql`${t.providerId} IS NOT NULL`),
    check("gym_invite_sends_result_check", sql`${t.result} IS NULL OR ${t.result} IN ('delivered','bounced','complained','failed','refused')`),
    check("gym_invite_sends_result_state_check", sql`${t.result} IS NULL OR ${t.state} = 'sent'`),
    check("gym_invite_sends_result_at_check", sql`(${t.result} IS NULL) = (${t.resultAt} IS NULL)`),
  ],
);

/** Addresses no invitation may go to: for one gym (an unsubscribe, a complaint) or,
 *  with no gym, for every gym (a hard bounce, or an address Resend refuses). */
export const emailSuppressions = pgTable(
  "email_suppressions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    emailHmac: text("email_hmac").notNull(),
    gymId: uuid("gym_id").references(() => gyms.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("email_suppressions_gym_uq").on(t.emailHmac, t.gymId).where(sql`${t.gymId} IS NOT NULL`),
    uniqueIndex("email_suppressions_every_gym_uq").on(t.emailHmac).where(sql`${t.gymId} IS NULL`),
    check("email_suppressions_email_hmac_check", sql`${t.emailHmac} ~ '^[0-9a-f]{64}$'`),
    check("email_suppressions_reason_check", sql`${t.reason} IN ('unsubscribed','complained','bounced','refused')`),
    check("email_suppressions_scope_check", sql`(${t.gymId} IS NULL) = (${t.reason} IN ('bounced','refused'))`),
  ],
);
