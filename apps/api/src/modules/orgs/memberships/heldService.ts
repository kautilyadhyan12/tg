// A person's memberships (spec Part 3 §13.2; ROADMAP 17a-ii).
//
// Reading them needs `members.confirm`, the tick the person's page itself needs, so
// what somebody owes is shown to nobody who cannot open that page. Giving one and
// changing one need the same tick through `requireWritablePrivilege`: a gym with no
// live plan reads them and cannot change them.
//
// Every date is worked out on the gym's own day: the server's clock read in the
// gym's time zone, never the caller's.
import type { Sql } from "postgres";
import {
  TERMINAL_PAYMENT_WORDS,
  DISCOUNT_WORDS,
  FRIEND_GIFT_WORDS,
  MEMBER_GIFT_WORDS,
  BILLS_SHOWN,
  BILL_OVERDUE_DAYS_MAX,
  HELD_EARLIER_PAGE,
  MEMBERSHIP_CHANGE_WORDS,
  changeFrom,
  MEMBER_LIST_BY_HAND_WORDS,
  billSettingsResponseSchema,
  countAfterGap,
  discountNothingOffWords,
  discountRefusalWords,
  formatMinor,
  freezeFeeApplies,
  heldMembershipView,
  memberCurrencyForCountry,
  heldMembershipsResponseSchema,
  memberBillState,
  memberCancelTarget,
  memberPayTarget,
  memberUndoTarget,
  paymentRefundableMinor,
  type BillSettings,
  type BillSettingsResponse,
  type CancelMemberBillRequest,
  type ChangeHeldMembershipRequest,
  type ClassBookingsEnding,
  type GiveHeldMembershipRequest,
  type HeldMembership,
  type HeldMembershipEvent,
  type HeldMembershipShown,
  type HeldMembershipView,
  type HeldMembershipsResponse,
  type MemberBilling,
  type MemberFee,
  type RecordMemberFeePaymentRequest,
  type NoteMemberRefundRequest,
  type RecordMemberPaymentRequest,
  type VoidMemberPaymentRequest,
  type VoidMemberRefundRequest,
} from "@app/shared";
import { dayInTz } from "../../gamification/streak.js";
import { OrgsError, requirePrivilege, requireWritablePrivilege } from "../service.js";
import { endMembershipBookings, membershipBookingsAsk } from "../classes/bookingChanges.js";
import { endingPerson, type BookingsAnswer } from "../classes/service.js";
import * as repo from "./heldRepo.js";
import * as billsRepo from "./billsRepo.js";
import * as changeRepo from "./changeRepo.js";
import { membershipDiscounts } from "../register/discountsRepo.js";
import { friendGiftOffer } from "../referrals/friendGift.js";
import { giftDaysOn, giftsOnBills, waitingGiftFor } from "../referrals/memberGiftRepo.js";
import { billDayOf, overdueDaysOf, type BillRow, type PaymentRow, type RefundRow, type VoidedPaymentRow, type VoidedRefundRow } from "./billsSql.js";
import * as feesRepo from "./feesRepo.js";
import { freezeFeeOf } from "./freezeFees.js";
import { type FeePaymentRow, type FeeRow } from "./feesRepo.js";

export interface HeldDeps {
  sql: Sql;
  now: () => Date;
}

const notFound = (): OrgsError => new OrgsError(404, "entry_not_found", MEMBER_LIST_BY_HAND_WORDS.entry_not_found);

/** In use first, then the ones that are over; newest start first within each. */
const ORDER: Record<HeldMembershipShown, number> = { active: 0, frozen: 0, upcoming: 1, ended: 2, cancelled: 2 };

/** One membership's bills, newest first, and the one payment that can be recorded or
 *  taken back now, the one bill that can be cancelled and what each payment can still be
 *  refunded: what the write will be decided by, worked out by the same rules. */
