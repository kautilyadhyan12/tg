// MY MEMBERSHIP (spec Part 3 §14.2; ROADMAP 18j): what a member holds at their gym and what
// they paid it, for the phone app. THE ONE RULE: a member reads their own record of the gym
// and nobody else's. Their own is the record their live account alone holds (`readerOf`'s
// `holders` of 1), the rule the overdue messages follow: a record two accounts share shows
// its money to neither. A stranger to the gym gets 404, as every member route answers.
//
// A payer (18i; Kd 2026-10-18, "i agree"): while the gym's list says Priya pays for Aarav,
// his memberships' bills, payments, fees and their receipts are hers to read and not his;
// he reads his memberships' dates and "Paid by Priya Sharma". What he bought at the desk
// stays his, since whoever stands at the desk pays there. A payer removed reads none of it.
//
// The memberships and bills are the person's page's own read (`readOwnHeld`), so the app and
// the console never give two answers; what staff did and can do is left out here.
import {
  PURCHASES_SHOWN,
  RECEIPT_WORDS,
  myMembershipResponseSchema,
  receiptSchema,
  type HeldMembershipItem,
  type MyMembership,
  type MyMembershipResponse,
  type MyPurchase,
  type Receipt,
} from "@app/shared";
import type { Sql } from "postgres";
import { dayInTz } from "../../gamification/streak.js";
import { OrgsError } from "../service.js";
import { readOwnHeld } from "../memberships/heldService.js";
import { paidForBy, payerOf } from "../payers/repo.js";
import { purchasesOf, type SaleRow } from "../register/repo.js";
import * as receipts from "../receipts/repo.js";
import * as repo from "./repo.js";

export interface MyMembershipDeps {
  sql: Sql;
  now: () => Date;
}

const notFound = (): OrgsError => new OrgsError(404, "org_not_found", "Organisation not found.");

type Limit = () => Promise<boolean>;

/** The reader and their own record, or 404 for anybody who is not a live member of the gym. */
async function readerOr404(deps: MyMembershipDeps, gymId: string, userId: string): Promise<repo.Reader & { own: string | null }> {
  const reader = await repo.readerOf(deps.sql, gymId, userId);
  if (reader === null) throw notFound();
  return { ...reader, own: reader.entryId !== null && reader.holders === 1 ? reader.entryId : null };
}

function membershipOf(m: HeldMembershipItem): MyMembership {
  const billing = m.billing;
  if (billing === null) throw new Error("readOwnHeld returned a membership without its bills");
  return {
    id: m.id,
    name: m.typeName,
    kind: m.kind,
    priceMinor: m.priceMinor,
    currency: m.currency,
    status: m.view.status,
    startsOn: m.startsOn,
    fromList: m.fromList,
    endsOn: m.view.endsOn,
    renewsOn: m.view.renewsOn,
    frozenOn: m.frozenOn,
    classesLeft: m.classesLeft,
    packClasses: m.packClasses,
    owed: billing.pay === null ? null : { amountMinor: billing.pay.leftMinor, dueOn: billing.pay.dueOn, state: billing.pay.state },
    // The bills come newest first; a bill's own payments in the order they were taken.
    payments: billing.bills.flatMap((b) =>
      [...b.payments].reverse().map((p) => ({
        amountMinor: p.amountMinor,
        method: p.method,
        paidOn: p.paidOn,
        covers: b.covers,
        receiptNumber: p.receiptNumber,
        refunds: p.refunds.map((r) => ({ amountMinor: r.amountMinor, method: r.method, refundedOn: r.refundedOn, receiptNumber: r.receiptNumber })),
      })),
    ),
    olderPeriodsNotShown: billing.billsNotShown,
    fees: billing.fees.flatMap((f) =>
      f.state === "removed"
        ? []
        : [{ fee: f.fee, forName: f.forName, on: f.on, amountMinor: f.amountMinor, dueOn: f.dueOn, state: f.state, receiptNumber: f.state === "paid" ? (f.payments[0]?.receiptNumber ?? null) : null }],
    ),
  };
}

/** A membership whose money is somebody else's to read: its dates, and no price, nothing owed or paid. */
const datesOnly = (m: MyMembership): MyMembership => ({ ...m, priceMinor: null, owed: null, payments: [], olderPeriodsNotShown: 0, fees: [] });

