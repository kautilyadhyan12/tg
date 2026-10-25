// The database half of Payments to match (ROADMAP 18d-iii-b-ii-a; `paymentsToMatch.ts`).
//
// The payments are `gym_square_app_payments` rows that wait (18d-iii-b-i). Every statement names the
// gym, and every write is asked under the gym's lock with the row as it stands then: a payment is put on
// a bill, marked or put back once, whichever press reaches it first.
import { memberFeeKindSchema, SQUARE_APP_WAIT_REASONS, type MemberFeeKind, type SalePerson, type SquareAppWaitReason } from "@app/shared";
import type { Sql, TransactionSql } from "postgres";
import { z } from "zod";
import { NO_NAME } from "../register/repo.js";
import type { SquareEnvironment } from "./square.js";
import type { CustomerSeen } from "./squareAppPaymentsRepo.js";

type SqlOrTx = Sql | TransactionSql;

const reasonSchema = z.enum(SQUARE_APP_WAIT_REASONS);

export interface WaitingRow {
  id: string;
  environment: SquareEnvironment;
  accountId: string;
  squarePaymentId: string;
  locationId: string;
  takenAt: Date;
  amountMinor: number;
  tipMinor: number;
  currency: string;
  enteredMinor: number | null;
  refundedMinor: number;
  brand: string | null;
  last4: string | null;
  source: string | null;
  customerId: string | null;
  customer: CustomerSeen | null;
  /** The name the gym gave the Square device that took it. */
  deviceName: string | null;
  reason: SquareAppWaitReason;
  /** The record Square's customer is, where it is one's. */
  entryId: string | null;
  person: SalePerson | null;
}

interface RawWaiting {
  id: string;
  environment: SquareEnvironment;
  account_id: string;
  square_payment_id: string;
  location_id: string;
  taken_at: Date;
  amount_minor: number;
  tip_minor: number;
  currency: string;
  entered_minor: number | null;
  refunded_minor: number;
  brand: string | null;
  last4: string | null;
  source: string | null;
  customer_id: string | null;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  device_name: string | null;
  reason: string | null;
  entry_id: string | null;
  full_name: string | null;
  member_number: string | null;
  email: string | null;
  past: boolean | null;
}

const COLUMNS = (sql: SqlOrTx) => sql`
  w.id, w.environment, w.account_id, w.square_payment_id, w.location_id, w.taken_at, w.amount_minor, w.tip_minor, w.currency,
  w.entered_minor, w.refunded_minor, w.brand, w.last4, w.source, w.customer_id, w.customer_name, w.customer_email, w.customer_phone,
  w.device_name, w.reason, w.entry_id, e.full_name, e.member_number, e.email::text AS email, e.former_at IS NOT NULL AS past`;

function toWaiting(r: RawWaiting): WaitingRow {
  const shaped = toTaken(r);
  // A CHECK keeps a waiting payment's reason to these; one it does not know fails here, never shown as another.
  return { ...shaped, reason: reasonSchema.parse(r.reason) };
}

function toTaken(r: RawWaiting): Omit<WaitingRow, "reason"> & { reason: SquareAppWaitReason | null } {
  const customer = r.customer_name === null && r.customer_email === null && r.customer_phone === null ? null : { name: r.customer_name, email: r.customer_email, phone: r.customer_phone };
  return {
    id: r.id,
    environment: r.environment,
    accountId: r.account_id,
    squarePaymentId: r.square_payment_id,
    locationId: r.location_id,
    takenAt: r.taken_at,
    amountMinor: r.amount_minor,
    tipMinor: r.tip_minor,
    currency: r.currency,
    enteredMinor: r.entered_minor,
    refundedMinor: r.refunded_minor,
    brand: r.brand,
    last4: r.last4,
    source: r.source,
    customerId: r.customer_id,
    customer,
    deviceName: r.device_name,
    reason: r.reason === null ? null : reasonSchema.parse(r.reason),
    entryId: r.entry_id,
    person:
      r.entry_id === null || r.full_name === null
        ? null
        : { entryId: r.entry_id, name: r.full_name.trim() === "" ? NO_NAME : r.full_name, memberNumber: r.member_number, email: r.email, past: r.past === true },
  };
}