function billingOf(
  row: { id: string; nextBillMinor: number; membership: HeldMembership },
  bills: readonly BillRow[],
  payments: readonly PaymentRow[],
  refunds: readonly RefundRow[],
  voided: { payments: readonly VoidedPaymentRow[]; refunds: readonly VoidedRefundRow[] },
  fees: { fees: readonly FeeRow[]; payments: readonly FeePaymentRow[] },
  ctx: { today: string; past: boolean; overdueAfterDays: number; gifts: ReadonlyMap<string, { offMinor: number; currency: string; friendName: string | null }> },
): Omit<MemberBilling, "change"> {
  const view = heldMembershipView(row.membership, ctx.today);
  const pay = memberPayTarget(row.membership, row.nextBillMinor, ctx.today, bills, ctx.past);
  const cancel = memberCancelTarget(row.membership, row.nextBillMinor, ctx.today, bills, ctx.past);
  const cancelBill = cancel === null ? undefined : bills.find((b) => b.periodIndex === cancel.periodIndex);
  const newestBack = ctx.past ? null : memberUndoTarget(row.membership, ctx.today, bills, payments);
  // A payment taken on the Terminal is refunded in Square, never voided here (18d-vi-a).
  const back = newestBack !== null && payments.some((p) => p.id === newestBack.paymentId && p.method === "terminal") ? null : newestBack;
  // A mark with no payment behind it: taken back as it always was. A period a bill
  // settled (paid, cancelled or refunded) is not one.
  const settledAt = (index: number): boolean => bills.some((b) => b.periodIndex === index && b.status !== "open");
  // The newest bills, and always the one a payment is taken for, however old: what can be
  // paid or cancelled is never left off the page.
  const newest = bills.slice(0, BILLS_SHOWN);
  const owedBill = pay === null ? undefined : bills.find((b) => b.periodIndex === pay.periodIndex);
  const sent = owedBill === undefined || newest.includes(owedBill) ? newest : [...newest, owedBill];
  const mark = !ctx.past && newestBack === null && view.can.undoPaid !== null && !settledAt(view.can.undoPaid.paidPeriods) ? view.can.undoPaid : null;
  const refundOf = (r: RefundRow) => ({ id: r.id, amountMinor: r.amountMinor, method: r.method, refundedOn: r.refundedOn, reason: r.reason, by: r.by, receiptNumber: r.receiptNumber });
  const voidedRefundsOf = (paymentId: string) => voided.refunds.filter((r) => r.paymentId === paymentId).map((r) => ({ ...refundOf(r), voided: r.voided }));
  return {
    bills: sent.map((b) => ({
      id: b.id,
      periodIndex: b.periodIndex,
      covers: b.covers,
      part: b.periodIndex === 0 && row.membership.fullFrom !== null,
      amountMinor: b.amountMinor,
      tax: b.tax,
      joiningFeeMinor: b.joiningFeeMinor,
      changeCreditMinor: b.changeCreditMinor,
      movedMinor: b.movedMinor,
      paidMinor: b.paidMinor,
      dueOn: b.dueOn,
      state: memberBillState(b, ctx.today, ctx.overdueAfterDays),
      refundedMinor: b.refundedMinor,
      cancelled: b.cancelled,
      gift: ctx.gifts.get(b.id) ?? null,
      payments: payments
        .filter((p) => p.billId === b.id)
        .map((p) => ({
          id: p.id,
          amountMinor: p.amountMinor,
          method: p.method,
          paidOn: p.paidOn,
          by: p.by,
          refunds: refunds.filter((r) => r.paymentId === p.id).map(refundOf),
          voidedRefunds: voidedRefundsOf(p.id),
          refundableMinor: paymentRefundableMinor(b, p),
          receiptNumber: p.receiptNumber,
        })),
      voidedPayments: voided.payments
        .filter((p) => p.billId === b.id)
        .map((p) => ({
          id: p.id,
          amountMinor: p.amountMinor,
          method: p.method,
          paidOn: p.paidOn,
          by: p.by,
          voidedRefunds: voidedRefundsOf(p.id),
          receiptNumber: p.receiptNumber,
          voided: p.voided,
        })),
    })),
    billsNotShown: bills.length - sent.length,
    pay:
      pay === null
        ? null
        : {
            periodIndex: pay.periodIndex,
            covers: pay.covers,
            leftMinor: pay.leftMinor,
            dueOn: pay.dueOn,
            state: memberBillState({ status: "open", dueOn: pay.dueOn }, ctx.today, ctx.overdueAfterDays) === "overdue" ? "overdue" : "due",
          },
    cancel: cancelBill === undefined ? null : { billId: cancelBill.id },
    undo: back !== null ? { kind: "payment", paymentId: back.paymentId } : mark !== null ? { kind: "mark", paidPeriods: mark.paidPeriods } : null,
    fees: fees.fees.map((f) => feeOf(f, fees.payments, ctx)),
  };
}

/** One fee as a person's page draws it (18h-i): paid all at once or waived while it is owed,
 *  and its payment voided while it stands. */
function feeOf(f: FeeRow, payments: readonly FeePaymentRow[], ctx: { today: string; overdueAfterDays: number }): MemberFee {
  const mine = payments.filter((p) => p.billId === f.id);
  const standing = mine.filter((p) => p.voided === null);
  const owed = f.status === "open";
  const paymentOf = (p: FeePaymentRow) => ({ id: p.id, amountMinor: p.amountMinor, method: p.method, paidOn: p.paidOn, by: p.by, receiptNumber: p.receiptNumber });
  return {
    id: f.id,
    fee: f.fee,
    of: f.of,
    forName: f.forName,
    on: f.on,
    to: f.to,
    amountMinor: f.amountMinor,
    tax: f.tax,
    dueOn: f.dueOn,
    state:
      f.waived !== null
        ? "waived"
        : f.status === "void"
          ? "removed"
          : owed
            ? memberBillState({ status: "open", dueOn: f.dueOn }, ctx.today, ctx.overdueAfterDays) === "overdue"
              ? "overdue"
              : "due"
            : "paid",
    waived: f.waived,
    stillOwed: f.stillOwed,
    payments: standing.map((p) => ({ ...paymentOf(p), refunds: [], voidedRefunds: [], refundableMinor: 0 })),
    voidedPayments: mine.flatMap((p) => (p.voided === null ? [] : [{ ...paymentOf(p), voidedRefunds: [], voided: p.voided }])),
    // A payment taken on the Terminal is refunded in Square, never voided here (18d-vi-b-i).
    can: { pay: owed, waive: owed, voidPaymentId: f.status === "paid" && standing[0] !== undefined && standing[0].method !== "terminal" ? standing[0].id : null },
  };
}

