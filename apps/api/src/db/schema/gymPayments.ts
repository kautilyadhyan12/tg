import { sql } from "drizzle-orm";
import { bigint, boolean, check, date, foreignKey, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { citext, createdAt } from "./common.js";
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
    /** Linked to a customer Square already had (0166; ROADMAP 18d-iii-b-ii-b-i), not one the app made. */
    joinedAt: timestamp("joined_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: "gym_square_customers_pk", columns: [t.gymId, t.entryId, t.environment, t.accountId] }),
    check("gym_square_customers_environment_check", sql`${t.environment} IN ('sandbox','production')`),
    check("gym_square_customers_ids_check", sql`${t.accountId} ~ '^[A-Za-z0-9_-]{1,64}$' AND (${t.customerId} IS NULL OR ${t.customerId} ~ '^[A-Za-z0-9_-]{1,64}$')`),
    check("gym_square_customers_made_check", sql`(${t.customerId} IS NULL) = (${t.makingKey} IS NOT NULL)`),
    // Square's customer on a payment taken in Square's own app, found (0164; 18d-iii-b-i).
    index("gym_square_customers_customer_idx").on(t.environment, t.accountId, t.customerId).where(sql`${t.customerId} IS NOT NULL`),
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
    index("gym_member_cards_customer_idx").on(t.environment, t.accountId, t.customerId),
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

/** The saved card charged (0158; ROADMAP 18d-iii-i): the app's own charge of a renewing
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
    /** On a decline the app tries again by itself (0160; 18d-iii-ii-a), the gym day it does. */
    nextTryOn: date("next_try_on"),
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
    check("gym_card_charges_next_try_check", sql`${t.nextTryOn} IS NULL OR ${t.outcome} = 'declined'`),
    uniqueIndex("gym_card_charges_schedule_uq").on(t.gymId, t.paymentKey).where(sql`${t.bySchedule}`),
    uniqueIndex("gym_card_charges_membership_uq").on(t.gymId, t.heldMembershipId).where(sql`${t.state} = 'charging'`),
    uniqueIndex("gym_card_charges_square_payment_uq").on(t.environment, t.accountId, t.squarePaymentId).where(sql`${t.squarePaymentId} IS NOT NULL`),
    index("gym_card_charges_bill_idx").on(t.gymId, t.billId, t.startedAt),
    index("gym_card_charges_period_idx").on(t.gymId, t.heldMembershipId, t.periodIndex).where(sql`${t.billId} IS NULL`),
    index("gym_card_charges_open_idx").on(t.checkedAt).where(sql`${t.state} = 'charging'`),
    index("gym_card_charges_card_idx").on(t.gymId, t.cardId).where(sql`${t.outcome} = 'declined'`),
    index("gym_card_charges_retry_idx").on(t.nextTryOn).where(sql`${t.nextTryOn} IS NOT NULL`),
  ],
);

/** The email telling a cardholder their payment did not go through (0160; 18d-iii-ii-a): one a
 *  period of a membership (`bill_id` null; a press paying ahead has no bill yet) or one a fee (by its
 *  bill), written with its first decline. The address is kept only while it waits to go. The record
 *  link (`entry_id`, `ON DELETE SET NULL` of that column alone) is in the migration only. */
