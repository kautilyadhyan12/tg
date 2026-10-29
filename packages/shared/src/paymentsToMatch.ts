// PAYMENTS TO MATCH (ROADMAP 18d-iii-b-ii-a; spec Part 3 §14.8; rulings/2026-10-25-18d-iii-b-ii-a.md).
//
// Every payment taken in Square Point of Sale waits here for staff (Kd, 2026-10-25: "one press"; why each
// waits is `squareAppDecision`), newest first, for staff who take payments. Where one bill fits, it is
// ticked and one press of Match puts the payment there, as Square Point of Sale, by the same step Record
// payment takes; otherwise staff choose who paid or which bill. Not for a bill takes one off the list (a
// shop sale typed in as an amount, or a payment already recorded on a bill by hand), with Undo.
//
// THE WORST THING here is a member charged twice: their card on file charged for a bill they already paid
// in Square Point of Sale, while that payment waits. So while a payment of theirs waits (or of whoever pays
// for them), their card on file is not charged, by the app or by staff (`startCharge`), and their page,
// Failed payments and this list say why.
import { z } from "zod";
import { cardSeenSchema } from "./cardCharges.js";
import { matchBillSchema, matchTargetSchema } from "./matchBill.js";
import { memberPaymentMethodSchema } from "./memberBills.js";
import { salePersonSchema } from "./register.js";
import { SQUARE_APP_WAIT_REASONS } from "./squareAppPayments.js";

const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const minorSchema = z.number().int().min(0).max(999_999_999);
const currencySchema = z.string().regex(/^[A-Z]{3}$/);

/** Rows a page; the list is read a page at a time, newest payment first. */
export const PAYMENTS_TO_MATCH_PAGE = 25;

/** What Square has of the customer on a payment, as it was when the payment was taken in: shown where
 *  that customer is linked to nobody here, so staff can tell who it is. */
export const squareAppCustomerSeenSchema = z
  .object({
    name: z.string().min(1).max(200).nullable(),
    email: z.string().min(1).max(320).nullable(),
    phone: z.string().min(1).max(40).nullable(),
  })
  .strict();
export type SquareAppCustomerSeen = z.infer<typeof squareAppCustomerSeenSchema>;

export const paymentToMatchSchema = z
  .object({
    id: z.string().uuid(),
    takenAt: z.string().datetime(),
    /** What Square took, without the tip. */
    amountMinor: minorSchema,
    tipMinor: minorSchema,
    currency: currencySchema,
    /** The part staff entered as an amount, without what Square added on top: what Match puts on the
     *  bill. Null where it can't be told (items in the sale, the sale paid in parts, Square didn't show
     *  the sale): Match then asks how much of it is for the bill. */
    enteredMinor: minorSchema.nullable(),
    /** What Square had given back of it when it was last read. */
    refundedMinor: minorSchema,
    card: cardSeenSchema.nullable(),
    /** How it was paid where it was not a card, as Square says (CASH, WALLET…). */
    source: z
      .string()
      .regex(/^[A-Z_]{1,40}$/)
      .nullable(),
    /** Square's own details for the customer added to the sale, where that customer is linked to nobody
     *  here; null where no customer was added, or the customer is linked. */
    customer: squareAppCustomerSeenSchema.nullable(),
    /** The one record Square's customer is linked to. */
    person: salePersonSchema.nullable(),
    /** The records Square's customer is linked to, where it is more than one's (`several_people`). */
    linkedNames: z.array(z.string()).max(10),
    /** Who Match fills in: `person`, or the one record here with the same email or phone as Square's
     *  customer. */
    suggested: salePersonSchema.nullable(),
    reason: z.enum(SQUARE_APP_WAIT_REASONS),
    /** While it waits, a card on file is not charged for `person`, or for somebody they pay for. */
    holdsCard: z.boolean(),
    /** The name the gym gave the Square device that took it ("the name of the device set by the seller",
     *  Square's Payment reference, read 2026-10-25), so each desk knows its own; null where Square gave none. */
    deviceName: z.string().min(1).max(100).nullable(),
    /** The one bill it fits, as Match's box ticks it, where why it waits leaves no doubt which (one press);
     *  null where staff choose who paid or which bill. Match puts `leftMinor` of it there. */
    bill: matchBillSchema.nullable(),
  })
  .strict();
export type PaymentToMatch = z.infer<typeof paymentToMatchSchema>;