/** The membership as the rule reads it, with ONE day for what is owed: the day its OLDEST
 *  open bill fell due, where it has one at or before the first unpaid period. That is the
 *  bill a payment is taken for first, so the line above the bills and the oldest bill
 *  under it say the same day; a freeze moves the membership's own dates and never a
 *  bill's; and every reader is sent the same day.
 *
 *  A past member's memberships are not in use, so their own clock says nothing true of
 *  money: for them a payment is due where a bill of that membership is still open, since
 *  its oldest, and nothing is said otherwise. */
function viewOf(row: { id: string; membership: HeldMembership }, bills: readonly BillRow[], fees: readonly FeeRow[], today: string, past: boolean): HeldMembershipView {
  const view = heldMembershipView(row.membership, today);
  // An unpaid fee that has fallen due is a payment due on its membership too, as the
  // Members list reads it (18h-i).
  const fee = fees.filter((f) => f.membershipId === row.id && f.status === "open" && f.dueOn <= today).sort((a, b) => (a.dueOn < b.dueOn ? -1 : a.dueOn > b.dueOn ? 1 : 0))[0];
  if (past) {
    const left = bills.filter((b) => b.membershipId === row.id && b.status === "open").sort((a, b) => a.periodIndex - b.periodIndex)[0];
    const since = left === undefined ? fee?.dueOn : fee === undefined || left.dueOn <= fee.dueOn ? left.dueOn : fee.dueOn;
    return { ...view, payment: since === undefined ? null : { state: "due", since } };
  }
  if (fee !== undefined && view.payment?.state !== "due") return { ...view, payment: { state: "due", since: fee.dueOn } };
  if (view.payment === null || view.payment.state !== "due" || view.payment.since === null) return view;
  const owed = bills
    .filter((b) => b.membershipId === row.id && b.status === "open" && b.periodIndex <= row.membership.paidPeriods)
    .sort((a, b) => a.periodIndex - b.periodIndex)[0];
  return owed === undefined ? view : { ...view, payment: { state: "due", since: owed.dueOn } };
}

/** `offers`: what the Add form fills in (discounts and Refer a friend's gifts), read for
 *  staff who take payments and never for the member's own view (`readOwnHeld`). */
