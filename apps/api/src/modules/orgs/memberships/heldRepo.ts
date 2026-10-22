// A person's memberships: the only file that reads or writes them (spec Part 3
// §13.2; ROADMAP 17a-ii).
//
// Every statement carries `gym_id` in its WHERE, and a membership is found by its
// gym, its record and its id together, never the id alone. Every write takes the
// gym's row and then the record's, in the order a merge of two records does
// (`memberList/byHandService.ts`), so a membership is never written onto a record
// that is being deleted. What a write may do is decided by the one rule in
// `@app/shared` (`moveHeldMembership`), on the day the service passes in.
// The one other writer is `wordsRepo.ts`, which gives a type to everybody who carries
// one of the list's words, under the same gym lock. A class booking (17c-i,
// `classes/bookingsRepo.ts`) reads a record's memberships and takes a class off a pack or
// gives it back through `heldForBooking`, `chargePack` and `givePackClassBack` below,
// under that lock too. A membership given with a discount (18b-ii-b) reads and uses it
// through `register/discountsRepo.ts`, in the giving's own transaction. A membership keeps
// the tax rate its type charged when it was given (18b-iii), and every bill it opens charges
// that rate's percentage as it is that day.
//
// `status` holds the last status written, and the clock ends a membership without
// writing: every write first marks the record's memberships the clock has ended
// (`settle`), so the rows still stored `active` stay few, and every read passes each
// row through the rule.
import type { Sql, TransactionSql } from "postgres";
import { z } from "zod";
import {
  HELD_EARLIER_PAGE,
  HELD_LIVE_MAX,
  MEMBERSHIP_PAYMENTS,
  addDays,
  addGiftDays,
  periodStart,
  giftDaysNextDay,
  giftDaysTarget,
  giftDaysNeverReached,
  takeBackGiftDays,
  billsAtCancel,
  billsToOpen,
  periodListedMinor,
  partMinor,
  partPeriod,
  countAfterGap,
  discountFits,
  freezeFeeApplies,
  giveHeldMembership,
  heldMembershipStatusSchema,
  heldMembershipView,
  sameTypeTwice,
  membershipAccessSchema,
  membershipDiscount,
  memberGiftOff,
  membershipKindSchema,
  membershipLimitPeriodSchema,
  membershipTermUnitSchema,
  moveHeldMembership,
  type DiscountRefusal,
  type HeldCover,
  type HeldMembership,
  type HeldMembershipEvent,
  type HeldMembershipTypeChoice,
  type HeldTax,
  type ListedMembership,
  type MemberPaymentByHand,
  type MembershipPayments,
  type PtHeld,
  type TaxApplied,
} from "@app/shared";
import { insertAudit, insertAudits } from "../repo.js";
import { lockEntries, lockGym } from "../memberList/repo.js";
import { lockedDiscount, takeUse } from "../register/discountsRepo.js";
import { friendGiftOpen } from "../referrals/friendGiftRepo.js";
import { giftUseUndone, giveMemberGift, lockedWaitingGift, markUsed } from "../referrals/memberGiftRepo.js";
import { rateOf, taxIncludedOf } from "../register/taxRepo.js";
import { feesFor, type FeePaymentRow, type FeeRow } from "./feesRepo.js";
import { freezeFeeOf, openFreezeFee, removeFreezeFees } from "./freezeFees.js";
import {
  billOf,
  billsFor,
  insertBills,
  insertPayment,
  overdueDaysOf,
  billDayOf,
  paymentsFor,
  refundsFor,
  setBillStatus,
  terminalWaiting,
  voidBills,
  voidedPaymentsFor,
  voidedRefundsFor,
  type BillRow,
  type PaymentRow,
  type RefundRow,
  type VoidedPaymentRow,
  type VoidedRefundRow,
} from "./billsSql.js";
import type { HasBookings, MembershipEndConfirmed } from "../classes/bookingChanges.js";
import type { MembershipScope } from "../classes/bookingsRepo.js";

export interface HeldRow {
  id: string;
  typeId: string;
  typeName: string;
  priceMinor: number;
  currency: string;
  fromList: boolean;
  /** The discount it was given with, as it was then (18b-ii-b). */
  discount: { name: string; offMinor: number; payments: MembershipPayments } | null;
  /** The tax rate it was sold with, as the rate is now (18b-iii); null for none. */
  tax: HeldTax | null;
  /** That tax as a bill opened today charges it; null for none. */
  taxApplied: TaxApplied | null;
  /** What the bill of the first period not paid comes to when opened today, its tax in (the part
   *  month's, 18y, where that is the first period); 0 for a free one. */
  nextBillMinor: number;
  /** What its freeze charges a month (18z), read while it is frozen; 0 for none. */
  freezeFeeMinor: number;
  membership: HeldMembership;
}

// Text columns under a CHECK: parsed, so a value the rule does not know fails here.
const rawSchema = z.object({
  id: z.string(),
  membership_type_id: z.string(),
  type_name: z.string(),
  kind: membershipKindSchema,
  price_minor: z.number().int(),
  currency: z.string(),
  term_count: z.number().int().nullable(),
  term_unit: membershipTermUnitSchema.nullable(),
  pack_classes: z.number().int().nullable(),
  pack_days: z.number().int().nullable(),
  starts_on: z.string(),
  frozen_days: z.number().int(),
  gift_days: z.number().int(),
  gift_from: z.number().int(),
  status: heldMembershipStatusSchema,
  frozen_on: z.string().nullable(),
  cancelled_on: z.string().nullable(),
  paid_periods: z.number().int(),
  paid_floor: z.number().int(),
  renews: z.boolean(),
  classes_left: z.number().int().nullable(),
  full_from: z.string().nullable(),
  freeze_fee_minor: z.number().int(),
  from_list: z.boolean(),
  discount_name: z.string().nullable(),
  discount_minor: z.number().int(),
  discount_payments: z.enum(MEMBERSHIP_PAYMENTS).nullable(),
  tax_name: z.string().nullable(),
  tax_bp: z.number().int().nullable(),
  tax_included: z.boolean().nullable(),
});

/** The part month's price of a membership billed from the gym's day (18y), before tax. */
function partOf(r: z.infer<typeof rawSchema>): number {
  const part = partPeriod({ kind: r.kind, termCount: r.term_count, termUnit: r.term_unit, packDays: r.pack_days, startsOn: r.starts_on, fullFrom: r.full_from });
  return part === null ? r.price_minor : partMinor(r.price_minor, part);
}

function shape(row: unknown): HeldRow {
  const r = rawSchema.parse(row);
  const tax = r.tax_name === null || r.tax_bp === null ? null : { name: r.tax_name, bp: r.tax_bp };
  // Whether its price held the tax is the membership's own, kept when it was sold.
  const taxApplied = tax === null ? null : { ...tax, included: r.tax_included ?? false };
  return {
    tax,
    taxApplied,
    freezeFeeMinor: r.freeze_fee_minor,
    nextBillMinor: r.price_minor === 0 ? 0 : billOf(r.full_from !== null && r.paid_periods === 0 ? partOf(r) : r.price_minor, taxApplied).amountMinor,
    id: r.id,
    typeId: r.membership_type_id,
    typeName: r.type_name,
    priceMinor: r.price_minor,
    currency: r.currency,
    fromList: r.from_list,
    discount: r.discount_name === null || r.discount_payments === null ? null : { name: r.discount_name, offMinor: r.discount_minor, payments: r.discount_payments },
    membership: {
      kind: r.kind,
      termCount: r.term_count,
      termUnit: r.term_unit,
      packClasses: r.pack_classes,
      packDays: r.pack_days,
      free: r.price_minor === 0,
      startsOn: r.starts_on,
      frozenDays: r.frozen_days,
      giftDays: r.gift_days,
      giftFrom: r.gift_from,
      status: r.status,
      frozenOn: r.frozen_on,
      cancelledOn: r.cancelled_on,
      paidPeriods: r.paid_periods,
      paidFloor: r.paid_floor,
      renews: r.renews,
      classesLeft: r.classes_left,
      fullFrom: r.full_from,
    },
  };
}

const typeSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: membershipKindSchema,
  price_minor: z.number().int(),
  currency: z.string(),
  term_count: z.number().int().nullable(),
  term_unit: membershipTermUnitSchema.nullable(),
  pack_classes: z.number().int().nullable(),
  pack_days: z.number().int().nullable(),
  tax_rate_id: z.string().nullable(),
  tax_name: z.string().nullable(),
  tax_bp: z.number().int().nullable(),
  joining_fee_minor: z.number().int(),
});

/** The tax rate a type charges, by id: what a membership given from it keeps. None for a
 *  free type: it opens no bill. */
export function typeTaxRateId(row: unknown): string | null {
  const t = typeSchema.parse(row);
  return t.price_minor === 0 ? null : t.tax_rate_id;
}

const rawTypePrice = (row: unknown): number => typeSchema.parse(row).price_minor;

export function typeChoice(row: unknown): HeldMembershipTypeChoice {
  const t = typeSchema.parse(row);
  return {
    tax: t.tax_name === null || t.tax_bp === null ? null : { name: t.tax_name, bp: t.tax_bp },
    id: t.id,
    name: t.name,
    kind: t.kind,
    priceMinor: t.price_minor,
    currency: t.currency,
    termCount: t.term_count,
    termUnit: t.term_unit,
    packClasses: t.pack_classes,
    packDays: t.pack_days,
    joiningFeeMinor: t.joining_fee_minor,
  };
}

/** A gym's live types, or the one named; a gym has at most 60. */
export const liveTypes = (sql: Sql | TransactionSql, gymId: string, typeId: string | null) => sql`
  SELECT id, name, kind, price_minor, currency, term_count, term_unit, pack_classes, pack_days, updated_at, tax_rate_id, joining_fee_minor,
         (SELECT r.name FROM gym_tax_rates r WHERE r.gym_id = gym_membership_types.gym_id AND r.id = gym_membership_types.tax_rate_id) AS tax_name,
         (SELECT r.rate_bp FROM gym_tax_rates r WHERE r.gym_id = gym_membership_types.gym_id AND r.id = gym_membership_types.tax_rate_id) AS tax_bp
  FROM gym_membership_types
  WHERE gym_id = ${gymId} AND archived_at IS NULL
    AND (${typeId}::uuid IS NULL OR id = ${typeId}::uuid)
  ORDER BY lower(name), id`;

