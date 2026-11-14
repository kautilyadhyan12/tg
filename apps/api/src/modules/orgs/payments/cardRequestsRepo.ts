// ASK MEMBERS TO ADD THEIR CARD (ROADMAP 18d-vii): the reads behind the Members list's "No card on
// file" and the Ask to add card box. Every statement names the gym.
import { CARD_REQUEST_MESSAGE_KIND, gymPaymentsAvailability } from "@app/shared";
import type { Sql, TransactionSql } from "postgres";
import { STILL_RENEWS } from "../memberships/heldRepo.js";
import { gymHasLivePlan } from "../repo.js";
import { paysForRenewal } from "./cardExpiryRepo.js";
import * as repo from "./repo.js";
import type { SquareEnvironment } from "./square.js";

type SqlOrTx = Sql | TransactionSql;

/** The Square account a gym takes cards in the app through now, or null: Square set up on this
 *  server, the gym in one of Square's countries, connected with a location, on a live plan and
 *  open. Card on file's own `canChange`, and the phone's Add card, read the same. */
export async function cardsAccountOf(sql: SqlOrTx, environment: SquareEnvironment | null, gymId: string): Promise<{ environment: SquareEnvironment; accountId: string } | null> {
  if (environment === null) return null;
  const [gym, open, row, live] = await Promise.all([repo.readGym(sql, gymId), gymOpen(sql, gymId), repo.readConnection(sql, gymId, environment), gymHasLivePlan(sql, gymId)]);
  if (gym === null || !open || gymPaymentsAvailability(gym.country) !== "square") return null;
  if (row?.state !== "connected" || row.locationId === null || !live) return null;
  return { environment, accountId: row.accountId };
}

async function gymOpen(sql: SqlOrTx, gymId: string): Promise<boolean> {
  const [row] = await sql<{ open: boolean }[]>`SELECT status = 'active' AS open FROM gyms WHERE id = ${gymId}`;
  return row?.open === true;
}

export interface CardsAccount {
  environment: SquareEnvironment;
  accountId: string;
}

// THE ONE RULE, in its parts, each read for a record (alias `e`): somebody else pays for them; a
// card is on file in the account the gym takes cards through now; they pay for a membership that
// renews by itself (theirs, or of somebody they pay for), the rule the app's own charges and the
// expiry reminders read. A record needs a card when it is current, nobody pays for it, it has no
// card there, and it pays for a renewal.
const HAS_PAYER = (sql: SqlOrTx) => sql`EXISTS (SELECT 1 FROM gym_member_payers p WHERE p.gym_id = e.gym_id AND p.entry_id = e.id)`;
const HAS_CARD = (sql: SqlOrTx, a: CardsAccount) => sql`
  EXISTS (SELECT 1 FROM gym_member_cards c
          WHERE c.gym_id = e.gym_id AND c.entry_id = e.id AND c.environment = ${a.environment} AND c.account_id = ${a.accountId})`;
const RENEWS = (sql: SqlOrTx, now: Date) => sql`(SELECT ${paysForRenewal(sql, now)} FROM (SELECT e.gym_id, e.id AS entry_id) k)`;
const NEEDS_CARD = (sql: SqlOrTx, a: CardsAccount, now: Date) => sql`
  e.former_at IS NULL AND NOT ${HAS_PAYER(sql)} AND NOT ${HAS_CARD(sql, a)} AND ${RENEWS(sql, now)}`;

/** The gym's current records that need a card: the Members list's "No card on file". */
export async function needsCardIds(sql: SqlOrTx, gymId: string, a: CardsAccount, now: Date): Promise<string[]> {
  const rows = await sql<{ id: string }[]>`
    SELECT e.id FROM gym_member_list_entries e WHERE e.gym_id = ${gymId} AND ${NEEDS_CARD(sql, a, now)}`;
  return rows.map((row) => row.id);
}

/** How many current records need a card, for the Filter's count. */
export async function needsCardCount(sql: SqlOrTx, gymId: string, a: CardsAccount, now: Date): Promise<number> {
  const [row] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM gym_member_list_entries e WHERE e.gym_id = ${gymId} AND ${NEEDS_CARD(sql, a, now)}`;
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
      user_ids: string[];
      asked_at: Date | null;
      asked_on: string | null;
      own_types: string[];
      pays_for_others: boolean;
    }[]
  >`
    SELECT e.id AS entry_id, e.full_name, (e.former_at IS NOT NULL) AS former,
           (SELECT pe.full_name FROM gym_member_payers p
            JOIN gym_member_list_entries pe ON pe.gym_id = p.gym_id AND pe.id = p.payer_entry_id
            WHERE p.gym_id = e.gym_id AND p.entry_id = e.id) AS payer_name,
           ${HAS_CARD(sql, a)} AS has_card,
           ${RENEWS(sql, now)} AS renews,
           ARRAY(SELECT m.user_id FROM gym_members m JOIN users u ON u.id = m.user_id AND u.status = 'active'
                 WHERE m.gym_id = e.gym_id AND m.entry_id = e.id AND m.removed_at IS NULL ORDER BY m.user_id) AS user_ids,
           asked.sent_at AS asked_at, asked.gym_day::text AS asked_on,
           ARRAY(SELECT DISTINCT t.name FROM gym_held_memberships h
                 JOIN gym_membership_types t ON t.gym_id = h.gym_id AND t.id = h.membership_type_id
                 WHERE h.gym_id = e.gym_id AND h.entry_id = e.id AND h.status IN ('active','frozen')
                   AND ${STILL_RENEWS(sql, now)} ORDER BY t.name) AS own_types,
           EXISTS (SELECT 1 FROM gym_member_payers q
                   JOIN gym_held_memberships h ON h.gym_id = q.gym_id AND h.entry_id = q.entry_id
                   JOIN gym_member_list_entries qe ON qe.gym_id = q.gym_id AND qe.id = q.entry_id AND qe.former_at IS NULL
                   WHERE q.gym_id = e.gym_id AND q.payer_entry_id = e.id AND h.status IN ('active','frozen')
                     AND ${STILL_RENEWS(sql, now)}) AS pays_for_others
    FROM gym_member_list_entries e
    LEFT JOIN LATERAL (
      SELECT x.sent_at, x.gym_day FROM gym_member_messages x
      JOIN gym_members m ON m.gym_id = x.gym_id AND m.user_id = x.user_id AND m.entry_id = e.id AND m.removed_at IS NULL
      WHERE x.gym_id = e.gym_id AND x.kind = ${CARD_REQUEST_MESSAGE_KIND}
      ORDER BY x.sent_at DESC LIMIT 1
    ) asked ON true
    WHERE e.gym_id = ${gymId} AND e.id = ANY(${[...ids]}::uuid[])
    ORDER BY e.full_name, e.id`;
  return rows.map((r) => ({
    entryId: r.entry_id,
    name: r.full_name,
    former: r.former,
    payerName: r.payer_name,
    hasCard: r.has_card,
    renews: r.renews,
    userIds: r.user_ids,
    askedAt: r.asked_at,
    askedOn: r.asked_on,
    ownTypes: r.own_types,
    paysForOthers: r.pays_for_others,
  }));
}