export const gymCardDeclineNotices = pgTable(
  "gym_card_decline_notices",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    heldMembershipId: uuid("held_membership_id").notNull(),
    /** The period it is about; null for a fee. */
    periodIndex: integer("period_index"),
    /** The fee it is about; null for a period. */
    billId: uuid("bill_id"),
    chargeId: uuid("charge_id")
      .notNull()
      .references(() => gymCardCharges.id, { onDelete: "cascade" }),
    /** The cardholder's record: the person's own, or whoever pays for them. */
    entryId: uuid("entry_id"),
    email: citext("email"),
    state: text("state").notNull(),
    reason: text("reason"),
    attempts: integer("attempts").notNull().default(0),
    notBefore: timestamp("not_before", { withTimezone: true }).notNull(),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    maybeSentAt: timestamp("maybe_sent_at", { withTimezone: true }),
    providerId: text("provider_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    check("gym_card_decline_notices_target_check", sql`(${t.periodIndex} IS NULL) = (${t.billId} IS NOT NULL) AND (${t.periodIndex} IS NULL OR ${t.periodIndex} >= 0)`),
    check("gym_card_decline_notices_state_check", sql`${t.state} IN ('queued','sending','sent','skipped','failed')`),
    check("gym_card_decline_notices_email_check", sql`(${t.state} IN ('queued','sending') OR ${t.email} IS NULL) AND (${t.email} IS NULL OR length(${t.email}) <= 254)`),
    check("gym_card_decline_notices_waiting_check", sql`${t.state} NOT IN ('queued','sending') OR ${t.email} IS NOT NULL`),
    check("gym_card_decline_notices_lease_check", sql`(${t.state} = 'sending') = (${t.leaseUntil} IS NOT NULL)`),
    check("gym_card_decline_notices_finished_check", sql`(${t.state} IN ('sent','skipped','failed')) = (${t.finishedAt} IS NOT NULL)`),
    check("gym_card_decline_notices_reason_check", sql`((${t.state} IN ('skipped','failed')) = (${t.reason} IS NOT NULL)) AND (${t.reason} IS NULL OR ${t.reason} ~ '^[a-z_]{1,40}$')`),
    check("gym_card_decline_notices_provider_check", sql`${t.providerId} IS NULL OR (${t.state} = 'sent' AND length(${t.providerId}) <= 100)`),
    check("gym_card_decline_notices_attempts_check", sql`${t.attempts} >= 0`),
    uniqueIndex("gym_card_decline_notices_period_uq").on(t.gymId, t.heldMembershipId, t.periodIndex).where(sql`${t.periodIndex} IS NOT NULL`),
    uniqueIndex("gym_card_decline_notices_fee_uq").on(t.gymId, t.billId).where(sql`${t.billId} IS NOT NULL`),
    index("gym_card_decline_notices_due_idx").on(t.notBefore, t.id).where(sql`${t.state} IN ('queued','sending')`),
    index("gym_card_decline_notices_sent_idx").on(t.finishedAt).where(sql`${t.state} = 'sent'`),
  ],
);

/** The email reminding a cardholder that their card on file expires this month (0163; 18d-iii-c):
 *  one a card and expiry date, for a gym that switched it on. The address is kept only while it
 *  waits to go. The record link (`entry_id`, `ON DELETE SET NULL` of that column alone) is in the
 *  migration only. */