async function readOr404(deps: HeldDeps, gymId: string, entryId: string, today: string, canBill: boolean, offers = canBill): Promise<HeldMembershipsResponse> {
  // A discount and its promo code are read and used by whoever takes payments, as on Sell.
  const [list, offered, friendGift] = await Promise.all([
    repo.readHeld(deps.sql, gymId, entryId),
    offers ? membershipDiscounts(deps.sql, gymId) : [],
    // Refer a friend's gift, for the friend it is for (20e-ii-b-i): filled in on Add.
    offers ? friendGiftOffer(deps.sql, gymId, entryId, today) : null,
  ]);
  if (list === null) throw notFound();
  // A member's own Refer a friend gift (20e-ii-b-ii-a): what it took off a bill, and the one
  // waiting, filled in on Add.
  // One off a membership is the one Add membership fills in; one off products waits for Sell,
  // and the page says both (round one, L3).
  const [gifts, memberGift, memberGiftAtSell, freeDays] = await Promise.all([
    canBill ? giftsOnBills(deps.sql, gymId, list.bills.map((b) => b.id)) : new Map<string, { offMinor: number; currency: string; friendName: string | null }>(),
    offers && !list.past ? waitingGiftFor(deps.sql, gymId, entryId, "membership") : null,
    offers && !list.past ? waitingGiftFor(deps.sql, gymId, entryId, "products") : null,
    // Refer a friend's free days on each (20e-ii-b-ii-b): why its dates moved.
    giftDaysOn(deps.sql, gymId, [...list.inUse, ...list.over].map((row) => row.id)),
  ]);
  const ctx = { today, past: list.past, overdueAfterDays: list.overdueAfterDays, gifts };
  // The page reads a membership as the next write will find it: with its count moved
  // over the periods nobody was asked for (`countAfterGap`), which `settle` then writes.
  const asOfToday = (row: repo.HeldRow): repo.HeldRow => {
    if (list.past) return row;
    const have = new Set(list.bills.filter((b) => b.membershipId === row.id).map((b) => b.periodIndex));
    const count = countAfterGap(row.membership, today, have);
    return count === null ? row : { ...row, membership: { ...row.membership, paidPeriods: count, paidFloor: count } };
  };
  // Change membership (18x): worked out by the rule the write uses, for each one in use.
  const replaced = new Set(list.changes.filter((c) => c.newStatus !== "cancelled").map((c) => c.oldId));
  const changeOf = (row: repo.HeldRow): MemberBilling["change"] => {
    if (list.past || !list.inUse.some((r) => r.id === row.id)) return null;
    if (replaced.has(row.id)) return { ok: false, reason: "changed_already" };
    const from = changeFrom(row.membership, row.priceMinor, list.bills.filter((b) => b.membershipId === row.id).map(changeRepo.changeBillFacts), today);
    return from.ok ? { ok: true, creditMinor: from.creditMinor, daysLeft: from.daysLeft, nextOn: from.nextOn } : { ok: false, reason: from.reason };
  };
  const changedTo = (id: string) => list.changes.find((c) => c.oldId === id && c.newStatus !== "cancelled");
  const changedFrom = (id: string) => list.changes.find((c) => c.newId === id);
  const all = [...list.inUse.map(asOfToday), ...list.over]
    .map((row) => ({
      billing: canBill
        ? {
            ...billingOf(
            row,
            list.bills.filter((b) => b.membershipId === row.id),
            list.payments.filter((p) => p.membershipId === row.id),
            list.refunds.filter((r) => r.membershipId === row.id),
            {
              payments: list.voidedPayments.filter((p) => p.membershipId === row.id),
              refunds: list.voidedRefunds.filter((r) => r.membershipId === row.id),
            },
            { fees: list.fees.filter((f) => f.membershipId === row.id), payments: list.feePayments },
            ctx,
          ),
            change: changeOf(row),
          }
        : null,
      id: row.id,
      typeId: row.typeId,
      typeName: row.typeName,
      kind: row.membership.kind,
      priceMinor: row.priceMinor,
      currency: row.currency,
      termCount: row.membership.termCount,
      termUnit: row.membership.termUnit,
      packClasses: row.membership.packClasses,
      packDays: row.membership.packDays,
      startsOn: row.membership.startsOn,
      fullFrom: row.membership.fullFrom,
      frozenOn: row.membership.frozenOn,
      // While frozen, what its freeze charges; else what a freeze today would (18z).
      freezeFeeMinor:
        row.membership.status === "frozen"
          ? row.freezeFeeMinor
          : heldMembershipView(row.membership, today).can.freeze && freezeFeeApplies(row.membership)
            ? list.freezeFee
            : 0,
      classesLeft: row.membership.classesLeft,
      fromList: row.fromList,
      notCharged: list.bills.some((b) => b.membershipId === row.id && b.cancelled !== null && b.periodIndex === row.membership.paidPeriods - 1),
      refundedInFull: list.bills.some((b) => b.membershipId === row.id && b.status === "refunded" && b.periodIndex === row.membership.paidPeriods - 1),
      discount: row.discount,
      freeDays: freeDays.get(row.id) ?? [],
      tax: row.tax,
      view: viewOf(row, list.bills, list.fees, today, list.past),
      changedFrom: ((c) => (c === undefined ? null : { typeName: c.oldName, stopped: c.stopped }))(changedFrom(row.id)),
      changedTo: ((c) => (c === undefined ? null : { typeName: c.newName, startsOn: c.startsOn }))(changedTo(row.id)),
    }))
    .sort(
      (a, b) =>
        ORDER[a.view.status] - ORDER[b.view.status] ||
        (a.startsOn < b.startsOn ? 1 : a.startsOn > b.startsOn ? -1 : 0) ||
        (a.id < b.id ? -1 : 1),
    );
  // Every one in use, and a page of the ones that are over: the ones the clock has
  // ended since the last write come first among those, being the newest.
  const inUse = all.filter((m) => ORDER[m.view.status] < 2);
  const over = all.filter((m) => ORDER[m.view.status] === 2);
  const shown = over.slice(0, HELD_EARLIER_PAGE);
  const stored = list.overTotal - list.over.length;
  return heldMembershipsResponseSchema.parse({
    today,
    past: list.past,
    memberships: [...inUse, ...shown],
    earlierNotShown: over.length - shown.length + stored,
    types: list.types,
    listed: list.listed,
    canBill,
    taxIncluded: list.taxIncluded,
    billDay: list.billDay,
    discounts: offered.map((d) => ({ ...d, archivedAt: d.archivedAt === null ? null : d.archivedAt.toISOString(), updatedAt: d.updatedAt.toISOString() })),
    friendGift: list.past ? null : friendGift,
    memberGift,
    memberGiftAtSell,
  });
}