const COLUMNS = (sql: Sql | TransactionSql) => sql`
  h.id, h.membership_type_id, t.name AS type_name, h.kind, h.price_minor, h.currency,
  h.term_count, h.term_unit, h.pack_classes, h.pack_days,
  h.starts_on::text AS starts_on, h.frozen_days, h.gift_days, h.gift_from, h.status,
  h.frozen_on::text AS frozen_on, h.cancelled_on::text AS cancelled_on,
  h.paid_periods, h.paid_floor, h.renews, h.classes_left, h.from_list, h.full_from::text AS full_from,
  h.freeze_fee_minor, h.discount_name, h.discount_minor, h.discount_payments,
  (SELECT r.name FROM gym_tax_rates r WHERE r.gym_id = h.gym_id AND r.id = h.tax_rate_id) AS tax_name,
  (SELECT r.rate_bp FROM gym_tax_rates r WHERE r.gym_id = h.gym_id AND r.id = h.tax_rate_id) AS tax_bp,
  h.tax_included`;

/** The record's memberships of the statuses named, newest start first. */
const held = (sql: Sql | TransactionSql, gymId: string, entryId: string, statuses: readonly string[], limit: number) => sql`
  SELECT ${COLUMNS(sql)}
  FROM gym_held_memberships h
  JOIN gym_membership_types t ON t.gym_id = h.gym_id AND t.id = h.membership_type_id
  WHERE h.gym_id = ${gymId} AND h.entry_id = ${entryId} AND h.status = ANY(${[...statuses]}::text[])
  ORDER BY h.starts_on DESC, h.id
  LIMIT ${limit}`;

const IN_USE = ["active", "frozen"] as const;
const OVER = ["ended", "cancelled"] as const;
/** Rows stored `active` or `frozen`: at most `HELD_LIVE_MAX` in use, and the ones the
 *  clock has ended since the record's last write. */
const IN_USE_READ = 500;

export interface HeldList {
  /** The record is a past member's. */
  past: boolean;
  /** Stored `active` or `frozen`; the rule says which of them the clock has ended. */
  inUse: HeldRow[];
  /** Stored `ended` or `cancelled`: a page, newest start first, and how many there are. */
  over: HeldRow[];
  overTotal: number;
  types: HeldMembershipTypeChoice[];
  /** What the member list says their membership is; null where it says nothing, and for
   *  a past member. */
  listed: ListedMembership | null;
  /** The bills of every membership here, the payments and refunds that stand, and the
   *  gym's own number of days before an unpaid bill reads Overdue (18a-i, 18a-ii). */
  bills: BillRow[];
  payments: PaymentRow[];
  refunds: RefundRow[];
  /** The payments and refunds staff voided (18o): shown struck through, counted in nothing. */
  voidedPayments: VoidedPaymentRow[];
  voidedRefunds: VoidedRefundRow[];
  /** The late cancel and no-show fees on them, and their payments (18h-i). */
  fees: FeeRow[];
  feePayments: FeePaymentRow[];
  overdueAfterDays: number;
  /** Whether the gym's prices hold its tax (18b-iii), for the Add form's total. */
  taxIncluded: boolean;
  /** The day of the month the gym bills everyone on (18y), for the Add form; null for none. */
  billDay: number | null;
  /** The gym's freeze fee a month (18z), for the Freeze box; 0 for none. */
  freezeFee: number;
  /** Every membership of this record given in place of another (18x), with both type names. */
  changes: HeldChange[];
}

/** One change of membership (18x): the new one, the one it replaced, and their types' names. */
export interface HeldChange {
  newId: string;
  oldId: string;
  newName: string;
  oldName: string;
  startsOn: string;
  newStatus: string;
  /** The change set the old one to stop: cancelling the new one before it starts undoes that. */
  stopped: boolean;
}

/** What the list says this record's membership is, and how that name stands with the
 *  price list: the live type staff said it is (`gym_membership_word_links`), else the
 *  live type of that very name, matched as the list's chips fold a word (`lower`). A
 *  name tied to an archived type is not set up, as the Memberships page says of it. */
async function listedMembership(
  tx: TransactionSql,
  gymId: string,
  entryId: string,
  entry: { membership_type: string | null; ends_on: string | null; ends_on_kind: string | null },
): Promise<ListedMembership | null> {
  const word = entry.membership_type;
  if (word === null || word === "") return null;
  const [type] = await tx<{ id: string; name: string; own_name: boolean; held: boolean }[]>`
    SELECT t.id, t.name, (lower(t.name) = lower(${word})) AS own_name,
           EXISTS (
             SELECT 1 FROM gym_held_memberships h
             WHERE h.gym_id = t.gym_id AND h.entry_id = ${entryId} AND h.membership_type_id = t.id
           ) AS held
    FROM gym_membership_types t
    WHERE t.gym_id = ${gymId} AND t.archived_at IS NULL
      AND t.id = COALESCE(
        (SELECT l.membership_type_id FROM gym_membership_word_links l
         WHERE l.gym_id = ${gymId} AND l.word_key = lower(${word})),
        (SELECT s.id FROM gym_membership_types s
         WHERE s.gym_id = ${gymId} AND s.archived_at IS NULL AND lower(s.name) = lower(${word}))
      )`;
  return {
    word,
    endsOn: entry.ends_on,
    // Text under a CHECK: a kind this build does not know reads as the list's default, an end day.
    endsOnKind: entry.ends_on === null || entry.ends_on_kind === null ? null : entry.ends_on_kind === "renews" ? "renews" : "ends",
    type: type === undefined ? null : { id: type.id, name: type.name },
    ownName: type?.own_name ?? false,
    held: type?.held ?? false,
  };
}

/** The fees of these memberships and their payments, as `HeldList` holds them. */
async function feesOf(tx: TransactionSql, gymId: string, ids: readonly string[]): Promise<{ fees: FeeRow[]; feePayments: FeePaymentRow[] }> {
  const read = await feesFor(tx, gymId, ids);
  return { fees: read.fees, feePayments: read.payments };
}

/** A record's memberships, or null where the record is not this gym's. */
export async function readHeld(sql: Sql, gymId: string, entryId: string): Promise<HeldList | null> {
  // One connection and one moment: the page of earlier ones and their count agree.
  return await sql.begin("isolation level repeatable read read only", async (tx): Promise<HeldList | null> => {
    const [entry] = await tx<{ past: boolean; membership_type: string | null; ends_on: string | null; ends_on_kind: string | null }[]>`
      SELECT former_at IS NOT NULL AS past, membership_type, ends_on::text AS ends_on, ends_on_kind
      FROM gym_member_list_entries
      WHERE gym_id = ${gymId} AND id = ${entryId}`;
    if (entry === undefined) return null;
    const listed = entry.past ? null : await listedMembership(tx, gymId, entryId, entry);
    const inUse = await held(tx, gymId, entryId, IN_USE, IN_USE_READ);
    const over = await held(tx, gymId, entryId, OVER, HELD_EARLIER_PAGE);
    const [total] = await tx<{ n: number }[]>`
      SELECT count(*)::int AS n FROM gym_held_memberships
      WHERE gym_id = ${gymId} AND entry_id = ${entryId} AND status = ANY(${[...OVER]}::text[])`;
    const types = await liveTypes(tx, gymId, null);
    const rows = { inUse: inUse.map(shape), over: over.map(shape) };
    const ids = [...rows.inUse, ...rows.over].map((row) => row.id);
    return {
      past: entry.past,
      ...rows,
      overTotal: total?.n ?? 0,
      types: types.map(typeChoice),
      listed,
      bills: await billsFor(tx, gymId, ids),
      payments: await paymentsFor(tx, gymId, ids),
      refunds: await refundsFor(tx, gymId, ids),
      voidedPayments: await voidedPaymentsFor(tx, gymId, ids),
      voidedRefunds: await voidedRefundsFor(tx, gymId, ids),
      ...(await feesOf(tx, gymId, ids)),
      overdueAfterDays: await overdueDaysOf(tx, gymId),
      taxIncluded: (await taxIncludedOf(tx, gymId)) ?? false,
      billDay: await billDayOf(tx, gymId),
      freezeFee: await freezeFeeOf(tx, gymId),
      changes: await tx<{ new_id: string; old_id: string; new_name: string; old_name: string; starts_on: string; new_status: string; stopped: boolean }[]>`
        SELECT n.id AS new_id, n.replaces_id AS old_id, tn.name AS new_name, tt.name AS old_name,
               n.starts_on::text AS starts_on, n.status AS new_status, n.replaced_stopped AS stopped
        FROM gym_held_memberships n
        JOIN gym_held_memberships o ON o.gym_id = n.gym_id AND o.id = n.replaces_id
        JOIN gym_membership_types tn ON tn.gym_id = n.gym_id AND tn.id = n.membership_type_id
        JOIN gym_membership_types tt ON tt.gym_id = o.gym_id AND tt.id = o.membership_type_id
        WHERE n.gym_id = ${gymId} AND n.entry_id = ${entryId} AND n.replaces_id IS NOT NULL`.then((rows) =>
        rows.map((r) => ({ newId: r.new_id, oldId: r.old_id, newName: r.new_name, oldName: r.old_name, startsOn: r.starts_on, newStatus: r.new_status, stopped: r.stopped })),
      ),
    };
  });
}