/** The gym's payments that wait, newest first, a page from the `from`th. */
export async function waitingPage(sql: SqlOrTx, gymId: string, from: number, limit: number): Promise<WaitingRow[]> {
  const rows = await sql<RawWaiting[]>`
    SELECT ${COLUMNS(sql)}
    FROM gym_square_app_payments w
    LEFT JOIN gym_member_list_entries e ON e.gym_id = w.gym_id AND e.id = w.entry_id
    WHERE w.gym_id = ${gymId} AND w.state = 'waiting'
    ORDER BY w.taken_at DESC, w.id DESC
    OFFSET ${from} LIMIT ${limit}`;
  return rows.map(toWaiting);
}

/** How many wait, and what they come to in each currency. */
export async function waitingTotals(sql: SqlOrTx, gymId: string): Promise<{ count: number; totals: { currency: string; minor: number }[] }> {
  const rows = await sql<{ currency: string; n: number; minor: number }[]>`
    SELECT currency, count(*)::int AS n, sum(amount_minor)::bigint::float8 AS minor
    FROM gym_square_app_payments
    WHERE gym_id = ${gymId} AND state = 'waiting'
    GROUP BY currency
    ORDER BY currency`;
  return { count: rows.reduce((sum, r) => sum + r.n, 0), totals: rows.map((r) => ({ currency: r.currency, minor: r.minor })) };
}

/** One of the gym's payments from Square Point of Sale, as it stands. `lock`: held until the caller's
 *  transaction ends, under the gym's lock. */
export async function readTaken(
  sql: SqlOrTx,
  gymId: string,
  id: string,
  lock = false,
): Promise<TakenRow | null> {
  const rows = lock
    ? await sql<(RawWaiting & { state: string; not_bill: string | null; member_payment_id: string | null; record_key: string; reason: string | null })[]>`
        SELECT ${COLUMNS(sql)}, w.state, w.not_bill, w.member_payment_id, w.record_key
        FROM gym_square_app_payments w
        LEFT JOIN gym_member_list_entries e ON e.gym_id = w.gym_id AND e.id = w.entry_id
        WHERE w.gym_id = ${gymId} AND w.id = ${id}
        FOR UPDATE OF w`
    : await sql<(RawWaiting & { state: string; not_bill: string | null; member_payment_id: string | null; record_key: string; reason: string | null })[]>`
        SELECT ${COLUMNS(sql)}, w.state, w.not_bill, w.member_payment_id, w.record_key
        FROM gym_square_app_payments w
        LEFT JOIN gym_member_list_entries e ON e.gym_id = w.gym_id AND e.id = w.entry_id
        WHERE w.gym_id = ${gymId} AND w.id = ${id}`;
  const row = rows[0];
  if (row === undefined) return null;
  return { ...toTaken(row), state: row.state, notBill: row.not_bill, memberPaymentId: row.member_payment_id, recordKey: row.record_key };
}

/** A payment from Square Point of Sale in any state: `reason` is why it waits (kept while it is marked). */
export type TakenRow = Omit<WaitingRow, "reason"> & {
  reason: SquareAppWaitReason | null;
  state: string;
  notBill: string | null;
  memberPaymentId: string | null;
  recordKey: string;
};

/** Matched by staff: on the bill now, as `recorded`, under the request's key. Square's details of its
 *  customer go: the payment is the record's now, and they were kept only to tell who it was. */
export async function markMatched(tx: TransactionSql, gymId: string, id: string, m: { memberPaymentId: string; entryId: string; recordKey: string }, now: Date): Promise<boolean> {
  const rows = await tx<{ id: string }[]>`
    UPDATE gym_square_app_payments
    SET state = 'recorded', reason = NULL, member_payment_id = ${m.memberPaymentId}, entry_id = ${m.entryId}, record_key = ${m.recordKey},
        customer_name = NULL, customer_email = NULL, customer_phone = NULL, updated_at = ${now}
    WHERE gym_id = ${gymId} AND id = ${id} AND state = 'waiting'
    RETURNING id`;
  return rows.length === 1;
}

