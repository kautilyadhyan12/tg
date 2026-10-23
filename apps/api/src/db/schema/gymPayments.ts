import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt } from "./common.js";
import { users } from "./identity.js";
import { gymMemberListEntries } from "./memberList.js";
import { gyms } from "./tenancy.js";

/** A gym's own payment company (0142; ROADMAP 18d-i): Square today, one row a gym and
 *  company. `account_id` is Square's merchant id. The tokens are locked under
 *  `PAYMENT_TOKENS_KEY` (`tokenBox.ts`) and held only while `state` is `connected`;
 *  `removed` keeps the business's name to say the gym took the app off inside Square. A
 *  connected row with no `location_id` is waiting for the owner to pick one of
 *  `location_choices`. `scopes` (0147): what the gym allowed on Square's page; a row made
 *  before a permission was added is asked to connect again. */
export const gymPaymentConnections = pgTable(
  "gym_payment_connections",
  {
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    environment: text("environment").notNull(),
    state: text("state").notNull(),
    accountId: text("account_id").notNull(),
    businessName: text("business_name").notNull(),
    country: text("country").notNull(),
    currency: text("currency").notNull(),
    locationId: text("location_id"),
    locationName: text("location_name"),
    locationChoices: jsonb("location_choices"),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    accessExpiresAt: timestamp("access_expires_at", { withTimezone: true }),
    /** When the worker next renews the tokens; pushed on while a renewal is under way. */
    refreshDueAt: timestamp("refresh_due_at", { withTimezone: true }),
    connectedBy: uuid("connected_by").references(() => users.id, { onDelete: "set null" }),
    connectedAt: timestamp("connected_at", { withTimezone: true }).notNull(),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    scopes: text("scopes").array().notNull().default(sql`'{}'::text[]`),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: "gym_payment_connections_pk", columns: [t.gymId, t.provider] }),
    check("gym_payment_connections_provider_check", sql`${t.provider} IN ('square')`),
    check("gym_payment_connections_environment_check", sql`${t.environment} IN ('sandbox','production')`),
    check("gym_payment_connections_state_check", sql`${t.state} IN ('connected','removed')`),
    check(
      "gym_payment_connections_tokens_check",
      sql`(${t.state} = 'connected') = (${t.accessToken} IS NOT NULL AND ${t.refreshToken} IS NOT NULL AND ${t.accessExpiresAt} IS NOT NULL AND ${t.refreshDueAt} IS NOT NULL AND ${t.removedAt} IS NULL)`,
    ),
    check("gym_payment_connections_location_check", sql`(${t.locationId} IS NULL) = (${t.locationName} IS NULL) AND (${t.locationId} IS NULL OR ${t.locationChoices} IS NULL)`),
    check("gym_payment_connections_country_check", sql`${t.country} ~ '^[A-Z]{2}$' AND ${t.currency} ~ '^[A-Z]{3}$'`),
    index("gym_payment_connections_account_idx").on(t.provider, t.accountId),
    index("gym_payment_connections_refresh_idx").on(t.refreshDueAt).where(sql`${t.state} = 'connected'`),
  ],
);

/** A press of Connect Square waiting for Square's answer (0142): the one-time value Square
 *  hands back, kept as its SHA-256, for the owner who pressed it, at this gym, once, for
 *  `SQUARE_CONNECT_MINUTES`. */
export const gymPaymentConnectStarts = pgTable(
  "gym_payment_connect_starts",
  {
    stateHash: text("state_hash").primaryKey(),
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    environment: text("environment").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check("gym_payment_connect_starts_provider_check", sql`${t.provider} IN ('square')`),
    check("gym_payment_connect_starts_environment_check", sql`${t.environment} IN ('sandbox','production')`),
    check("gym_payment_connect_starts_hash_check", sql`${t.stateHash} ~ '^[0-9a-f]{64}$'`),
    index("gym_payment_connect_starts_expires_idx").on(t.expiresAt),
  ],
);

/** Tokens Square is still to be told to stop (0142): written in the same step that lets
 *  them go (Disconnect, or a connection refused), and sent by the worker until Square says
 *  so. `whole_account`: end the app's whole access to the account, which only happens when
 *  no other gym here holds it. The token stays locked under the gym it came from. */
