// Staff invited by email (Part 3 §10.3; ROADMAP 4a-i). Mirrors `0059_staff_invites.sql`.
//
// The address is kept readable: the owner must see whom they invited. It is the gym's
// record, so the table is on `USER_LINKED_NOT_PURGED_TABLES` (who sent it, who answered
// it) and a closed gym's invitations are deleted with its list (`archiveSweep.ts`).
import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
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
    /** The ticks the owner chose on the invite form: what Accept gives. */
    privileges: text("privileges").array().notNull(),
    /** The gym's own role it is for ("Front desk"), shown in place of the role. */
    roleName: text("role_name"),
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
    index("gym_staff_invites_created_idx").on(t.createdAt),
    // `owner` is a co-owner's invitation (4b-i, `0129`): no role name, and the only one with "Manage staff".
    check("gym_staff_invites_role_check", sql`${t.role} IN ('manager','trainer','owner') AND (${t.role} <> 'owner' OR ${t.roleName} IS NULL)`),
    check("gym_staff_invites_role_name_check", sql`${t.roleName} IS NULL OR length(${t.roleName}) BETWEEN 1 AND 40`),
    check("gym_staff_invites_privileges_check", sql`(${t.role} = 'owner' OR NOT ('staff.manage' = ANY (${t.privileges}))) AND cardinality(${t.privileges}) <= 20`),
    check("gym_staff_invites_state_check", sql`${t.state} IN ('pending','accepted','declined','cancelled')`),
    check("gym_staff_invites_answered_check", sql`(${t.state} = 'pending') = (${t.answeredAt} IS NULL)`),
    check("gym_staff_invites_cleared_check", sql`${t.clearedAt} IS NULL OR ${t.state} IN ('pending','declined')`),
    check("gym_staff_invites_expires_check", sql`${t.expiresAt} > ${t.createdAt}`),
    check("gym_staff_invites_email_length_check", sql`length(${t.email}) BETWEEN 3 AND 254`),
  ],
);

