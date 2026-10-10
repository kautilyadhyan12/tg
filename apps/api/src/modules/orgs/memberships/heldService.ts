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
  BILLS_SHOWN,
  BILL_OVERDUE_DAYS_MAX,
  HELD_EARLIER_PAGE,
  MEMBER_LIST_BY_HAND_WORDS,
  billSettingsResponseSchema,
  countAfterGap,
  formatMinor,
  heldMembershipView,
  heldMembershipsResponseSchema,
  memberBillState,
  memberCancelTarget,
  memberPayTarget,
  memberUndoTarget,
  refundableMinor,
  type BillSettings,
  type BillSettingsResponse,
  type CancelMemberBillRequest,
  type ClassBookingsEnding,
  type GiveHeldMembershipRequest,
  type HeldMembership,
  type HeldMembershipEvent,
  type HeldMembershipShown,
  type HeldMembershipView,
  type HeldMembershipsResponse,
  type MemberBilling,
  type NoteMemberRefundRequest,
  type RecordMemberPaymentRequest,
} from "@app/shared";
import { dayInTz } from "../../gamification/streak.js";
import { OrgsError, requirePrivilege, requireWritablePrivilege } from "../service.js";
import { endMembershipBookings, membershipBookingsAsk } from "../classes/bookingChanges.js";
import { endingPerson, type BookingsAnswer } from "../classes/service.js";
import * as repo from "./heldRepo.js";
import * as billsRepo from "./billsRepo.js";
import { overdueDaysOf, type BillRow, type PaymentRow, type RefundRow } from "./billsSql.js";

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
  row: { id: string; priceMinor: number; membership: HeldMembership },
  bills: readonly BillRow[],
  payments: readonly PaymentRow[],
  refunds: readonly RefundRow[],
  ctx: { today: string; past: boolean; overdueAfterDays: number },
): MemberBilling {
  const view = heldMembershipView(row.membership, ctx.today);
  const pay = memberPayTarget(row.membership, row.priceMinor, ctx.today, bills, ctx.past);
  const cancel = memberCancelTarget(row.membership, row.priceMinor, ctx.today, bills, ctx.past);
  const cancelBill = cancel === null ? undefined : bills.find((b) => b.periodIndex === cancel.periodIndex);
  const back = ctx.past ? null : memberUndoTarget(row.membership, ctx.today, bills, payments);
  // A mark with no payment behind it: taken back as it always was. A period a bill
  // settled (paid, cancelled or refunded) is not one.
  const settledAt = (index: number): boolean => bills.some((b) => b.periodIndex === index && b.status !== "open");
  const mark = !ctx.past && back === null && view.can.undoPaid !== null && !settledAt(view.can.undoPaid.paidPeriods) ? view.can.undoPaid : null;
  return {
    bills: bills.slice(0, BILLS_SHOWN).map((b) => ({
      id: b.id,
      periodIndex: b.periodIndex,
      covers: b.covers,
      amountMinor: b.amountMinor,
      paidMinor: b.paidMinor,
      dueOn: b.dueOn,
      state: memberBillState(b, ctx.today, ctx.overdueAfterDays),
      refundedMinor: b.refundedMinor,
      cancelled: b.cancelled,
      payments: payments
        .filter((p) => p.billId === b.id)
        .map((p) => ({
          id: p.id,
          amountMinor: p.amountMinor,
          method: p.method,
          paidOn: p.paidOn,
          by: p.by,
          refunds: refunds
            .filter((r) => r.paymentId === p.id)
            .map((r) => ({ id: r.id, amountMinor: r.amountMinor, method: r.method, refundedOn: r.refundedOn, reason: r.reason, by: r.by })),
          refundableMinor: refundableMinor(b.status, p),
        })),
    })),
    billsNotShown: Math.max(0, bills.length - BILLS_SHOWN),
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
  };
}

/** The membership as the rule reads it, with ONE day for what is owed: the day its OLDEST
 *  open bill fell due, where it has one at or before the first unpaid period. That is the
 *  bill a payment is taken for first, so the line above the bills and the oldest bill
 *  under it say the same day; a freeze moves the membership's own dates and never a
 *  bill's; and every reader is sent the same day. */
function viewOf(row: { id: string; membership: HeldMembership }, bills: readonly BillRow[], today: string): HeldMembershipView {
  const view = heldMembershipView(row.membership, today);
  if (view.payment === null || view.payment.state !== "due" || view.payment.since === null) return view;
  const owed = bills
    .filter((b) => b.membershipId === row.id && b.status === "open" && b.periodIndex <= row.membership.paidPeriods)
    .sort((a, b) => a.periodIndex - b.periodIndex)[0];
  return owed === undefined ? view : { ...view, payment: { state: "due", since: owed.dueOn } };
}

