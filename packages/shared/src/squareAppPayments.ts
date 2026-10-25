// A PAYMENT TAKEN IN SQUARE'S OWN APP, RECORDED ON THE MEMBER (ROADMAP 18d-iii-b-i; spec Part 3 §14.8;
// rulings/2026-10-25-18d-iii-b-i.md).
//
// Staff take the payment on a Square Reader in Square's own app, picking the person there and typing
// the bill's total. Square's message about it names Square's customer; where that customer is the one
// the app keeps for a record on the gym's list, and the amount is exactly what is left on one of that
// person's bills, the payment is recorded on it by itself.
//
// THE WORST THING here is money put on the wrong person's bill, or recorded twice. So the rule is built
// the safe way round: a payment is recorded only where Square says every line was a typed amount (not
// an item from the gym's list in Square), its customer is one record's, and exactly one bill of exactly
// one person fits, due within a week; anything else waits for staff, never guessed and never dropped.
// Stripe matches a bank transfer the same way: "the oldest open invoice where the amount precisely
// matches", and what it cannot match "remains ... until you manually reconcile it" (read 2026-10-24).
import { addDays } from "./heldMemberships.js";

export const SQUARE_APP = {
  /** A bill due at most this many days ahead is paid early by itself; one further ahead waits. */
  aheadDays: 7,
  /** A bill not yet due, whose bill before it was paid within this many days, waits: the person may
   *  have paid twice (the card on file charged at 6 in the morning, then paid again at the desk). */
  twiceDays: 2,
  /** A payment Square made longer ago than this is never taken in, by a message or by the hourly look. */
  keepDays: 30,
} as const;

/** What Square says was sold: only typed amounts, only items from the gym's list in Square (or gift
 *  cards), both, or nothing that can be read (the order missing, or a line of a kind Square adds later). */
export type SquareAppLines = "typed" | "items" | "mixed" | "unread";

/** Square's line kinds (OrderLineItemItemType, read 2026-10-24): "CUSTOM_AMOUNT ... a non-itemized
 *  sale", "ITEM ... an itemized sale", "GIFT_CARD ... a gift card sale". Any other kind is unread. */
export function squareAppLinesOf(kinds: readonly (string | null | undefined)[]): SquareAppLines {
  if (kinds.length === 0) return "unread";
  let typed = 0;
  let items = 0;
  for (const kind of kinds) {
    if (kind === "CUSTOM_AMOUNT") typed += 1;
    else if (kind === "ITEM" || kind === "GIFT_CARD") items += 1;
    else return "unread";
  }
  if (items === 0) return "typed";
  return typed === 0 ? "items" : "mixed";
}

/** Who Square's customer is on the gym's list: no customer picked, a customer no record holds, one
 *  record, or more than one. */
export type SquareAppCustomer = "none" | "unknown" | "one" | "several";

/** A bill the payment could be for: the next one of a membership, or a fee, of the record or of
 *  somebody it pays for (18i). */
export interface SquareAppCandidate {
  entryId: string;
  target: { kind: "period"; membershipId: string; periodIndex: number } | { kind: "fee"; membershipId: string; billId: string };
  leftMinor: number;
  /** The gym's own day it falls due. */
  dueOn: string;
  /** The membership's bill before this one was paid within `twiceDays` (a period's alone). */
  paidJustBefore: boolean;
  /** A payment for the membership waits on the Terminal, or its card on file is being charged. */
  busy: boolean;
}

/** Why a payment waits for staff. The first three are about the person, the next two about what was
 *  sold, the rest about the bills; `other_location`, `several_gyms` and `not_this_bill` are set where
 *  the payment is taken in (another location of the account; a location two gyms here use; staff took
 *  it off a bill). */
export const SQUARE_APP_WAIT_REASONS = [
  "no_customer",
  "not_linked",
  "several_people",
  "mixed_sale",
  "sale_unread",
  "no_bill",
  "too_early",
  "several_bills",
  "busy",
  "maybe_twice",
  "other_location",
  "several_gyms",
  "not_this_bill",
] as const;
export type SquareAppWaitReason = (typeof SQUARE_APP_WAIT_REASONS)[number];

