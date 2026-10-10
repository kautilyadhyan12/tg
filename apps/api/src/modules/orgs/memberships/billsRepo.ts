// A gym's notebook: recording a payment, taking one back, and the run that opens the
// bills that have fallen due (spec Part 3 §14.2; ROADMAP 18a-i).
//
// Every write takes the gym's row and then the record's, as `heldRepo.ts` does, and
// asks the rules in `@app/shared` on the rows as they are under those locks: which
// period can be paid (`memberPayTarget`), which payment can be taken back
// (`memberUndoTarget`), and which bills a membership is owed (`billsToOpen`). The count
// of paid periods moves only through `moveHeldMembership`.
import type { Sql, TransactionSql } from "postgres";
import {
  billsToOpen,
  countAfterPayment,
  countAfterUndo,
  memberPayTarget,
  memberUndoTarget,
  moveHeldMembership,
  payMemberBill,
  type HeldMembership,
  type MemberPaymentMethod,
} from "@app/shared";
import { dayInTz } from "../../gamification/streak.js";
import { insertAudit } from "../repo.js";
import { lockGym } from "../memberList/repo.js";
import { billsFor, insertBills, insertPayment, paymentsFor, setBillStatus, setOverdueDays, type NewBill } from "./billsSql.js";
import { listHeldMembership, lockedEntry, lockedHeld, settle, writePaidPeriods, type ListHeldColumns } from "./heldRepo.js";

export type BillWriteOutcome =
  | { kind: "ok" }
  | { kind: "entry_not_found" }
  | { kind: "membership_not_found" }
  | { kind: "payment_not_found" }
  | { kind: "past_member" }
  /** The key of this request already recorded a payment on another membership. */
  | { kind: "request_reused" }
  /** The membership or its bills are not as the screen was shown them. */
  | { kind: "not_allowed" }
  /** More than what is left to pay for the period. */
  | { kind: "too_much"; leftMinor: number; currency: string };

export async function recordPayment(
  sql: Sql,
  input: {
    gymId: string;
    entryId: string;
    membershipId: string;
    requestKey: string;
    /** The period the screen was shown. */
    periodIndex: number;
    amountMinor: number;
    method: MemberPaymentMethod;
    /** A payment company's own id for this payment (18d): the same one twice is one row. */
    provider?: { name: string; paymentId: string };
    /** The gym's own day. */
    today: string;
    actorUserId: string | null;
    now: Date;
  },
): Promise<BillWriteOutcome> {
  return await sql.begin(async (tx): Promise<BillWriteOutcome> => {
    const entry = await lockedEntry(tx, input.gymId, input.entryId);
    if (entry === null) return { kind: "entry_not_found" };

    // The same request, or the same payment of a company's, again: the one recorded
    // stands and nothing is added.
    const [byKey] = await tx<{ held_membership_id: string }[]>`
      SELECT b.held_membership_id
      FROM gym_member_payments p
      JOIN gym_member_bills b ON b.gym_id = p.gym_id AND b.id = p.bill_id
      WHERE p.gym_id = ${input.gymId} AND p.request_key = ${input.requestKey}`;
    if (byKey !== undefined) return byKey.held_membership_id === input.membershipId ? { kind: "ok" } : { kind: "request_reused" };
    if (input.provider !== undefined) {
      const [byCompany] = await tx<{ id: string }[]>`
        SELECT id FROM gym_member_payments
        WHERE provider = ${input.provider.name} AND provider_payment_id = ${input.provider.paymentId}`;
      if (byCompany !== undefined) return { kind: "ok" };
    }

    const row = await lockedHeld(tx, input.gymId, input.entryId, input.membershipId);
    if (row === null) return { kind: "membership_not_found" };
    if (!entry.past) await settle(tx, input.gymId, input.entryId, input.today, input.now);

    const bills = await billsFor(tx, input.gymId, [row.id]);
    const target = memberPayTarget(row.membership, row.priceMinor, input.today, bills, entry.past);
    if (target === null || target.periodIndex !== input.periodIndex) return { kind: "not_allowed" };
    if (input.amountMinor > target.leftMinor) return { kind: "too_much", leftMinor: target.leftMinor, currency: row.currency };

    let bill = bills.find((b) => b.periodIndex === target.periodIndex);
    if (bill === undefined) {
      const [opened] = await insertBills(
        tx,
        input.gymId,
        [{ membershipId: row.id, periodIndex: target.periodIndex, amountMinor: row.priceMinor, currency: row.currency, dueOn: target.dueOn }],
        input.now,
      );
      if (opened === undefined) throw new Error("a bill to pay was not opened under the gym's lock");
      bill = { id: opened.id, membershipId: row.id, periodIndex: target.periodIndex, amountMinor: row.priceMinor, currency: row.currency, dueOn: target.dueOn, status: "open", paidMinor: 0 };
    }
    const paid = payMemberBill(bill, input.amountMinor);
    if (!paid.ok) return { kind: "not_allowed" };

    // The count of paid periods moves with the payment that settles the bill, or not at all.
    let paidPeriods: number | null = null;
    if (paid.status === "paid") {
      const count = countAfterPayment(row.membership, target, input.today);
      if (!count.ok) return { kind: "not_allowed" };
      paidPeriods = count.paidPeriods;
    }

    const paymentId = await insertPayment(
      tx,
      {
        gymId: input.gymId,
        billId: bill.id,
        amountMinor: input.amountMinor,
        currency: bill.currency,
        method: input.method,
        requestKey: input.requestKey,
        paidOn: input.today,
        recordedBy: input.actorUserId,
        provider: input.provider ?? null,
      },
      input.now,
    );
    if (paymentId === null) throw new Error("a payment was not recorded under the gym's lock");
    if (paid.status === "paid") await setBillStatus(tx, input.gymId, bill.id, "paid", input.now);
    if (paidPeriods !== null) await writePaidPeriods(tx, input.gymId, input.entryId, row.id, paidPeriods, input.now);

    await insertAudit(tx, {
      actorUserId: input.actorUserId,
      gymId: input.gymId,
      action: "org.member_payment_recorded",
      targetType: "gym_member_payment",
      targetId: paymentId,
      meta: {
        entryId: input.entryId,
        membershipId: row.id,
        billId: bill.id,
        period: String(bill.periodIndex),
        amountMinor: String(input.amountMinor),
        currency: bill.currency,
        method: input.method,
        billSettled: String(paid.status === "paid"),
      },
    });
    return { kind: "ok" };
  });
}

