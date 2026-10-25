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
import { z } from "zod";
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

/** Why a payment waits for staff. The first three are about the person, the next three about what was
 *  sold (`square_tax`: Square added tax or a charge on top of what staff typed), the rest about the bills; `other_location`, `several_gyms` and `not_this_bill` are set where
 *  the payment is taken in (another location of the account; a location two gyms here use; staff took
 *  it off a bill). */
export const SQUARE_APP_WAIT_REASONS = [
  "no_customer",
  "not_linked",
  "several_people",
  "mixed_sale",
  "sale_unread",
  "square_tax",
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
  /** Square added tax or a charge on top of what staff typed (`squareOrderAddsOnTop`). */
  addedOnTop: boolean;
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
  // The money taken is not what staff typed: never matched to a bill, whatever it comes to.
  if (p.addedOnTop) return { kind: "wait", reason: "square_tax" };

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

/** Square added something on top of what staff typed: a tax added to the price (ADDITIVE, as US and
 *  Canadian sales tax are), or a charge of its own. A tax inside the price (INCLUSIVE) changes nothing
 *  that was charged. */
export function squareOrderAddsOnTop(order: {
  taxes?: readonly { type?: string | null | undefined; applied_money?: { amount: number } | null | undefined }[] | null | undefined;
  total_service_charge_money?: { amount: number } | null | undefined;
}): boolean {
  const taxed = (order.taxes ?? []).some((t) => t.type !== "INCLUSIVE" && (t.applied_money?.amount ?? 0) > 0);
  return taxed || (order.total_service_charge_money?.amount ?? 0) > 0;
}

/** A tax in the business's own Square item library, as the check reads it. */
export interface SquareTaxFacts {
  name: string | null;
  percentage: string | null;
  inclusionType: string | null;
  appliesToCustomAmounts: boolean | null;
  enabled: boolean | null;
  deleted: boolean | null;
  atAllLocations: boolean | null;
  presentAt: readonly string[];
  absentAt: readonly string[];
}

/** The taxes Square adds on top of an amount staff type in at this location: switched on, not deleted,
 *  used here (Square's own default is every location), added to the price rather than inside it, and
 *  applied to custom amounts. Square's own default for a tax's kind is ADDITIVE ("CatalogTax", read
 *  2026-10-25), so a tax that does not say is taken as added. */
export function taxesOnTypedAmounts(taxes: readonly SquareTaxFacts[], locationId: string): { name: string; percentage: string | null }[] {
  return taxes
    .filter((t) => t.deleted !== true && t.enabled !== false && t.appliesToCustomAmounts === true && t.inclusionType !== "INCLUSIVE")
    .filter((t) => (t.atAllLocations === false ? t.presentAt.includes(locationId) : !t.absentAt.includes(locationId)))
    .map((t) => ({ name: t.name === null || t.name.trim() === "" ? "A tax with no name" : t.name.trim(), percentage: t.percentage }));
}

/** What Square charges for an amount typed in, these taxes added on top, each rounded to the smallest
 *  unit as Square rounds a tax. A rate that does not read as a number adds nothing. */
export function chargedWithTaxes(typedMinor: number, percentages: readonly (string | null)[]): number {
  let total = typedMinor;
  for (const p of percentages) {
    const rate = p === null ? Number.NaN : Number(p);
    if (Number.isFinite(rate) && rate > 0) total += Math.round((typedMinor * rate) / 100);
  }
  return total;
}

/** The example bill the check's words use. */
export const SQUARE_APP_EXAMPLE_MINOR = 4500;

/** Settings → Payments: whether Square adds tax to amounts staff type in (18d-iii-b-i), read from the
 *  gym's own Square item library each time the box asks. `none`: Square adds no tax to them; `adds`:
 *  these taxes; `unknown`: Square could not be asked just now; `needs_allow`: connected before the app
 *  could read the item library. `membershipTax`: a membership on the price list here has a tax rate;
 *  `canSetTax`: this person may set one (`memberships.manage`). */
export const squareAppCheckSchema = z
  .object({
    taxes: z.discriminatedUnion("state", [
      z.object({ state: z.literal("none") }).strict(),
      z
        .object({
          state: z.literal("adds"),
          taxes: z.array(z.object({ name: z.string().min(1).max(255), percentage: z.string().max(20).nullable() }).strict()).min(1).max(50),
          /** The example: a bill of this much, typed in, is charged `chargedMinor`. */
          exampleMinor: z.number().int().min(1),
          chargedMinor: z.number().int().min(1),
        })
        .strict(),
      z.object({ state: z.literal("unknown") }).strict(),
      z.object({ state: z.literal("needs_allow") }).strict(),
    ]),
    currency: z.string().regex(/^[A-Z]{3}$/),
    membershipTax: z.boolean(),
    canSetTax: z.boolean(),
  })
  .strict();
export type SquareAppCheck = z.infer<typeof squareAppCheckSchema>;
export const squareAppCheckResponseSchema = z.object({ check: squareAppCheckSchema }).strict();
export type SquareAppCheckResponse = z.infer<typeof squareAppCheckResponseSchema>;

/** "Sales tax (8.25%)", "Sales tax (8.25%) and City tax (1%)". */
export function squareTaxNames(taxes: readonly { name: string; percentage: string | null }[]): string {
  const one = (t: { name: string; percentage: string | null }) => (t.percentage === null || t.percentage === "" ? t.name : `${t.name} (${t.percentage}%)`);
  const all = taxes.map(one);
  return all.length < 2 ? (all[0] ?? "") : `${all.slice(0, -1).join(", ")} and ${all[all.length - 1] ?? ""}`;
}

/** Settings → Payments: how the gym sets up Square's own app, Square Point of Sale (its own name for it,
 *  on a phone or tablet with a Square Reader, or on a Square Register or Terminal used on its own). The
 *  menus are Square's (help article 5061, "Add a customer at checkout", read 2026-10-25). */
export const SQUARE_APP_WORDS = {
  heading: "Payments taken in Square Point of Sale",
  intro: "When staff take a payment in Square Point of Sale and add the person as the customer, it's recorded on the person's bill here, as long as the amount is exactly what the bill says.",
  setupLead: "Set up Square Point of Sale once:",
  customers: "Open More → Settings → Checkout. Turn on Customer management, then turn on Before checkout under Collect customer information. Staff then add the person before taking the money.",
  /** The tax check, read from the gym's own Square item library each time the box opens. */
  taxChecking: "Checking your tax settings in Square…",
  taxNone: "Square adds no tax of its own to amounts staff type in. Any tax is already in the bill here, so the member pays exactly the bill's total.",
  taxAdds: (names: string): string => `Square adds ${names} on top of any amount staff type in.`,
  taxExample: (bill: string, charged: string): string =>
    `For example, a member's bill here is ${bill}. Staff type ${bill} in Square Point of Sale, and Square charges ${charged}. That isn't the bill's amount, so the payment isn't recorded on the bill. And if the bill already includes tax, the member pays tax twice.`,
  taxFixLead: "To fix it:",
  taxFixSquare: (several: boolean): string =>
    `In Square Point of Sale, open More → Settings → Checkout → Sales taxes, open ${several ? "each of these taxes" : "the tax"} and turn off Custom amounts.`,
  taxFixHere: "Put the same tax on your memberships here, so each bill already includes it.",
  taxFixItems: "Ring up taxable shop items from your item list in Square, so Square still adds their tax.",
  taxUnknown: "We couldn't read your tax settings from Square just now.",
  checkAgain: "Check again",
  noMembershipTax: "None of your memberships has tax set here. If you charge tax on memberships, add it here so it's in each bill.",
  setTaxButton: "Add tax to memberships",
  setTaxWho: "The owner, or a manager who can change prices, adds tax to memberships in Memberships.",
  linked: "A person's payments are recorded automatically once their card is saved here.",
  items: "Ring up shop items from your item list in Square. Item sales are never added to a bill.",
  needsAllow: "To record payments taken in Square Point of Sale, our app needs your permission in Square.",
  needsAllowHint: "Press Reconnect Square, then Allow on Square's page. Nothing else changes.",
  ownerOnly: (gym: string): string => `The owner of ${gym} needs to reconnect Square before payments taken in Square Point of Sale can be recorded.`,
  /** The server's answers to a void. */
  void_square_app: "This was taken in Square Point of Sale. To give the money back, refund it in your Square Dashboard, then note the refund here. If it's on the wrong bill, press Not this bill.",
  not_square_app: "Only a payment taken in Square Point of Sale can be taken off with Not this bill.",
} as const;