export const gymCardExpiryNotices = pgTable(
  "gym_card_expiry_notices",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    /** The cardholder's record. */
    entryId: uuid("entry_id"),
    environment: text("environment").notNull(),
    accountId: text("account_id").notNull(),
    cardId: text("card_id").notNull(),
    expMonth: integer("exp_month").notNull(),
    expYear: integer("exp_year").notNull(),
    email: citext("email"),
    state: text("state").notNull(),
    reason: text("reason"),
    attempts: integer("attempts").notNull().default(0),
    notBefore: timestamp("not_before", { withTimezone: true }).notNull(),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    maybeSentAt: timestamp("maybe_sent_at", { withTimezone: true }),
    providerId: text("provider_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    check("gym_card_expiry_notices_environment_check", sql`${t.environment} IN ('sandbox','production')`),
    check("gym_card_expiry_notices_ids_check", sql`${t.accountId} ~ '^[A-Za-z0-9_-]{1,64}$' AND ${t.cardId} ~ '^[A-Za-z0-9:_-]{1,192}$'`),
    check("gym_card_expiry_notices_expiry_check", sql`${t.expMonth} BETWEEN 1 AND 12 AND ${t.expYear} BETWEEN 2000 AND 2200`),
    check("gym_card_expiry_notices_state_check", sql`${t.state} IN ('queued','sending','sent','skipped','failed')`),
    check("gym_card_expiry_notices_email_check", sql`(${t.state} IN ('queued','sending') OR ${t.email} IS NULL) AND (${t.email} IS NULL OR length(${t.email}) <= 254)`),
    check("gym_card_expiry_notices_waiting_check", sql`${t.state} NOT IN ('queued','sending') OR ${t.email} IS NOT NULL`),
    check("gym_card_expiry_notices_lease_check", sql`(${t.state} = 'sending') = (${t.leaseUntil} IS NOT NULL)`),
    check("gym_card_expiry_notices_finished_check", sql`(${t.state} IN ('sent','skipped','failed')) = (${t.finishedAt} IS NOT NULL)`),
    check("gym_card_expiry_notices_reason_check", sql`((${t.state} IN ('skipped','failed')) = (${t.reason} IS NOT NULL)) AND (${t.reason} IS NULL OR ${t.reason} ~ '^[a-z_]{1,40}$')`),
    check("gym_card_expiry_notices_provider_check", sql`${t.providerId} IS NULL OR (${t.state} = 'sent' AND length(${t.providerId}) <= 100)`),
    check("gym_card_expiry_notices_attempts_check", sql`${t.attempts} >= 0`),
    uniqueIndex("gym_card_expiry_notices_card_uq").on(t.gymId, t.environment, t.accountId, t.cardId, t.expYear, t.expMonth),
    index("gym_card_expiry_notices_due_idx").on(t.notBefore, t.id).where(sql`${t.state} IN ('queued','sending')`),
    index("gym_card_expiry_notices_entry_idx").on(t.gymId, t.entryId),
  ],
);

/** A payment Square made at a location of a Square account a gym here is connected to, not the app's
 *  own (0164; ROADMAP 18d-iii-b-i): taken in once, by Square's message or the hourly look, and what
 *  became of it. `waiting` for staff with `reason` (every one, since 0165: Kd's "one press"), `recorded`
 *  on a bill once staff matched it, `shop_sale` items from the gym's list in Square. `gym_id` is null only for a location two gyms here use where no customer says
 *  whose. `record_key` is the request key it is recorded with, a new one each time staff take it off a
 *  bill. Its link to a record (`ON DELETE SET NULL` of `entry_id` alone) is in the migration only;
 *  `member_payment_id` has no link, as the Terminal's has none. */
