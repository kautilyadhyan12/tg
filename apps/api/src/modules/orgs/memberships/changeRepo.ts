// MOVE TO ANOTHER MEMBERSHIP (spec Part 3 §14.8; ROADMAP Stage 2 item 18x): the one write.
//
// One transaction, under the gym's lock and the record's as every membership write takes them:
// the membership changed is cancelled today (or set to stop at the end of what is paid), the
// new one is given by `giveHeldIn` with the credit the rule in `@app/shared` works out
// (`changeFrom`, `changeTo`), the classes and personal training sessions booked on the old one
// move to the new one where its type covers them, and the rest end only once the screen has
// confirmed them. Anything refused after the first write throws, so nothing is half done.
import type { Sql, TransactionSql } from "postgres";
import {
  addDays,
  billsAtCancel,
  changeFrom,
  changeTo,
  moveHeldMembership,
  movedMoneyMinor,
  withinLimit,
  type ChangeBillFacts,
  type ChangeFromRefusal,
  type ChangeToRefusal,
  type HeldMembershipEvent,
  type MemberPaymentByHand,
} from "@app/shared";
import { insertAudit } from "../repo.js";
import { giftUseUndone } from "../referrals/memberGiftRepo.js";
import type { HasBookings } from "../classes/bookingChanges.js";
import type { MembershipScope } from "../classes/bookingsRepo.js";
import { billDayOf, billsFor, terminalWaiting, voidBills, type BillRow } from "./billsSql.js";
import { giveHeldIn, liveTypes, lockedEntry, lockedHeld, settle, typeChoice, type CancelBookings, type HeldWriteOutcome } from "./heldRepo.js";

export type ChangeOutcome =
  | HeldWriteOutcome
  | HasBookings
  /** The rule refuses this change, or the membership was already changed for another. */
  | { kind: "change_refused"; reason: ChangeFromRefusal | ChangeToRefusal | "changed_already" }
  /** What it has paid for its days is no longer what the screen showed coming off. */
  | { kind: "credit_changed" };

/** A refusal after the first write: thrown so the transaction rolls back, and answered. */
class Undo extends Error {
  constructor(readonly outcome: ChangeOutcome) {
    super("membership change undone");
  }
}

export function changeBillFacts(b: BillRow): ChangeBillFacts {
  return {
    periodIndex: b.periodIndex,
    status: b.status,
    amountMinor: b.amountMinor,
    tax: b.tax === null ? null : { minor: b.tax.minor, included: b.tax.included },
    joiningFeeMinor: b.joiningFeeMinor,
    changeCreditMinor: b.changeCreditMinor,
    paidMinor: b.paidMinor,
    refundedMinor: b.refundedMinor,
  };
}

/** The memberships of this record already changed for another one that still stands. */
export async function changedAlready(sql: Sql | TransactionSql, gymId: string, entryId: string): Promise<Set<string>> {
  const rows = await sql<{ replaces_id: string }[]>`
    SELECT replaces_id FROM gym_held_memberships
    WHERE gym_id = ${gymId} AND entry_id = ${entryId} AND replaces_id IS NOT NULL AND status <> 'cancelled'`;
  return new Set(rows.map((r) => r.replaces_id));
}