export type HeldWriteOutcome =
  | { kind: "ok" }
  | { kind: "entry_not_found" }
  /** A past member holds nothing in use: put them back first. */
  | { kind: "past_member" }
  /** No live type of this gym has that id. */
  | { kind: "type_not_found" }
  | { kind: "too_many"; cap: number }
  | { kind: "start_out_of_range" }
  | { kind: "already_over" }
  /** The key of this request already gave somebody else a membership. */
  | { kind: "request_reused" }
  | { kind: "membership_not_found" }
  /** The rule refuses this change of the membership as it is today. */
  | { kind: "not_allowed" }
  /** The person has this type running already. `ends`: the one they hold has a last day,
   *  so a start date after it would be taken; a repeating one that renews has none. */
  | { kind: "already_held"; typeName: string; ends: boolean }
  /** Given as paid, with a price, and the request does not say how they paid. */
  | { kind: "method_needed" }
  /** The type's price is no longer the one the screen showed. */
  | { kind: "price_changed" }
  /** The gym's billing day (18y) is no longer the one the screen worked the first bill out on. */
  | { kind: "bill_day_changed" }
  /** The freeze fee the screen showed is no longer the gym's (18z), or this membership has none. */
  | { kind: "freeze_fee_changed" }
  /** The discount named is not one of this gym's. */
  | { kind: "discount_not_found" }
  /** The gym's own discount, and it cannot be used on this membership today. */
  | { kind: "discount_refused"; name: string; reason: DiscountRefusal }
  /** The discount rounds to nothing on this price. */
  | { kind: "discount_nothing_off"; name: string }
  /** The discount takes off the whole price. */
  | { kind: "discount_nothing_to_pay" }
  /** The Refer a friend gift named is not this record's, or is no longer waiting. */
  | { kind: "member_gift_not_theirs" }
  /** What the gift takes off is no longer what the screen showed, or it no longer fits. */
  | { kind: "member_gift_changed" }
  /** What the discount takes off is no longer what the screen showed. */
  | { kind: "discount_changed" }
  /** Refer a friend's gift, for somebody who is not an invited friend, or has had it. */
  | { kind: "friend_gift_not_theirs" }
  /** A cancel, and a payment stands on a bill for days after the membership's last day. */
  | { kind: "early_payment" }
  /** A payment for this membership waits on the gym's Square Terminal (18d-vi-a). */
  | { kind: "terminal_waiting" };

/** The record under the gym's lock and its own: null where it is not this gym's. */
export async function lockedEntry(tx: TransactionSql, gymId: string, entryId: string): Promise<{ past: boolean } | null> {
  await lockGym(tx, gymId);
  await lockEntries(tx, gymId, [entryId]);
  const [entry] = await tx<{ past: boolean }[]>`
    SELECT former_at IS NOT NULL AS past FROM gym_member_list_entries
    WHERE gym_id = ${gymId} AND id = ${entryId}`;
  return entry ?? null;
}

/** What the clock alone has done to the record's memberships, written before any change
 *  to them: the ones it has ended are marked, and a count that stands before periods
 *  nobody was asked for is moved over them (`countAfterGap`). Answers how many are still
 *  in use. Under the record's lock; a caller reads the rows it works on AFTER this. */
export async function settle(tx: TransactionSql, gymId: string, entryId: string, today: string, now: Date): Promise<number> {
  const rows = (await held(tx, gymId, entryId, IN_USE, IN_USE_READ)).map(shape);
  const ended = rows.filter((row) => heldMembershipView(row.membership, today).status === "ended").map((row) => row.id);
  if (ended.length > 0) {
    await tx`
      UPDATE gym_held_memberships SET status = 'ended', updated_at = ${now}
      WHERE gym_id = ${gymId} AND entry_id = ${entryId} AND status = 'active' AND id = ANY(${ended}::uuid[])`;
  }
  // Read the bills only for a membership whose count is behind today's period at all.
  const behind = rows.filter((row) => countAfterGap(row.membership, today, new Set()) !== null);
  if (behind.length > 0) {
    const bills = await billsFor(tx, gymId, behind.map((row) => row.id));
    const moves: CountMove[] = [];
    for (const row of behind) {
      const count = countAfterGap(row.membership, today, new Set(bills.filter((b) => b.membershipId === row.id).map((b) => b.periodIndex)));
      if (count !== null) moves.push({ entryId, row, count });
    }
    await writeCountsAfterGap(tx, { gymId, moves, today, now });
  }
  return rows.length - ended.length;
}

/** The open bill for the period free days lengthen (or shorten again) says the days it is
 *  for as they now are, so "Take payment … for 20 October to 28 November" agrees with the
 *  renewal beside it (round one, L2). A paid bill keeps what it was paid for. */
async function openBillTo(tx: TransactionSql, gymId: string, membershipId: string, m: HeldMembership, from: number, now: Date): Promise<void> {
  if (from < 1) return;
  await tx`
    UPDATE gym_member_bills SET covers_to = ${addDays(periodStart(m, from), -1)}::date, updated_at = ${now}
    WHERE gym_id = ${gymId} AND held_membership_id = ${membershipId} AND period_index = ${from - 1}
      AND status = 'open' AND covers_to IS NOT NULL AND covers_from <= ${addDays(periodStart(m, from), -1)}::date`;
}

/** REFER A FRIEND'S FREE DAYS ADDED (20e-ii-b-ii-b) to the one membership of this record
 *  that takes them (`giftDaysTarget`): the gym's lock and the record's, the clock's changes
 *  written first, then that one row. Null where none can take them (the money is given
 *  instead). `next`: its new renewal or last day, for the member's message. */
export async function addGiftDaysTo(
  tx: TransactionSql,
  input: { gymId: string; entryId: string; days: number; today: string; now: Date },
): Promise<{ membershipId: string; typeName: string; from: number; next: { renews: boolean; day: string } | null } | null> {
  await lockGym(tx, input.gymId);
  await lockEntries(tx, input.gymId, [input.entryId]);
  await settle(tx, input.gymId, input.entryId, input.today, input.now);
  const rows = (await held(tx, input.gymId, input.entryId, IN_USE, IN_USE_READ)).map(shape);
  const target = giftDaysTarget(rows, input.today);
  const added = target === null ? null : addGiftDays(target.membership, input.days, input.today);
  if (target === null || added === null) return null;
  const m = added.membership;
  const done = await tx<{ id: string }[]>`
    UPDATE gym_held_memberships
    SET frozen_days = ${m.frozenDays}, gift_days = ${m.giftDays}, gift_from = ${m.giftFrom}, updated_at = ${input.now}
    WHERE gym_id = ${input.gymId} AND entry_id = ${input.entryId} AND id = ${target.id}
    RETURNING id`;
  if (done.length !== 1) throw new Error("free days were not added to the membership that was read under the gym's lock");
  await openBillTo(tx, input.gymId, target.id, m, added.from, input.now);
  await insertAudit(tx, {
    actorUserId: null,
    gymId: input.gymId,
    action: "org.held_membership_gift_days_added",
    targetType: "gym_held_membership",
    targetId: target.id,
    meta: { entryId: input.entryId, type: target.typeName, on: input.today, days: String(input.days), from: String(added.from) },
  });
  return { membershipId: target.id, typeName: target.typeName, from: added.from, next: giftDaysNextDay(m, added.from) };
}

/** Free days given to `membershipId` before its period `from` TAKEN BACK, while its member
 *  has reached none of them (`takeBackGiftDays`), or true with nothing to change where it was
 *  cancelled before the first of them; false where they stay. Under the gym's lock, which
 *  the caller holds. */
export async function takeGiftDaysBack(
  tx: TransactionSql,
  input: { gymId: string; membershipId: string; days: number; from: number; today: string; now: Date },
): Promise<boolean> {
  await lockGym(tx, input.gymId);
  const [found] = await tx<{ entry_id: string; past: boolean }[]>`
    SELECT h.entry_id, e.former_at IS NOT NULL AS past
    FROM gym_held_memberships h
    JOIN gym_member_list_entries e ON e.gym_id = h.gym_id AND e.id = h.entry_id
    WHERE h.gym_id = ${input.gymId} AND h.id = ${input.membershipId}`;
  if (found === undefined) return false;
  await lockEntries(tx, input.gymId, [found.entry_id]);
  // A past member's record is never settled by somebody else's write, as every payment write
  // leaves it (round one, L1).
  if (!found.past) await settle(tx, input.gymId, found.entry_id, input.today, input.now);
  const row = await lockedHeld(tx, input.gymId, found.entry_id, input.membershipId);
  if (row === null) return false;
  const back = takeBackGiftDays(row.membership, input.days, input.from, input.today);
  // Cancelled before the first free day: there is nothing to take off it, and the gift goes.
  if (back === null) return giftDaysNeverReached(row.membership, input.days, input.from, input.today);
  await tx`
    UPDATE gym_held_memberships SET gift_days = ${back.giftDays}, updated_at = ${input.now}
    WHERE gym_id = ${input.gymId} AND id = ${input.membershipId}`;
  await openBillTo(tx, input.gymId, input.membershipId, back, input.from, input.now);
  await insertAudit(tx, {
    actorUserId: null,
    gymId: input.gymId,
    action: "org.held_membership_gift_days_taken_back",
    targetType: "gym_held_membership",
    targetId: input.membershipId,
    meta: { entryId: found.entry_id, type: row.typeName, on: input.today, days: String(input.days) },
  });
  return true;
}

/** A membership whose count `countAfterGap` says to move, and the count to move it to. */
export interface CountMove {
  entryId: string;
  row: { id: string; typeName: string; membership: HeldMembership };
  count: number;
}

/** The one write of `countAfterGap`'s answers: two statements however many memberships,
 *  each with its note in the record. Nobody did this, the days passing did. Used by
 *  `settle` for one record and by the hourly run for a whole gym. */
export async function writeCountsAfterGap(
  tx: TransactionSql,
  input: { gymId: string; moves: readonly CountMove[]; today: string; now: Date },
): Promise<void> {
  if (input.moves.length === 0) return;
  const payload = input.moves.map((move) => ({ id: move.row.id, was: move.row.membership.paidPeriods, count: move.count }));
  await tx`
    UPDATE gym_held_memberships h
    SET paid_periods = r.count, paid_floor = r.count, updated_at = ${input.now}
    FROM jsonb_to_recordset(${tx.json(payload)}) AS r(id uuid, was int, count int)
    WHERE h.gym_id = ${input.gymId} AND h.id = r.id AND h.paid_periods = r.was`;
  await insertAudits(
    tx,
    input.moves.map((move) => ({
      actorUserId: null,
      gymId: input.gymId,
      action: "org.held_membership_count_moved",
      targetType: "gym_held_membership",
      targetId: move.row.id,
      meta: { entryId: move.entryId, type: move.row.typeName, on: input.today, paidBefore: String(move.row.membership.paidPeriods), paidAfter: String(move.count) },
    })),
  );
}

/** Two records about to be merged: the name of a type both have running at once, which
 *  the kept record would then hold twice; null where there is none. One taken from the
 *  list is not asked about: it is left with its record (`moveHeldMemberships`). Both
 *  records settled first, under the gym's lock. */
