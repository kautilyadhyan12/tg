import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createdAt } from "./common.js";
import { users } from "./identity.js";
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
