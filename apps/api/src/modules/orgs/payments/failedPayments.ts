// FAILED PAYMENTS (ROADMAP 18d-iii-ii-b; spec Part 3 §14.8): the bills and fees still owed whose
// newest charge to a card on file was declined, for staff who take payments, a page at a time, with
// what Try again would do now.
//
// THE WORST THING here is Try again charging somebody else's card, or a bill twice. So the list sends
// nothing a press is decided by: Try again is Record payment's own Card on file press (`startCharge`),
// which reads the card, the amount, the bill and the retry rule again under the record's lock, and the
// same press sent twice is one charge. What the list says of each row is read by the rules that press
// uses (`memberPayTarget`, `staffCardRetry`) and the decline by the function the person's page uses
// (`chargesOfBills`), so the list, the person's page and the press agree.
import {
  FAILED_PAYMENTS_PAGE,
  cardExpired,
  countAfterGap,
  failedPaymentsResponseSchema,
  failedPaymentsSummarySchema,
  memberPayTarget,
  staffCardRetry,
  type FailedPayment,
  type FailedPaymentRetry,
  type FailedPaymentsResponse,
  type FailedPaymentsSummary,
} from "@app/shared";
import { dayInTz } from "../../gamification/streak.js";
import { OrgsError, requirePrivilege } from "../service.js";
import { billsFor } from "../memberships/billsSql.js";
import { heldRowsOf } from "../memberships/heldRepo.js";
import { BILLING, orgNotFound, stateOf } from "./cards.js";
import * as charges from "./cardChargesRepo.js";
import { failedBills, type FailedBill } from "./failedPaymentsRepo.js";
import * as repo from "./repo.js";
import type { PaymentsDeps } from "./service.js";

const NO_BILLING = "Recording payments isn't part of your role. Ask the owner to turn on \"Record members' payments\" for you.";

async function allowed(deps: PaymentsDeps, gymId: string, userId: string) {
  const { privileges } = await requirePrivilege(deps, gymId, userId, "members.read");
  if (!privileges.includes(BILLING)) throw new OrgsError(403, "forbidden", NO_BILLING);
  const gym = await repo.readGym(deps.sql, gymId);
  if (gym === null) throw orgNotFound();
  const square = deps.square;
  const connection = square === null ? null : await repo.readConnection(deps.sql, gymId, square.environment);
  const ready = square !== null && connection !== null && stateOf(square, gym, connection) === "ready" ? { environment: square.environment, connection } : null;
  return { gym, ready };
}

const leftOf = (b: FailedBill): number => Math.max(0, b.amountMinor - b.paidMinor);

function summaryOf(bills: readonly FailedBill[], square: boolean): FailedPaymentsSummary {
  const totals = new Map<string, number>();
  for (const b of bills) totals.set(b.currency, (totals.get(b.currency) ?? 0) + leftOf(b));
  return {
    count: bills.length,
    totals: [...totals].map(([currency, minor]) => ({ currency, minor })).sort((a, b) => (a.currency < b.currency ? -1 : 1)),
    square,
  };
}

/** How many, and what they come to: Overview's line. */
export async function readFailedSummary(deps: PaymentsDeps, userId: string, gymId: string): Promise<FailedPaymentsSummary> {
  const { ready } = await allowed(deps, gymId, userId);
  return failedPaymentsSummarySchema.parse(summaryOf(await failedBills(deps.sql, gymId), ready !== null));
}

/** A page of the list, from the `from`th row. */
export async function readFailedPayments(deps: PaymentsDeps, userId: string, gymId: string, from: number): Promise<FailedPaymentsResponse> {
  const { gym, ready } = await allowed(deps, gymId, userId);
  const now = deps.now();
  const today = dayInTz(now, gym.timezone);
  const all = await failedBills(deps.sql, gymId);
  const page = all.slice(from, from + FAILED_PAYMENTS_PAGE);
  const { declined } = await charges.chargesOfBills(deps.sql, gymId, page.map((b) => b.billId), [], now);
  const ids = [...new Set(page.filter((b) => b.periodIndex !== null).map((b) => b.membershipId))];
  const [held, bills] = await Promise.all([heldRowsOf(deps.sql, gymId, ids), billsFor(deps.sql, gymId, ids)]);
  const cards = new Map<string, Awaited<ReturnType<typeof charges.readChargeCard>>>();

  /** What Try again would do now, by the rules the press itself is decided by. */
  const retryOf = async (b: FailedBill): Promise<FailedPaymentRetry> => {
    if (ready === null) return { kind: "no", why: "square" };
    if (b.currency !== ready.connection.currency) return { kind: "no", why: "currency" };
    let amountMinor = leftOf(b);
    if (b.periodIndex !== null) {
      const row = held.get(b.membershipId);
      if (row === undefined) return { kind: "no", why: "elsewhere" };
      const mine = bills.filter((x) => x.membershipId === row.id);
      // As the person's page reads it: the count moved over periods nobody was asked for.
      const count = b.past ? null : countAfterGap(row.membership, today, new Set(mine.map((x) => x.periodIndex)));
      const membership = count === null ? row.membership : { ...row.membership, paidPeriods: count, paidFloor: count };
      const target = memberPayTarget(membership, row.nextBillMinor, today, mine, b.past);
      if (target === null || target.periodIndex !== b.periodIndex || target.leftMinor <= 0) return { kind: "no", why: "elsewhere" };
      amountMinor = target.leftMinor;
    }
    if (amountMinor <= 0) return { kind: "no", why: "elsewhere" };
    if (!cards.has(b.entryId)) cards.set(b.entryId, await charges.readChargeCard(deps.sql, gymId, b.entryId, ready.environment, ready.connection.accountId));
    const card = cards.get(b.entryId) ?? null;
    if (card === null) return { kind: "no", why: "no_card" };
    const tries = await charges.triesOf(deps.sql, gymId, b.membershipId, b.billId, b.periodIndex);
    const stopped = await charges.cardStopped(deps.sql, gymId, card.card_id);
    const retry = staffCardRetry(tries, card.card_id, stopped, now);
    if (retry.kind === "wait") return { kind: "wait", from: retry.from.toISOString() };
    if (retry.kind === "no") return { kind: "no", why: retry.why };
    return {
      kind: "charge",
      card: { brand: card.brand, last4: card.last4 },
      payerName: card.payerName,
      expired: cardExpired({ expMonth: card.exp_month, expYear: card.exp_year }, today),
      cardRef: charges.cardRefOf(card),
      amountMinor,
    };
  };

  const payments: FailedPayment[] = [];
  for (const b of page) {
    const decline = declined.get(b.billId);
    // Charged again, or paid, between the two reads: the next read leaves it out.
    if (decline === undefined) continue;
    payments.push({
      billId: b.billId,
      entryId: b.entryId,
      name: b.name,
      past: b.past,
      membershipId: b.membershipId,
      typeName: b.typeName,
      periodIndex: b.periodIndex,
      covers: b.covers,
      fee: b.fee,
      leftMinor: leftOf(b),
      currency: b.currency,
      declined: decline,
      retry: await retryOf(b),
    });
  }
  const next = from + FAILED_PAYMENTS_PAGE < all.length ? from + FAILED_PAYMENTS_PAGE : null;
  return failedPaymentsResponseSchema.parse({ ...summaryOf(all, ready !== null), payments, next });
}
