// A DECLINED CARD TRIED AGAIN (ROADMAP 18d-iii-ii-a; spec Part 3 §14.8; rulings/2026-10-21-money-plan.md).
//
// Square's own advice (Cards API, "Manage card-on-file declines", read 2026-10-23): "Wait at least 24
// hours before retrying", "Limit retries to 2 to 3 attempts over several days", INSUFFICIENT_FUNDS
// "Retrying after a few days might be effective", GENERIC_DECLINE "Don't retry". The card companies
// forbid trying again after a decline that says the card will never be approved (Visa's Category 1:
// a closed or unknown account, an expired card, a card not allowed this payment; Stripe's own list of
// declines it never retries is the same kind).
//
// So the rule is built the safe way round: the app tries a card again BY ITSELF only after a decline
// Square names as one a later try may cure; staff may charge it again only after a decline Square
// names as one the cardholder can clear with their bank; and every other code, one Square adds
// tomorrow among them, stops that card until another is saved. One bill is charged to one card at
// most three times in all, by the app and by staff together, never twice within a day.
import { addDays, daysBetween } from "./heldMemberships.js";
import type { CardChargeOutcome } from "./cardCharges.js";

export const CARD_RETRY = {
  /** Charges of one bill to one card, the first among them. */
  tries: 3,
  /** The app's second and third tries: this many days after the card was first declined for the bill. */
  afterDays: [3, 7] as readonly number[],
  /** Never sooner than this after the card's last decline, by the app or by staff. */
  gapMs: 24 * 60 * 60_000,
  /** The member is asked to pay another way within this many days of the first decline (Visa). */
  noticeDays: 7,
} as const;

/** What a decline allows next. `later`: the app tries again on its days; `bank`: only staff, once the
 *  cardholder has spoken to their bank; `new_card`: never this card again. */
export type CardDeclineClass = "later" | "bank" | "new_card";

/** Square's decline codes (its ErrorCode list, read 2026-10-23) a later try may cure. */
const LATER: ReadonlySet<string> = new Set(["INSUFFICIENT_FUNDS", "TRANSACTION_LIMIT"]);
/** Declines the cardholder can clear with their bank: staff may charge again after that. */
const BANK: ReadonlySet<string> = new Set([
  "GENERIC_DECLINE",
  "CARD_DECLINED",
  "CARD_DECLINED_CALL_ISSUER",
  "CARD_DECLINED_VERIFICATION_REQUIRED",
  "VOICE_FAILURE",
  "CVV_FAILURE",
  "ADDRESS_VERIFICATION_FAILURE",
]);

export function cardDeclineClassOf(code: string): CardDeclineClass {
  if (LATER.has(code)) return "later";
  if (BANK.has(code)) return "bank";
  return "new_card";
}

/** One earlier charge of the bill, as the rule reads it. */
export interface CardChargeTry {
  cardId: string;
  /** Null while Square has not answered. */
  outcome: CardChargeOutcome | null;
  code: string | null;
  bySchedule: boolean;
  startedAt: Date;
  /** The gym's own day it was started on. */
  day: string;
}

export type StaffRetry =
  | { kind: "yes" }
  /** The card was declined for this bill less than a day ago. */
  | { kind: "wait"; from: Date }
  /** The bank said never for this card, or it was tried as often as the rule allows for this bill. */
  | { kind: "no"; why: "new_card" | "tried_out" };

export type AppRetry =
  /** Never charged: the first try, by the rules of the bill's date. */
  | { kind: "first" }
  /** The next try: on this gym day, and not before `notBefore`. */
  | { kind: "on"; day: string; notBefore: Date }
  | { kind: "no"; why: "new_card" | "tried_out" | "bank" | "not_declined" | "card_changed" };

const declinesOn = (tries: readonly CardChargeTry[], cardId: string) => tries.filter((t) => t.cardId === cardId && t.outcome === "declined");

/** May staff charge this card for this bill now? `cardStopped`: the card was declined for good for
 *  any bill of this gym. */
export function staffCardRetry(tries: readonly CardChargeTry[], cardId: string, cardStopped: boolean, now: Date): StaffRetry {
  if (cardStopped) return { kind: "no", why: "new_card" };
  const declined = declinesOn(tries, cardId);
  if (declined.some((t) => t.code === null || cardDeclineClassOf(t.code) === "new_card")) return { kind: "no", why: "new_card" };
  if (declined.length >= CARD_RETRY.tries) return { kind: "no", why: "tried_out" };
  const last = declined.reduce<Date | null>((at, t) => (at === null || t.startedAt > at ? t.startedAt : at), null);
  if (last !== null && now.getTime() < last.getTime() + CARD_RETRY.gapMs) return { kind: "wait", from: new Date(last.getTime() + CARD_RETRY.gapMs) };
  return { kind: "yes" };
}

/** When the app charges this card for this bill by itself next. Only after the bill's newest charge
 *  was a decline on this same card that a later try may cure; a charge refused, unanswered or taken
 *  ends the app's own tries, as a card saved since does (staff charge a new card). */
export function appCardRetry(tries: readonly CardChargeTry[], cardId: string, cardStopped: boolean): AppRetry {
  // A card the bank declined for good, for any bill, is never charged again: not for a new bill either.
  if (cardStopped) return { kind: "no", why: "new_card" };
  if (tries.length === 0) return { kind: "first" };
  const newest = tries.reduce((a, b) => (b.startedAt > a.startedAt ? b : a));
  if (newest.outcome !== "declined" || newest.code === null) return { kind: "no", why: "not_declined" };
  if (newest.cardId !== cardId) return { kind: "no", why: "card_changed" };
  const cls = cardDeclineClassOf(newest.code);
  if (cls !== "later") return { kind: "no", why: cls };
  const declined = declinesOn(tries, cardId);
  if (declined.some((t) => t.code === null || cardDeclineClassOf(t.code) === "new_card")) return { kind: "no", why: "new_card" };
  const after = CARD_RETRY.afterDays[declined.length - 1];
  if (declined.length >= CARD_RETRY.tries || after === undefined) return { kind: "no", why: "tried_out" };
  const first = declined.reduce((a, b) => (b.startedAt < a.startedAt ? b : a));
  return { kind: "on", day: addDays(first.day, after), notBefore: new Date(newest.startedAt.getTime() + CARD_RETRY.gapMs) };
}

/** May the app charge it now, on the gym's `today` at `now`? */
export function appRetryDue(retry: AppRetry, today: string, now: Date): boolean {
  return retry.kind === "on" && daysBetween(retry.day, today) >= 0 && now.getTime() >= retry.notBefore.getTime();
}