/** How many, and what they come to in each currency: Overview's line, and the list's heading. */
export const paymentsToMatchSummarySchema = z
  .object({
    count: z.number().int().min(0),
    totals: z.array(z.object({ currency: currencySchema, minor: minorSchema }).strict()),
    /** The gym has taken payments in Square Point of Sale: the menu keeps its count current (live). */
    used: z.boolean().default(false),
    /** Square is connected at a location and reads what was sold: Add member offers Square Point of Sale as
     *  a way of paying, recording nothing (18d-iii-b-ii-a). */
    pointOfSale: z.boolean().default(false),
  })
  .strict();
export type PaymentsToMatchSummary = z.infer<typeof paymentsToMatchSummarySchema>;

export const paymentsToMatchResponseSchema = paymentsToMatchSummarySchema
  .extend({
    payments: z.array(paymentToMatchSchema),
    /** The gym's own day, which the bills ticked are due against. */
    today: daySchema,
    /** Where the next page starts; null on the last. */
    next: z.number().int().min(1).nullable(),
    /** Square is connected now, so Match can ask Square about a payment before it goes on a bill. */
    square: z.boolean(),
    /** Payments taken at this gym's Square location with no customer added, which another gym here uses
     *  too: kept for neither, so not listed; giving each gym its own location ends it. */
    sharedLocation: z.number().int().min(0),
  })
  .strict();
export type PaymentsToMatchResponse = z.infer<typeof paymentsToMatchResponseSchema>;

export const paymentsToMatchQuerySchema = z
  .object({
    from: z.coerce.number().int().min(0).max(100_000).default(0),
  })
  .strict();

/** One payment's address: its gym, and its own id here (never Square's). */
export const paymentToMatchParamsSchema = z.object({ gymId: z.string().uuid(), paymentId: z.string().uuid() }).strict();

/** A payment already on one of their bills, shown in the Match box so one recorded by hand is seen. */
export const matchPaidSchema = z
  .object({
    amountMinor: minorSchema,
    currency: currencySchema,
    paidOn: daySchema,
    method: memberPaymentMethodSchema,
    /** Whose bill it paid, where it is not the person picked. */
    forName: z.string().nullable(),
  })
  .strict();
export type MatchPaid = z.infer<typeof matchPaidSchema>;

/** What Match's box offers to do about Square's customer on the payment, for the person picked as who paid
 *  (18d-iii-b-ii-c; spec Part 3 §14.8): link them, so that customer's next payments come to the person's page.
 *  `link`: the customer and the person agree (the same email or phone, and the same name), so the box's tick is
 *  on; `ask`: the app can't tell they are the same person (a parent paying for a child has her own customer), so
 *  the tick is off and staff say; `taken`: the customer is already linked to somebody else here, so it can't be.
 *  `also`: the person has another customer in the gym's Square already, and this one is linked as theirs too.
 *  `customerName`: Square's name for the customer, as seen when the payment was taken in (null: none seen).
 *  `byName`: who it is linked to here, for `taken`. `elsewhere`: for `taken`, nobody here has it, but somebody at
 *  another business on the same Square account does (round one, High 1), whose name is never shown here. */