export async function changeHeld(
  sql: Sql,
  bookings: CancelBookings,
  input: {
    gymId: string;
    entryId: string;
    membershipId: string;
    typeId: string;
    when: "today" | "next_payment";
    requestKey: string;
    /** What the screen showed: the new type's price, the credit, the first bill's total, and the
     *  day the new one starts. */
    shownPriceMinor: number;
    shownCreditMinor: number;
    shownTotalMinor: number;
    shownStartsOn: string;
    /** The day it said the new one's full payments start (18y); null for none. */
    shownFullFrom: string | null;
    paid: boolean;
    method: MemberPaymentByHand | null;
    confirmBookings: string | null;
    confirmPtSessions: string | null;
    /** The gym's own day. */
    today: string;
    actorUserId: string;
    now: Date;
  },
): Promise<ChangeOutcome> {
  try {
    return await sql.begin(async (tx): Promise<ChangeOutcome> => {
      const entry = await lockedEntry(tx, input.gymId, input.entryId);
      if (entry === null) return { kind: "entry_not_found" };
      // The same request again: the change it made stands.
      const [again] = await tx<{ entry_id: string; replaces_id: string | null }[]>`
        SELECT entry_id, replaces_id FROM gym_held_memberships
        WHERE gym_id = ${input.gymId} AND request_key = ${input.requestKey}`;
      if (again !== undefined) return again.entry_id === input.entryId && again.replaces_id === input.membershipId ? { kind: "ok" } : { kind: "request_reused" };
      if (entry.past) return { kind: "past_member" };

      await settle(tx, input.gymId, input.entryId, input.today, input.now);
      const before = await lockedHeld(tx, input.gymId, input.entryId, input.membershipId);
      if (before === null) return { kind: "membership_not_found" };
      if (await terminalWaiting(tx, input.gymId, before.id)) return { kind: "terminal_waiting" };
      if ((await changedAlready(tx, input.gymId, input.entryId)).has(before.id)) return { kind: "change_refused", reason: "changed_already" };

      const bills = await billsFor(tx, input.gymId, [before.id]);
      const from = changeFrom(before.membership, before.priceMinor, bills.map(changeBillFacts), input.today);
      if (!from.ok) return { kind: "change_refused", reason: from.reason };
      const [rawType] = await liveTypes(tx, input.gymId, input.typeId);
      if (rawType === undefined) return { kind: "type_not_found" };
      const type = typeChoice(rawType);
      const to = changeTo(from, before.typeId, type, input.when, input.today, await billDayOf(tx, input.gymId));
      if (!to.ok) return { kind: "change_refused", reason: to.reason };
      // A payment ahead recorded while the box was open moves the next payment date: the change
      // is never written on a day the screen did not say (round one, Low-1).
      if (to.creditMinor !== input.shownCreditMinor || to.startsOn !== input.shownStartsOn) return { kind: "credit_changed" };
      // The gym's billing day changed while the box was open (18y): nothing at a total it did not show.
      if (to.fullFrom !== input.shownFullFrom) return { kind: "bill_day_changed" };

      // The membership changed: today it ends now; later it stops at the end of what is paid.
      const event: HeldMembershipEvent = { type: "cancel", when: input.when === "today" ? "today" : "period_end" };
      const move = moveHeldMembership(before.membership, event, input.today);
      // One already set to stop, or paid once, ends by itself on its last day: nothing to change.
      const stops = move.ok ? move.membership : before.membership;
      const lastDay = input.when === "today" ? input.today : addDays(to.startsOn, -1);
      // Its bills for days after its last day go, as a cancel's do (18a-i); paid ones are the credit.
      const after = billsAtCancel(bills, lastDay);
      if (after.blocked) return { kind: "early_payment" };
      const voided = bills.filter((b) => after.voids.includes(b.periodIndex)).map((b) => b.id);
      await tx`
        UPDATE gym_held_memberships
        SET status = ${stops.status}, frozen_on = ${stops.frozenOn}::date, cancelled_on = ${stops.cancelledOn}::date,
            renews = ${stops.renews}, updated_at = ${input.now}
        WHERE gym_id = ${input.gymId} AND entry_id = ${input.entryId} AND id = ${before.id}`;

      const given = await giveHeldIn(tx, {
        gymId: input.gymId,
        entryId: input.entryId,
        typeId: type.id,
        requestKey: input.requestKey,
        startsOn: to.startsOn,
        paid: input.paid,
        method: input.method,
        shownPriceMinor: input.shownPriceMinor,
        discount: null,
        memberGift: null,
        shownTotalMinor: input.shownTotalMinor,
        joiningFeeMinor: null,
        shownFullFrom: to.fullFrom,
        mayWaiveJoiningFee: false,
        // Set to stop by this change: cancelling the new one before it starts undoes that (Low-2).
        change: { fromId: before.id, creditMinor: to.creditMinor, paidByChange: to.paidByChange, stoppedOld: before.membership.renews && !stops.renews && stops.status !== "cancelled" },
        today: input.today,
        actorUserId: input.actorUserId,
        now: input.now,
      });
      if (given.kind !== "given") throw new Undo(given.kind === "ok" ? { kind: "request_reused" } : given);

      // The money on the old bills whose days moved is never refunded from them (round one, High-2).
      const moves = (to.creditMinor > 0 ? from.byPeriod : []).flatMap((p) => {
          const bill = bills.find((b) => b.periodIndex === p.periodIndex);
          const moved = bill === undefined ? 0 : movedMoneyMinor(changeBillFacts(bill), p.creditMinor);
          return bill === undefined || moved === 0 ? [] : [{ id: bill.id, moved }];
        });
      if (moves.length > 0) {
        await tx`
          UPDATE gym_member_bills b SET moved_minor = r.moved, updated_at = ${input.now}
          FROM jsonb_to_recordset(${tx.json(moves)}) AS r(id uuid, moved int)
          WHERE b.gym_id = ${input.gymId} AND b.held_membership_id = ${before.id} AND b.id = r.id`;
      }

      // Booked on the old one after its last day: moved where the new type covers them, within its
      // own limit for each week or month (round one, Low-3); the rest end once confirmed.
      const scope: MembershipScope = { membership: before.id, now: input.now, afterDay: input.when === "today" ? null : lastDay };
      const [limits] = await tx<{ bookings_limit: number | null; bookings_period: string | null; pt_limit: number | null; pt_period: string | null }[]>`
        SELECT bookings_limit, bookings_period, pt_limit, pt_period FROM gym_membership_types WHERE gym_id = ${input.gymId} AND id = ${type.id}`;
      const periodOf = (p: string | null | undefined): "week" | "month" | null => (p === "week" || p === "month" ? p : null);
      const classesCovered = await tx<{ id: string; day: string }[]>`
        SELECT b.id, s.local_date::text AS day
        FROM gym_class_bookings b
        JOIN gym_class_sessions s ON s.gym_id = b.gym_id AND s.id = b.session_id
        JOIN gym_membership_types t ON t.gym_id = b.gym_id AND t.id = ${type.id}
        WHERE b.gym_id = ${input.gymId} AND b.held_membership_id = ${before.id} AND b.status IN ('booked','attended')
          AND s.starts_at > ${input.now}
          AND (${scope.afterDay}::date IS NULL OR s.local_date > ${scope.afterDay}::date)
          AND t.access <> 'gym_only'
          AND (t.covers_all_classes OR EXISTS (
            SELECT 1 FROM gym_membership_type_classes c
            WHERE c.gym_id = t.gym_id AND c.membership_type_id = t.id AND c.class_type_id = s.class_type_id))`;
      const movedClasses = withinLimit(classesCovered, limits?.bookings_limit ?? null, periodOf(limits?.bookings_period));
      if (movedClasses.length > 0) {
        await tx`
          UPDATE gym_class_bookings SET held_membership_id = ${given.id}
          WHERE gym_id = ${input.gymId} AND held_membership_id = ${before.id} AND id = ANY(${movedClasses}::uuid[])`;
      }
      const ptCovered = await tx<{ id: string; day: string }[]>`
        SELECT a.id, a.local_date::text AS day
        FROM gym_pt_appointments a
        JOIN gym_membership_types t ON t.gym_id = a.gym_id AND t.id = ${type.id}
        WHERE a.gym_id = ${input.gymId} AND a.held_membership_id = ${before.id} AND a.status = 'booked' AND a.starts_at > ${input.now}
          AND (${scope.afterDay}::date IS NULL OR a.local_date > ${scope.afterDay}::date)
          AND t.includes_pt`;
      const movedPt = withinLimit(ptCovered, limits?.pt_limit ?? null, periodOf(limits?.pt_period));
      if (movedPt.length > 0) {
        await tx`
          UPDATE gym_pt_appointments SET held_membership_id = ${given.id}
          WHERE gym_id = ${input.gymId} AND held_membership_id = ${before.id} AND id = ANY(${movedPt}::uuid[])`;
      }
      // What the new one does not cover ends, once the screen has been told which.
      const ask = await bookings.ask(tx, input.gymId, scope, { bookings: input.confirmBookings, ptSessions: input.confirmPtSessions });
      if (ask !== null) throw new Undo(ask);
      const ended = await bookings.end(tx, input.gymId, scope, input.now);

      await voidBills(tx, input.gymId, voided, input.now);
      await giftUseUndone(tx, input.gymId, { billIds: voided }, input.today, input.now);
      await insertAudit(tx, {
        actorUserId: input.actorUserId,
        gymId: input.gymId,
        action: "org.held_membership_changed",
        targetType: "gym_held_membership",
        targetId: before.id,
        meta: {
          entryId: input.entryId,
          type: before.typeName,
          toType: type.name,
          to: given.id,
          when: input.when,
          on: input.today,
          startsOn: to.startsOn,
          changeCreditMinor: String(to.creditMinor),
          statusBefore: before.membership.status,
          statusAfter: stops.status,
          renews: String(stops.renews),
          ...(voided.length === 0 ? {} : { billsCancelled: String(voided.length) }),
          bookingsMoved: String(movedClasses.length),
          ptSessionsMoved: String(movedPt.length),
          bookingsEnded: String(ended.booked),
          ptSessionsEnded: String(ended.ptSessions ?? 0),
        },
      });
      return { kind: "ok" };
    });
  } catch (err) {
    if (err instanceof Undo) return err.outcome;
    throw err;
  }
}
