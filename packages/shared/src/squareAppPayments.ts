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
 *  sold (`square_tax`: Square added tax or a charge on top of what staff typed), the rest about the bills;
 *  `other_location`, `several_gyms`, `not_this_bill` and `refunded` are set where the payment is taken in
 *  (another location of the account; a location two gyms here use; staff took it off a bill; Square had
 *  given money back on it before it was taken in). */
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
  "refunded",
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

/** What Square added on top of what staff typed, in all: its taxes added to the price and its charges. */
export function squareOrderAddedMinor(order: Parameters<typeof squareOrderAddsOnTop>[0]): number {
  const taxes = (order.taxes ?? []).filter((t) => t.type !== "INCLUSIVE").reduce((sum, t) => sum + Math.max(0, t.applied_money?.amount ?? 0), 0);
  return taxes + Math.max(0, order.total_service_charge_money?.amount ?? 0);
}

/** The part of a payment staff entered as an amount, without what Square added on top (18d-iii-b-ii-a):
 *  what Match puts on a bill. Told only where every line of the sale was a typed amount and this one
 *  payment paid the whole of it (the order's one tender names it); null where it cannot be told (items
 *  in the sale, the sale paid in parts, the order unread), and staff then say how much is for the bill.
 *  `amountMinor` is the payment's own, without its tip, as Square keeps the tip apart. */
export function squareAppEnteredMinor(
  order: Parameters<typeof squareOrderAddsOnTop>[0] & {
    line_items?: readonly { item_type?: string | null | undefined }[] | null | undefined;
    tenders?: readonly { payment_id?: string | null | undefined }[] | null | undefined;
  },
  payment: { id: string; amountMinor: number },
): number | null {
  if (squareAppLinesOf((order.line_items ?? []).map((line) => line.item_type)) !== "typed") return null;
  const tenders = order.tenders ?? [];
  if (tenders.length !== 1 || tenders[0]?.payment_id !== payment.id) return null;
  const entered = payment.amountMinor - squareOrderAddedMinor(order);
  return entered > 0 ? entered : null;
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
 *  2026-10-25), so a tax that does not say is taken as added; one that does not say whether it applies
 *  to custom amounts is taken as applying, so a missing flag never gives the all-clear. */