export const MATCH_LINK_OFFERS = ["link", "ask", "taken"] as const;
export const matchLinkOfferSchema = z
  .object({
    offer: z.enum(MATCH_LINK_OFFERS),
    customerName: z.string().min(1).max(200).nullable(),
    also: z.boolean(),
    byName: z.string().nullable(),
    elsewhere: z.boolean(),
    /** Staff unlinked this customer from this person on their page (18d-iii-b-ii-c-ii), when: the tick is off whatever the rule
     *  says, and only ticking it links them again. */
    unlinkedAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();
export type MatchLinkOffer = z.infer<typeof matchLinkOfferSchema>;

/** Match's box, for one person: their bills (and those of anybody they pay for), and their newest
 *  payments. `amountMinor`: what goes on the bill, where the app can tell. `link`: what the box offers to do
 *  about Square's customer on the payment; null where there is nothing to link (no customer was added to the
 *  sale, or the customer is this person's already). */
export const matchBillsResponseSchema = z
  .object({
    person: salePersonSchema,
    /** The gym's own day, which the bills' due days are read against. */
    today: daySchema,
    amountMinor: minorSchema.nullable(),
    bills: z.array(matchBillSchema).max(200),
    /** The bill ticked when the box opens: the first one due of exactly `amountMinor`; null for none. */
    suggested: z.number().int().min(0).nullable(),
    paid: z.array(matchPaidSchema).max(5),
    link: matchLinkOfferSchema.nullable(),
  })
  .strict();
export type MatchBillsResponse = z.infer<typeof matchBillsResponseSchema>;

export const matchBillsQuerySchema = z.object({ entryId: z.string().uuid() }).strict();

/** Match. `requestKey` is the box's own: the same press sent twice puts the payment on the bill once.
 *  `amountMinor`: what the screen showed going on the bill. `linkTo`: the person who paid, whose Square customer
 *  on the payment is to be linked to them (18d-iii-b-ii-c); null, which nothing but the box's tick sends, links
 *  nobody. */
export const matchPaymentRequestSchema = z
  .object({
    requestKey: z.string().uuid(),
    entryId: z.string().uuid(),
    membershipId: z.string().uuid(),
    target: matchTargetSchema,
    amountMinor: z.number().int().min(1).max(99_999_999),
    linkTo: z.string().uuid().nullable().default(null),
  })
  .strict();
export type MatchPaymentRequest = z.infer<typeof matchPaymentRequestSchema>;

/** What Match did about the Square customer it was asked to link: `linked` (it is the person's customer now),
 *  `also` (the person had another customer, and this one is theirs too), `taken` (somebody else here has it),
 *  `gone` (Square no longer has it), `merged` (Square has merged it into another customer since), `unchecked`
 *  (Square wouldn't say), `past` (the person is a past member), `none` (nothing was asked, or the payment had
 *  no customer). */
export const MATCH_LINK_RESULTS = ["none", "linked", "also", "taken", "gone", "merged", "unchecked", "past"] as const;
export const matchLinkResultSchema = z
  .object({
    result: z.enum(MATCH_LINK_RESULTS),
    /** Square's name for the customer; null where it was not seen, or the same press is answered again. */
    customerName: z.string().min(1).max(200).nullable(),
    /** The person it was to be linked to. */
    personName: z.string().nullable(),
  })
  .strict();
export type MatchLinkResult = z.infer<typeof matchLinkResultSchema>;

export const matchPaymentResponseSchema = z
  .object({
    matched: z
      .object({
        entryId: z.string().uuid(),
        name: z.string(),
        amountMinor: minorSchema,
        currency: currencySchema,
        receiptNumber: z.number().int().min(1).max(2_147_483_647),
        link: matchLinkResultSchema,
      })
      .strict(),
  })
  .strict();
export type MatchPaymentResponse = z.infer<typeof matchPaymentResponseSchema>;

/** Not for a bill: a shop sale or anything else (`other`), or a payment already recorded on a bill by
 *  hand (`by_hand`). */
export const NOT_A_BILL_REASONS = ["other", "by_hand"] as const;
export const notABillRequestSchema = z.object({ why: z.enum(NOT_A_BILL_REASONS) }).strict();
export type NotABillRequest = z.infer<typeof notABillRequestSchema>;

/** What became of the payment: still waiting (Undo), or marked. */
export const paymentToMatchStateResponseSchema = z
  .object({ state: z.enum(["waiting", "not_bill"]), why: z.enum(NOT_A_BILL_REASONS).nullable() })
  .strict();
export type PaymentToMatchStateResponse = z.infer<typeof paymentToMatchStateResponseSchema>;

/** The server's answers, as staff read them. */
export const PAYMENTS_TO_MATCH_WORDS = {
  gone: "This payment is no longer here.",
  matched: "This payment is already on a bill.",
  marked: "This payment was marked as not a bill payment.",
  changed: "This payment has changed since you opened it. Open Match again.",
  key_reused: "That Match was already used for another bill. Open Match again.",
  refunded: "Square has refunded some or all of this payment, so it can't go on a bill.",
  not_completed: "Square no longer shows this payment as taken, so it can't go on a bill.",
  square_unavailable: "Square didn't answer just now. Nothing was changed. Try again in a minute.",
  not_connected: "Square isn't connected right now, so this payment can't be checked with Square. Reconnect Square in Settings, then try again.",
  other_account: "This payment was taken in another Square account than the one connected now, so it can't go on a bill here.",
  too_much: "This is more than is left on that bill. Choose another bill, or choose Not for a bill.",
  busy: "A payment for that membership is being taken on the Square Terminal or charged to the card on file. Wait a minute, then try again.",
  bill_changed: "That bill has changed since you opened this. Open Match again.",
  past_member: "A past member's membership can't be paid here. Choose another bill.",
  /** The card on file is not charged while a payment of the person's from Square Point of Sale waits. */
  card_held: "This person has a payment from Square Point of Sale waiting in Payments to match. Match it to their bill, or mark it Not for a bill, before charging their card, so they aren't charged twice.",
} as const;