export const gymSquareAppPayments = pgTable(
  "gym_square_app_payments",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    environment: text("environment").notNull(),
    accountId: text("account_id").notNull(),
    squarePaymentId: text("square_payment_id").notNull(),
    gymId: uuid("gym_id").references(() => gyms.id, { onDelete: "cascade" }),
    locationId: text("location_id").notNull(),
    customerId: text("customer_id"),
    amountMinor: integer("amount_minor").notNull(),
    tipMinor: integer("tip_minor").notNull().default(0),
    currency: text("currency").notNull(),
    /** CARD, CASH, WALLET and the rest: how it was paid, as Square says. */
    source: text("source"),
    brand: text("brand"),
    last4: text("last4"),
    /** When Square made it. */
    takenAt: timestamp("taken_at", { withTimezone: true }).notNull(),
    state: text("state").notNull(),
    reason: text("reason"),
    entryId: uuid("entry_id"),
    memberPaymentId: uuid("member_payment_id"),
    recordKey: uuid("record_key").notNull().default(sql`gen_random_uuid()`),
    /** Marked by staff as not a bill payment (0165; 18d-iii-b-ii-a): `other`, a shop sale or anything
     *  else; `by_hand`, already recorded on a bill by hand. `reason` keeps why it was waiting, for Undo. */
    notBill: text("not_bill"),
    /** The part staff entered as an amount, without what Square added on top, where it can be told. */
    enteredMinor: integer("entered_minor"),
    /** What Square had given back of it when it was last read. */
    refundedMinor: integer("refunded_minor").notNull().default(0),
    /** What Square has of the customer added to the sale, where that customer is linked to nobody here. */
    customerName: text("customer_name"),
    customerEmail: text("customer_email"),
    customerPhone: text("customer_phone"),
    /** The name the gym gave the Square device that took it (0165). */
    deviceName: text("device_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    check("gym_square_app_payments_environment_check", sql`${t.environment} IN ('sandbox','production')`),
    check(
      "gym_square_app_payments_ids_check",
      sql`${t.accountId} ~ '^[A-Za-z0-9_-]{1,64}$' AND ${t.squarePaymentId} ~ '^[A-Za-z0-9_-]{1,192}$' AND ${t.locationId} ~ '^[A-Za-z0-9_-]{1,64}$' AND (${t.customerId} IS NULL OR ${t.customerId} ~ '^[A-Za-z0-9_-]{1,64}$')`,
    ),
    check("gym_square_app_payments_amount_check", sql`${t.amountMinor} BETWEEN 0 AND 999999999 AND ${t.tipMinor} BETWEEN 0 AND 999999999 AND ${t.currency} ~ '^[A-Z]{3}$'`),
    check(
      "gym_square_app_payments_card_check",
      sql`(${t.source} IS NULL OR ${t.source} ~ '^[A-Z_]{1,40}$') AND (${t.brand} IS NULL OR ${t.brand} ~ '^[A-Z_]{1,40}$') AND (${t.last4} IS NULL OR ${t.last4} ~ '^[0-9]{4}$')`,
    ),
    check("gym_square_app_payments_state_check", sql`${t.state} IN ('recorded','waiting','shop_sale','not_bill')`),
    check(
      "gym_square_app_payments_reason_check",
      sql`(${t.state} IN ('waiting','not_bill')) = (${t.reason} IS NOT NULL) AND (${t.reason} IS NULL OR ${t.reason} IN ('ready','no_customer','not_linked','several_people','mixed_sale','sale_unread','square_tax','no_bill','too_early','several_bills','busy','maybe_twice','other_location','several_gyms','not_this_bill','refunded','shop_items','paid_in_parts'))`,
    ),
    check("gym_square_app_payments_recorded_check", sql`(${t.state} = 'recorded') = (${t.memberPaymentId} IS NOT NULL)`),
    check("gym_square_app_payments_gym_check", sql`${t.gymId} IS NOT NULL OR (${t.state} = 'waiting' AND ${t.reason} = 'several_gyms')`),
    check("gym_square_app_payments_not_bill_check", sql`(${t.state} = 'not_bill') = (${t.notBill} IS NOT NULL) AND (${t.notBill} IS NULL OR ${t.notBill} IN ('other','by_hand'))`),
    check(
      "gym_square_app_payments_money_check",
      sql`(${t.enteredMinor} IS NULL OR ${t.enteredMinor} BETWEEN 1 AND 999999999) AND ${t.refundedMinor} BETWEEN 0 AND 999999999`,
    ),
    check(
      "gym_square_app_payments_customer_check",
      sql`(${t.customerName} IS NULL OR char_length(${t.customerName}) BETWEEN 1 AND 200) AND (${t.customerEmail} IS NULL OR char_length(${t.customerEmail}) BETWEEN 1 AND 320) AND (${t.customerPhone} IS NULL OR char_length(${t.customerPhone}) BETWEEN 1 AND 40)`,
    ),
    check("gym_square_app_payments_device_check", sql`${t.deviceName} IS NULL OR char_length(${t.deviceName}) BETWEEN 1 AND 100`),
    uniqueIndex("gym_square_app_payments_square_uq").on(t.environment, t.accountId, t.squarePaymentId),
    index("gym_square_app_payments_gym_idx").on(t.gymId, t.state, t.takenAt),
    index("gym_square_app_payments_entry_idx").on(t.gymId, t.entryId).where(sql`${t.entryId} IS NOT NULL`),
    // The payments that hold a person's card on file (0165).
    index("gym_square_app_payments_waiting_idx").on(t.gymId, t.entryId).where(sql`${t.state} = 'waiting' AND ${t.entryId} IS NOT NULL`),
  ],
);