export const gymPaymentRevokes = pgTable(
  "gym_payment_revokes",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    gymId: uuid("gym_id").notNull(),
    provider: text("provider").notNull(),
    environment: text("environment").notNull(),
    accountId: text("account_id").notNull(),
    accessToken: text("access_token").notNull(),
    wholeAccount: boolean("whole_account").notNull(),
    tries: integer("tries").notNull().default(0),
    notBefore: timestamp("not_before", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check("gym_payment_revokes_provider_check", sql`${t.provider} IN ('square')`),
    check("gym_payment_revokes_environment_check", sql`${t.environment} IN ('sandbox','production')`),
    check("gym_payment_revokes_tries_check", sql`${t.tries} >= 0`),
    index("gym_payment_revokes_due_idx").on(t.notBefore),
  ],
);

/** The person a record is in a gym's Square account (0144; ROADMAP 18d-ii): made the first
 *  time a card is saved for them, once. `making_key` stands for Square's id while Square is
 *  asked to make it: every save meanwhile asks with that key, so Square makes one. */
export const gymSquareCustomers = pgTable(
  "gym_square_customers",
  {
    gymId: uuid("gym_id").notNull(),
    entryId: uuid("entry_id").notNull(),
    environment: text("environment").notNull(),
    accountId: text("account_id").notNull(),
    customerId: text("customer_id"),
    makingKey: uuid("making_key"),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: "gym_square_customers_pk", columns: [t.gymId, t.entryId, t.environment, t.accountId] }),
    check("gym_square_customers_environment_check", sql`${t.environment} IN ('sandbox','production')`),
    check("gym_square_customers_ids_check", sql`${t.accountId} ~ '^[A-Za-z0-9_-]{1,64}$' AND (${t.customerId} IS NULL OR ${t.customerId} ~ '^[A-Za-z0-9_-]{1,64}$')`),
    check("gym_square_customers_made_check", sql`(${t.customerId} IS NULL) = (${t.makingKey} IS NOT NULL)`),
    foreignKey({ name: "gym_square_customers_entry_fk", columns: [t.gymId, t.entryId], foreignColumns: [gymMemberListEntries.gymId, gymMemberListEntries.id] }).onDelete("cascade"),
  ],
);

/** What the person agreed to when a card was saved (0144): the words shown, when, and on whose
 *  screen (`desk`: staff's, `app`: the member's own, `terminal`: the gym's Square Terminal,
 *  0148). It outlives a removed card. A record
 *  deleted for good lets go of it with the day (`record_deleted_at`); its link to the record is
 *  checked when the transaction commits, so it is not declared here (as `0108`'s is not). */
export const gymCardAgreements = pgTable(
  "gym_card_agreements",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    entryId: uuid("entry_id"),
    recordDeletedAt: timestamp("record_deleted_at", { withTimezone: true }),
    words: text("words").notNull(),
    screen: text("screen").notNull(),
    screenUserId: uuid("screen_user_id").references(() => users.id, { onDelete: "set null" }),
    /** `terminal` (0148): the Square Terminal the person tapped I agree on. */
    deviceId: text("device_id"),
    brand: text("brand").notNull(),
    last4: text("last4").notNull(),
    agreedAt: timestamp("agreed_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    check("gym_card_agreements_words_check", sql`char_length(${t.words}) BETWEEN 20 AND 600`),
    check(
      "gym_card_agreements_screen_check",
      sql`${t.screen} IN ('desk','app','terminal') AND (${t.screen} = 'terminal') = (${t.deviceId} IS NOT NULL) AND (${t.deviceId} IS NULL OR ${t.deviceId} ~ '^[A-Za-z0-9:_-]{1,100}$')`,
    ),
    check("gym_card_agreements_card_check", sql`${t.brand} ~ '^[A-Z_]{1,40}$' AND ${t.last4} ~ '^[0-9]{4}$'`),
    check("gym_card_agreements_deleted_day_check", sql`${t.entryId} IS NOT NULL OR ${t.recordDeletedAt} IS NOT NULL`),
    index("gym_card_agreements_entry_idx").on(t.gymId, t.entryId),
    index("gym_card_agreements_deleted_idx").on(t.recordDeletedAt).where(sql`${t.entryId} IS NULL`),
  ],
);

/** A record's card on file (0144): one a record, in the Square account it names. The card
 *  number never reaches us: Square's ids and what a screen shows of the card. */