export async function typeHeldByBoth(tx: TransactionSql, gymId: string, goneId: string, keepId: string, today: string): Promise<string | null> {
  const gone = (await held(tx, gymId, goneId, IN_USE, IN_USE_READ)).map(shape).filter((row) => !row.fromList);
  if (gone.length === 0) return null;
  const kept = (await held(tx, gymId, keepId, IN_USE, IN_USE_READ)).map(shape);
  for (const a of gone) {
    if (kept.some((b) => b.typeId === a.typeId && sameTypeTwice(a.membership, b.membership, today))) return a.typeName;
  }
  return null;
}

/** What `giveHeld` is given. */
export interface GiveHeldInput {
  gymId: string;
  entryId: string;
  typeId: string;
  requestKey: string;
  startsOn: string;
  paid: boolean;
  /** How they paid, where `paid`. */
  method: MemberPaymentByHand | null;
  /** The price the screen showed; null where it showed none. */
  shownPriceMinor: number | null;
  /** The gym's discount it is given with, and what the screen showed coming off. */
  discount: { id: string; shownOffMinor: number } | null;
  /** The person's own Refer a friend gift filled in (20e-ii-b-ii-a), off its first bill, and
   *  what the screen showed it takes off. */
  memberGift: { id: string; shownOffMinor: number } | null;
  /** What the screen showed its first bill comes to, tax in; null where it showed none. */
  shownTotalMinor: number | null;
  /** The type's joining fee the screen showed and charges (18t), 0 where it showed it waived;
   *  null where it showed none. */
  joiningFeeMinor: number | null;
  /** The day the screen said its full payments start, its first bill the part month (18y); null
   *  where it said none; undefined where the caller showed no screen of its own. */
  shownFullFrom?: string | null;
  /** Whether this reader may give a type that has a joining fee without it. */
  mayWaiveJoiningFee: boolean;
  /** Given in place of another membership (18x, `changeRepo.ts`): the one it replaces and
   *  the credit off its first bill, before tax. No joining fee, discount or gift with it;
   *  `paidByChange` where the credit pays the whole first period, which then opens no bill. */
  change?: { fromId: string; creditMinor: number; paidByChange: boolean; stoppedOld?: boolean } | null;
  /** The gym's own day. */
  today: string;
  actorUserId: string;
  now: Date;
}

export async function giveHeld(sql: Sql, input: GiveHeldInput): Promise<HeldWriteOutcome> {
  return await sql.begin(async (tx): Promise<HeldWriteOutcome> => {
    const given = await giveHeldIn(tx, input);
    return given.kind === "given" ? { kind: "ok" } : given;
  });
}

/** `giveHeld` in the caller's transaction: answers the membership it made, or `ok` where the
 *  same request had already made it. */
export async function giveHeldIn(tx: TransactionSql, input: GiveHeldInput): Promise<HeldWriteOutcome | { kind: "given"; id: string }> {
  const change = input.change ?? null;
  const entry = await lockedEntry(tx, input.gymId, input.entryId);
  if (entry === null) return { kind: "entry_not_found" };

  // The same request again: the membership it gave stands, and nothing is added.
  const [again] = await tx<{ entry_id: string }[]>`
    SELECT entry_id FROM gym_held_memberships
    WHERE gym_id = ${input.gymId} AND request_key = ${input.requestKey}`;
  if (again !== undefined) return again.entry_id === input.entryId ? { kind: "ok" } : { kind: "request_reused" };
  // The key also names the payment a paid give records.
  const [spent] = await tx<{ id: string }[]>`
    SELECT id FROM gym_member_payments WHERE gym_id = ${input.gymId} AND request_key = ${input.requestKey}`;
  if (spent !== undefined) return { kind: "request_reused" };

  if (entry.past) return { kind: "past_member" };
  const inUse = await settle(tx, input.gymId, input.entryId, input.today, input.now);
  if (inUse >= HELD_LIVE_MAX) return { kind: "too_many", cap: HELD_LIVE_MAX };

  const [rawType] = await liveTypes(tx, input.gymId, input.typeId);
  if (rawType === undefined) return { kind: "type_not_found" };
  const type = typeChoice(rawType);
  if (input.shownPriceMinor !== null && input.shownPriceMinor !== type.priceMinor) return { kind: "price_changed" };
  // The type's rate as it is now, read under the gym's lock that its changes take: the
  // membership keeps it, and its first bill charges it.
  const taxRateId = typeTaxRateId(rawType);
  // A free membership opens no bill, so it charges no tax.
  const rate = taxRateId === null || rawTypePrice(rawType) === 0 ? null : await rateOf(tx, input.gymId, taxRateId);
  const included = await taxIncludedOf(tx, input.gymId);
  const tax: TaxApplied | null = rate === null || included === null ? null : { name: rate.name, bp: rate.bp, included };

  // The discount is this gym's own, read under its lock, judged on the gym's own day,
  // and what it takes off is worked out again here: nothing is given at any other price.
  let used: { id: string; name: string; offMinor: number; payments: MembershipPayments; heldPriceMinor: number; firstBillMinor: number } | null = null;
  if (input.discount !== null) {
    const found = await lockedDiscount(tx, input.gymId, input.discount.id);
    if (found === null) return { kind: "discount_not_found" };
    const fits = discountFits({ ...found, archived: found.archivedAt !== null }, { today: input.today, membershipTypeId: type.id, currency: type.currency });
    if (!fits.ok) return { kind: "discount_refused", name: found.name, reason: fits.reason };
    // Refer a friend's gift goes only to the friend it is for, once (20e-ii-b-i).
    if (found.referralGift && !(await friendGiftOpen(tx, input.gymId, input.entryId, found.id, input.today))) return { kind: "friend_gift_not_theirs" };
    const costs = membershipDiscount(found, type);
    if (!costs.ok) return costs.reason === "nothing_off" ? { kind: "discount_nothing_off", name: found.name } : { kind: "discount_nothing_to_pay" };
    if (costs.offMinor !== input.discount.shownOffMinor) return { kind: "discount_changed" };
    used = { id: found.id, name: found.name, ...costs };
  }
  const priceMinor = used === null ? type.priceMinor : used.heldPriceMinor;
  const firstListed = used === null ? type.priceMinor : used.firstBillMinor;
  // The member's own Refer a friend gift comes off the first bill, after any discount: this
  // record's, still waiting, read under its lock, and taking off what the screen showed. It is
  // worked out below, once the first bill's own price is known.
  // The joining fee (18t): the type's own as it is now, and only where the screen showed that
  // very amount. 0 is waived, which only a reader who takes payments may do. A screen that
  // said nothing of a fee the type has was opened before it was set: sent back to look again.
  // A change (18x) is no joining: no fee is charged, and none is waived.
  const joiningFeeMinor = change !== null ? 0 : (input.joiningFeeMinor ?? 0);
  if (change === null) {
    if (input.joiningFeeMinor === null && type.joiningFeeMinor > 0) return { kind: "price_changed" };
    if (joiningFeeMinor > 0 && joiningFeeMinor !== type.joiningFeeMinor) return { kind: "price_changed" };
    if (input.joiningFeeMinor === 0 && type.joiningFeeMinor > 0 && !input.mayWaiveJoiningFee) return { kind: "price_changed" };
  }
  const waivedFeeMinor = change === null && joiningFeeMinor === 0 ? type.joiningFeeMinor : 0;
  // A change's credit comes off the first bill before tax, as a gift does (18x).
  const creditMinor = change?.creditMinor ?? 0;
  const paidByChange = change?.paidByChange ?? false;

  // Worked out unpaid: the bill of the period owed is opened first, and a payment
  // recorded against it is what moves the count of paid periods on. Where the gym bills
  // everyone on one day (18y), its full periods count from the first of those days after its
  // start, as the screen said: a day changed since it was opened gives nothing.
  const given = giveHeldMembership(type, input.startsOn, false, input.today, await billDayOf(tx, input.gymId));
  if (!given.ok) return { kind: given.reason };
  if (input.shownFullFrom !== undefined && input.shownFullFrom !== given.membership.fullFrom) return { kind: "bill_day_changed" };
  // The first bill: its price after any discount, for the part month where it is that period's
  // (the gift worked out on that), the joining fee, less any credit, and its tax. Nothing is
  // given at a total the screen did not show.
  const [firstDue] = billsToOpen(given.membership, input.today, new Set());
  const firstPart = periodListedMinor(given.membership, firstDue?.periodIndex ?? 0, firstListed);
  let gift: { id: string; offMinor: number } | null = null;
  if (input.memberGift !== null) {
    const found = await lockedWaitingGift(tx, input.gymId, input.entryId, input.memberGift.id, "membership");
    if (found === null || type.priceMinor === 0) return { kind: "member_gift_not_theirs" };
    const off = memberGiftOff(found, firstPart, type.currency);
    if (off === 0 || off !== input.memberGift.shownOffMinor) return { kind: "member_gift_changed" };
    gift = { id: found.id, offMinor: off };
  }
  const firstBill =
    type.priceMinor === 0 || paidByChange ? { amountMinor: 0, tax: null } : billOf(firstPart - (gift?.offMinor ?? 0) + joiningFeeMinor - creditMinor, tax);
  if (input.shownTotalMinor !== null && input.shownTotalMinor !== firstBill.amountMinor) return { kind: "price_changed" };
  // Paid by the change: its first period counts as paid as one before it was given does, so
  // no mark is ever taken back into it and no bill is asked for it.
  const owed = paidByChange ? { ...given.membership, paidPeriods: 1, paidFloor: 1 } : given.membership;
  const pays = input.paid && !owed.free && !paidByChange;
  if (pays && input.method === null) return { kind: "method_needed" };
  const paidMove = pays ? moveHeldMembership(owed, { type: "paid", paidPeriods: owed.paidPeriods + 1 }, input.today) : null;
  if (paidMove !== null && !paidMove.ok) return { kind: "not_allowed" };
  const m = paidMove === null ? owed : paidMove.membership;

  // Asked under the record's lock, so two staff pressing Add at one instant give one.
  const running = (await held(tx, input.gymId, input.entryId, IN_USE, IN_USE_READ)).map(shape);
  const clash = running.filter((row) => row.typeId === input.typeId && sameTypeTwice(row.membership, m, input.today));
  if (clash.length > 0) {
    const ends = clash.every((row) => heldMembershipView(row.membership, input.today).endsOn !== null);
    return { kind: "already_held", typeName: type.name, ends };
  }

  // One use, in one statement that will not pass the limit, in this same transaction.
  if (used !== null && !(await takeUse(tx, input.gymId, used.id))) return { kind: "discount_refused", name: used.name, reason: "used_up" };

  const [created] = await tx<{ id: string }[]>`
    INSERT INTO gym_held_memberships
      (gym_id, entry_id, membership_type_id, request_key, kind, price_minor, currency,
       term_count, term_unit, pack_classes, pack_days, starts_on, status,
       paid_periods, paid_floor, renews, classes_left,
       discount_id, discount_name, discount_minor, discount_payments, tax_rate_id, tax_included, replaces_id, replaced_stopped, full_from)
    VALUES (${input.gymId}, ${input.entryId}, ${input.typeId}, ${input.requestKey}, ${m.kind},
            ${priceMinor}, ${type.currency}, ${m.termCount}, ${m.termUnit}, ${m.packClasses},
            ${m.packDays}, ${m.startsOn}::date, ${m.status},
            ${m.paidPeriods}, ${m.paidFloor}, ${m.renews}, ${m.classesLeft},
            ${used?.id ?? null}, ${used?.name ?? null}, ${used?.offMinor ?? 0}, ${used?.payments ?? null}, ${rate?.id ?? null}, ${tax?.included ?? null},
            ${change?.fromId ?? null}, ${change?.stoppedOld ?? false}, ${m.fullFrom}::date)
    RETURNING id`;
  if (created === undefined) throw new Error("held membership insert returned no row");

  await insertAudit(tx, {
    actorUserId: input.actorUserId,
    gymId: input.gymId,
    action: "org.held_membership_given",
    targetType: "gym_held_membership",
    targetId: created.id,
    meta: {
      entryId: input.entryId,
      type: type.name,
      startsOn: m.startsOn,
      paidPeriods: String(m.paidPeriods),
      priceMinor: String(priceMinor),
      currency: type.currency,
      ...(used === null ? {} : { discountId: used.id, discount: used.name, discountMinor: String(used.offMinor), discountPayments: used.payments }),
      ...(tax === null ? {} : { tax: tax.name, taxBp: String(tax.bp) }),
      ...(joiningFeeMinor > 0 ? { joiningFeeMinor: String(joiningFeeMinor) } : {}),
      ...(waivedFeeMinor > 0 ? { joiningFeeWaivedMinor: String(waivedFeeMinor) } : {}),
      ...(change === null ? {} : { replaces: change.fromId, changeCreditMinor: String(creditMinor) }),
      ...(m.fullFrom === null ? {} : { fullFrom: m.fullFrom }),
    },
  });

  const [due] = billsToOpen(owed, input.today, new Set());
  if (due !== undefined) {
    const [opened] = await insertBills(
      tx,
      input.gymId,
      [{ membershipId: created.id, periodIndex: due.periodIndex, amountMinor: firstBill.amountMinor, tax: firstBill.tax, joiningFeeMinor, changeCreditMinor: creditMinor, currency: type.currency, dueOn: due.dueOn, covers: due.covers }],
      input.now,
    );
    if (opened === undefined) throw new Error("a new membership's bill was not opened");
    if (gift !== null) await markUsed(tx, { gymId: input.gymId, giftId: gift.id, billId: opened.id, saleId: null, offMinor: gift.offMinor, currency: type.currency, now: input.now });
    if (pays && input.method !== null) {
      const recorded = await insertPayment(
        tx,
        {
          gymId: input.gymId,
          billId: opened.id,
          amountMinor: firstBill.amountMinor,
          currency: type.currency,
          method: input.method,
          requestKey: input.requestKey,
          paidOn: input.today,
          recordedBy: input.actorUserId,
          provider: null,
        },
        input.now,
      );
      if (recorded === null) throw new Error("a new membership's payment was not recorded");
      const paymentId = recorded.id;
      await setBillStatus(tx, input.gymId, opened.id, "paid", input.now);
      // A friend a member invited has paid: the member's Refer a friend gift (20e-ii-b-ii-a).
      await giveMemberGift(tx, { gymId: input.gymId, friendEntryId: input.entryId, by: { paymentId }, today: input.today, now: input.now });
      await insertAudit(tx, {
        actorUserId: input.actorUserId,
        gymId: input.gymId,
        action: "org.member_payment_recorded",
        targetType: "gym_member_payment",
        targetId: paymentId,
        meta: {
          entryId: input.entryId,
          membershipId: created.id,
          billId: opened.id,
          period: String(due.periodIndex),
          amountMinor: String(firstBill.amountMinor),
          currency: type.currency,
          method: input.method,
          ...(recorded.paidByEntryId === null ? {} : { paidByEntryId: recorded.paidByEntryId }),
        },
      });
    }
  } else if (pays) {
    throw new Error("a membership given as paid had no bill to pay");
  } else if (used !== null && used.payments === "first") {
    // Its discount rides on the bill opened now; every later one is opened at the full price.
    throw new Error("a membership given with a first-payment discount had no bill to carry it");
  } else if (gift !== null) {
    throw new Error("a membership given with a Refer a friend gift had no bill to carry it");
  } else if (joiningFeeMinor > 0) {
    throw new Error("a membership given with a joining fee had no bill to carry it");
  } else if (creditMinor > 0 && !paidByChange) {
    throw new Error("a membership given in place of another had no bill to carry its credit");
  }
  return { kind: "given", id: created.id };
}

