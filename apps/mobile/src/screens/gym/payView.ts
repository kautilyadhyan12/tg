import { APP_PAYMENT_WORDS, MEMBER_FEE_WORDS, formatMinor, type AppPayment, type AppPaymentRequest, type MyMembership } from "@app/shared";
import type { FeeItem } from "./membershipView";

// Pay what I owe, on My membership (ROADMAP Stage 5 item 20f; the server's `/my-membership/payments`, built in 18k-ii).
// A membership's bill or a fee that is due has Pay beside it, the member's own and those of anybody they pay for. Pay
// opens Square's own payment page in a tab over the app; back in the app, the page is closed at Square unless it was paid,
// and what happened is said where Pay was. Pure: the server decides what is owed, what may be paid and how it ended.

export const myPaymentsPath = (gymId: string): string => `/v1/orgs/${encodeURIComponent(gymId)}/my-membership/payments`;
export const myPaymentClosePath = (gymId: string, paymentId: string): string => `${myPaymentsPath(gymId)}/${encodeURIComponent(paymentId)}/close`;

/** What one Pay pays: a membership's bill (its period) or one of its fees, all of `amountMinor`. `key` names it on the
 *  screen, so what is said after it stands under that bill or fee alone. */
export type PayTarget = { key: string; membershipId: string; amountMinor: number; currency: string; what: string } & ({ kind: "bill"; periodIndex: number } | { kind: "fee"; feeId: string });

/** Every bill of one membership's key starts so: what Pay did stays under the membership once its bill is paid. */
export const billKeyStart = (membershipId: string): string => `bill:${membershipId}:`;
export const billKey = (membershipId: string, periodIndex: number): string => `${billKeyStart(membershipId)}${String(periodIndex)}`;
export const feeKey = (feeId: string): string => `fee:${feeId}`;

/** The bill or fee a page pays, as `PayTarget.key` names it. */
export const keyOfPayment = (p: Pick<AppPayment, "membershipId" | "periodIndex" | "feeId">): string | null =>
  p.feeId !== null ? feeKey(p.feeId) : p.periodIndex !== null ? billKey(p.membershipId, p.periodIndex) : null;

/** A membership's bill, where it can be paid in the app now: owed, due by `today` (paying ahead stays at the desk), and
 *  not waiting for the front desk to check an earlier payment with Square. */
export function billTarget(m: MyMembership, today: string): PayTarget | null {
  const owed = m.owed;
  if (owed === null || owed.check || owed.amountMinor <= 0 || owed.dueOn > today) return null;
  return { key: billKey(m.id, owed.periodIndex), kind: "bill", membershipId: m.id, periodIndex: owed.periodIndex, amountMinor: owed.amountMinor, currency: m.currency, what: m.name };
}

/** A fee, where it can be paid in the app now: owed and due, still counted by its class or session, and not waiting for
 *  the front desk to check an earlier payment. */
export function feeTarget(item: FeeItem, today: string): PayTarget | null {
  const f = item.fee;
  if ((f.state !== "due" && f.state !== "overdue") || !f.stillOwed || f.check || f.amountMinor <= 0 || f.dueOn > today) return null;
  return { key: feeKey(f.id), kind: "fee", membershipId: item.membershipId, feeId: f.id, amountMinor: f.amountMinor, currency: item.currency, what: `${MEMBER_FEE_WORDS[f.fee]}, ${f.forName}` };
}

/** What Pay sends: the bill or fee the screen showed and all of its amount, under the press's own key. */
export function payBody(target: PayTarget, requestKey: string): AppPaymentRequest {
  return target.kind === "bill"
    ? { requestKey, membershipId: target.membershipId, amountMinor: target.amountMinor, periodIndex: target.periodIndex }
    : { requestKey, membershipId: target.membershipId, amountMinor: target.amountMinor, feeId: target.feeId };
}

export const PAY = "Pay";
/** What a screen reader says for Pay: "Pay $49.00 for Gold Monthly". */
export const paySay = (target: PayTarget): string => `Pay ${formatMinor(target.amountMinor, target.currency)} for ${target.what}`;

export type PayTone = "good" | "plain" | "warn" | "bad";
export interface PaySaid {
  tone: PayTone;
  line: string;
  /** Check again is offered under it: Square had not said how the page ended, or the answer was lost. */
  again?: boolean;
}

/** "Paid $49.00 in the app." */
export const paidLine = (amountMinor: number, currency: string): string => `Paid ${formatMinor(amountMinor, currency)} in the app.`;
export const NOT_PAID = "Not paid. Nothing was taken.";
/** Under a bill or fee whose page ended with money Square may have taken, each time the page is read. */
export const PAY_CHECK = APP_PAYMENT_WORDS.check;
export const PAY_OPENING = "Opening the payment page…";
export const PAY_CHECKING = "Checking your payment…";
export const PAY_NOT_OPENED = "Couldn’t open the payment page. Try again.";
export const PAY_WAITING = "Square hasn’t said yet whether this was paid. Check again in a minute.";
export const PAY_NO_ANSWER = "Couldn’t check your payment. Check your internet and try again.";
export const PAY_NO_ANSWER_PRESS = "Couldn’t open the payment page. Check your internet and try again.";
export const PAY_CHANGED = "What you owe has changed. Check it, then press Pay again.";
export const CHECK_AGAIN = "Check again";

/** How a page ended, in the place Pay was; null while it is still open. Only the server's `paid` ever reads Paid. */
export function endedSaid(p: AppPayment): PaySaid | null {
  switch (p.state) {
    case "paid":
      return { tone: "good", line: paidLine(p.amountMinor, p.currency) };
    case "closed":
      return { tone: "plain", line: NOT_PAID };
    case "check":
      return { tone: "warn", line: PAY_CHECK };
    case "open":
      return null;
  }
}

/** A refused Pay, in the member's words: the server's own, which are written for the member, but for a bill or fee that
 *  changed, which the page reads again. */
export function payRefusalSaid(code: string, serverWords: string): PaySaid {
  if (code === "app_payment_changed" || code === "app_payment_not_found") return { tone: "warn", line: PAY_CHANGED };
  if (code === "app_payment_check") return { tone: "warn", line: serverWords };
  return { tone: "bad", line: serverWords === "" ? PAY_NOT_OPENED : serverWords };
}