/** The hourly look at a gym's Square payments for any whose message never came (0164; 18d-iii-b-i):
 *  from `swept_until`, at the account and location it was made for. Square payments made before
 *  `watching_since` are never taken in. */
export const gymSquarePaymentSweeps = pgTable(
  "gym_square_payment_sweeps",
  {
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    environment: text("environment").notNull(),
    accountId: text("account_id").notNull(),
    locationId: text("location_id").notNull(),
    watchingSince: timestamp("watching_since", { withTimezone: true }).notNull(),
    sweptUntil: timestamp("swept_until", { withTimezone: true }).notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    /** The payment a look stopped at, Square giving no answer about its order, and when it first asked. */
    stuckPaymentId: text("stuck_payment_id"),
    stuckSince: timestamp("stuck_since", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ name: "gym_square_payment_sweeps_pk", columns: [t.gymId, t.environment] }),
    check("gym_square_payment_sweeps_environment_check", sql`${t.environment} IN ('sandbox','production')`),
    check("gym_square_payment_sweeps_ids_check", sql`${t.accountId} ~ '^[A-Za-z0-9_-]{1,64}$' AND ${t.locationId} ~ '^[A-Za-z0-9_-]{1,64}$'`),
    check(
      "gym_square_payment_sweeps_stuck_check",
      sql`(${t.stuckPaymentId} IS NULL) = (${t.stuckSince} IS NULL) AND (${t.stuckPaymentId} IS NULL OR ${t.stuckPaymentId} ~ '^[A-Za-z0-9_-]{1,192}$')`,
    ),
    index("gym_square_payment_sweeps_due_idx").on(t.dueAt),
  ],
);

/** Members in Square (0166; ROADMAP 18d-iii-b-ii-b-i): the owner's check of the gym's Square customer list
 *  and where it stands, and, once members were added, `automatic`: each new member is added by itself. */
