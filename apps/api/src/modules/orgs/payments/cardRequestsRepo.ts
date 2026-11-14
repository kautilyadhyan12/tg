// ASK MEMBERS TO ADD THEIR CARD (ROADMAP 18d-vii): the reads behind the Members list's "No card on
// file" and the Ask to add card box. Every statement names the gym, and each reads the gym's people
// in one pass (a gym of 10,000 is read in one statement, never a statement a person).
import { CARD_REQUEST_MESSAGE_KIND, gymPaymentsAvailability } from "@app/shared";
import type { Sql, TransactionSql } from "postgres";
import { STILL_RENEWS } from "../memberships/heldRepo.js";
import { gymHasLivePlan } from "../repo.js";
import { renewing } from "./cardExpiryRepo.js";
import * as repo from "./repo.js";
import type { SquareEnvironment } from "./square.js";

type SqlOrTx = Sql | TransactionSql;

async function gymOpen(sql: SqlOrTx, gymId: string): Promise<boolean> {
  const [row] = await sql<{ open: boolean }[]>`SELECT status = 'active' AS open FROM gyms WHERE id = ${gymId}`;
  return row?.open === true;
}

export interface CardsAccount {
  environment: SquareEnvironment;
  accountId: string;
}

/** The Square account a gym takes cards in the app through now, or null: Square set up on this
 *  server, the gym in one of Square's countries, connected with a location, on a live plan and
 *  open. Card on file's own `canChange`, and the phone's Add card, read the same. */
export async function cardsAccountOf(sql: SqlOrTx, environment: SquareEnvironment | null, gymId: string): Promise<CardsAccount | null> {
  if (environment === null) return null;
  const [gym, open, row, live] = await Promise.all([repo.readGym(sql, gymId), gymOpen(sql, gymId), repo.readConnection(sql, gymId, environment), gymHasLivePlan(sql, gymId)]);
  if (gym === null || !open || gymPaymentsAvailability(gym.country) !== "square") return null;
  if (row?.state !== "connected" || row.locationId === null || !live) return null;
  return { environment, accountId: row.accountId };
}

// THE ONE RULE, as the app's own charges and the card-expiry reminders read it (`renewing`, and
// `paysForRenewal`'s two halves): a record pays for a renewal when it holds a membership that renews
// by itself and nobody pays for it, or it pays for somebody who holds one. A record NEEDS A CARD when
// it is current, nobody pays for it, it has no card in the account the gym takes cards through now,
// and it pays for a renewal. `renew` is the gym's records holding a renewal; `pays` those paying for
// one. `among`, where given, keeps the reading to those records and the people they pay for.
const PAYS = (sql: SqlOrTx, gymId: string, now: Date, among: readonly string[] | null) => sql`
  renew AS (
    SELECT DISTINCT h.entry_id FROM gym_held_memberships h
    WHERE h.gym_id = ${gymId} AND ${renewing(sql, now)}
      ${
        among === null
          ? sql``
          : sql`AND (h.entry_id = ANY(${[...among]}::uuid[])
                     OR h.entry_id IN (SELECT q.entry_id FROM gym_member_payers q WHERE q.gym_id = ${gymId} AND q.payer_entry_id = ANY(${[...among]}::uuid[])))`
      }
  ),
  pays AS (
    SELECT r.entry_id AS id, false AS for_others FROM renew r
    WHERE NOT EXISTS (SELECT 1 FROM gym_member_payers p WHERE p.gym_id = ${gymId} AND p.entry_id = r.entry_id)
    UNION ALL
    SELECT p.payer_entry_id, true FROM gym_member_payers p JOIN renew r ON r.entry_id = p.entry_id WHERE p.gym_id = ${gymId}
  )`;
const NO_PAYER = (sql: SqlOrTx) => sql`NOT EXISTS (SELECT 1 FROM gym_member_payers p WHERE p.gym_id = e.gym_id AND p.entry_id = e.id)`;
const NO_CARD = (sql: SqlOrTx, a: CardsAccount) => sql`
  NOT EXISTS (SELECT 1 FROM gym_member_cards c
              WHERE c.gym_id = e.gym_id AND c.entry_id = e.id AND c.environment = ${a.environment} AND c.account_id = ${a.accountId})`;
const NEEDS_CARD = (sql: SqlOrTx, gymId: string, a: CardsAccount, now: Date) => sql`
  WITH ${PAYS(sql, gymId, now, null)}
  SELECT e.id FROM gym_member_list_entries e
  WHERE e.gym_id = ${gymId} AND e.former_at IS NULL AND e.id IN (SELECT id FROM pays) AND ${NO_PAYER(sql)} AND ${NO_CARD(sql, a)}`;

/** The gym's current records that need a card: the Members list's "No card on file". */
export async function needsCardIds(sql: SqlOrTx, gymId: string, a: CardsAccount, now: Date): Promise<string[]> {
  const rows = await sql<{ id: string }[]>`${NEEDS_CARD(sql, gymId, a, now)}`;
  return rows.map((row) => row.id);
}