export const gymMemberCards = pgTable(
  "gym_member_cards",
  {
    gymId: uuid("gym_id").notNull(),
    entryId: uuid("entry_id").notNull(),
    environment: text("environment").notNull(),
    accountId: text("account_id").notNull(),
    customerId: text("customer_id").notNull(),
    cardId: text("card_id").notNull(),
    brand: text("brand").notNull(),
    last4: text("last4").notNull(),
    expMonth: integer("exp_month").notNull(),
    expYear: integer("exp_year").notNull(),
    savedFrom: text("saved_from").notNull(),
    savedBy: uuid("saved_by").references(() => users.id, { onDelete: "set null" }),
    agreementId: uuid("agreement_id")
      .notNull()
      .references(() => gymCardAgreements.id),
    savedAt: timestamp("saved_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ name: "gym_member_cards_pk", columns: [t.gymId, t.entryId] }),
    unique("gym_member_cards_card_uq").on(t.environment, t.accountId, t.cardId),
    check("gym_member_cards_environment_check", sql`${t.environment} IN ('sandbox','production')`),
    check(
      "gym_member_cards_ids_check",
      sql`${t.accountId} ~ '^[A-Za-z0-9_-]{1,64}$' AND ${t.customerId} ~ '^[A-Za-z0-9_-]{1,64}$' AND ${t.cardId} ~ '^[A-Za-z0-9:_-]{1,192}$'`,
    ),
    check(
      "gym_member_cards_card_check",
      sql`${t.brand} ~ '^[A-Z_]{1,40}$' AND ${t.last4} ~ '^[0-9]{4}$' AND ${t.expMonth} BETWEEN 1 AND 12 AND ${t.expYear} BETWEEN 2000 AND 2200`,
    ),
    check("gym_member_cards_saved_from_check", sql`${t.savedFrom} IN ('desk','app','terminal')`),
    foreignKey({ name: "gym_member_cards_entry_fk", columns: [t.gymId, t.entryId], foreignColumns: [gymMemberListEntries.gymId, gymMemberListEntries.id] }).onDelete("cascade"),
  ],
);

/** Cards Square is still to be told to stop (0144): replaced by a newer card, or their record
 *  deleted for good or joined to another. Sent by the worker with the gym's own connection to
 *  that account until Square says so. */
export const gymCardDisables = pgTable(
  "gym_card_disables",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    environment: text("environment").notNull(),
    accountId: text("account_id").notNull(),
    cardId: text("card_id").notNull(),
    tries: integer("tries").notNull().default(0),
    notBefore: timestamp("not_before", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check("gym_card_disables_environment_check", sql`${t.environment} IN ('sandbox','production')`),
    check("gym_card_disables_ids_check", sql`${t.accountId} ~ '^[A-Za-z0-9_-]{1,64}$' AND ${t.cardId} ~ '^[A-Za-z0-9:_-]{1,192}$'`),
    check("gym_card_disables_tries_check", sql`${t.tries} >= 0`),
    index("gym_card_disables_due_idx").on(t.notBefore),
  ],
);

/** A gym's Square Terminals (0147; ROADMAP 18d-ii-b-i), in the Square account they were paired
 *  in. `pairing`: Square's code waits for a Terminal to sign in with it until `pair_by`; the
 *  code itself is never kept. `paired`: `device_id` is the Terminal's id at Square, the serial
 *  number under it; one row a Terminal in a Square account, whichever gym. `practice`: one of
 *  Square's simulated Terminals, in its sandbox only. */
export const gymSquareTerminals = pgTable(
  "gym_square_terminals",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    environment: text("environment").notNull(),
    accountId: text("account_id").notNull(),
    state: text("state").notNull(),
    deviceCodeId: text("device_code_id"),
    deviceId: text("device_id"),
    practice: text("practice"),
    pairBy: timestamp("pair_by", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    pairedAt: timestamp("paired_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    check("gym_square_terminals_environment_check", sql`${t.environment} IN ('sandbox','production')`),
    check("gym_square_terminals_state_check", sql`${t.state} IN ('pairing','paired')`),
    check(
      "gym_square_terminals_ids_check",
      sql`${t.accountId} ~ '^[A-Za-z0-9_-]{1,64}$' AND (${t.deviceCodeId} IS NULL OR ${t.deviceCodeId} ~ '^[A-Za-z0-9_-]{1,64}$') AND (${t.deviceId} IS NULL OR ${t.deviceId} ~ '^[A-Za-z0-9:_-]{1,100}$')`,
    ),
    check(
      "gym_square_terminals_pairing_check",
      sql`(${t.state} = 'pairing') = (${t.deviceCodeId} IS NOT NULL AND ${t.pairBy} IS NOT NULL AND ${t.deviceId} IS NULL AND ${t.pairedAt} IS NULL)`,
    ),
    check("gym_square_terminals_paired_check", sql`(${t.state} = 'paired') = (${t.deviceId} IS NOT NULL AND ${t.pairedAt} IS NOT NULL AND ${t.pairBy} IS NULL)`),
    check(
      "gym_square_terminals_practice_check",
      sql`${t.practice} IS NULL OR (${t.practice} IN ('saves','declines','cancels','times_out','offline') AND ${t.environment} = 'sandbox' AND ${t.state} = 'paired' AND ${t.deviceCodeId} IS NULL)`,
    ),
    uniqueIndex("gym_square_terminals_device_uq").on(t.environment, t.accountId, t.deviceId).where(sql`${t.deviceId} IS NOT NULL`),
    uniqueIndex("gym_square_terminals_pairing_uq").on(t.gymId, t.environment).where(sql`${t.state} = 'pairing'`),
  ],
);

/** Save card on Terminal (0148; ROADMAP 18d-ii-b-ii): one press, while the person agrees on the
 *  gym's Square Terminal (`agreeing`) and inserts or swipes their card (`saving`), then `saved`
 *  or `not_saved` with why, kept a day. The key each Square action is asked with is kept, so
 *  asking again gives back the same action. A record deleted for good or joined lets go of
 *  `entry_id` alone (`ON DELETE SET NULL ("entry_id")`, which Drizzle cannot write, so that
 *  link is not declared here): whatever the Terminal then saves is stopped at Square. */
export const gymTerminalCardSaves = pgTable(
  "gym_terminal_card_saves",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    entryId: uuid("entry_id"),
    environment: text("environment").notNull(),
    accountId: text("account_id").notNull(),
    deviceId: text("device_id").notNull(),
    customerId: text("customer_id").notNull(),
    requestKey: uuid("request_key").notNull(),
    state: text("state").notNull(),
    outcome: text("outcome"),
    words: text("words").notNull(),
    confirmKey: uuid("confirm_key").notNull(),
    confirmActionId: text("confirm_action_id"),
    pickedUp: boolean("picked_up").notNull().default(false),
    agreedAt: timestamp("agreed_at", { withTimezone: true }),
    saveKey: uuid("save_key").notNull(),
    saveActionId: text("save_action_id"),
    cardId: text("card_id"),
    startedBy: uuid("started_by").references(() => users.id, { onDelete: "set null" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    checkingUntil: timestamp("checking_until", { withTimezone: true }),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull(),
    cancelWantedAt: timestamp("cancel_wanted_at", { withTimezone: true }),
    cancelTooLate: boolean("cancel_too_late").notNull().default(false),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    check("gym_terminal_card_saves_environment_check", sql`${t.environment} IN ('sandbox','production')`),
    check(
      "gym_terminal_card_saves_ids_check",
      sql`${t.accountId} ~ '^[A-Za-z0-9_-]{1,64}$' AND ${t.deviceId} ~ '^[A-Za-z0-9:_-]{1,100}$' AND ${t.customerId} ~ '^[A-Za-z0-9_-]{1,64}$' AND (${t.confirmActionId} IS NULL OR ${t.confirmActionId} ~ '^[A-Za-z0-9:_-]{1,255}$') AND (${t.saveActionId} IS NULL OR ${t.saveActionId} ~ '^[A-Za-z0-9:_-]{1,255}$') AND (${t.cardId} IS NULL OR ${t.cardId} ~ '^[A-Za-z0-9:_-]{1,192}$')`,
    ),
    check("gym_terminal_card_saves_state_check", sql`${t.state} IN ('agreeing','saving','saved','not_saved')`),
    check(
      "gym_terminal_card_saves_outcome_check",
      sql`(${t.state} IN ('agreeing','saving')) = (${t.outcome} IS NULL AND ${t.finishedAt} IS NULL) AND (${t.outcome} IS NULL OR ${t.outcome} IN ('saved','not_agreed','cancelled_on_terminal','timed_out','no_answer','cancelled','refused','gone'))`,
    ),
    check(
      "gym_terminal_card_saves_saved_check",
      sql`(${t.state} = 'saved') = (${t.outcome} IS NOT DISTINCT FROM 'saved') AND (${t.state} <> 'saved' OR (${t.cardId} IS NOT NULL AND ${t.agreedAt} IS NOT NULL))`,
    ),
    check("gym_terminal_card_saves_agreed_check", sql`${t.state} NOT IN ('saving','saved') OR ${t.agreedAt} IS NOT NULL`),
    check("gym_terminal_card_saves_words_check", sql`char_length(${t.words}) BETWEEN 20 AND 600`),
    uniqueIndex("gym_terminal_card_saves_request_uq").on(t.gymId, t.requestKey),
    uniqueIndex("gym_terminal_card_saves_device_uq").on(t.environment, t.accountId, t.deviceId).where(sql`${t.state} IN ('agreeing','saving')`),
    uniqueIndex("gym_terminal_card_saves_entry_uq").on(t.gymId, t.entryId).where(sql`${t.state} IN ('agreeing','saving') AND ${t.entryId} IS NOT NULL`),
    index("gym_terminal_card_saves_open_idx").on(t.checkedAt).where(sql`${t.state} IN ('agreeing','saving')`),
    index("gym_terminal_card_saves_done_idx").on(t.finishedAt).where(sql`${t.finishedAt} IS NOT NULL`),
  ],
);

/** Take payment on Terminal (0149; ROADMAP 18d-vi-a): one press, while the amount waits on the
 *  gym's Square Terminal (`waiting`), then `done` with why, kept a day; one whose money Square
 *  took but could not be recorded (`not_recorded`) is kept. The checkout's key is kept, so asking
 *  again gives back the same checkout. `held_membership_id` has no link: the payment is recorded
 *  on whichever record holds the membership when Square answers. A record deleted for good lets
 *  go of `entry_id` alone (`ON DELETE SET NULL ("entry_id")`, in the migration only). */
export const gymTerminalPayments = pgTable(
  "gym_terminal_payments",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    entryId: uuid("entry_id"),
    /** Null for a basket at Sell (0153; 18d-vi-b-ii). */
    heldMembershipId: uuid("held_membership_id"),
    periodIndex: integer("period_index"),
    /** A fee of the membership (18d-vi-b-i), in place of a period. */
    feeBillId: uuid("fee_bill_id"),
    /** A basket at Sell (0153; 18d-vi-b-ii), as priced at the press, in place of a membership. */
    sale: jsonb("sale"),
    /** The sale's receipt, once Square took the money and the sale is recorded. */
    saleReceiptNumber: integer("sale_receipt_number"),
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull(),
    environment: text("environment").notNull(),
    accountId: text("account_id").notNull(),
    locationId: text("location_id").notNull(),
    deviceId: text("device_id").notNull(),
    requestKey: uuid("request_key").notNull(),
    state: text("state").notNull(),
    outcome: text("outcome"),
    checkoutKey: uuid("checkout_key").notNull(),
    checkoutId: text("checkout_id"),
    pickedUp: boolean("picked_up").notNull().default(false),
    squarePaymentId: text("square_payment_id"),
    memberPaymentId: uuid("member_payment_id"),
    startedBy: uuid("started_by").references(() => users.id, { onDelete: "set null" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    checkingUntil: timestamp("checking_until", { withTimezone: true }),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull(),
    cancelWantedAt: timestamp("cancel_wanted_at", { withTimezone: true }),
    cancelTooLate: boolean("cancel_too_late").notNull().default(false),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    check("gym_terminal_payments_environment_check", sql`${t.environment} IN ('sandbox','production')`),
    check(
      "gym_terminal_payments_ids_check",
      sql`${t.accountId} ~ '^[A-Za-z0-9_-]{1,64}$' AND ${t.locationId} ~ '^[A-Za-z0-9_-]{1,64}$' AND ${t.deviceId} ~ '^[A-Za-z0-9:_-]{1,100}$' AND (${t.checkoutId} IS NULL OR ${t.checkoutId} ~ '^[A-Za-z0-9:_-]{1,255}$') AND (${t.squarePaymentId} IS NULL OR ${t.squarePaymentId} ~ '^[A-Za-z0-9_-]{1,192}$')`,
    ),
    check("gym_terminal_payments_amount_check", sql`${t.amountMinor} BETWEEN 1 AND 99999999 AND ${t.currency} ~ '^[A-Z]{3}$' AND (${t.periodIndex} IS NULL OR ${t.periodIndex} >= 0)`),
    check("gym_terminal_payments_bill_check", sql`num_nonnulls(${t.periodIndex}, ${t.feeBillId}, ${t.sale}) = 1 AND (${t.heldMembershipId} IS NULL) = (${t.sale} IS NOT NULL)`),
    check("gym_terminal_payments_state_check", sql`${t.state} IN ('waiting','done')`),
    check(
      "gym_terminal_payments_outcome_check",
      sql`(${t.state} = 'waiting') = (${t.outcome} IS NULL AND ${t.finishedAt} IS NULL) AND (${t.outcome} IS NULL OR ${t.outcome} IN ('paid','cancelled_on_terminal','timed_out','no_answer','cancelled','refused','gone','not_recorded'))`,
    ),
    check(
      "gym_terminal_payments_paid_check",
      sql`((${t.outcome} IS NOT DISTINCT FROM 'paid') = (${t.memberPaymentId} IS NOT NULL OR ${t.saleReceiptNumber} IS NOT NULL)) AND (${t.memberPaymentId} IS NULL OR ${t.saleReceiptNumber} IS NULL) AND (${t.outcome} NOT IN ('paid','not_recorded') OR ${t.squarePaymentId} IS NOT NULL)`,
    ),
    uniqueIndex("gym_terminal_payments_request_uq").on(t.gymId, t.requestKey),
    uniqueIndex("gym_terminal_payments_device_uq").on(t.environment, t.accountId, t.deviceId).where(sql`${t.state} = 'waiting'`),
    uniqueIndex("gym_terminal_payments_membership_uq").on(t.gymId, t.heldMembershipId).where(sql`${t.state} = 'waiting'`),
    uniqueIndex("gym_terminal_payments_square_payment_uq").on(t.environment, t.accountId, t.squarePaymentId).where(sql`${t.squarePaymentId} IS NOT NULL`),
    index("gym_terminal_payments_sale_idx").on(t.gymId).where(sql`${t.state} = 'waiting' AND ${t.sale} IS NOT NULL`),
    index("gym_terminal_payments_entry_idx").on(t.gymId, t.entryId).where(sql`${t.state} = 'waiting'`),
    index("gym_terminal_payments_open_idx").on(t.checkedAt).where(sql`${t.state} = 'waiting'`),
    index("gym_terminal_payments_done_idx").on(t.finishedAt).where(sql`${t.finishedAt} IS NOT NULL`),
  ],
);

/** The saved card charged (0157; ROADMAP 18d-iii-i): the app's own charge of a renewing
 *  membership's bill or a freeze fee on its date (`by_schedule`), or staff pressing Charge card on
 *  file. `payment_key` is Square's idempotency key (the bill's id for the app's, the row's own for a
 *  press), so asking again gives back the same payment. While `charging`, nothing else pays, voids
 *  or cancels that membership's bills. Kept: a bill reads "declined" from its newest one. The
 *  record links (`entry_id`, `payer_entry_id`, each `ON DELETE SET NULL` of that column alone) are
 *  in the migration only, as `gym_terminal_payments`' is. */
export const gymCardCharges = pgTable(
  "gym_card_charges",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    entryId: uuid("entry_id"),
    heldMembershipId: uuid("held_membership_id").notNull(),
    /** Null only for a press paying a period whose bill is not open yet. */
    billId: uuid("bill_id"),
    /** Null for a fee. */
    periodIndex: integer("period_index"),
    /** Whose card: the person's own, or the record that pays for them (18i). */
    payerEntryId: uuid("payer_entry_id"),
    environment: text("environment").notNull(),
    accountId: text("account_id").notNull(),
    locationId: text("location_id").notNull(),
    customerId: text("customer_id").notNull(),
    cardId: text("card_id").notNull(),
    brand: text("brand").notNull(),
    last4: text("last4").notNull(),
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull(),
    bySchedule: boolean("by_schedule").notNull(),
    requestKey: uuid("request_key").notNull(),
    paymentKey: text("payment_key").notNull(),
    state: text("state").notNull(),
    outcome: text("outcome"),
    /** Square's code for a decline or a refusal. */
    declineCode: text("decline_code"),
    squarePaymentId: text("square_payment_id"),
    memberPaymentId: uuid("member_payment_id"),
    startedBy: uuid("started_by").references(() => users.id, { onDelete: "set null" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    checkingUntil: timestamp("checking_until", { withTimezone: true }),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    check("gym_card_charges_environment_check", sql`${t.environment} IN ('sandbox','production')`),
    check(
      "gym_card_charges_ids_check",
      sql`${t.accountId} ~ '^[A-Za-z0-9_-]{1,64}$' AND ${t.locationId} ~ '^[A-Za-z0-9_-]{1,64}$' AND ${t.customerId} ~ '^[A-Za-z0-9_-]{1,64}$' AND ${t.cardId} ~ '^[A-Za-z0-9:_-]{1,192}$' AND (${t.squarePaymentId} IS NULL OR ${t.squarePaymentId} ~ '^[A-Za-z0-9_-]{1,192}$') AND char_length(${t.paymentKey}) BETWEEN 1 AND 45`,
    ),
    check("gym_card_charges_card_check", sql`${t.brand} ~ '^[A-Z_]{1,40}$' AND ${t.last4} ~ '^[0-9]{4}$'`),
    check("gym_card_charges_amount_check", sql`${t.amountMinor} BETWEEN 1 AND 99999999 AND ${t.currency} ~ '^[A-Z]{3}$' AND (${t.periodIndex} IS NULL OR ${t.periodIndex} >= 0)`),
    check("gym_card_charges_by_check", sql`NOT ${t.bySchedule} OR (${t.startedBy} IS NULL AND ${t.billId} IS NOT NULL)`),
    check("gym_card_charges_bill_check", sql`${t.billId} IS NOT NULL OR ${t.periodIndex} IS NOT NULL`),
    check(
      "gym_card_charges_state_check",
      sql`${t.state} IN ('charging','done') AND (${t.state} = 'charging') = (${t.outcome} IS NULL AND ${t.finishedAt} IS NULL) AND (${t.outcome} IS NULL OR ${t.outcome} IN ('paid','declined','refused','not_recorded','gone'))`,
    ),
    check(
      "gym_card_charges_paid_check",
      sql`((${t.outcome} IS NOT DISTINCT FROM 'paid') = (${t.memberPaymentId} IS NOT NULL)) AND (${t.outcome} NOT IN ('paid','not_recorded') OR ${t.squarePaymentId} IS NOT NULL)`,
    ),
    check(
      "gym_card_charges_decline_check",
      sql`(${t.declineCode} IS NULL OR (${t.outcome} IN ('declined','refused') AND ${t.declineCode} ~ '^[A-Z0-9_]{1,60}$')) AND (${t.outcome} IS DISTINCT FROM 'declined' OR ${t.declineCode} IS NOT NULL)`,
    ),
    uniqueIndex("gym_card_charges_request_uq").on(t.gymId, t.requestKey),
    uniqueIndex("gym_card_charges_payment_key_uq").on(t.environment, t.accountId, t.paymentKey),
    uniqueIndex("gym_card_charges_schedule_uq").on(t.gymId, t.billId).where(sql`${t.bySchedule}`),
    uniqueIndex("gym_card_charges_membership_uq").on(t.gymId, t.heldMembershipId).where(sql`${t.state} = 'charging'`),
    uniqueIndex("gym_card_charges_square_payment_uq").on(t.environment, t.accountId, t.squarePaymentId).where(sql`${t.squarePaymentId} IS NOT NULL`),
    index("gym_card_charges_bill_idx").on(t.gymId, t.billId, t.startedAt),
    index("gym_card_charges_period_idx").on(t.gymId, t.heldMembershipId, t.periodIndex).where(sql`${t.billId} IS NULL`),
    index("gym_card_charges_open_idx").on(t.checkedAt).where(sql`${t.state} = 'charging'`),
  ],
);
