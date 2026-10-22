// TAKE PAYMENT ON TERMINAL (ROADMAP 18d-vi-a; spec Part 3 §14.8; rulings/2026-10-21-money-plan.md).
//
// On a person's bill, staff holding the payments tick press Take payment on Terminal: the amount
// goes to the gym's Square Terminal, the person taps, inserts or swipes their card there, and the
// payment Square took is recorded on the bill as Card on Terminal, with its receipt. A late cancel
// or no-show fee is paid the same way (18d-vi-b-i). Nothing is
// recorded until Square says the money was taken, and a payment Square took is recorded once.
import { z } from "zod";
import { cardTerminalSchema, memberCardStateSchema } from "./memberCards.js";
import { receiptNumberSchema } from "./memberBills.js";
import { SQUARE_TERMINALS_MAX } from "./gymPayments.js";

/** Why a payment on a Terminal ended. `paid`: Square took it and it is on the bill;
 *  `cancelled_on_terminal`: the person cancelled there; `timed_out`: Square's time on the Terminal
 *  ran out; `no_answer`: the Terminal never showed it (off, or offline); `cancelled`: staff pressed
 *  Cancel; `refused`: Square refused it; `gone`: the gym's Square connection or the Terminal
 *  changed, so it could not be followed; `not_recorded`: Square took the money but the bill had
 *  changed, so it was not recorded (staff check it in Square). */
export const terminalPaymentOutcomeSchema = z.enum(["paid", "cancelled_on_terminal", "timed_out", "no_answer", "cancelled", "refused", "gone", "not_recorded"]);
export type TerminalPaymentOutcome = z.infer<typeof terminalPaymentOutcomeSchema>;

export const terminalPaymentSchema = z
  .object({
    id: z.string().uuid(),
    membershipId: z.string().uuid(),
    /** The fee it pays (18d-vi-b-i); null for a period of the membership. */
    feeBillId: z.string().uuid().nullable(),
    amountMinor: z.number().int().min(1).max(99_999_999),
    currency: z.string().regex(/^[A-Z]{3}$/),
    /** `waiting`: on its way to the Terminal or on its screen; `done`: see `outcome`. */
    step: z.enum(["waiting", "done"]),
    outcome: terminalPaymentOutcomeSchema.nullable(),
    /** The Terminal has it on its screen (Square no longer reads it as pending). */
    pickedUp: z.boolean(),
    /** Cancel was pressed and Square has not stopped it yet. */
    stopping: z.boolean(),
    /** Square refused Cancel: the person is paying on the Terminal. */
    tooLate: z.boolean(),
    /** Null once the gym has removed the Terminal. */
    terminal: cardTerminalSchema.nullable(),
    startedAt: z.string().datetime(),
    /** The payment's receipt, once it is on the bill. */
    receiptNumber: receiptNumberSchema.nullable(),
  })
  .strict();
export type TerminalPayment = z.infer<typeof terminalPaymentSchema>;

/** The Terminals a person's bill can be paid on now, and the payments waiting on one for them. */
export const terminalPaymentsResponseSchema = z
  .object({
    terminals: z.array(cardTerminalSchema).max(SQUARE_TERMINALS_MAX),
    waiting: z.array(terminalPaymentSchema).max(50),
    /** Whether the gym has set up Square, and whether this reader is its owner, who alone can
     *  connect it: the payment forms offer Connect Square while it is not set up (18x). */
    square: memberCardStateSchema.default("not_offered"),
    isOwner: z.boolean().default(false),
  })
  .strict();
export type TerminalPaymentsResponse = z.infer<typeof terminalPaymentsResponseSchema>;

/** Take payment on Terminal: the period the screen showed, and the amount. `requestKey`: the same
 *  press sent twice is one payment. */
export const terminalPaymentRequestSchema = z
  .object({
    terminalId: z.string().uuid(),
    requestKey: z.string().uuid(),
    periodIndex: z.number().int().min(0).max(100_000),
    amountMinor: z.number().int().min(1).max(99_999_999),
  })
  .strict();
export type TerminalPaymentRequest = z.infer<typeof terminalPaymentRequestSchema>;

/** Take payment on Terminal for a fee (18d-vi-b-i): all of it, the amount the screen showed. */
export const terminalFeePaymentRequestSchema = z
  .object({
    terminalId: z.string().uuid(),
    requestKey: z.string().uuid(),
    amountMinor: z.number().int().min(1).max(99_999_999),
  })
  .strict();
export type TerminalFeePaymentRequest = z.infer<typeof terminalFeePaymentRequestSchema>;

export const terminalPaymentResponseSchema = z.object({ payment: terminalPaymentSchema }).strict();
export type TerminalPaymentResponse = z.infer<typeof terminalPaymentResponseSchema>;

/** The server's refusals, as staff read them. */
export const TERMINAL_PAYMENT_WORDS = {
  terminal_gone: "This Terminal is no longer paired. Choose another, or record the payment by hand.",
  terminal_busy: "This Terminal is busy. Try again in a minute, or choose another Terminal.",
  terminal_refused: "Square couldn't send this to the Terminal. Check it's on and signed in, then try again.",
  currency: "This membership is priced in another currency from your Square account, so it can't be paid on the Terminal.",
  waiting: "A payment for this membership is waiting on the Terminal. Wait for it to finish, or cancel it first.",
  payment_gone: "This payment is no longer active.",
  disconnect_waiting: "A payment is waiting on a Square Terminal. Let it finish, or cancel it, then disconnect.",
  void_terminal: "This was paid by card on the Terminal. To give the money back, refund it in your Square Dashboard, then note the refund here.",
} as const;