export const gymSquareMemberRuns = pgTable(
  "gym_square_member_runs",
  {
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    environment: text("environment").notNull(),
    accountId: text("account_id").notNull(),
    runId: uuid("run_id").notNull(),
    state: text("state").notNull(),
    automatic: boolean("automatic").notNull().default(false),
    startedBy: uuid("started_by").references(() => users.id, { onDelete: "set null" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    cursor: text("cursor"),
    looked: integer("looked").notNull().default(0),
    listedAt: timestamp("listed_at", { withTimezone: true }),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    addedAt: timestamp("added_at", { withTimezone: true }),
    failure: text("failure"),
    unansweredAt: timestamp("unanswered_at", { withTimezone: true }),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    listVersion: bigint("list_version", { mode: "number" }),
    lookDueAt: timestamp("look_due_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ name: "gym_square_member_runs_pk", columns: [t.gymId, t.environment] }),
    check("gym_square_member_runs_environment_check", sql`${t.environment} IN ('sandbox','production')`),
    check("gym_square_member_runs_account_check", sql`${t.accountId} ~ '^[A-Za-z0-9_-]{1,64}$'`),
    check("gym_square_member_runs_state_check", sql`${t.state} IN ('checking','checked','adding','added','failed')`),
    check(
      "gym_square_member_runs_failure_check",
      sql`(${t.state} = 'failed') = (${t.failure} IS NOT NULL) AND (${t.failure} IS NULL OR ${t.failure} IN ('square_refused','square_unauthorized'))`,
    ),
    check("gym_square_member_runs_checked_check", sql`${t.state} NOT IN ('checked','adding','added') OR ${t.checkedAt} IS NOT NULL`),
    check("gym_square_member_runs_added_check", sql`NOT ${t.automatic} OR ${t.addedAt} IS NOT NULL`),
    check("gym_square_member_runs_cursor_check", sql`(${t.cursor} IS NULL OR char_length(${t.cursor}) BETWEEN 1 AND 2048) AND ${t.looked} >= 0`),
    index("gym_square_member_runs_work_idx").on(t.environment).where(sql`${t.state} IN ('checking','adding') OR ${t.automatic}`),
  ],
);

/** While a check reads Square (0166): the customers sharing an email or a phone with a record here, or
 *  naming one of its records as their reference, and nobody else's; removed once the check has decided. */
export const gymSquareMemberCandidates = pgTable(
  "gym_square_member_candidates",
  {
    gymId: uuid("gym_id").notNull(),
    environment: text("environment").notNull(),
    runId: uuid("run_id").notNull(),
    customerId: text("customer_id").notNull(),
    givenName: text("given_name"),
    familyName: text("family_name"),
    email: text("email"),
    phoneE164: text("phone_e164"),
    referenceId: text("reference_id"),
  },
  (t) => [
    primaryKey({ name: "gym_square_member_candidates_pk", columns: [t.gymId, t.environment, t.runId, t.customerId] }),
    foreignKey({ name: "gym_square_member_candidates_run_fk", columns: [t.gymId, t.environment], foreignColumns: [gymSquareMemberRuns.gymId, gymSquareMemberRuns.environment] }).onDelete("cascade"),
    check("gym_square_member_candidates_ids_check", sql`${t.customerId} ~ '^[A-Za-z0-9_-]{1,64}$'`),
    check(
      "gym_square_member_candidates_text_check",
      sql`(${t.givenName} IS NULL OR char_length(${t.givenName}) <= 300) AND (${t.familyName} IS NULL OR char_length(${t.familyName}) <= 300) AND (${t.email} IS NULL OR char_length(${t.email}) <= 320) AND (${t.phoneE164} IS NULL OR ${t.phoneE164} ~ '^\\+[1-9][0-9]{6,14}$') AND (${t.referenceId} IS NULL OR char_length(${t.referenceId}) <= 255)`,
    ),
  ],
);

/** What a check decided for each record not yet in Square (0166), and what adding did. */
export const gymSquareMemberPlan = pgTable(
  "gym_square_member_plan",
  {
    gymId: uuid("gym_id").notNull(),
    environment: text("environment").notNull(),
    entryId: uuid("entry_id").notNull(),
    runId: uuid("run_id").notNull(),
    decision: text("decision").notNull(),
    customerId: text("customer_id"),
    digest: text("digest").notNull(),
    billed: boolean("billed").notNull().default(false),
    lookedAt: timestamp("looked_at", { withTimezone: true }).notNull(),
    outcome: text("outcome"),
    doneAt: timestamp("done_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ name: "gym_square_member_plan_pk", columns: [t.gymId, t.environment, t.entryId] }),
    foreignKey({ name: "gym_square_member_plan_entry_fk", columns: [t.gymId, t.entryId], foreignColumns: [gymMemberListEntries.gymId, gymMemberListEntries.id] }).onDelete("cascade"),
    check("gym_square_member_plan_environment_check", sql`${t.environment} IN ('sandbox','production')`),
    check(
      "gym_square_member_plan_decision_check",
      sql`${t.decision} IN ('ours','link','add','several_customers','several_people') AND (${t.decision} IN ('ours','link')) = (${t.customerId} IS NOT NULL) AND (${t.customerId} IS NULL OR ${t.customerId} ~ '^[A-Za-z0-9_-]{1,64}$')`,
    ),
    check("gym_square_member_plan_digest_check", sql`${t.digest} ~ '^[0-9a-f]{32}$'`),
    check(
      "gym_square_member_plan_outcome_check",
      sql`(${t.outcome} IS NULL) = (${t.doneAt} IS NULL) AND (${t.outcome} IS NULL OR (${t.outcome} IN ('done','changed','refused') AND ${t.decision} IN ('ours','link','add')))`,
    ),
    index("gym_square_member_plan_run_idx").on(t.gymId, t.environment, t.runId),
  ],
);