/** Takes back the newest payment on a membership: recorded by mistake. Its row is kept,
 *  marked; the bill is owed again, and where it had settled the newest paid period the
 *  count of paid periods goes back by one. */
export async function undoPayment(
  sql: Sql,
  input: { gymId: string; entryId: string; membershipId: string; paymentId: string; today: string; actorUserId: string; now: Date },
): Promise<BillWriteOutcome> {
  return await sql.begin(async (tx): Promise<BillWriteOutcome> => {
    const entry = await lockedEntry(tx, input.gymId, input.entryId);
    if (entry === null) return { kind: "entry_not_found" };
    const row = await lockedHeld(tx, input.gymId, input.entryId, input.membershipId);
    if (row === null) return { kind: "membership_not_found" };

    const [payment] = await tx<{ undone: boolean; bill_id: string; amount_minor: number; currency: string; period_index: number }[]>`
      SELECT p.undone_at IS NOT NULL AS undone, p.bill_id, p.amount_minor, p.currency, b.period_index
      FROM gym_member_payments p
      JOIN gym_member_bills b ON b.gym_id = p.gym_id AND b.id = p.bill_id
      WHERE p.gym_id = ${input.gymId} AND p.id = ${input.paymentId} AND b.held_membership_id = ${row.id}`;
    if (payment === undefined) return { kind: "payment_not_found" };
    if (payment.undone) return { kind: "ok" };
    if (entry.past) return { kind: "past_member" };
    await settle(tx, input.gymId, input.entryId, input.today, input.now);

    const bills = await billsFor(tx, input.gymId, [row.id]);
    const payments = await paymentsFor(tx, input.gymId, [row.id]);
    const target = memberUndoTarget(row.membership, input.today, bills, payments);
    if (target === null || target.paymentId !== input.paymentId) return { kind: "not_allowed" };

    const count = countAfterUndo(row.membership, target.goesBack, input.today);
    if (!count.ok) return { kind: "not_allowed" };
    const paidPeriods = count.paidPeriods;

    await tx`
      UPDATE gym_member_payments SET undone_at = ${input.now}, undone_by = ${input.actorUserId}
      WHERE gym_id = ${input.gymId} AND id = ${input.paymentId} AND undone_at IS NULL`;
    if (target.reopens) await setBillStatus(tx, input.gymId, payment.bill_id, "open", input.now);
    if (paidPeriods !== null) await writePaidPeriods(tx, input.gymId, input.entryId, row.id, paidPeriods, input.now);

    await insertAudit(tx, {
      actorUserId: input.actorUserId,
      gymId: input.gymId,
      action: "org.member_payment_undone",
      targetType: "gym_member_payment",
      targetId: input.paymentId,
      meta: {
        entryId: input.entryId,
        membershipId: row.id,
        billId: payment.bill_id,
        period: String(payment.period_index),
        amountMinor: String(payment.amount_minor),
        currency: payment.currency,
      },
    });
    return { kind: "ok" };
  });
}

