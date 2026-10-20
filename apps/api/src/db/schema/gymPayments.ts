import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { createdAt } from "./common.js";
import { users } from "./identity.js";
import { gymMemberListEntries } from "./memberList.js";
import { gyms } from "./tenancy.js";

/** A gym's own payment company (0142; ROADMAP 18d-i): Square today, one row a gym and
 *  company. `account_id` is Square's merchant id. The tokens are locked under
 *  `PAYMENT_TOKENS_KEY` (`tokenBox.ts`) and held only while `state` is `connected`;
 *  `removed` keeps the business's name to say the gym took the app off inside Square. A
 *  connected row with no `location_id` is waiting for the owner to pick one of
 *  `location_choices`. */
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
 *  time a card is saved for them, once, under a lock. */
export const gymSquareCustomers = pgTable(
  "gym_square_customers",
  {
    gymId: uuid("gym_id").notNull(),
    entryId: uuid("entry_id").notNull(),
    environment: text("environment").notNull(),
    accountId: text("account_id").notNull(),
    customerId: text("customer_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: "gym_square_customers_pk", columns: [t.gymId, t.entryId, t.environment, t.accountId] }),
    check("gym_square_customers_environment_check", sql`${t.environment} IN ('sandbox','production')`),
    check("gym_square_customers_ids_check", sql`${t.accountId} ~ '^[A-Za-z0-9_-]{1,64}$' AND ${t.customerId} ~ '^[A-Za-z0-9_-]{1,64}$'`),
    foreignKey({ name: "gym_square_customers_entry_fk", columns: [t.gymId, t.entryId], foreignColumns: [gymMemberListEntries.gymId, gymMemberListEntries.id] }).onDelete("cascade"),
  ],
);

/** What the person agreed to when a card was saved (0144): the words shown, when, and on whose
 *  screen (`desk`: staff's, `app`: the member's own). It outlives a removed card. A record
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
    brand: text("brand").notNull(),
    last4: text("last4").notNull(),
    agreedAt: timestamp("agreed_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    check("gym_card_agreements_words_check", sql`char_length(${t.words}) BETWEEN 20 AND 600`),
    check("gym_card_agreements_screen_check", sql`${t.screen} IN ('desk','app')`),
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
    check("gym_member_cards_saved_from_check", sql`${t.savedFrom} IN ('desk','app')`),
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