/** One membership of a record, held for a write, or null where it is not that record's.
 *  Under the gym's lock and the record's. */
export async function lockedHeld(tx: TransactionSql, gymId: string, entryId: string, membershipId: string): Promise<HeldRow | null> {
  const [raw] = await tx`
    SELECT ${COLUMNS(tx)}
    FROM gym_held_memberships h
    JOIN gym_membership_types t ON t.gym_id = h.gym_id AND t.id = h.membership_type_id
    WHERE h.gym_id = ${gymId} AND h.entry_id = ${entryId} AND h.id = ${membershipId}
    FOR UPDATE OF h`;
  return raw === undefined ? null : shape(raw);
}

/** The count of paid periods, written for a payment recorded or taken back
 *  (`billsRepo.ts`): the caller has asked `moveHeldMembership` first. */
export async function writePaidPeriods(tx: TransactionSql, gymId: string, entryId: string, membershipId: string, paidPeriods: number, now: Date): Promise<void> {
  await tx`
    UPDATE gym_held_memberships SET paid_periods = ${paidPeriods}, updated_at = ${now}
    WHERE gym_id = ${gymId} AND entry_id = ${entryId} AND id = ${membershipId}`;
}

const AUDIT_ACTION: Record<HeldMembershipEvent["type"], string> = {
  freeze: "org.held_membership_frozen",
  unfreeze: "org.held_membership_unfrozen",
  cancel: "org.held_membership_cancelled",
  paid: "org.held_membership_paid",
};

/** What a cancel does about the places booked on the membership, handed in by the service
 *  so this file runs none of the booking code (which imports this one; its types alone
 *  are read here): `ask` answers the question to put first, or null to go ahead; `end`
 *  ends them. Both run in the cancel's transaction, under the gym's lock. */
export interface CancelBookings {
  ask: (tx: TransactionSql, gymId: string, scope: MembershipScope, confirmed: MembershipEndConfirmed) => Promise<HasBookings | null>;
  end: (
    tx: TransactionSql,
    gymId: string,
    scope: MembershipScope,
    now: Date,
  ) => Promise<{ booked: number; packClasses: number; ptSessions?: number; ptPackSessions?: number }>;
}

/** One change to a held membership, decided by the rule on the row as it is under its
 *  lock. A change that is already so writes nothing and answers ok. A cancel that would
 *  end bookings answers who they are until the request sends their number back. */
