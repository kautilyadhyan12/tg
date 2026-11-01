// REFUND TO CARD (ROADMAP 18d-iv-a; spec Part 3 §14.8): money given back to the card that paid, through
// Square, from the payment on a person's page. Square's "Refund Payments" and "Process Refunds" pages,
// read 2026-10-30, and its test area, measured that day (`apps/api/.cost/18d-iv-a/probe-refund.mts`).
import { z } from "zod";
import { cardSeenSchema } from "./cardCharges.js";
import { cardTerminalSchema } from "./memberCards.js";
import { refundReasonSchema } from "./memberBills.js";
import { formatMinor } from "./memberships.js";

/** Square: "more than 1 year ago" cannot be refunded, and "the maximum `PENDING` time is 14 days. A seller should contact
 *  Square Support if a refund is `PENDING` beyond 14 days." */
export const CARD_REFUND_LIMITS = { daysToRefund: 365, pendingDays: 14 } as const;

export const CARD_REFUND_WORDS = {
  /** "When you refund a payment, the processing fees for the payment aren't refunded back to you." */
  fee: "Square does not give back its card fee on a refund.",
  /** The whole way, from the press: "In total, it can take up to 4–14 business days for your customer to receive their refund."
   *  (Square's "Manage customer refunds", read 2026-10-31.) */
  days: "It can take up to 14 business days to reach the card, depending on the bank.",
  /** Once Square has finished: "It might take 7–10 business days for refunds to appear, depending on the bank." ("Refund a payment".) */
  days_left: "It can take up to 10 business days to reach the card, depending on the bank.",
  waiting: "A refund here is waiting for Square's answer. Try again once it has finished.",
  waiting_membership: "A refund on this membership is waiting for Square's answer. Try again once it has finished.",
  not_card: "This payment wasn't taken through Square. Use Note a refund instead.",
  other_account: "This payment was taken in a Square account you are no longer connected to. Refund it in that account, then note the refund here.",
  too_old: "Square refunds a payment for up to a year after it was taken. Give the money back another way, then note the refund here.",
  not_finished: "Square hasn't finished this payment yet, so it can't be refunded. Try again later.",
  differs: "This payment doesn't match Square's record of it. Check it in your Square Dashboard before refunding it.",
  key_reused: "That refund has already been sent. Open the payment again to see where it stands.",
  nothing_left: "There is nothing left of this payment to refund.",
  /** All of a sale, where Square shows less left than the app does. */
  less_in_square: "Square shows less of this sale left to refund than your records do, as part was refunded there. It will appear here by itself within the hour, or you can refund one product at a time.",
  /** Square took it up, then said it failed. */
  failed: "Square could not refund this. No money went back.",
} as const;

/** Why Square refused a refund, in the gym's words. Any code not named here reads the last line: a code Square adds
 *  later never says more than it knows. */
export function cardRefundRefusedLine(code: string | null): string {
  switch (code) {
    case "REFUND_AMOUNT_INVALID":
    case "AMOUNT_TOO_HIGH":
      return "Square shows less of this payment left to refund than you asked for. No money went back. Check it in your Square Dashboard.";
    case "INSUFFICIENT_FUNDS":
      return "Your Square account doesn't have enough money for this refund. No money went back.";
    case "PAYMENT_NOT_REFUNDABLE_DUE_TO_DISPUTE":
      return "This payment has a chargeback, so Square won't refund it. No money went back. Open the chargeback in your Square Dashboard.";
    case "PAYMENT_NOT_REFUNDABLE":
      return "Square says this payment can't be refunded. No money went back. Give the money back another way, then note the refund here.";
    case "INSUFFICIENT_PERMISSIONS_FOR_REFUND":
      return "Your Square account isn't allowed to make this refund. No money went back. Check it in your Square Dashboard.";
    default:
      return "Square refused this refund. No money went back. Check the payment in your Square Dashboard.";
  }
}

/** A refund still with Square after its 14 days. */
export const CARD_REFUND_LATE_LINE = "This refund has been pending for over 14 days. Contact Square Support.";

/** What stops Refund to card on this payment, as the box says it; null where it can be sent. */
export const CARD_REFUND_BLOCKS = ["other_account", "too_old", "not_finished", "differs", "waiting", "nothing_left", "less_in_square"] as const;
export const cardRefundBlockSchema = z.enum(CARD_REFUND_BLOCKS);
export type CardRefundBlock = z.infer<typeof cardRefundBlockSchema>;

const minorSchema = z.number().int().min(0).max(99_999_999);

/** `requestKey` is made by the screen once a box: the same key twice is one refund. `terminalId`: where Square needs the card present. */
export const cardRefundRequestSchema = z
  .object({ requestKey: z.string().uuid(), amountMinor: z.number().int().min(1).max(99_999_999), reason: refundReasonSchema, terminalId: z.string().uuid().optional() })
  .strict();
export type CardRefundRequest = z.infer<typeof cardRefundRequestSchema>;

/** How a refund on the Terminal ended with no money sent. */
export const CARD_REFUND_TERMINAL_ENDS = ["cancelled_on_terminal", "timed_out", "no_answer", "cancelled"] as const;
export const cardRefundTerminalEndSchema = z.enum(CARD_REFUND_TERMINAL_ENDS);
export type CardRefundTerminalEnd = z.infer<typeof cardRefundTerminalEndSchema>;