/** Takes back a mark that has no payment behind it: one made before bills were kept, or
 *  staff's word for a person taken from the gym's own list. `paidPeriods` is the count
 *  to go back to. A period with a recorded payment is taken back through `undoPayment`. */
export async function undoMark(
  sql: Sql,
  input: { gymId: string; entryId: string; membershipId: string; paidPeriods: number; today: string; actorUserId: string; now: Date },
): Promise<BillWriteOutcome> {
  return await sql.begin(async (tx): Promise<BillWriteOutcome> => {
    const entry = await lockedEntry(tx, input.gymId, input.entryId);
    if (entry === null) return { kind: "entry_not_found" };
    const row = await lockedHeld(tx, input.gymId, input.entryId, input.membershipId);
    if (row === null) return { kind: "membership_not_found" };
    if (entry.past) return { kind: "past_member" };
    await settle(tx, input.gymId, input.entryId, input.today, input.now);

    const before = row.membership.paidPeriods;
    // Only ever back, and only by the rule's one step.
    if (input.paidPeriods > before) return { kind: "not_allowed" };
    const move = moveHeldMembership(row.membership, { type: "paid", paidPeriods: input.paidPeriods }, input.today);
    if (!move.ok) return { kind: "not_allowed" };
    if (!move.changed || move.membership.paidPeriods === before) return { kind: "ok" };
    const bills = await billsFor(tx, input.gymId, [row.id]);
    if (bills.some((b) => b.periodIndex === input.paidPeriods && b.status === "paid")) return { kind: "not_allowed" };

    await writePaidPeriods(tx, input.gymId, input.entryId, row.id, input.paidPeriods, input.now);
    await insertAudit(tx, {
      actorUserId: input.actorUserId,
      gymId: input.gymId,
      action: "org.held_membership_paid",
      targetType: "gym_held_membership",
      targetId: row.id,
      meta: { entryId: input.entryId, type: row.typeName, on: input.today, paidBefore: String(before), paidAfter: String(input.paidPeriods) },
    });
    return { kind: "ok" };
  });
}

export async function saveOverdueDays(sql: Sql, input: { gymId: string; days: number; actorUserId: string }): Promise<void> {
  await sql.begin(async (tx) => {
    await lockGym(tx, input.gymId);
    await setOverdueDays(tx, input.gymId, input.days);
    await insertAudit(tx, {
      actorUserId: input.actorUserId,
      gymId: input.gymId,
      action: "org.bill_settings_changed",
      targetType: "gym",
      targetId: input.gymId,
      meta: { overdueAfterDays: String(input.days) },
    });
  });
}

// ── The run that opens the bills that have fallen due ───────────────────────

type Owing = ListHeldColumns & { gym_id: string; timezone: string; price_minor: number; currency: string };

/** The memberships that may be owed a bill: stored active, with a price, of a current
 *  record of a gym that is open, and either repeating and renewing or never paid. Which
 *  of them is owed one today is `billsToOpen`'s to say. */
const owing = (sql: Sql | TransactionSql, gymIds: readonly string[] | null) => sql<Owing[]>`
  SELECT h.id, t.name AS type_name, h.kind, h.term_count, h.term_unit, h.pack_classes, h.pack_days,
         (h.price_minor = 0) AS free, h.starts_on::text AS starts_on, h.frozen_days, h.status,
         h.frozen_on::text AS frozen_on, h.cancelled_on::text AS cancelled_on,
         h.paid_periods, h.paid_floor, h.renews, h.classes_left, h.from_list,
         h.gym_id, g.timezone, h.price_minor, h.currency
  FROM gym_held_memberships h
  JOIN gyms g ON g.id = h.gym_id AND g.status = 'active'
  JOIN gym_membership_types t ON t.gym_id = h.gym_id AND t.id = h.membership_type_id
  JOIN gym_member_list_entries e ON e.gym_id = h.gym_id AND e.id = h.entry_id AND e.former_at IS NULL
  WHERE h.status = 'active' AND h.price_minor > 0
    AND ((h.kind = 'recurring' AND h.renews) OR (h.kind <> 'recurring' AND h.paid_periods = 0))
    AND (${gymIds === null ? null : [...gymIds]}::uuid[] IS NULL OR h.gym_id = ANY(${gymIds === null ? null : [...gymIds]}::uuid[]))`;