export async function moveHeld(
  sql: Sql,
  bookings: CancelBookings,
  input: {
    gymId: string;
    entryId: string;
    membershipId: string;
    event: HeldMembershipEvent;
    /** The gym's own day. */
    today: string;
    /** A cancel: the number of bookings the screen was told it would end. */
    confirmBookings: string | null;
    /** A cancel: the mark of the personal training sessions it was told it would end. */
    confirmPtSessions?: string | null;
    /** A freeze: the fee a month the screen showed and staff left ticked, or 0 for none (18z). */
    freezeFeeMinor?: number;
    /** Whether this reader may freeze with no fee where the gym charges one (`billing.members`). */
    mayWaiveFreezeFee?: boolean;
    actorUserId: string;
    now: Date;
  },
): Promise<HeldWriteOutcome | HasBookings> {
  return await sql.begin(async (tx): Promise<HeldWriteOutcome | HasBookings> => {
    const entry = await lockedEntry(tx, input.gymId, input.entryId);
    if (entry === null) return { kind: "entry_not_found" };
    const [raw] = await tx`
      SELECT ${COLUMNS(tx)}
      FROM gym_held_memberships h
      JOIN gym_membership_types t ON t.gym_id = h.gym_id AND t.id = h.membership_type_id
      WHERE h.gym_id = ${input.gymId} AND h.entry_id = ${input.entryId} AND h.id = ${input.membershipId}
      FOR UPDATE OF h`;
    if (raw === undefined) return { kind: "membership_not_found" };
    if (entry.past) return { kind: "past_member" };
    await settle(tx, input.gymId, input.entryId, input.today, input.now);
    // Read again: what the clock has done is written now, and the change is decided on that.
    const before = await lockedHeld(tx, input.gymId, input.entryId, input.membershipId);
    if (before === null) return { kind: "membership_not_found" };
    // Frozen, cancelled or marked paid while the Terminal waits, the member would pay for it anyway.
    if (await terminalWaiting(tx, input.gymId, before.id)) return { kind: "terminal_waiting" };

    const move = moveHeldMembership(before.membership, input.event, input.today);
    if (!move.ok) return { kind: "not_allowed" };
    if (!move.changed) return { kind: "ok" };
    const m = move.membership;

    // A freeze charges the gym's fee where staff left it ticked: refused where the screen showed
    // another, or a fee on a membership that freezes with none (18z).
    let freezeFee = m.status === "frozen" ? before.freezeFeeMinor : 0;
    if (input.event.type === "freeze") {
      const offered = freezeFeeApplies(before.membership) ? await freezeFeeOf(tx, input.gymId) : 0;
      const asked = input.freezeFeeMinor ?? 0;
      if (asked !== 0 && asked !== offered) return { kind: "freeze_fee_changed" };
      // Staff who do not record payments freeze with the gym's fee; for them 0 is a screen that
      // showed none.
      if (asked === 0 && offered > 0 && input.mayWaiveFreezeFee !== true) return { kind: "freeze_fee_changed" };
      freezeFee = asked;
    }

    // A cancel takes with it the bills for days after its last day (18a-i): nobody is left
    // owing, or reading Overdue, for a month they never had.
    let voided: string[] = [];
    if (input.event.type === "cancel") {
      const lastDay = m.status === "cancelled" ? input.today : heldMembershipView(m, input.today).endsOn;
      if (lastDay !== null) {
        const bills = await billsFor(tx, input.gymId, [before.id]);
        const after = billsAtCancel(bills, lastDay);
        if (after.blocked) return { kind: "early_payment" };
        voided = bills.filter((b) => after.voids.includes(b.periodIndex)).map((b) => b.id);
      }
    }

    // A cancel ends the places booked on it (17c-iii): every class not yet started, or,
    // where it runs on to the end of what is paid, the classes after its last day.
    let ends: MembershipScope | null = null;
    if (input.event.type === "cancel") {
      const last = m.status === "cancelled" ? null : heldMembershipView(m, input.today).endsOn;
      if (m.status === "cancelled" || last !== null) ends = { membership: before.id, now: input.now, afterDay: last };
    }
    if (ends !== null) {
      const ask = await bookings.ask(tx, input.gymId, ends, { bookings: input.confirmBookings, ptSessions: input.confirmPtSessions ?? null });
      if (ask !== null) return ask;
    }

    await tx`
      UPDATE gym_held_memberships
      SET status = ${m.status}, frozen_days = ${m.frozenDays}, frozen_on = ${m.frozenOn}::date,
          cancelled_on = ${m.cancelledOn}::date, paid_periods = ${m.paidPeriods}, renews = ${m.renews},
          freeze_fee_minor = ${freezeFee}, updated_at = ${input.now}
      WHERE gym_id = ${input.gymId} AND entry_id = ${input.entryId} AND id = ${input.membershipId}`;
    const ended = ends === null ? null : await bookings.end(tx, input.gymId, ends, input.now);
    // Its first month's freeze fee, at once; an unfreeze or a cancel takes off the unpaid fees of
    // months that begin today or later (18z).
    const feesOpened = m.status === "frozen" && input.event.type === "freeze" && freezeFee > 0 ? await openFreezeFee(tx, input.gymId, before.id, input.now) : 0;
    const feesRemoved =
      before.membership.status === "frozen" && m.status !== "frozen" ? await removeFreezeFees(tx, input.gymId, before.id, input.today, input.now) : 0;
    // A change on the next payment date undone before the new one starts: the one it replaced
    // renews again, as it did before the change (18x, round one, Low-2).
    let renewsAgain = false;
    if (input.event.type === "cancel" && m.status === "cancelled" && before.membership.startsOn > input.today) {
      const back = await tx<{ id: string; starts_on: string }[]>`
        UPDATE gym_held_memberships o SET renews = true, updated_at = ${input.now}
        FROM gym_held_memberships n
        WHERE n.gym_id = ${input.gymId} AND n.id = ${before.id} AND n.replaced_stopped
          AND o.gym_id = n.gym_id AND o.id = n.replaces_id AND o.entry_id = ${input.entryId}
          AND o.status = 'active' AND o.kind = 'recurring' AND NOT o.renews
        RETURNING o.id, n.starts_on::text AS starts_on`;
      renewsAgain = back.length > 0;
      // The bills the change cancelled with it (unpaid, for days after its last day) are owed again,
      // so a payment due always has its bill to pay (re-check, Low).
      for (const old of back) {
        await tx`
          UPDATE gym_member_bills SET status = 'open', updated_at = ${input.now}
          WHERE gym_id = ${input.gymId} AND held_membership_id = ${old.id} AND status = 'void'
            AND void_reason IS NULL AND period_index IS NOT NULL AND due_on >= ${old.starts_on}::date`;
      }
    }
    await voidBills(tx, input.gymId, voided, input.now);
    // A Refer a friend gift taken off a bill cancelled with it waits for the next bill.
    await giftUseUndone(tx, input.gymId, { billIds: voided }, input.today, input.now);

    await insertAudit(tx, {
      actorUserId: input.actorUserId,
      gymId: input.gymId,
      action: AUDIT_ACTION[input.event.type],
      targetType: "gym_held_membership",
      targetId: before.id,
      meta: {
        entryId: input.entryId,
        type: before.typeName,
        on: input.today,
        statusBefore: before.membership.status,
        statusAfter: m.status,
        paidBefore: String(before.membership.paidPeriods),
        paidAfter: String(m.paidPeriods),
        renews: String(m.renews),
        ...(voided.length === 0 ? {} : { billsCancelled: String(voided.length) }),
        ...(input.event.type === "freeze" ? { freezeFeeMinor: String(freezeFee) } : {}),
        ...(feesOpened === 0 ? {} : { freezeFeesOpened: String(feesOpened) }),
        ...(feesRemoved === 0 ? {} : { freezeFeesRemoved: String(feesRemoved) }),
        ...(renewsAgain ? { replacedRenewsAgain: "true" } : {}),
        ...(ended === null
          ? {}
          : {
              bookingsEnded: String(ended.booked),
              packClassesBack: String(ended.packClasses),
              ptSessionsEnded: String(ended.ptSessions ?? 0),
              ptPackSessionsBack: String(ended.ptPackSessions ?? 0),
            }),
      },
    });
    return { kind: "ok" };
  });
}

const forBookingSchema = z.object({
  entry_id: z.string(),
  access: membershipAccessSchema,
  bookings_limit: z.number().int().nullable(),
  bookings_period: membershipLimitPeriodSchema.nullable(),
  covers_class: z.boolean(),
});

const forClassesSchema = forBookingSchema.omit({ covers_class: true }).extend({ covers_all: z.boolean(), class_type_ids: z.array(z.string()) });

/** These records' memberships in use, each with the kinds of class its type names (17d):
 *  what `heldForBooking` answers for one class, for every class at once. A plain read. */
export async function heldForClasses(
  sql: Sql | TransactionSql,
  gymId: string,
  entryIds: readonly string[],
): Promise<(Omit<HeldCover, "used" | "coversClass"> & { entryId: string; coversAll: boolean; classTypeIds: string[] })[]> {
  const rows = await sql`
    SELECT ${COLUMNS(sql)}, h.entry_id, t.access, t.bookings_limit, t.bookings_period, t.covers_all_classes AS covers_all,
           ARRAY(SELECT c.class_type_id::text FROM gym_membership_type_classes c
                 WHERE c.gym_id = t.gym_id AND c.membership_type_id = t.id) AS class_type_ids
    FROM gym_held_memberships h
    JOIN gym_membership_types t ON t.gym_id = h.gym_id AND t.id = h.membership_type_id
    WHERE h.gym_id = ${gymId} AND h.entry_id = ANY(${[...entryIds]}::uuid[]) AND h.status = ANY(${[...IN_USE]}::text[])
    ORDER BY h.id`;
  return rows.map((row) => {
    const extra = forClassesSchema.parse(row);
    const h = shape(row);
    return {
      entryId: extra.entry_id,
      id: h.id,
      membership: h.membership,
      access: extra.access,
      coversAll: extra.covers_all,
      classTypeIds: extra.class_type_ids,
      bookingsLimit: extra.bookings_limit,
      bookingsPeriod: extra.bookings_period,
    };
  });
}

/** These records' memberships in use, each with what its type includes for one class
 *  (17c-i). `used` is the booking repo's to count. For a booking, under the gym's lock. */
export async function heldForBooking(
  tx: Sql | TransactionSql,
  gymId: string,
  entryIds: readonly string[],
  classTypeId: string,
): Promise<(Omit<HeldCover, "used"> & { entryId: string })[]> {
  const rows = await tx`
    SELECT ${COLUMNS(tx)}, h.entry_id, t.access, t.bookings_limit, t.bookings_period,
           (t.covers_all_classes OR EXISTS (
             SELECT 1 FROM gym_membership_type_classes c
             WHERE c.gym_id = t.gym_id AND c.membership_type_id = t.id AND c.class_type_id = ${classTypeId}
           )) AS covers_class
    FROM gym_held_memberships h
    JOIN gym_membership_types t ON t.gym_id = h.gym_id AND t.id = h.membership_type_id
    WHERE h.gym_id = ${gymId} AND h.entry_id = ANY(${[...entryIds]}::uuid[]) AND h.status = ANY(${[...IN_USE]}::text[])
    ORDER BY h.id`;
  return rows.map((row) => {
    const extra = forBookingSchema.parse(row);
    const h = shape(row);
    return {
      entryId: extra.entry_id,
      id: h.id,
      membership: h.membership,
      access: extra.access,
      coversClass: extra.covers_class,
      bookingsLimit: extra.bookings_limit,
      bookingsPeriod: extra.bookings_period,
    };
  });
}

const forPtSchema = z.object({
  entry_id: z.string(),
  includes_pt: z.boolean(),
  pt_limit: z.number().int().nullable(),
  pt_period: membershipLimitPeriodSchema.nullable(),
});

/** These records' memberships in use, each with whether its type includes personal training
 *  and its limit on sessions (17e-i, 17e-v), its record and its type's name. `used` is the
 *  personal training repo's to count. For a session's booking, under the gym's lock; a
 *  plain read for the list of people to book and a member's own page, which run the
 *  booking's own rule on it. */