function throwOnFailure(outcome: repo.HeldWriteOutcome): void {
  switch (outcome.kind) {
    case "ok":
      return;
    case "entry_not_found":
      throw notFound();
    case "membership_not_found":
      throw new OrgsError(404, "held_membership_not_found", "That membership was not found.");
    case "type_not_found":
      throw new OrgsError(
        409,
        "membership_type_not_found",
        "That membership type is no longer on your price list. Pick another.",
      );
    case "past_member":
      throw new OrgsError(409, "past_member", "This is a past member. Put them back on your list first.");
    case "too_many":
      throw new OrgsError(
        409,
        "too_many_held_memberships",
        `One person can have ${String(outcome.cap)} memberships running at once. Cancel one they no longer use first.`,
      );
    case "start_out_of_range":
      throw new OrgsError(400, "start_out_of_range", "Pick a start date no more than a year from today.");
    case "already_over":
      throw new OrgsError(
        409,
        "membership_already_over",
        "With that start date this membership would already be over. Pick a later start date.",
      );
    case "already_held":
      throw new OrgsError(
        409,
        "membership_already_held",
        outcome.ends
          ? `They already have ${outcome.typeName}. Cancel that one first, or pick a start date after it ends.`
          : `They already have ${outcome.typeName}. Cancel that one first.`,
      );
    case "request_reused":
      throw new OrgsError(409, "request_reused", "That was already saved for somebody else. Open the form again.");
    case "method_needed":
      throw new OrgsError(400, "payment_method_needed", "Pick how they paid.");
    case "price_changed":
      throw new OrgsError(409, "membership_price_changed", "The price of this membership changed while this was open. Nothing was saved: check the total and press again.");
    case "bill_day_changed":
      throw new OrgsError(409, "membership_bill_day_changed", "Your gym's billing day changed while this was open. Nothing was saved: check the total and press again.");
    case "freeze_fee_changed":
      throw new OrgsError(409, "membership_freeze_fee_changed", "Your gym's freeze fee changed while this was open. Nothing was saved: check the fee and press Freeze again.");
    case "discount_not_found":
      throw new OrgsError(409, "discount_not_available", DISCOUNT_WORDS.membership_not_available);
    case "discount_refused":
      throw new OrgsError(409, `discount_${outcome.reason}`, discountRefusalWords(outcome.name, outcome.reason, "membership"));
    case "discount_nothing_off":
      throw new OrgsError(409, "discount_takes_nothing_off", discountNothingOffWords(outcome.name, "membership"));
    case "discount_nothing_to_pay":
      throw new OrgsError(409, "discount_nothing_to_pay", DISCOUNT_WORDS.membership_nothing_to_pay);
    case "discount_changed":
      throw new OrgsError(409, "membership_discount_changed", DISCOUNT_WORDS.membership_discount_changed);
    case "friend_gift_not_theirs":
      throw new OrgsError(409, "friend_gift_not_theirs", FRIEND_GIFT_WORDS.not_theirs);
    case "member_gift_not_theirs":
      throw new OrgsError(409, "member_gift_not_theirs", MEMBER_GIFT_WORDS.not_theirs);
    case "member_gift_changed":
      throw new OrgsError(409, "member_gift_changed", MEMBER_GIFT_WORDS.changed);
    case "terminal_waiting":
      throw new OrgsError(409, "terminal_payment_waiting", TERMINAL_PAYMENT_WORDS.waiting);
    case "early_payment":
      throw new OrgsError(
        409,
        "early_payment_stands",
        "A payment is recorded for a month after its last day. Void that payment first, then cancel.",
      );
    case "not_allowed":
      throw new OrgsError(
        409,
        "held_membership_changed",
        "This membership has changed since you opened it. Nothing was saved: check it and try again.",
      );
    default: {
      const never: never = outcome;
      throw new Error(`unhandled held membership outcome: ${JSON.stringify(never)}`);
    }
  }
}

export async function getHeldMemberships(
  deps: HeldDeps,
  userId: string,
  gymId: string,
  entryId: string,
): Promise<HeldMembershipsResponse> {
  const { org, privileges } = await requirePrivilege(deps, gymId, userId, "members.confirm");
  return await readOr404(deps, gymId, entryId, dayInTz(deps.now(), org.timezone), privileges.includes(BILLING));
}

/** One record's memberships with their bills, as staff who take payments read them, for the
 *  member's own view (18j), which is the caller's to check is theirs. */
export async function readOwnHeld(deps: HeldDeps, gymId: string, entryId: string, today: string): Promise<HeldMembershipsResponse> {
  return await readOr404(deps, gymId, entryId, today, true, false);
}

export async function giveHeldMembership(
  deps: HeldDeps,
  userId: string,
  gymId: string,
  entryId: string,
  req: GiveHeldMembershipRequest,
): Promise<HeldMembershipsResponse> {
  const { org, privileges } = await requireWritablePrivilege(deps, gymId, userId, "members.confirm");
  const canBill = privileges.includes(BILLING);
  // Saying it is paid records a payment, which is the notebook's own tick; so is using a
  // discount, which is taken where payments are (18b-ii-a), paid or not.
  if (req.paid && !canBill) throw new OrgsError(403, "forbidden", NO_BILLING);
  if ((req.discountId !== undefined || req.memberGiftId !== undefined) && !canBill) throw new OrgsError(403, "forbidden", NO_DISCOUNTS);
  const now = deps.now();
  const today = dayInTz(now, org.timezone);
  throwOnFailure(
    await repo.giveHeld(deps.sql, {
      gymId,
      entryId,
      typeId: req.typeId,
      requestKey: req.requestKey,
      startsOn: req.startsOn,
      paid: req.paid,
      method: req.method ?? null,
      shownPriceMinor: req.priceMinor ?? null,
      shownTotalMinor: req.totalMinor ?? null,
      joiningFeeMinor: req.joiningFeeMinor ?? null,
      // A screen that showed a price and said nothing of a part month showed none (18y).
      ...(req.priceMinor === undefined && req.fullFrom === undefined ? {} : { shownFullFrom: req.fullFrom ?? null }),
      // Leaving the fee off is waiving it, which is where payments are taken, as a discount is.
      mayWaiveJoiningFee: canBill,
      discount: req.discountId === undefined || req.discountMinor === undefined ? null : { id: req.discountId, shownOffMinor: req.discountMinor },
      memberGift: req.memberGiftId === undefined || req.memberGiftMinor === undefined ? null : { id: req.memberGiftId, shownOffMinor: req.memberGiftMinor },
      today,
      actorUserId: userId,
      now,
    }),
  );
  return await readOr404(deps, gymId, entryId, today, canBill);
}