/** A refund on the Terminal (18d-iv-c). `pickedUp`: it is on the Terminal's screen. `stopping`: Cancel was pressed.
 *  `tooLate`: the person had started, so Square would not cancel it. */
export const cardRefundTerminalViewSchema = z
  .object({ terminal: cardTerminalSchema.nullable(), pickedUp: z.boolean(), stopping: z.boolean(), tooLate: z.boolean(), ended: cardRefundTerminalEndSchema.nullable() })
  .strict();

/** Where the press ended: `pending` and `completed` are Square's own words; `checking`: Square has not answered yet, and
 *  the worker asks it again; `terminal`: it waits for the person on the Terminal; `ended`: it stopped there, no money sent; `lost`: nothing more will
 *  be asked of Square, so it is left to check there. */
export const cardRefundResponseSchema = z
  .object({
    step: z.enum(["terminal", "pending", "completed", "checking", "ended", "lost"]),
    amountMinor: minorSchema,
    currency: z.string().regex(/^[A-Z]{3}$/),
    card: cardSeenSchema.nullable(),
    pressId: z.string().uuid(),
    onTerminal: cardRefundTerminalViewSchema.nullable(),
  })
  .strict();
export type CardRefundResponse = z.infer<typeof cardRefundResponseSchema>;

/** What Square says of the payment when the box opens. `leftMinor`: the most that can go back now, by the app and by
 *  Square. `refundedInSquareMinor`: what Square gave back that the app has no note of. `onTerminal`: Square's own mark on
 *  the payment that the card must be present (`refund_requires_card_presence`), with the Terminals to choose from.
 *  `waitingPress`: the refund already waiting on a Terminal, so an opened box shows it and its Cancel. */
export const cardRefundCheckSchema = z
  .object({
    card: cardSeenSchema.nullable(),
    leftMinor: minorSchema,
    refundedInSquareMinor: minorSchema,
    block: cardRefundBlockSchema.nullable(),
    onTerminal: z.boolean(),
    terminals: z.array(cardTerminalSchema).max(50),
    waitingPress: cardRefundResponseSchema.nullable(),
  })
  .strict();
export type CardRefundCheck = z.infer<typeof cardRefundCheckSchema>;

export const cardRefundPressParamsSchema = z.object({ gymId: z.string().uuid(), pressId: z.string().uuid() }).strict();

/** The box of a refund that needs the card on the Terminal. */
export const CARD_REFUND_TERMINAL_WORDS = {
  /** "Interac card payments in Canada can only be refunded when the payment card is present" ("Refund Interac Payments"). */
  present: "This card can only be refunded on the Terminal. The person who paid must be here with it. If they can't come in, give the money back another way, then use Note a refund.",
  no_terminal: "This card can only be refunded on a Square Terminal, and none is set up here. Pair one, or give the money back another way, then use Note a refund.",
  no_terminal_staff: "This card can only be refunded on a Square Terminal, and none is set up here. Ask the owner to pair one, or give the money back another way, then use Note a refund.",
  pick: "Choose the Terminal.",
  terminal_label: "Which Terminal",
  shown: "Sending it to the Terminal",
  card: "Ask them to use the card they paid with on the Terminal",
  not_shown: "Not on the Terminal yet? Check that it is on and online.",
  too_late: "They have started on the Terminal, so it can't be cancelled. It will finish there.",
  terminal_gone: "This Terminal is no longer paired, so nothing was sent. Press again to use another Terminal.",
  not_offered: "This card can only be refunded on a Square Terminal, and none can be used here. Give the money back another way, then use Note a refund.",
  terminal_busy: "This Terminal is busy. Try again in a minute, or choose another Terminal.",
} as const;

/** How the refund on the Terminal ended, in the box. */
export function cardRefundEndedLine(ended: CardRefundTerminalEnd): string {
  switch (ended) {
    case "cancelled_on_terminal":
      return "The refund was cancelled on the Terminal. No money went back.";
    case "timed_out":
      return "The Terminal ran out of time. No money went back.";
    case "no_answer":
      return "The Terminal didn't show the refund, so it was cancelled. No money went back. Check that it is on and online, then try again.";
    case "cancelled":
      return "The refund was cancelled. No money went back.";
  }
}

/** What Refund to card says when it is done, in the place it was pressed. `cardWords`: "Visa ending 1111". */
export function cardRefundSentLine(r: CardRefundResponse, cardWords: string): string {
  const money = formatMinor(r.amountMinor, r.currency);
  if (r.step === "lost") return `We don't know whether Square took this ${money} refund. Check your Square Dashboard. If it went through, note the refund here.`;
  if (r.step === "checking") return `Square hasn't answered yet, so ${money} is not refunded yet. Don't refund it again: this page will say when Square answers.`;
  if (r.step === "completed") return `${money} was refunded to ${cardWords}. ${CARD_REFUND_WORDS.days_left}`;
  return `Square is processing this ${money} refund to ${cardWords}. ${CARD_REFUND_WORDS.days}`;
}