/** Not a bill payment: off the list, keeping why it waited. */
export async function markNotBill(tx: TransactionSql, gymId: string, id: string, why: "other" | "by_hand", now: Date): Promise<boolean> {
  const rows = await tx<{ id: string }[]>`
    UPDATE gym_square_app_payments SET state = 'not_bill', not_bill = ${why}, updated_at = ${now}
    WHERE gym_id = ${gymId} AND id = ${id} AND state = 'waiting'
    RETURNING id`;
  return rows.length === 1;
}

/** Undo: back on the list, waiting as it was. */
export async function putBack(tx: TransactionSql, gymId: string, id: string, now: Date): Promise<boolean> {
  const rows = await tx<{ id: string }[]>`
    UPDATE gym_square_app_payments SET state = 'waiting', not_bill = NULL, updated_at = ${now}
    WHERE gym_id = ${gymId} AND id = ${id} AND state = 'not_bill'
    RETURNING id`;
  return rows.length === 1;
}

/** Square has given money back on it since it was taken in: it waits as refunded. */
export async function markRefunded(tx: TransactionSql, gymId: string, id: string, refundedMinor: number, now: Date): Promise<void> {
  await tx`
    UPDATE gym_square_app_payments SET reason = 'refunded', refunded_minor = ${refundedMinor}, updated_at = ${now}
    WHERE gym_id = ${gymId} AND id = ${id} AND state = 'waiting'`;
}

/** Payments waiting at this Square location that two gyms here use, with no customer to say whose: kept for
 *  neither gym (`several_gyms`), so counted for each, never shown; and only while another gym here is still
 *  connected at that location, which is what the screen says. */