const CANCEL_BOOKINGS = { ask: membershipBookingsAsk, end: endMembershipBookings };

export async function moveHeldMembership(
  deps: HeldDeps,
  userId: string,
  gymId: string,
  entryId: string,
  membershipId: string,
  event: HeldMembershipEvent,
  confirmBookings: string | null = null,
  confirmPtSessions: string | null = null,
  freezeFeeMinor = 0,
): Promise<BookingsAnswer<HeldMembershipsResponse>> {
  const { org, privileges } = await requireWritablePrivilege(deps, gymId, userId, "members.confirm");
  const now = deps.now();
  const today = dayInTz(now, org.timezone);
  const outcome = await repo.moveHeld(deps.sql, CANCEL_BOOKINGS, {
    gymId,
    entryId,
    membershipId,
    event,
    today,
    confirmBookings,
    confirmPtSessions,
    freezeFeeMinor,
    // Freezing with no fee where the gym charges one is a waiver: staff who record payments only.
    mayWaiveFreezeFee: privileges.includes(BILLING),
    actorUserId: userId,
    now,
  });
  if (outcome.kind === "has_bookings") {
    const ending: ClassBookingsEnding = { ...outcome.ending, people: outcome.ending.people.map(endingPerson) };
    // `ptSessions` rides along as it is: the sessions booked on this membership.
    return { kind: "bookings", ending };
  }
  throwOnFailure(outcome);
  return { kind: "ok", body: await readOr404(deps, gymId, entryId, today, privileges.includes(BILLING)) };
}

/** CHANGE MEMBERSHIP (18x): moves money, so it needs `billing.members` as well as the person's
 *  page. Classes booked on the old one that the new one does not cover end once confirmed. */
export async function changeHeldMembership(
  deps: HeldDeps,
  userId: string,
  gymId: string,
  entryId: string,
  membershipId: string,
  req: ChangeHeldMembershipRequest,
): Promise<BookingsAnswer<HeldMembershipsResponse>> {
  const { today, now } = await requireBilling(deps, userId, gymId);
  const outcome = await changeRepo.changeHeld(deps.sql, CANCEL_BOOKINGS, {
    gymId,
    entryId,
    membershipId,
    typeId: req.typeId,
    when: req.when,
    requestKey: req.requestKey,
    shownPriceMinor: req.priceMinor,
    shownCreditMinor: req.creditMinor,
    shownTotalMinor: req.totalMinor,
    shownStartsOn: req.startsOn,
    shownFullFrom: req.fullFrom ?? null,
    paid: req.paid,
    method: req.method ?? null,
    confirmBookings: req.confirmBookings ?? null,
    confirmPtSessions: req.confirmPtSessions ?? null,
    today,
    actorUserId: userId,
    now,
  });
  if (outcome.kind === "has_bookings") {
    return { kind: "bookings", ending: { ...outcome.ending, people: outcome.ending.people.map(endingPerson) } };
  }
  if (outcome.kind === "change_refused") throw new OrgsError(409, `membership_change_${outcome.reason}`, MEMBERSHIP_CHANGE_WORDS[outcome.reason]);
  if (outcome.kind === "credit_changed") throw new OrgsError(409, "membership_change_credit_changed", MEMBERSHIP_CHANGE_WORDS.credit_changed);
  throwOnFailure(outcome);
  return { kind: "ok", body: await readOr404(deps, gymId, entryId, today, true) };
}

// ── Bills and payments (spec Part 3 §14.2; ROADMAP 18a-i) ────────────────────
//
// Reading a person's bills, recording a payment and taking one back need
// `billing.members`, and the person's page they are drawn on needs `members.confirm`:
// both are asked.

const BILLING = "billing.members";
const NO_BILLING = "Recording payments isn't part of your role. Ask the owner to turn on \"Record members' payments\" for you.";
const NO_DISCOUNTS = "Using a discount isn't part of your role. Add the membership without one, or ask the owner to turn on \"Record members' payments\" for you.";

async function requireBilling(deps: HeldDeps, userId: string, gymId: string): Promise<{ today: string; now: Date }> {
  const { org, privileges } = await requireWritablePrivilege(deps, gymId, userId, "members.confirm");
  if (!privileges.includes(BILLING)) throw new OrgsError(403, "forbidden", NO_BILLING);
  const now = deps.now();
  return { today: dayInTz(now, org.timezone), now };
}