export async function heldForPtOf(
  sql: Sql | TransactionSql,
  gymId: string,
  entryIds: readonly string[],
): Promise<(Omit<PtHeld, "used"> & { entryId: string; typeName: string })[]> {
  if (entryIds.length === 0) return [];
  const rows = await sql`
    SELECT ${COLUMNS(sql)}, h.entry_id, t.includes_pt, t.pt_limit, t.pt_period
    FROM gym_held_memberships h
    JOIN gym_membership_types t ON t.gym_id = h.gym_id AND t.id = h.membership_type_id
    WHERE h.gym_id = ${gymId} AND h.entry_id = ANY(${[...entryIds]}::uuid[]) AND h.status = ANY(${[...IN_USE]}::text[])
    ORDER BY h.id`;
  return rows.map((row) => {
    const h = shape(row);
    const extra = forPtSchema.parse(row);
    return {
      id: h.id,
      membership: h.membership,
      includesPt: extra.includes_pt,
      ptLimit: extra.pt_limit,
      ptPeriod: extra.pt_period,
      entryId: extra.entry_id,
      typeName: h.typeName,
    };
  });
}

// ── What the Members list reads (23a-i) ─────────────────────────────────────
//
// The list asks about every person of a gym at once (its Filter and its counts), so these
// two reads return plain rows and check them by hand: parsing each of a few thousand rows
// through a schema kept the server's one thread busy for 150 ms at 2,100 people
// (`tools/measure-members-held-cost.ts`). Past members are left out: their memberships
// are kept and not in use.

/** One membership as the list's rule needs it. */
export interface ListHeld {
  id: string;
  typeName: string;
  fromList: boolean;
  membership: HeldMembership;
}

export interface ListHeldColumns {
  id: string;
  type_name: string;
  kind: string;
  term_count: number | null;
  term_unit: string | null;
  pack_classes: number | null;
  pack_days: number | null;
  free: boolean;
  starts_on: string;
  frozen_days: number;
  gift_days: number;
  gift_from: number;
  status: string;
  frozen_on: string | null;
  cancelled_on: string | null;
  paid_periods: number;
  paid_floor: number;
  renews: boolean;
  classes_left: number | null;
  from_list: boolean;
  full_from: string | null;
}

/** A row of an outer join: every column may be missing. */
type Nullable<T> = { [K in keyof T]: T[K] | null };

const LIST_COLUMNS = (sql: Sql | TransactionSql) => sql`
  h.id, t.name AS type_name, h.kind, h.term_count, h.term_unit, h.pack_classes, h.pack_days,
  (h.price_minor = 0) AS free, h.starts_on::text AS starts_on, h.frozen_days, h.gift_days, h.gift_from, h.status,
  h.frozen_on::text AS frozen_on, h.cancelled_on::text AS cancelled_on,
  h.paid_periods, h.paid_floor, h.renews, h.classes_left, h.from_list, h.full_from::text AS full_from`;

/** A text column under a CHECK, as one of the values the rule knows: a value this build
 *  does not know fails here, as it does in `shape`. */
function oneOf<T extends string>(options: readonly T[], value: string, what: string): T {
  const found = options.find((option) => option === value);
  if (found === undefined) throw new Error(`a held membership holds a ${what} that no longer parses: ${value}`);
  return found;
}

function listHeld(row: ListHeldColumns): ListHeld {
  return {
    id: row.id,
    typeName: row.type_name,
    fromList: row.from_list,
    membership: {
      kind: oneOf(membershipKindSchema.options, row.kind, "kind"),
      termCount: row.term_count,
      termUnit: row.term_unit === null ? null : oneOf(membershipTermUnitSchema.options, row.term_unit, "term unit"),
      packClasses: row.pack_classes,
      packDays: row.pack_days,
      free: row.free,
      startsOn: row.starts_on,
      frozenDays: row.frozen_days,
      giftDays: row.gift_days,
      giftFrom: row.gift_from,
      status: oneOf(heldMembershipStatusSchema.options, row.status, "status"),
      frozenOn: row.frozen_on,
      cancelledOn: row.cancelled_on,
      paidPeriods: row.paid_periods,
      paidFloor: row.paid_floor,
      renews: row.renews,
      classesLeft: row.classes_left,
      fullFrom: row.full_from,
    },
  };
}

/** HOW MANY MEMBERSHIPS STILL CHARGE EACH RATE (18b-iii, round one): a current record's, with
 *  a price, not over on the gym's own day by the rule (a stored `active` the clock has ended
 *  is not counted, nor a past member's, nor a free one). What a rate's line in the Tax box
 *  says, and what keeps it from being removed. A plain read, bounded by the gym's list. */
export async function taxedInUse(sql: Sql | TransactionSql, gymId: string, today: string): Promise<Map<string, number>> {
  const rows = await sql<(ListHeldColumns & { tax_rate_id: string })[]>`
    SELECT ${LIST_COLUMNS(sql)}, h.tax_rate_id
    FROM gym_held_memberships h
    JOIN gym_membership_types t ON t.gym_id = h.gym_id AND t.id = h.membership_type_id
    JOIN gym_member_list_entries e ON e.gym_id = h.gym_id AND e.id = h.entry_id AND e.former_at IS NULL
    WHERE h.gym_id = ${gymId} AND h.tax_rate_id IS NOT NULL AND h.price_minor > 0
      AND h.status = ANY(${[...IN_USE]}::text[])`;
  const counts = new Map<string, number>();
  for (const row of rows) {
    const status = heldMembershipView(listHeld(row).membership, today).status;
    if (status === "ended" || status === "cancelled") continue;
    counts.set(row.tax_rate_id, (counts.get(row.tax_rate_id) ?? 0) + 1);
  }
  return counts;
}

/** A plain row as the rule reads it, for the run that opens bills (`billsRepo.ts`). */
export const listHeldMembership = (row: ListHeldColumns): HeldMembership => listHeld(row).membership;

/** Every membership stored in use of the current records named (`entryIds`), or of every
 *  current record of the gym (null). A plain read. */
export async function inUseForList(
  sql: Sql | TransactionSql,
  gymId: string,
  entryIds: readonly string[] | null,
): Promise<{ entryId: string; noEmail: boolean; held: ListHeld }[]> {
  if (entryIds !== null && entryIds.length === 0) return [];
  const ids = entryIds === null ? null : [...entryIds];
  const rows = await sql<(ListHeldColumns & { entry_id: string; no_email: boolean })[]>`
    SELECT ${LIST_COLUMNS(sql)}, h.entry_id, (e.email IS NULL) AS no_email
    FROM gym_held_memberships h
    JOIN gym_membership_types t ON t.gym_id = h.gym_id AND t.id = h.membership_type_id
    JOIN gym_member_list_entries e ON e.gym_id = h.gym_id AND e.id = h.entry_id AND e.former_at IS NULL
    WHERE h.gym_id = ${gymId} AND h.status = ANY(${[...IN_USE]}::text[])
      AND (${ids}::uuid[] IS NULL OR h.entry_id = ANY(${ids}::uuid[]))`;
  return rows.map((row) => ({ entryId: row.entry_id, noEmail: row.no_email, held: listHeld(row) }));
}

/** Every membership stored in use of the gym's current records, sold in `currency`, with
 *  its type and the price it was sold at: what Reports' money figures read (21b-i). */
export async function inUseForMoney(
  sql: Sql | TransactionSql,
  gymId: string,
  currency: string,
): Promise<{ typeId: string; typeName: string; priceMinor: number; membership: HeldMembership }[]> {
  const rows = await sql<(ListHeldColumns & { membership_type_id: string; price_minor: number })[]>`
    SELECT ${LIST_COLUMNS(sql)}, h.membership_type_id, h.price_minor
    FROM gym_held_memberships h
    JOIN gym_membership_types t ON t.gym_id = h.gym_id AND t.id = h.membership_type_id
    JOIN gym_member_list_entries e ON e.gym_id = h.gym_id AND e.id = h.entry_id AND e.former_at IS NULL
    WHERE h.gym_id = ${gymId} AND h.status = ANY(${[...IN_USE]}::text[]) AND h.currency = ${currency}`;
  return rows.map((row) => ({
    typeId: row.membership_type_id,
    typeName: row.type_name,
    priceMinor: row.price_minor,
    membership: listHeld(row).membership,
  }));
}

/** A stored membership's last day, for a row aliased `h`, as the rule works it out
 *  (`lastDay` in `@app/shared`): the start, so many terms on, plus the days frozen and the
 *  free days that go before that period, less one. A repeating one counts the periods it is
 *  paid for; any other kind has one. Postgres adds months and years as the rule does (31
 *  Jan and a month is 28 Feb).
 *  `memberships.overForList.test.ts` and `membershipWords.again.routes.test.ts` hold the
 *  two together. */
export const LAST_DAY = (sql: Sql | TransactionSql) => sql`
  ((CASE WHEN h.full_from IS NOT NULL AND h.paid_periods >= 1 THEN h.full_from ELSE h.starts_on END + make_interval(
      years  => CASE WHEN h.kind <> 'pack' AND h.term_unit = 'year'  THEN h.term_count * (CASE WHEN h.kind = 'recurring' THEN h.paid_periods - (CASE WHEN h.full_from IS NOT NULL AND h.paid_periods >= 1 THEN 1 ELSE 0 END) ELSE 1 END) ELSE 0 END,
      months => CASE WHEN h.kind <> 'pack' AND h.term_unit = 'month' THEN h.term_count * (CASE WHEN h.kind = 'recurring' THEN h.paid_periods - (CASE WHEN h.full_from IS NOT NULL AND h.paid_periods >= 1 THEN 1 ELSE 0 END) ELSE 1 END) ELSE 0 END,
      weeks  => CASE WHEN h.kind <> 'pack' AND h.term_unit = 'week'  THEN h.term_count * (CASE WHEN h.kind = 'recurring' THEN h.paid_periods ELSE 1 END) ELSE 0 END,
      days   => CASE WHEN h.kind = 'pack' THEN h.pack_days
                     WHEN h.term_unit = 'day' THEN h.term_count * (CASE WHEN h.kind = 'recurring' THEN h.paid_periods ELSE 1 END) ELSE 0 END
    ))::date + h.frozen_days
      + CASE WHEN (CASE WHEN h.kind = 'recurring' THEN h.paid_periods ELSE 1 END) >= h.gift_from THEN h.gift_days ELSE 0 END - 1)`;

/** For each pack named: the gym's day of the last class or personal training session
 *  charged to it; a pack with none recorded is not in the answer. A plain read. */