async function readOr404(deps: HeldDeps, gymId: string, entryId: string, today: string, canBill: boolean): Promise<HeldMembershipsResponse> {
  const list = await repo.readHeld(deps.sql, gymId, entryId);
  if (list === null) throw notFound();
  const ctx = { today, past: list.past, overdueAfterDays: list.overdueAfterDays };
  // The page reads a membership as the next write will find it: with its count moved
  // over the periods nobody was asked for (`countAfterGap`), which `settle` then writes.
  const asOfToday = (row: repo.HeldRow): repo.HeldRow => {
    if (list.past) return row;
    const have = new Set(list.bills.filter((b) => b.membershipId === row.id).map((b) => b.periodIndex));
    const count = countAfterGap(row.membership, today, have);
    return count === null ? row : { ...row, membership: { ...row.membership, paidPeriods: count, paidFloor: count } };
  };
  const all = [...list.inUse.map(asOfToday), ...list.over]
    .map((row) => ({
      billing: canBill
        ? billingOf(
            row,
            list.bills.filter((b) => b.membershipId === row.id),
            list.payments.filter((p) => p.membershipId === row.id),
            list.refunds.filter((r) => r.membershipId === row.id),
            ctx,
          )
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
      frozenOn: row.membership.frozenOn,
      classesLeft: row.membership.classesLeft,
      fromList: row.fromList,
      notCharged: list.bills.some((b) => b.membershipId === row.id && b.status === "void" && b.periodIndex === row.membership.paidPeriods - 1),
      view: viewOf(row, list.bills, today),
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
    case "early_payment":
      throw new OrgsError(
        409,
        "early_payment_stands",
        "A payment is recorded for a month after its last day. Take that payment back first (Undo last payment), then cancel.",
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

export async function giveHeldMembership(
  deps: HeldDeps,
  userId: string,
  gymId: string,
  entryId: string,
  req: GiveHeldMembershipRequest,
): Promise<HeldMembershipsResponse> {
  const { org, privileges } = await requireWritablePrivilege(deps, gymId, userId, "members.confirm");
  const canBill = privileges.includes(BILLING);
  // Saying it is paid records a payment, which is the notebook's own tick.
  if (req.paid && !canBill) throw new OrgsError(403, "forbidden", NO_BILLING);
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

// ── Bills and payments (spec Part 3 §14.2; ROADMAP 18a-i) ────────────────────
//
// Reading a person's bills, recording a payment and taking one back need
// `billing.members`, and the person's page they are drawn on needs `members.confirm`:
// both are asked.

const BILLING = "billing.members";
const NO_BILLING = "Recording payments isn't part of your role. Ask the owner to turn on \"Record members' payments\" for you.";

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
      throw new OrgsError(409, "request_reused", "That form was already used for another payment. Open it again.");
    case "bill_has_payment":
      throw new OrgsError(
        409,
        "bill_has_payment",
        "A payment is recorded on this bill. Take it back first (Undo last payment), or record the rest.",
      );
    case "refund_not_settled":
      throw new OrgsError(
        409,
        "refund_not_settled",
        "This bill isn't fully paid, so there is nothing to refund yet. To take a payment back, use Undo last payment.",
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

export async function undoMemberPayment(
  deps: HeldDeps,
  userId: string,
  gymId: string,
  entryId: string,
  membershipId: string,
  paymentId: string,
): Promise<HeldMembershipsResponse> {
  const { today, now } = await requireBilling(deps, userId, gymId);
  throwOnBillFailure(await billsRepo.undoPayment(deps.sql, { gymId, entryId, membershipId, paymentId, today, actorUserId: userId, now }));
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

export async function undoMemberRefund(
  deps: HeldDeps,
  userId: string,
  gymId: string,
  entryId: string,
  membershipId: string,
  paymentId: string,
  refundId: string,
): Promise<HeldMembershipsResponse> {
  const { today, now } = await requireBilling(deps, userId, gymId);
  throwOnBillFailure(await billsRepo.undoRefund(deps.sql, { gymId, entryId, membershipId, paymentId, refundId, actorUserId: userId, now }));
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
  const { privileges } = await requirePrivilege(deps, gymId, userId, "members.read");
  return billSettingsResponseSchema.parse({ overdueAfterDays: await overdueDaysOf(deps.sql, gymId), canChange: privileges.includes(BILLING) });
}

export async function saveBillSettings(deps: HeldDeps, userId: string, gymId: string, req: BillSettings): Promise<BillSettingsResponse> {
  const { privileges } = await requireWritablePrivilege(deps, gymId, userId, "members.read");
  if (!privileges.includes(BILLING)) throw new OrgsError(403, "forbidden", NO_BILLING);
  const days = Math.min(BILL_OVERDUE_DAYS_MAX, Math.max(0, req.overdueAfterDays));
  await billsRepo.saveOverdueDays(deps.sql, { gymId, days, actorUserId: userId });
  return billSettingsResponseSchema.parse({ overdueAfterDays: days, canChange: true });
}