/** The gym's own staff roles (Kd, RULINGS 2026-10-01): a name and its ticks. */
export const gymStaffRoles = pgTable(
  "gym_staff_roles",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    name: citext("name").notNull(),
    privileges: text("privileges").array().notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    unique("gym_staff_roles_name_uq").on(t.gymId, t.name),
    check("gym_staff_roles_name_check", sql`length(${t.name}) BETWEEN 1 AND 40`),
    check("gym_staff_roles_privileges_check", sql`NOT ('staff.manage' = ANY (${t.privileges})) AND cardinality(${t.privileges}) <= 20`),
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
    /** The address's HMAC, kept for what Resend reports back after the address is cleared. */
    emailHmac: text("email_hmac").notNull(),
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
    /** What Resend reported about an email that went, once its own record agreed. */
    result: text("result"),
    resultAt: timestamp("result_at", { withTimezone: true }),
  },
  (t) => [
    index("gym_staff_invite_sends_gym_sent_idx").on(t.gymId, t.finishedAt).where(sql`${t.state} = 'sent'`),
    index("gym_staff_invite_sends_provider_idx").on(t.providerId).where(sql`${t.providerId} IS NOT NULL`),
    check("gym_staff_invite_sends_email_hmac_check", sql`${t.emailHmac} ~ '^[0-9a-f]{64}$'`),
    check("gym_staff_invite_sends_result_check", sql`${t.result} IS NULL OR ${t.result} IN ('delivered','bounced','complained','failed','refused')`),
    check("gym_staff_invite_sends_result_state_check", sql`${t.result} IS NULL OR ${t.state} = 'sent'`),
    check("gym_staff_invite_sends_result_at_check", sql`(${t.result} IS NULL) = (${t.resultAt} IS NULL)`),
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

/** A request to one of the gym's staff to be a co-owner (ROADMAP 4b-i; mirrors
 *  `0129_co_owner_requests.sql`). Asked by the gym's owner; accepting makes the person's
 *  staff row an owner's row. One waiting a person a gym. */
export const gymCoOwnerRequests = pgTable(
  "gym_co_owner_requests",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    requestedBy: uuid("requested_by").references(() => users.id, { onDelete: "set null" }),
    /** Their staff row's `created_at` when asked: the request counts while that row stands. */
    staffSince: timestamp("staff_since", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    state: text("state").notNull().default("pending"),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
    /** When its email went: one person is emailed at most once a day by these requests. */
    emailedAt: timestamp("emailed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("gym_co_owner_requests_pending_uq").on(t.gymId, t.userId).where(sql`${t.state} = 'pending'`),
    index("gym_co_owner_requests_user_idx").on(t.userId).where(sql`${t.state} = 'pending'`),
    check("gym_co_owner_requests_state_check", sql`${t.state} IN ('pending','accepted','declined','cancelled','expired')`),
    check("gym_co_owner_requests_answered_check", sql`(${t.state} = 'pending') = (${t.answeredAt} IS NULL)`),
    check("gym_co_owner_requests_expires_check", sql`${t.expiresAt} > ${t.createdAt}`),
  ],
);

/** The owner hands the gym to a co-owner, who accepts (4b-ii, migration `0139`). One waiting a gym. */
export const gymOwnerRequests = pgTable(
  "gym_owner_requests",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    requestedBy: uuid("requested_by").references(() => users.id, { onDelete: "set null" }),
    /** Their staff row's `created_at` when asked: the request counts while that row stands. */
    staffSince: timestamp("staff_since", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    state: text("state").notNull().default("pending"),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
    /** When its email went: one person is emailed at most once a day by these requests. */
    emailedAt: timestamp("emailed_at", { withTimezone: true }),
    // A gym paying through Paddle (4b-iii-a): Paddle's card window Accept opened for the person
    // asked, the plan it is for, and that person's Paddle customer and address.
    cardSubscriptionRef: text("card_subscription_ref"),
    cardTxnRef: text("card_txn_ref"),
    cardCustomerRef: text("card_customer_ref"),
    cardAddressRef: text("card_address_ref"),
    cardOpenedAt: timestamp("card_opened_at", { withTimezone: true }),
    /** Pointed back at the plan's own payer, or found saved: nothing left to do with it. */
    cardClosedAt: timestamp("card_closed_at", { withTimezone: true }),
    /** After the hand-over: Paddle's payer is the new owner. */
    payerMovedAt: timestamp("payer_moved_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("gym_owner_requests_pending_uq").on(t.gymId).where(sql`${t.state} = 'pending'`),
    index("gym_owner_requests_user_idx").on(t.userId).where(sql`${t.state} = 'pending'`),
    index("gym_owner_requests_card_work_idx")
      .on(t.cardOpenedAt)
      .where(sql`${t.cardTxnRef} IS NOT NULL AND (${t.cardClosedAt} IS NULL OR (${t.state} = 'accepted' AND ${t.payerMovedAt} IS NULL))`),
    check(
      "gym_owner_requests_card_check",
      sql`(${t.cardTxnRef} IS NULL AND ${t.cardSubscriptionRef} IS NULL AND ${t.cardCustomerRef} IS NULL AND ${t.cardAddressRef} IS NULL AND ${t.cardOpenedAt} IS NULL AND ${t.cardClosedAt} IS NULL AND ${t.payerMovedAt} IS NULL) OR (${t.cardTxnRef} IS NOT NULL AND ${t.cardSubscriptionRef} IS NOT NULL AND ${t.cardCustomerRef} IS NOT NULL AND ${t.cardAddressRef} IS NOT NULL AND ${t.cardOpenedAt} IS NOT NULL)`,
    ),
    check("gym_owner_requests_state_check", sql`${t.state} IN ('pending','accepted','declined','cancelled','expired')`),
    check("gym_owner_requests_answered_check", sql`(${t.state} = 'pending') = (${t.answeredAt} IS NULL)`),
    check("gym_owner_requests_expires_check", sql`${t.expiresAt} > ${t.createdAt}`),
  ],
);