function throwOnBillFailure(outcome: billsRepo.BillWriteOutcome): void {
  switch (outcome.kind) {
    case "ok":
      return;
    case "entry_not_found":
      throw notFound();
    case "membership_not_found":
      throw new OrgsError(404, "held_membership_not_found", "That membership was not found.");
    case "payment_not_found":
      throw new OrgsError(404, "member_payment_not_found", "That payment was not found.");
    case "bill_not_found":
      throw new OrgsError(404, "member_bill_not_found", "That bill was not found.");
    case "refund_not_found":
      throw new OrgsError(404, "member_refund_not_found", "That refund was not found.");
    case "past_member":
      throw new OrgsError(409, "past_member", "This is a past member. Put them back on your list first.");
    case "request_reused":
      throw new OrgsError(409, "request_reused", "That form was already used. Open it again.");
    case "bill_has_payment":
      throw new OrgsError(
        409,
        "bill_has_payment",
        "A payment is recorded on this bill. Void it first, or record the rest.",
      );
    case "refund_not_settled":
      throw new OrgsError(
        409,
        "refund_not_settled",
        "This bill isn't fully paid, so there is nothing to refund yet. If a payment was recorded by mistake, void it.",
      );
    case "refund_too_much":
      throw new OrgsError(
        409,
        "refund_too_much",
        outcome.leftMinor === 0
          ? "All of that payment has already been refunded."
          : `That is more than is left of that payment. ${formatMinor(outcome.leftMinor, outcome.currency)} can still be refunded.`,
      );
    case "too_much":
      throw new OrgsError(
        409,
        "payment_too_much",
        `That is more than is left to pay. ${formatMinor(outcome.leftMinor, outcome.currency)} is left.`,
      );
    case "not_allowed":
      throw new OrgsError(
        409,
        "held_membership_changed",
        "This membership has changed since you opened it. Nothing was saved: check it and try again.",
      );
    case "terminal_waiting":
      throw new OrgsError(409, "terminal_payment_waiting", TERMINAL_PAYMENT_WORDS.waiting);
    case "terminal_payment":
      throw new OrgsError(409, "terminal_payment_void", TERMINAL_PAYMENT_WORDS.void_terminal);
    default: {
      const never: never = outcome;
      throw new Error(`unhandled bill outcome: ${JSON.stringify(never)}`);
    }
  }
}

export async function recordMemberPayment(
  deps: HeldDeps,
  userId: string,
  gymId: string,
  entryId: string,
  membershipId: string,
  req: RecordMemberPaymentRequest,
): Promise<HeldMembershipsResponse> {
  const { today, now } = await requireBilling(deps, userId, gymId);
  throwOnBillFailure(
    await billsRepo.recordPayment(deps.sql, {
      gymId,
      entryId,
      membershipId,
      requestKey: req.requestKey,
      periodIndex: req.periodIndex,
      amountMinor: req.amountMinor,
      method: req.method,
      today,
      actorUserId: userId,
      now,
    }),
  );
  return await readOr404(deps, gymId, entryId, today, true);
}

export async function voidMemberPayment(
  deps: HeldDeps,
  userId: string,
  gymId: string,
  entryId: string,
  membershipId: string,
  paymentId: string,
  req: VoidMemberPaymentRequest,
): Promise<HeldMembershipsResponse> {
  const { today, now } = await requireBilling(deps, userId, gymId);
  throwOnBillFailure(await billsRepo.voidPayment(deps.sql, { gymId, entryId, membershipId, paymentId, reason: req.reason, today, actorUserId: userId, now }));
  return await readOr404(deps, gymId, entryId, today, true);
}

/** Staff cancel one bill of a membership: the person no longer owes it. */
export async function cancelMemberBill(
  deps: HeldDeps,
  userId: string,
  gymId: string,
  entryId: string,
  membershipId: string,
  billId: string,
  req: CancelMemberBillRequest,
): Promise<HeldMembershipsResponse> {
  const { today, now } = await requireBilling(deps, userId, gymId);
  throwOnBillFailure(await billsRepo.cancelMemberBill(deps.sql, { gymId, entryId, membershipId, billId, reason: req.reason, today, actorUserId: userId, now }));
  return await readOr404(deps, gymId, entryId, today, true);
}

/** Notes that the gym gave money back for one payment. */
export async function noteMemberRefund(
  deps: HeldDeps,
  userId: string,
  gymId: string,
  entryId: string,
  membershipId: string,
  paymentId: string,
  req: NoteMemberRefundRequest,
): Promise<HeldMembershipsResponse> {
  const { today, now } = await requireBilling(deps, userId, gymId);
  throwOnBillFailure(
    await billsRepo.noteRefund(deps.sql, {
      gymId,
      entryId,
      membershipId,
      paymentId,
      requestKey: req.requestKey,
      amountMinor: req.amountMinor,
      method: req.method,
      reason: req.reason,
      today,
      actorUserId: userId,
      now,
    }),
  );
  return await readOr404(deps, gymId, entryId, today, true);
}

export async function voidMemberRefund(
  deps: HeldDeps,
  userId: string,
  gymId: string,
  entryId: string,
  membershipId: string,
  paymentId: string,
  refundId: string,
  req: VoidMemberRefundRequest,
): Promise<HeldMembershipsResponse> {
  const { today, now } = await requireBilling(deps, userId, gymId);
  throwOnBillFailure(await billsRepo.voidRefund(deps.sql, { gymId, entryId, membershipId, paymentId, refundId, reason: req.reason, today, actorUserId: userId, now }));
  return await readOr404(deps, gymId, entryId, today, true);
}