export async function packLastClassDays(sql: Sql | TransactionSql, gymId: string, membershipIds: readonly string[]): Promise<Map<string, string>> {
  if (membershipIds.length === 0) return new Map();
  const rows = await sql<{ id: string; day: string }[]>`
    SELECT c.id, to_char(max(c.day), 'YYYY-MM-DD') AS day
    FROM (
      SELECT k.held_membership_id AS id, s.local_date AS day
      FROM gym_class_bookings k
      JOIN gym_class_sessions s ON s.gym_id = k.gym_id AND s.id = k.session_id
      WHERE k.gym_id = ${gymId} AND k.pack_charged AND k.held_membership_id = ANY(${[...membershipIds]}::uuid[])
      UNION ALL
      SELECT a.held_membership_id, a.local_date
      FROM gym_pt_appointments a
      WHERE a.gym_id = ${gymId} AND a.pack_charged AND a.held_membership_id = ANY(${[...membershipIds]}::uuid[])
    ) c
    GROUP BY c.id`;
  return new Map(rows.map((row) => [row.id, row.day]));
}

export interface OverForList {
  entryId: string;
  /** The record has no address: what a chip's "can be invited" count needs. */
  noEmail: boolean;
  /** The membership name the gym's own list gives this record, where it names something
   *  the person does not hold and never has; null otherwise. */
  listedUnheld: string | null;
  /** The membership of theirs stored over that finished last; null where none is. */
  held: ListHeld | null;
}

/** For the current records with nothing stored in use: the membership of each stored over
 *  that finished last, and what the list's own word names. Asked of the records named
 *  (`entryIds`) or of the whole gym (null), and also of `alsoIds` whatever they hold: the
 *  records whose every membership stored in use the clock has ended. `today` is the gym's
 *  own day. A plain read.
 *
 *  **Which stored row.** One a record, by the rule's own order (`finishedLast` in
 *  `@app/shared`): the day it finished, a membership before a pack on the same day, then the
 *  newest start. The day is worked out here as the rule works it out, since a person who
 *  buys a day pass a visit has hundreds of rows and all of them cannot be read: the day it
 *  was cancelled; else its last day (the start, so many terms on, plus the days frozen,
 *  less one); a pack used up before that day by its start day. Postgres adds months and
 *  years as the rule does (31 Jan and a month is 28 Feb). `memberships.overForList.test.ts`
 *  holds the two to the same choice.
 *
 *  **`listedUnheld`** is the list's word where it names something this record has never
 *  held: no membership of theirs is of the type staff said that word is, nor of a type of
 *  that very name. A type archived since still counts, so somebody cancelled here does not
 *  go back to their old file's words because the type left the price list (a person's own
 *  page says "Not set up" of an archived type, which is about setting it up again). */
export async function overForList(
  sql: Sql | TransactionSql,
  gymId: string,
  entryIds: readonly string[] | null,
  alsoIds: readonly string[],
  today: string,
): Promise<OverForList[]> {
  if (entryIds !== null && entryIds.length === 0 && alsoIds.length === 0) return [];
  const ids = entryIds === null ? null : [...entryIds];
  const rows = await sql<(Nullable<ListHeldColumns> & { entry_id: string; no_email: boolean; listed_unheld: string | null })[]>`
    WITH asked AS (
      SELECT DISTINCT x.entry_id
      FROM gym_held_memberships x
      WHERE x.gym_id = ${gymId} AND x.status = ANY(${[...OVER]}::text[])
        AND (${ids}::uuid[] IS NULL OR x.entry_id = ANY(${ids}::uuid[]))
        AND NOT EXISTS (
          SELECT 1 FROM gym_held_memberships y
          WHERE y.gym_id = x.gym_id AND y.entry_id = x.entry_id AND y.status = ANY(${[...IN_USE]}::text[])
        )
      UNION
      SELECT unnest(${[...alsoIds]}::uuid[])
    )
    SELECT e.id AS entry_id, (e.email IS NULL) AS no_email, o.*,
           CASE
             WHEN e.membership_type IS NULL OR e.membership_type = '' THEN NULL
             WHEN EXISTS (
               SELECT 1
               FROM gym_held_memberships lh
               JOIN gym_membership_types lt ON lt.gym_id = lh.gym_id AND lt.id = lh.membership_type_id
               WHERE lh.gym_id = e.gym_id AND lh.entry_id = e.id
                 AND (lower(lt.name) = lower(e.membership_type)
                      OR lt.id = (SELECT l.membership_type_id FROM gym_membership_word_links l
                                  WHERE l.gym_id = e.gym_id AND l.word_key = lower(e.membership_type)))
             ) THEN NULL
             ELSE e.membership_type
           END AS listed_unheld
    FROM asked
    JOIN gym_member_list_entries e ON e.gym_id = ${gymId} AND e.id = asked.entry_id AND e.former_at IS NULL
    LEFT JOIN LATERAL (
      SELECT ${LIST_COLUMNS(sql)}
      FROM gym_held_memberships h
      JOIN gym_membership_types t ON t.gym_id = h.gym_id AND t.id = h.membership_type_id
      WHERE h.gym_id = e.gym_id AND h.entry_id = e.id AND h.status = ANY(${[...OVER]}::text[])
      ORDER BY
        CASE
          WHEN h.status = 'cancelled' THEN h.cancelled_on
          -- One that renews has no last day; the rule falls back on its start day.
          WHEN h.kind = 'recurring' AND h.renews THEN h.starts_on
          ELSE (
            -- A repeating one that will not renew runs to the end of what is paid.
            SELECT CASE WHEN d.last_day <= ${today}::date THEN d.last_day ELSE h.starts_on END
            FROM (SELECT ${LAST_DAY(sql)} AS last_day) d
          )
        END DESC,
        (h.kind = 'pack') ASC,
        h.starts_on DESC,
        h.id::text ASC
      LIMIT 1
    ) o ON true`;
  return rows.map((row) => ({
    entryId: row.entry_id,
    noEmail: row.no_email,
    listedUnheld: row.listed_unheld,
    held: wholeRow(row),
  }));
}

/** The LEFT JOIN's membership: null where the record has none stored over, and every
 *  column of it where it has. */
function wholeRow(row: Nullable<ListHeldColumns>): ListHeld | null {
  const { id, type_name, kind, free, starts_on, frozen_days, gift_days, gift_from, status, paid_periods, paid_floor, renews, from_list } = row;
  if (id === null) return null;
  if (
    type_name === null ||
    kind === null ||
    free === null ||
    starts_on === null ||
    frozen_days === null ||
    gift_days === null ||
    gift_from === null ||
    status === null ||
    paid_periods === null ||
    paid_floor === null ||
    renews === null ||
    from_list === null
  ) {
    throw new Error("a held membership came back without one of its columns");
  }
  return listHeld({
    id,
    type_name,
    kind,
    free,
    starts_on,
    frozen_days,
    gift_days,
    gift_from,
    status,
    paid_periods,
    paid_floor,
    renews,
    from_list,
    term_count: row.term_count,
    term_unit: row.term_unit,
    pack_classes: row.pack_classes,
    pack_days: row.pack_days,
    frozen_on: row.frozen_on,
    cancelled_on: row.cancelled_on,
    classes_left: row.classes_left,
    full_from: row.full_from,
  });
}

/** One class off a pack, for a booking. False where the pack has none left: the caller
 *  holds the gym's lock and has just read one, so that is a fault and it throws. */
export async function chargePack(tx: TransactionSql, gymId: string, membershipId: string, now: Date): Promise<boolean> {
  const rows = await tx<{ id: string }[]>`
    UPDATE gym_held_memberships SET classes_left = classes_left - 1, updated_at = ${now}
    WHERE gym_id = ${gymId} AND id = ${membershipId} AND kind = 'pack' AND classes_left > 0
    RETURNING id`;
  return rows.length === 1;
}

/** A pack's class given back by a free cancel. A pack marked ended because its last class
 *  was used runs again; one over by its days stays over by the rule's own reading. */
export async function givePackClassBack(tx: TransactionSql, gymId: string, membershipId: string, now: Date): Promise<void> {
  await tx`
    UPDATE gym_held_memberships
    SET status = CASE WHEN status = 'ended' AND classes_left = 0 THEN 'active' ELSE status END,
        classes_left = classes_left + 1, updated_at = ${now}
    WHERE gym_id = ${gymId} AND id = ${membershipId} AND kind = 'pack' AND classes_left < pack_classes`;
}

/** Several packs given their classes back in one statement (`n` each), for bookings ended
 *  with a class or with a person's membership. Never past what the pack was sold with. */
export async function givePackClassesBack(tx: TransactionSql, gymId: string, back: ReadonlyMap<string, number>, now: Date): Promise<void> {
  if (back.size === 0) return;
  const payload = [...back].map(([id, n]) => ({ id, n }));
  await tx`
    UPDATE gym_held_memberships h
    SET status = CASE WHEN h.status = 'ended' AND h.classes_left = 0 THEN 'active' ELSE h.status END,
        classes_left = LEAST(h.pack_classes, h.classes_left + r.n), updated_at = ${now}
    FROM jsonb_to_recordset(${tx.json(payload)}) AS r(id uuid, n int)
    WHERE h.gym_id = ${gymId} AND h.id = r.id AND h.kind = 'pack'`;
}

/** How many memberships each of these records has in use on `today`, by the rule: a
 *  stored `active` row the clock has ended is not counted. Only records with at least
 *  `atLeast` stored in use are read. */
export async function inUseByRule(
  tx: TransactionSql,
  gymId: string,
  entryIds: readonly string[],
  today: string,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (entryIds.length === 0) return counts;
  const rows = await tx`
    SELECT h.entry_id, ${COLUMNS(tx)}
    FROM gym_held_memberships h
    JOIN gym_membership_types t ON t.gym_id = h.gym_id AND t.id = h.membership_type_id
    WHERE h.gym_id = ${gymId} AND h.entry_id = ANY(${[...entryIds]}::uuid[])
      AND h.status = ANY(${[...IN_USE]}::text[])`;
  for (const row of rows) {
    const entryId = z.object({ entry_id: z.string() }).passthrough().parse(row).entry_id;
    if (heldMembershipView(shape(row).membership, today).status === "ended") continue;
    counts.set(entryId, (counts.get(entryId) ?? 0) + 1);
  }
  return counts;
}
