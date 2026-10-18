// MY MEMBERSHIP (spec Part 3 §14.2; ROADMAP 18j): what a member holds at their gym and what
// they paid it, for the phone app. THE ONE RULE: a member reads their own record of the gym
// and nobody else's. Their own is the record their live account alone holds (`readerOf`'s
// `holders` of 1), the rule the overdue messages follow: a record two accounts share shows
// its money to neither. A stranger to the gym gets 404, as every member route answers.
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
import { payerOf } from "../payers/repo.js";
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
  const empty = { gym: { name: reader.gymName }, today, paidBy: null, memberships: [], earlierNotShown: 0, purchases: [], purchasesNotShown: 0 };
  if (reader.own === null) return myMembershipResponseSchema.parse({ ...empty, record: reader.entryId === null ? "none" : "shared" });
  const [held, bought, payer] = await Promise.all([
    readOwnHeld(deps, gymId, reader.own, today),
    purchasesOf(deps.sql, gymId, reader.own, PURCHASES_SHOWN, true),
    payerOf(deps.sql, gymId, reader.own),
  ]);
  const purchases = purchasesFrom(bought?.sales ?? []);
  return myMembershipResponseSchema.parse({
    ...empty,
    record: "own",
    paidBy: payer?.name ?? null,
    memberships: held.memberships.map(membershipOf),
    earlierNotShown: held.earlierNotShown,
    purchases,
    purchasesNotShown: Math.max(0, (bought?.total ?? 0) - purchases.length),
  });
}

/** One receipt, where it is for the reader's own record; 404 alike for one that is not and
 *  one the gym does not have, so a member learns nothing of anybody else's. */
export async function getMyReceipt(deps: MyMembershipDeps, userId: string, gymId: string, number: number, limit: Limit): Promise<Receipt | null> {
  const reader = await readerOr404(deps, gymId, userId);
  if (!(await limit())) return null;
  const missing = new OrgsError(404, "receipt_not_found", RECEIPT_WORDS.receipt_not_found);
  if (reader.own === null) throw missing;
  const entryId = await repo.receiptEntry(deps.sql, gymId, number);
  if (entryId !== reader.own) throw missing;
  const [row, gym] = await Promise.all([receipts.readReceipt(deps.sql, gymId, number), receipts.gymOnReceipt(deps.sql, gymId)]);
  if (row === null || gym === null) throw missing;
  return receiptSchema.parse({ ...row, gym });
}