// ── A late cancel or no-show fee (18h-i): the payments' own tick ──

function throwOnFeeFailure(outcome: feesRepo.FeeWriteOutcome): void {
  switch (outcome.kind) {
    case "ok":
      return;
    case "entry_not_found":
      throw notFound();
    case "fee_not_found":
      throw new OrgsError(404, "member_fee_not_found", "That fee was not found.");
    case "payment_not_found":
      throw new OrgsError(404, "member_payment_not_found", "That payment was not found.");
    case "request_reused":
      throw new OrgsError(409, "request_reused", "That form was already used. Open it again.");
    case "past_member":
      throw new OrgsError(409, "past_member", "This is a past member. Put them back on your list first.");
    case "fee_changed":
      throw new OrgsError(409, "member_fee_changed", "This fee has changed since you opened it. Nothing was saved: check it and try again.");
    case "terminal_waiting":
      throw new OrgsError(409, "terminal_payment_waiting", TERMINAL_PAYMENT_WORDS.waiting);
    case "terminal_payment":
      throw new OrgsError(409, "terminal_payment_void", TERMINAL_PAYMENT_WORDS.void_terminal);
    default: {
      const never: never = outcome;
      throw new Error(`unhandled fee outcome: ${JSON.stringify(never)}`);
    }
  }
}

/** Staff record that a fee was paid, all of it. */
export async function recordMemberFeePayment(
  deps: HeldDeps,
  userId: string,
  gymId: string,
  entryId: string,
  membershipId: string,
  billId: string,
  req: RecordMemberFeePaymentRequest,
): Promise<HeldMembershipsResponse> {
  const { today, now } = await requireBilling(deps, userId, gymId);
  throwOnFeeFailure(
    await feesRepo.recordFeePayment(deps.sql, { gymId, entryId, membershipId, billId, requestKey: req.requestKey, amountMinor: req.amountMinor, method: req.method, today, actorUserId: userId, now }),
  );
  return await readOr404(deps, gymId, entryId, today, true);
}

/** Staff waive an unpaid fee. */
export async function waiveMemberFee(deps: HeldDeps, userId: string, gymId: string, entryId: string, membershipId: string, billId: string): Promise<HeldMembershipsResponse> {
  const { today, now } = await requireBilling(deps, userId, gymId);
  throwOnFeeFailure(await feesRepo.waiveFee(deps.sql, { gymId, entryId, membershipId, billId, today, actorUserId: userId, now }));
  return await readOr404(deps, gymId, entryId, today, true);
}

/** Staff void the payment of a fee, recorded by mistake: the fee is owed again. */
export async function voidMemberFeePayment(
  deps: HeldDeps,
  userId: string,
  gymId: string,
  entryId: string,
  membershipId: string,
  billId: string,
  paymentId: string,
  req: VoidMemberPaymentRequest,
): Promise<HeldMembershipsResponse> {
  const { today, now } = await requireBilling(deps, userId, gymId);
  throwOnFeeFailure(await feesRepo.voidFeePayment(deps.sql, { gymId, entryId, membershipId, billId, paymentId, reason: req.reason, actorUserId: userId, now }));
  return await readOr404(deps, gymId, entryId, today, true);
}

/** Takes back a mark that has no payment behind it. A count that would go up is
 *  refused: a period is paid by recording its payment. */
export async function undoPaidMark(
  deps: HeldDeps,
  userId: string,
  gymId: string,
  entryId: string,
  membershipId: string,
  paidPeriods: number,
): Promise<HeldMembershipsResponse> {
  const { today, now } = await requireBilling(deps, userId, gymId);
  throwOnBillFailure(await billsRepo.undoMark(deps.sql, { gymId, entryId, membershipId, paidPeriods, today, actorUserId: userId, now }));
  return await readOr404(deps, gymId, entryId, today, true);
}

export async function getBillSettings(deps: HeldDeps, userId: string, gymId: string): Promise<BillSettingsResponse> {
  const { org, privileges } = await requirePrivilege(deps, gymId, userId, "members.read");
  return billSettingsResponseSchema.parse({
    overdueAfterDays: await overdueDaysOf(deps.sql, gymId),
    billDay: await billDayOf(deps.sql, gymId),
    freezeFeeMinor: await freezeFeeOf(deps.sql, gymId),
    currency: memberCurrencyForCountry(org.country),
    canChange: privileges.includes(BILLING),
  });
}

export async function saveBillSettings(deps: HeldDeps, userId: string, gymId: string, req: BillSettings): Promise<BillSettingsResponse> {
  const { org, privileges } = await requireWritablePrivilege(deps, gymId, userId, "members.read");
  if (!privileges.includes(BILLING)) throw new OrgsError(403, "forbidden", NO_BILLING);
  const days = Math.min(BILL_OVERDUE_DAYS_MAX, Math.max(0, req.overdueAfterDays));
  const saved = await billsRepo.saveBillSettings(deps.sql, { gymId, days, billDay: req.billDay, freezeFeeMinor: req.freezeFeeMinor, actorUserId: userId });
  return billSettingsResponseSchema.parse({ overdueAfterDays: days, ...saved, currency: memberCurrencyForCountry(org.country), canChange: true });
}