export type SquareAppDecision =
  | { kind: "record"; candidate: SquareAppCandidate }
  | { kind: "wait"; reason: SquareAppWaitReason }
  /** Items from the gym's list in Square: a shop sale, which stays in Square and is no bill's. */
  | { kind: "shop_sale" };

const order = (a: SquareAppCandidate, b: SquareAppCandidate): number => (a.dueOn < b.dueOn ? -1 : a.dueOn > b.dueOn ? 1 : 0);

/** What becomes of a payment taken in Square's own app. `amountMinor` is Square's amount without
 *  any tip. */
export function squareAppDecision(p: {
  lines: SquareAppLines;
  customer: SquareAppCustomer;
  amountMinor: number;
  today: string;
  candidates: readonly SquareAppCandidate[];
}): SquareAppDecision {
  if (p.lines === "items") return { kind: "shop_sale" };
  if (p.customer === "none") return { kind: "wait", reason: "no_customer" };
  if (p.customer === "unknown") return { kind: "wait", reason: "not_linked" };
  if (p.customer === "several") return { kind: "wait", reason: "several_people" };
  if (p.lines === "mixed") return { kind: "wait", reason: "mixed_sale" };
  if (p.lines === "unread") return { kind: "wait", reason: "sale_unread" };

  const same = p.candidates.filter((c) => c.leftMinor === p.amountMinor);
  const last = addDays(p.today, SQUARE_APP.aheadDays);
  const due = [...same.filter((c) => c.dueOn <= last)].sort(order);
  const first = due[0];
  if (first === undefined) return { kind: "wait", reason: same.length > 0 ? "too_early" : "no_bill" };
  // Bills of this amount for two people, or two of one person's falling due the same day: which one
  // the money was for is the desk's to say.
  if (new Set(due.map((c) => c.entryId)).size > 1) return { kind: "wait", reason: "several_bills" };
  if (due[1] !== undefined && due[1].dueOn === first.dueOn) return { kind: "wait", reason: "several_bills" };
  if (first.busy) return { kind: "wait", reason: "busy" };
  if (first.dueOn > p.today && first.paidJustBefore) return { kind: "wait", reason: "maybe_twice" };
  return { kind: "record", candidate: first };
}

/** Settings → Payments: how the gym sets up Square's own app, Square Point of Sale (its own name for it,
 *  on a phone or tablet with a Square Reader, or on a Square Register or Terminal used on its own). The
 *  menus are Square's (help article 5061, "Add a customer at checkout", read 2026-10-25). */
export const SQUARE_APP_WORDS = {
  heading: "Payments taken in Square Point of Sale",
  intro: "When staff take a payment in Square Point of Sale and add the person as the customer, it's recorded on the person's bill here, as long as the amount is exactly what the bill says.",
  setupLead: "Set up Square Point of Sale once:",
  customers: "Open More → Settings → Checkout. Turn on Customer management, then turn on Before checkout under Collect customer information. Staff then add the person before taking the money.",
  tax: "Open More → Settings → Checkout → Sales taxes (VAT in some countries). Open each tax and turn off Custom amounts. Set any tax on your memberships here instead, so each bill already includes it and Square charges exactly what staff enter.",
  linked: "A person's payments are recorded automatically once their card is saved here.",
  items: "Ring up shop items from your item list in Square. Item sales are never added to a bill.",
  needsAllow: "To record payments taken in Square Point of Sale, Square needs one more permission.",
  needsAllowHint: "Press Reconnect Square, then Allow on Square's page. Nothing else changes.",
  ownerOnly: (gym: string): string => `The owner of ${gym} needs to reconnect Square before payments taken in Square Point of Sale can be recorded.`,
  /** The server's answers to a void. */
  void_square_app: "This was taken in Square Point of Sale. To give the money back, refund it in your Square Dashboard, then note the refund here. If it's on the wrong bill, press Not this bill.",
  not_square_app: "Only a payment taken in Square Point of Sale can be taken off with Not this bill.",
} as const;