/** How many current records need a card, for the Filter's count. */
export async function needsCardCount(sql: SqlOrTx, gymId: string, a: CardsAccount, now: Date): Promise<number> {
  const [row] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM (${NEEDS_CARD(sql, gymId, a, now)}) x`;
  return row?.n ?? 0;
}

export interface RequestStateRow {
  entryId: string;
  name: string;
  former: boolean;
  /** Who pays for them, by name; null for nobody. */
  payerName: string | null;
  hasCard: boolean;
  renews: boolean;
  /** The live app accounts on the record. */
  userIds: string[];
  /** When the record's account was last sent a card request here, and the gym's day it was. */
  askedAt: Date | null;
  askedOn: string | null;
  /** Their own memberships that renew by themselves, by name. */
  ownTypes: string[];
  /** They pay for somebody else's membership that renews. */
  paysForOthers: boolean;
}

/** Each of these records of the gym, as the box reads them; a record not the gym's is not in it. */
export async function requestStateOf(sql: SqlOrTx, gymId: string, ids: readonly string[], a: CardsAccount, now: Date): Promise<RequestStateRow[]> {
  if (ids.length === 0) return [];
  const rows = await sql<
    {
      entry_id: string;
      full_name: string;
      former: boolean;
      payer_name: string | null;
      has_card: boolean;
      renews: boolean;
      user_ids: string[] | null;
      asked_at: Date | null;
      asked_on: string | null;
      own_types: string[] | null;
      pays_for_others: boolean;
    }[]
  >`
    WITH ${PAYS(sql, gymId, now, ids)},
    accounts AS (
      SELECT m.entry_id, array_agg(m.user_id ORDER BY m.user_id) AS user_ids
      FROM gym_members m JOIN users u ON u.id = m.user_id AND u.status = 'active'
      WHERE m.gym_id = ${gymId} AND m.entry_id = ANY(${[...ids]}::uuid[]) AND m.removed_at IS NULL
      GROUP BY m.entry_id
    ),
    asked AS (
      SELECT DISTINCT ON (m.entry_id) m.entry_id, x.sent_at, x.gym_day
      FROM gym_members m
      JOIN gym_member_messages x ON x.user_id = m.user_id AND x.gym_id = m.gym_id AND x.kind = ${CARD_REQUEST_MESSAGE_KIND}
      WHERE m.gym_id = ${gymId} AND m.entry_id = ANY(${[...ids]}::uuid[]) AND m.removed_at IS NULL
      ORDER BY m.entry_id, x.sent_at DESC
    ),
    own AS (
      SELECT h.entry_id, array_agg(DISTINCT t.name ORDER BY t.name) AS names
      FROM gym_held_memberships h
      JOIN gym_membership_types t ON t.gym_id = h.gym_id AND t.id = h.membership_type_id
      WHERE h.gym_id = ${gymId} AND h.entry_id = ANY(${[...ids]}::uuid[]) AND h.status IN ('active','frozen') AND ${STILL_RENEWS(sql, now)}
      GROUP BY h.entry_id
    )
    SELECT e.id AS entry_id, e.full_name, (e.former_at IS NOT NULL) AS former, pe.full_name AS payer_name,
           (c.entry_id IS NOT NULL) AS has_card,
           EXISTS (SELECT 1 FROM pays s WHERE s.id = e.id) AS renews,
           ac.user_ids, asked.sent_at AS asked_at, asked.gym_day::text AS asked_on, own.names AS own_types,
           EXISTS (SELECT 1 FROM pays s WHERE s.id = e.id AND s.for_others) AS pays_for_others
    FROM gym_member_list_entries e
    LEFT JOIN gym_member_payers p ON p.gym_id = e.gym_id AND p.entry_id = e.id
    LEFT JOIN gym_member_list_entries pe ON pe.gym_id = p.gym_id AND pe.id = p.payer_entry_id
    LEFT JOIN gym_member_cards c ON c.gym_id = e.gym_id AND c.entry_id = e.id AND c.environment = ${a.environment} AND c.account_id = ${a.accountId}
    LEFT JOIN accounts ac ON ac.entry_id = e.id
    LEFT JOIN asked ON asked.entry_id = e.id
    LEFT JOIN own ON own.entry_id = e.id
    WHERE e.gym_id = ${gymId} AND e.id = ANY(${[...ids]}::uuid[])
    ORDER BY e.full_name, e.id`;
  return rows.map((r) => ({
    entryId: r.entry_id,
    name: r.full_name,
    former: r.former,
    payerName: r.payer_name,
    hasCard: r.has_card,
    renews: r.renews,
    userIds: r.user_ids ?? [],
    askedAt: r.asked_at,
    askedOn: r.asked_on,
    ownTypes: r.own_types ?? [],
    paysForOthers: r.pays_for_others,
  }));
}