/** The periods that already have an open bill, by membership: a plain read beside the one
 *  above. Asked inside it, one membership at a time, the same answer took 3.8 s for 8,000
 *  memberships on a table with no statistics yet (`tools/measure-member-bills-cost.ts`).
 *  Only open bills are read: every period from a candidate's first unpaid one on has an
 *  open bill or none, and the unique index is what keeps a period to one bill. */
async function billedOpen(sql: Sql | TransactionSql, gymIds: readonly string[] | null): Promise<Map<string, Set<number>>> {
  const ids = gymIds === null ? null : [...gymIds];
  const rows = await sql<{ held_membership_id: string; period_index: number }[]>`
    SELECT held_membership_id, period_index FROM gym_member_bills
    WHERE status = 'open' AND (${ids}::uuid[] IS NULL OR gym_id = ANY(${ids}::uuid[]))`;
  const have = new Map<string, Set<number>>();
  for (const row of rows) {
    const set = have.get(row.held_membership_id);
    if (set === undefined) have.set(row.held_membership_id, new Set([row.period_index]));
    else set.add(row.period_index);
  }
  return have;
}

const NONE: ReadonlySet<number> = new Set();

function owed(rows: readonly Owing[], billed: ReadonlyMap<string, ReadonlySet<number>>, now: Date): Map<string, NewBill[]> {
  const byGym = new Map<string, NewBill[]>();
  const todayOf = new Map<string, string>();
  for (const row of rows) {
    let today = todayOf.get(row.gym_id);
    if (today === undefined) {
      today = dayInTz(now, row.timezone);
      todayOf.set(row.gym_id, today);
    }
    const membership: HeldMembership = listHeldMembership(row);
    for (const due of billsToOpen(membership, today, billed.get(row.id) ?? NONE)) {
      const list = byGym.get(row.gym_id) ?? [];
      list.push({ membershipId: row.id, periodIndex: due.periodIndex, amountMinor: row.price_minor, currency: row.currency, dueOn: due.dueOn });
      byGym.set(row.gym_id, list);
    }
  }
  return byGym;
}

export interface OpenBillsDeps {
  sql: Sql;
  log: { info: (obj: object, msg: string) => void; error: (obj: object, msg: string) => void };
}

/** Opens every bill that has fallen due, on each gym's own day. A plain read finds the
 *  gyms with something to open; each of those is then one transaction under its lock,
 *  which reads its memberships again, so a membership cancelled a moment before is not
 *  billed. Safe to run twice and at once: a period has one bill. A gym that fails is
 *  logged and tried on the next run. `gymIds` is for tests on a shared database. */
export async function openDueBills(deps: OpenBillsDeps, opts: { now?: Date; gymIds?: readonly string[] } = {}): Promise<{ opened: number; gyms: number; failed: number }> {
  const now = opts.now ?? new Date();
  const first = owed(await owing(deps.sql, opts.gymIds ?? null), await billedOpen(deps.sql, opts.gymIds ?? null), now);
  let opened = 0;
  let gyms = 0;
  let failed = 0;
  for (const gymId of first.keys()) {
    try {
      const made = await deps.sql.begin(async (tx) => {
        await lockGym(tx, gymId);
        const due = owed(await owing(tx, [gymId]), await billedOpen(tx, [gymId]), now).get(gymId) ?? [];
        const rows = await insertBills(tx, gymId, due, now);
        if (rows.length > 0) {
          await insertAudit(tx, {
            actorUserId: null,
            gymId,
            action: "org.member_bills_opened",
            targetType: "gym",
            targetId: gymId,
            meta: { bills: String(rows.length) },
          });
        }
        return rows.length;
      });
      if (made > 0) gyms += 1;
      opened += made;
    } catch (err) {
      failed += 1;
      deps.log.error({ event: "member_bills.gym_failed", gymId, err }, "opening a gym's bills failed");
    }
  }
  if (opened > 0) deps.log.info({ event: "member_bills.opened", opened, gyms }, "member bills opened");
  return { opened, gyms, failed };
}