/** The lines of each sale under its one receipt, newest sale first, as `purchasesOf` reads them. */
function purchasesFrom(lines: readonly SaleRow[]): MyPurchase[] {
  const sales = new Map<number, SaleRow[]>();
  for (const line of lines) sales.set(line.receiptNumber, [...(sales.get(line.receiptNumber) ?? []), line]);
  return [...sales.entries()].flatMap(([receiptNumber, rows]) => {
    const first = rows[0];
    if (first === undefined) return [];
    return [
      {
        receiptNumber,
        soldOn: first.soldOn,
        method: first.method,
        currency: first.currency,
        totalMinor: rows.reduce((n, r) => n + r.totalMinor, 0),
        lines: rows.map((r) => ({ name: r.itemName, quantity: r.quantity, totalMinor: r.totalMinor })),
        refunds: rows.flatMap((r) =>
          r.refunds.filter((f) => f.voided === null).map((f) => ({ amountMinor: f.amountMinor, method: f.method, refundedOn: f.refundedOn, receiptNumber: f.receiptNumber })),
        ),
      },
    ];
  });
}

export async function getMyMembership(deps: MyMembershipDeps, userId: string, gymId: string, limit: Limit): Promise<MyMembershipResponse | null> {
  const reader = await readerOr404(deps, gymId, userId);
  if (!(await limit())) return null;
  const today = dayInTz(deps.now(), reader.timezone);
  const empty = { gym: { name: reader.gymName }, today, paidBy: null, memberships: [], paysFor: [], earlierNotShown: 0, purchases: [], purchasesNotShown: 0 };
  if (reader.own === null) return myMembershipResponseSchema.parse({ ...empty, record: reader.entryId === null ? "none" : "shared" });
  const [held, bought, payer, paidFor] = await Promise.all([
    readOwnHeld(deps, gymId, reader.own, today),
    purchasesOf(deps.sql, gymId, reader.own, PURCHASES_SHOWN, true),
    payerOf(deps.sql, gymId, reader.own),
    paidForBy(deps.sql, gymId, reader.own),
  ]);
  // Ten at most (`PAYS_FOR_MAX`), each the person's page's own read.
  const paysFor = await Promise.all(
    paidFor.map(async (p) => {
      const theirs = await readOwnHeld(deps, gymId, p.entryId, today);
      return { name: p.name, memberships: theirs.memberships.map(membershipOf), earlierNotShown: theirs.earlierNotShown };
    }),
  );
  const purchases = purchasesFrom(bought?.sales ?? []);
  const own = held.memberships.map(membershipOf);
  return myMembershipResponseSchema.parse({
    ...empty,
    record: "own",
    paidBy: payer?.name ?? null,
    memberships: payer === null ? own : own.map(datesOnly),
    paysFor,
    earlierNotShown: held.earlierNotShown,
    purchases,
    purchasesNotShown: Math.max(0, (bought?.total ?? 0) - purchases.length),
  });
}

/** One receipt, where it is the reader's to read: a desk sale of their own record; a
 *  membership's of their own record while nobody pays for them, or of somebody they pay for.
 *  404 alike for every other, for one staff voided (the lists leave those out too) and for one
 *  the gym does not have, so a member learns nothing of anybody else's. The member of staff who
 *  took it is not named. */
export async function getMyReceipt(deps: MyMembershipDeps, userId: string, gymId: string, number: number, limit: Limit): Promise<Receipt | null> {
  const reader = await readerOr404(deps, gymId, userId);
  if (!(await limit())) return null;
  const missing = new OrgsError(404, "receipt_not_found", RECEIPT_WORDS.receipt_not_found);
  if (reader.own === null) throw missing;
  const own = reader.own;
  const found = await repo.receiptEntry(deps.sql, gymId, number);
  if (found === null) throw missing;
  const theirs =
    found.of === "sale"
      ? found.entryId === own
      : found.entryId === own
        ? (await payerOf(deps.sql, gymId, own)) === null
        : (await paidForBy(deps.sql, gymId, own)).some((p) => p.entryId === found.entryId);
  if (!theirs) throw missing;
  const [row, gym] = await Promise.all([receipts.readReceipt(deps.sql, gymId, number), receipts.gymOnReceipt(deps.sql, gymId)]);
  if (row === null || gym === null || row.cancelled) throw missing;
  return receiptSchema.parse({ ...row, by: null, gym });
}