export async function sharedLocationCount(sql: SqlOrTx, at: { gymId: string; environment: SquareEnvironment; accountId: string; locationId: string }): Promise<number> {
  const [row] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM gym_square_app_payments
    WHERE gym_id IS NULL AND state = 'waiting' AND reason = 'several_gyms'
      AND environment = ${at.environment} AND account_id = ${at.accountId} AND location_id = ${at.locationId}
      AND EXISTS (
        SELECT 1 FROM gym_payment_connections c
        WHERE c.provider = 'square' AND c.environment = ${at.environment} AND c.state = 'connected'
          AND c.account_id = ${at.accountId} AND c.location_id = ${at.locationId} AND c.gym_id <> ${at.gymId})`;
  return row?.n ?? 0;
}

/** A card on file the app could charge: saved in a Square account the gym is connected to now (alias `k`). */
const chargeable = (sql: SqlOrTx) => sql`
  EXISTS (SELECT 1 FROM gym_payment_connections c
          WHERE c.gym_id = k.gym_id AND c.provider = 'square' AND c.state = 'connected' AND c.environment = k.environment AND c.account_id = k.account_id)`;

/** Of these people, those whose card on file a payment of theirs waiting holds: the card their own bills
 *  are charged to (theirs, or their payer's), or their own where they pay for somebody; only a card the app
 *  could charge, in the Square account connected now (round one, Low 3). */
export async function cardHeldFor(sql: SqlOrTx, gymId: string, entryIds: readonly string[]): Promise<Set<string>> {
  if (entryIds.length === 0) return new Set();
  const rows = await sql<{ entry_id: string }[]>`
    SELECT x.entry_id FROM unnest(${[...entryIds]}::uuid[]) AS x(entry_id)
    WHERE EXISTS (
            SELECT 1 FROM gym_member_cards k
            WHERE k.gym_id = ${gymId} AND ${chargeable(sql)}
              AND k.entry_id = COALESCE((SELECT p.payer_entry_id FROM gym_member_payers p WHERE p.gym_id = ${gymId} AND p.entry_id = x.entry_id), x.entry_id))
       OR (EXISTS (SELECT 1 FROM gym_member_payers p WHERE p.gym_id = ${gymId} AND p.payer_entry_id = x.entry_id)
           AND EXISTS (SELECT 1 FROM gym_member_cards k WHERE k.gym_id = ${gymId} AND k.entry_id = x.entry_id AND ${chargeable(sql)}))`;
  return new Set(rows.map((r) => r.entry_id));
}

/** The one current record with this email or phone, where exactly one has it: who Match fills in for a
 *  Square customer linked to nobody. Each is the whole of what Square has, never a part of it. */
export async function onlyRecordWith(sql: SqlOrTx, gymId: string, contact: { email: string | null; phone: string | null }): Promise<SalePerson | null> {
  const phone = contact.phone === null ? null : phoneE164Like(contact.phone);
  if (contact.email === null && phone === null) return null;
  const rows = await sql<{ id: string; full_name: string; member_number: string | null; email: string | null; by: string }[]>`
    SELECT id, full_name, member_number, email::text AS email, 'email' AS by FROM gym_member_list_entries
    WHERE gym_id = ${gymId} AND former_at IS NULL AND ${contact.email}::citext IS NOT NULL AND email = ${contact.email}::citext
    UNION ALL
    SELECT id, full_name, member_number, email::text AS email, 'phone' AS by FROM gym_member_list_entries
    WHERE gym_id = ${gymId} AND former_at IS NULL AND ${phone}::text IS NOT NULL AND phone_e164 = ${phone}
    LIMIT 10`;
  for (const by of ["email", "phone"]) {
    const found = rows.filter((r) => r.by === by);
    const [only] = found;
    if (found.length === 1 && only !== undefined) {
      return { entryId: only.id, name: only.full_name.trim() === "" ? NO_NAME : only.full_name, memberNumber: only.member_number, email: only.email, past: false };
    }
  }
  return null;
}

/** A phone as Square keeps it ("+15551234567", "+1 555-123-4567") in the list's own form: a plus and its
 *  digits. Null for one with no country code, which could be any country's. */
export function phoneE164Like(phone: string): string | null {
  const trimmed = phone.trim();
  if (!trimmed.startsWith("+")) return null;
  const digits = trimmed.slice(1).replace(/[\s().-]/g, "");
  return /^[1-9][0-9]{6,14}$/.test(digits) ? `+${digits}` : null;
}

/** The records each Square customer is linked to in this gym, by name: the customer the app made for them,
 *  or the one their card on file is saved on. */
export async function linkedNames(
  sql: SqlOrTx,
  q: { gymId: string; environment: SquareEnvironment; accountId: string; customerIds: readonly string[] },
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (q.customerIds.length === 0) return out;
  const rows = await sql<{ customer_id: string; full_name: string }[]>`
    SELECT l.customer_id, e.full_name
    FROM (
      SELECT customer_id, entry_id FROM gym_square_customers
      WHERE gym_id = ${q.gymId} AND environment = ${q.environment} AND account_id = ${q.accountId} AND customer_id = ANY(${[...q.customerIds]}::text[])
      UNION
      SELECT customer_id, entry_id FROM gym_member_cards
      WHERE gym_id = ${q.gymId} AND environment = ${q.environment} AND account_id = ${q.accountId} AND customer_id = ANY(${[...q.customerIds]}::text[])
    ) l
    JOIN gym_member_list_entries e ON e.gym_id = ${q.gymId} AND e.id = l.entry_id
    ORDER BY l.customer_id, lower(e.full_name), e.id`;
  for (const r of rows) out.set(r.customer_id, [...(out.get(r.customer_id) ?? []), r.full_name.trim() === "" ? NO_NAME : r.full_name]);
  return out;
}

export interface WaitingForRow {
  id: string;
  amountMinor: number;
  currency: string;
  takenOn: string;
  takenAt: Date;
  deviceName: string | null;
  enteredMinor: number | null;
  reason: SquareAppWaitReason;
  /** Whose payment: the person's own, or their payer's. */
  entryId: string;
  byName: string | null;
}

/** The payments waiting that hold this person's card on file: theirs, and those of whoever pays for them,
 *  newest first, with the payer's name where it is theirs, and the gym's own day each was taken. */
export async function waitingFor(sql: SqlOrTx, gymId: string, entryId: string): Promise<WaitingForRow[]> {
  const rows = await sql<
    {
      id: string;
      amount_minor: number;
      currency: string;
      taken_on: string;
      taken_at: Date;
      device_name: string | null;
      entered_minor: number | null;
      reason: string | null;
      entry_id: string;
      full_name: string;
    }[]
  >`
    SELECT w.id, w.amount_minor, w.currency, (w.taken_at AT TIME ZONE g.timezone)::date::text AS taken_on, w.taken_at, w.device_name,
           w.entered_minor, w.reason, w.entry_id, e.full_name
    FROM gym_square_app_payments w
    JOIN gyms g ON g.id = w.gym_id
    JOIN gym_member_list_entries e ON e.gym_id = w.gym_id AND e.id = w.entry_id
    WHERE w.gym_id = ${gymId} AND w.state = 'waiting'
      AND w.entry_id IN (${entryId}::uuid, (SELECT p.payer_entry_id FROM gym_member_payers p WHERE p.gym_id = ${gymId} AND p.entry_id = ${entryId}))
    ORDER BY w.taken_at DESC, w.id DESC
    LIMIT 20`;
  return rows.map((r) => ({
    id: r.id,
    amountMinor: r.amount_minor,
    currency: r.currency,
    takenOn: r.taken_on,
    takenAt: r.taken_at,
    deviceName: r.device_name,
    enteredMinor: r.entered_minor,
    reason: reasonSchema.parse(r.reason),
    entryId: r.entry_id,
    byName: r.entry_id === entryId ? null : r.full_name.trim() === "" ? NO_NAME : r.full_name,
  }));
}

// ── Match's box ──────────────────────────────────────────────────────────────

export interface PersonRow {
  entryId: string;
  name: string;
  memberNumber: string | null;
  email: string | null;
  past: boolean;
}

/** Each person asked for, then the people they pay for (18i), in that order, by the person asked for; a
 *  person who is not the gym's is missing. */
export async function peopleOfMany(sql: SqlOrTx, gymId: string, entryIds: readonly string[]): Promise<Map<string, PersonRow[]>> {
  const out = new Map<string, PersonRow[]>();
  if (entryIds.length === 0) return out;
  const rows = await sql<{ root: string; id: string; full_name: string; member_number: string | null; email: string | null; past: boolean }[]>`
    SELECT x.root, e.id, e.full_name, e.member_number, e.email::text AS email, e.former_at IS NOT NULL AS past
    FROM unnest(${[...entryIds]}::uuid[]) AS x(root)
    JOIN gym_member_list_entries e ON e.gym_id = ${gymId}
      AND (e.id = x.root OR e.id IN (SELECT p.entry_id FROM gym_member_payers p WHERE p.gym_id = ${gymId} AND p.payer_entry_id = x.root))
    ORDER BY x.root, (e.id = x.root) DESC, lower(e.full_name), e.id`;
  for (const r of rows) {
    const person = { entryId: r.id, name: r.full_name.trim() === "" ? NO_NAME : r.full_name, memberNumber: r.member_number, email: r.email, past: r.past };
    out.set(r.root, [...(out.get(r.root) ?? []), person]);
  }
  for (const [root, people] of out) if (people[0]?.entryId !== root) out.delete(root);
  return out;
}

/** The memberships of these people a bill could be paid on: in use, or with a bill still owed. */
export async function membershipsOf(sql: SqlOrTx, gymId: string, entryIds: readonly string[]): Promise<{ id: string; entryId: string }[]> {
  if (entryIds.length === 0) return [];
  const rows = await sql<{ id: string; entry_id: string }[]>`
    SELECT h.id, h.entry_id FROM gym_held_memberships h
    WHERE h.gym_id = ${gymId} AND h.entry_id = ANY(${[...entryIds]}::uuid[])
      AND (h.status IN ('active','frozen')
           OR EXISTS (SELECT 1 FROM gym_member_bills b WHERE b.gym_id = h.gym_id AND b.held_membership_id = h.id AND b.status = 'open'))
    ORDER BY h.entry_id, h.id`;
  return rows.map((r) => ({ id: r.id, entryId: r.entry_id }));
}

export interface OpenFee {
  id: string;
  membershipId: string;
  kind: MemberFeeKind;
  forName: string;
  amountMinor: number;
  paidMinor: number;
  currency: string;
  dueOn: string;
}

/** These memberships' fees still owed. */
export async function openFeesOf(sql: SqlOrTx, gymId: string, membershipIds: readonly string[]): Promise<OpenFee[]> {
  if (membershipIds.length === 0) return [];
  const rows = await sql<{ id: string; held_membership_id: string; fee: string; fee_for: string; amount_minor: number; paid_minor: number; currency: string; due_on: string }[]>`
    SELECT b.id, b.held_membership_id, b.fee, b.fee_for, b.amount_minor, b.currency, b.due_on::text AS due_on,
           COALESCE((SELECT sum(p.amount_minor) FROM gym_member_payments p WHERE p.gym_id = b.gym_id AND p.bill_id = b.id AND p.undone_at IS NULL), 0)::int AS paid_minor
    FROM gym_member_bills b
    WHERE b.gym_id = ${gymId} AND b.held_membership_id = ANY(${[...membershipIds]}::uuid[]) AND b.fee IS NOT NULL AND b.status = 'open'
    ORDER BY b.due_on, b.id`;
  return rows.map((r) => ({
    id: r.id,
    membershipId: r.held_membership_id,
    kind: memberFeeKindSchema.parse(r.fee),
    forName: r.fee_for,
    amountMinor: r.amount_minor,
    paidMinor: r.paid_minor,
    currency: r.currency,
    dueOn: r.due_on,
  }));
}

/** The memberships of these that have money out through Square now: on the Terminal, or the card on file. */
export async function busyOf(sql: SqlOrTx, gymId: string, membershipIds: readonly string[]): Promise<Set<string>> {
  if (membershipIds.length === 0) return new Set();
  const rows = await sql<{ id: string }[]>`
    SELECT held_membership_id AS id FROM gym_terminal_payments WHERE gym_id = ${gymId} AND held_membership_id = ANY(${[...membershipIds]}::uuid[]) AND state = 'waiting'
    UNION
    SELECT held_membership_id AS id FROM gym_card_charges WHERE gym_id = ${gymId} AND held_membership_id = ANY(${[...membershipIds]}::uuid[]) AND state = 'charging'`;
  return new Set(rows.map((r) => r.id));
}

/** The gym has taken payments in Square Point of Sale: Today's takings says where their shop sales are. */
export async function usesSquareApp(sql: SqlOrTx, gymId: string): Promise<boolean> {
  const [row] = await sql<{ any: boolean }[]>`SELECT EXISTS (SELECT 1 FROM gym_square_app_payments WHERE gym_id = ${gymId}) AS any`;
  return row?.any === true;
}

/** Whom staff pick in Square Point of Sale for this person's bill, by name, so the payment comes to their
 *  page with the bill ticked: the person, where a Square customer of this account is linked to them (the one
 *  the app made, or their card on file's), else whoever pays for them, so linked. Null for neither: the
 *  payment will wait in Payments to match. */
export async function squareAppPick(sql: SqlOrTx, q: { gymId: string; entryId: string; environment: SquareEnvironment; accountId: string }): Promise<string | null> {
  const rows = await sql<{ full_name: string; own: boolean }[]>`
    SELECT e.full_name, e.id = ${q.entryId} AS own
    FROM gym_member_list_entries e
    WHERE e.gym_id = ${q.gymId}
      AND (e.id = ${q.entryId} OR e.id = (SELECT p.payer_entry_id FROM gym_member_payers p WHERE p.gym_id = ${q.gymId} AND p.entry_id = ${q.entryId}))
      AND (EXISTS (SELECT 1 FROM gym_square_customers c WHERE c.gym_id = e.gym_id AND c.entry_id = e.id AND c.environment = ${q.environment} AND c.account_id = ${q.accountId})
           OR EXISTS (SELECT 1 FROM gym_member_cards k WHERE k.gym_id = e.gym_id AND k.entry_id = e.id AND k.environment = ${q.environment} AND k.account_id = ${q.accountId}))
    ORDER BY own DESC`;
  const first = rows[0];
  return first === undefined ? null : first.full_name.trim() === "" ? NO_NAME : first.full_name;
}