export function taxesOnTypedAmounts(taxes: readonly SquareTaxFacts[], locationId: string): { name: string; percentage: string | null }[] {
  return taxes
    .filter((t) => t.deleted !== true && t.enabled !== false && t.appliesToCustomAmounts !== false && t.inclusionType !== "INCLUSIVE")
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

/** One tax as the box names it: "Sales tax (8.25%)", or its name alone where Square gives no rate. */
export function squareTaxName(t: { name: string; percentage: string | null }): string {
  return t.percentage === null || t.percentage === "" ? t.name : `${t.name} (${t.percentage}%)`;
}

/** "Sales tax (8.25%)", "Sales tax (8.25%) and City tax (1%)". */
export function squareTaxNames(taxes: readonly { name: string; percentage: string | null }[]): string {
  const all = taxes.map(squareTaxName);
  return all.length < 2 ? (all[0] ?? "") : `${all.slice(0, -1).join(", ")} and ${all[all.length - 1] ?? ""}`;
}

/** Settings → Payments: Square's own app, Square Point of Sale (on a phone or tablet with a Square Reader,
 *  or a Square Register or Terminal used on its own), as a checklist a gym that opened last week can
 *  follow, in the words Kd gave on 2026-10-25 after three rounds of his click-through. A word in [brackets]
 *  is a label as it reads on a screen, Square's or this app's, drawn in its own colour (the console's
 *  ScreenWords; Kd: "SIMPLY JUST CHANGE THE TEXT COLOUR"); {taxes}, {bill} and {charged} are filled in, in
 *  bold. The menus are Square's own, read 2026-10-25: help article 5061 (the website's Sales taxes, "Apply
 *  tax to custom amounts", the app's "Custom amounts", and Actions → Disable tax, which stops the tax on
 *  every sale), the Square Champion's answer of 2025-02-10 in Square's community (open the tax, then Save at
 *  the upper right), and Square's post "Add a customer at checkout" of 2023-08-21. Before checkout gives
 *  staff the button to add a customer before the customer has paid; it does not change the checkout flow
 *  (Square's product manager, 2022-05-03), so Square is never said to ask by itself, and staff can skip it. */
export const SQUARE_APP_WORDS = {
  heading: "Square Point of Sale",
  how: "Use the Square Point of Sale app on a phone or tablet with a Square Reader. Start the payment in the Square app. When the amount is exactly what the bill says, it usually appears on the member's bill here afterwards.",
  listLead: "To make this work:",
  needsFixing: "Needs fixing",
  done: "Done",
  taxChecking: "Checking Square's tax settings…",
  taxNoneTitle: "Square does not add tax to the amount you enter",
  taxNoneDetail: "The member pays exactly what the bill says.",
  taxAddsTitle: "Square adds tax to the amount you enter",
  taxAddsDetail: "Square adds {taxes} to manually entered amounts. For a {bill} bill, the member would be charged {charged}.",
  taxAddsWhy: "This does not match the bill total, so the payment will not be applied to the member's bill. If the bill already includes tax, the member will be charged tax twice.",
  howToFix: "How to fix",
  hideSteps: "Hide the steps",
  fixSquareTitle: "1. Turn off Square's tax on manually entered amounts",
  fixSquareWhy: "Membership bills are charged in Square using manually entered amounts, and each bill already includes the tax configured here.",
  fixWebsitePath: "On the Square website: [Settings] → [Account & Settings] → [Payments] → [Sales taxes].",
  /** `which`: "[Sales Tax]", or "each tax, [A] and [B]" (`squareTaxesToOpen`). */
  fixWebsiteDo: (which: string): string => `Open ${which}. Turn off [Apply tax to custom amounts], then click [Save] in the top-right corner.`,
  fixAppPath: "OR, in the Square Point of Sale app: [More] → [Settings] → [Checkout] → [Sales taxes].",
  fixAppDo: (which: string, several: boolean): string => `Tap ${which}${several ? "," : ""} and turn off [Custom amounts].`,
  fixKeeps: "Tax will still apply to items sold from your Square item list. Do not select [Disable tax], as this would remove tax from those items too.",
  fixHereTitle: "2. Set the same tax for your memberships here",
  fixHereUnset: "This ensures that each bill includes the tax and the member pays it only once.",
  fixHereSet: "Tax on memberships is already set here. Check that it is the same rate as in Square.",
  seeTaxButton: "See tax on memberships",
  taxUnknownTitle: "Couldn't check Square's tax settings",
  taxUnknownDetail: "Square didn't answer just now.",
  checkAgain: "Check again",
  memberTaxSetTitle: "Tax on memberships is set here",
  memberTaxSetDetail: "Bills of the memberships it is set on already include it.",
  memberTaxUnsetTitle: "Tax on memberships: not set here",
  memberTaxUnsetDetail: "If you charge tax on memberships, set it here, not in Square.",
  setTaxButton: "Set tax on memberships",
  setTaxWho: "The owner, or a manager who can change prices, can set it in Memberships.",
  pickTitle: "Select the member for every sale",
  pickDetail: "In Square Point of Sale, tap [Add a customer] and select the member before taking payment.",
  pickSkip: "Square allows staff to skip this step. If no member is selected, the payment will not be applied to the bill automatically, and you will need to record it manually.",
  pickHow: "Can't find Add a customer?",
  pickPath: "In Square Point of Sale: [More] → [Settings] → [Checkout] → [Customer management].",
  pickDo: "Enable customer management. Then, under [Collect customer information], turn on [Before checkout].",
  cardSaved: "For members who have a card on file here, the payment is usually applied to their bill automatically when they are selected as the customer and the amount is exactly what the bill says.",
  /** A payment that does not go on a bill by itself (paid early, Square's tax added, nobody picked…) waits in
   *  Payments to match (18d-iii-b-ii-a), where staff match it to the bill. */
  others: "For anyone else, or for a sale where no member is selected, Square will process the payment as usual. It then waits in [Payments to match], where you match it to their bill.",
  notShown: "Any payment that is not applied to a bill automatically waits in [Payments to match].",
  toList: "Open Payments to match",
  items: "Shop items sold from your Square item list are never added to a bill.",
  needsAllowTitle: "Square needs your permission first",
  needsAllow: "Press [Reconnect Square], then [Allow] on Square's page. Nothing else changes.",
  ownerOnly: (gym: string): string => `The owner of ${gym} needs to reconnect Square first.`,
  /** The server's answers to a void. */
  void_square_app: "This was taken in Square Point of Sale. To give the money back, refund it in your Square Dashboard, then note the refund here. If it's on the wrong bill, press Not this bill.",
  not_square_app: "Only a payment taken in Square Point of Sale can be taken off with Not this bill.",
} as const;

/** The tax to open in Square's steps, as Square's own label: "[Sales Tax]", or "each tax, [Sales Tax] and
 *  [City Tax]". A bracket in a tax's own name is left out, so it never reads as the end of the label. */
export function squareTaxesToOpen(taxes: readonly { name: string }[]): string {
  const names = taxes.map((t) => `[${t.name.replace(/[[\]]/g, "")}]`);
  if (names.length < 2) return names[0] ?? "the tax";
  return `each tax, ${names.slice(0, -1).join(", ")} and ${names[names.length - 1] ?? ""}`;
}
