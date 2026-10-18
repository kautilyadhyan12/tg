// Co-owners (ROADMAP Stage 2 item 4b-i; rulings/2026-10-16-4b-i.md). The gym's owner asks
// one of its staff to be a co-owner; the person asked accepts or declines. A co-owner can
// do everything in the console except add, change or remove co-owners, which stays with the
// owner, who pays and is never changed or removed by a co-owner.
import { z } from "zod";
import { payerEmailSchema, paddleTransactionIdSchema } from "./billing.js";

/** How long a request waits for an answer. */
export const CO_OWNER_REQUEST_DAYS = 7;

/** The two routes the owner uses address a person on the Staff tab by their user id. */
export const coOwnerStaffParamsSchema = z.object({ gymId: z.string().uuid(), userId: z.string().uuid() }).strict();

/** The person asked answers the one request they were shown. */
export const coOwnerRequestParamsSchema = z.object({ gymId: z.string().uuid(), requestId: z.string().uuid() }).strict();

/** Send request: the request, and whether its email went. */
export const sendCoOwnerRequestResponseSchema = z.object({
  request: z.object({ userId: z.string().uuid(), expiresAt: z.string().datetime() }),
  /** False when the email could not be sent: the request still waits on their Overview. */
  emailed: z.boolean(),
});
export type SendCoOwnerRequestResponse = z.infer<typeof sendCoOwnerRequestResponseSchema>;

export const cancelCoOwnerRequestResponseSchema = z.object({ status: z.literal("cancelled") });
export type CancelCoOwnerRequestResponse = z.infer<typeof cancelCoOwnerRequestResponseSchema>;

/** The caller's own request waiting at this gym, for its Overview, or null. */
export const myCoOwnerRequestResponseSchema = z.object({
  request: z
    .object({
      id: z.string().uuid(),
      /** The owner who asked, by the name they go by; empty when they have none. */
      ownerName: z.string(),
      expiresAt: z.string().datetime(),
    })
    .nullable(),
});
export type MyCoOwnerRequestResponse = z.infer<typeof myCoOwnerRequestResponseSchema>;

export const answerCoOwnerRequestResponseSchema = z.object({ status: z.enum(["accepted", "declined"]) });
export type AnswerCoOwnerRequestResponse = z.infer<typeof answerCoOwnerRequestResponseSchema>;

/** What the server says when it refuses, in the words the console shows. */
export const CO_OWNER_WORDS = {
  owner_only: "Only the owner can add, change or remove co-owners.",
  not_staff: "That person isn't on your staff any more.",
  already_owner: "That person is already an owner here.",
  already_requested: "You've already asked them. The request is waiting for their answer.",
  no_request: "There's no request waiting for them.",
  request_gone: "This request has ended. Ask the owner to send it again if you still want to be a co-owner.",
  owner_row_locked: "Only the owner can change or remove a co-owner.",
  owner_keeps_owner: "The owner stays the owner and can't be changed or removed here.",
} as const;

// ── The owner hands the gym to a co-owner (ROADMAP 4b-ii; rulings/2026-10-17-4b-ii.md) ──
// The owner asks one of the gym's co-owners to be its owner; the person asked accepts or
// declines. On Accept they are the owner and the old owner stays a co-owner. The free trial
// stays counted against whoever started it.
//
// A gym paying through Paddle (4b-iii-a): Accept opens Paddle's card window for the person
// asked, and the gym is theirs once their card is saved; from then they pay and the old owner
// is not charged again. A plan paid through Razorpay is not handed over yet (4b-iii-b).

/** How long a request to be the owner waits for an answer. */
export const OWNER_REQUEST_DAYS = 7;

/** Send request: the request, and whether its email went. */
export const sendOwnerRequestResponseSchema = z.object({
  request: z.object({ userId: z.string().uuid(), expiresAt: z.string().datetime() }),
  /** False when the email could not be sent: the request still waits on their Overview. */
  emailed: z.boolean(),
});
export type SendOwnerRequestResponse = z.infer<typeof sendOwnerRequestResponseSchema>;

export const cancelOwnerRequestResponseSchema = z.object({ status: z.literal("cancelled") });
export type CancelOwnerRequestResponse = z.infer<typeof cancelOwnerRequestResponseSchema>;

/** The caller's own request to be the owner of this gym, for its Overview, or null. */
export const myOwnerRequestResponseSchema = z.object({
  request: z
    .object({
      id: z.string().uuid(),
      /** The owner who asked, by the name they go by; empty when they have none. */
      ownerName: z.string(),
      expiresAt: z.string().datetime(),
      /** The gym pays through Paddle: Accept opens a card window, and they pay from then on. */
      cardNeeded: z.boolean().optional(),
    })
    .nullable(),
});
export type MyOwnerRequestResponse = z.infer<typeof myOwnerRequestResponseSchema>;

/** Paddle's card window for the person accepting: it saves their card on the gym's plan. */
export const ownerCardWindowSchema = z.object({
  environment: z.enum(["sandbox", "production"]),
  clientToken: z.string().min(1).max(200),
  transactionId: paddleTransactionIdSchema,
  /** Their own email, which the window is already filled in with. */
  email: payerEmailSchema,
});
export type OwnerCardWindow = z.infer<typeof ownerCardWindowSchema>;

/** Accept or Decline. `card_needed`: the gym pays through Paddle, so nothing has moved yet;
 *  the window saves their card, and then the gym is theirs. */
export const answerOwnerRequestResponseSchema = z.union([
  z.object({ status: z.enum(["accepted", "declined"]) }),
  z.object({ status: z.literal("card_needed"), card: ownerCardWindowSchema }),
]);
export type AnswerOwnerRequestResponse = z.infer<typeof answerOwnerRequestResponseSchema>;

/** After Paddle's window says the card was saved: `accepted` once the gym is theirs, `waiting`
 *  while Paddle has not confirmed it yet (ask again in a moment). After it closed without a card:
 *  `closed` (Paddle refuses that window from now on), or `accepted` if a card was saved after all. */
export const ownerCardResponseSchema = z.object({ status: z.enum(["accepted", "waiting", "closed"]) });

/** How long a card window stays pointed at the person accepting: past it, the worker points it
 *  back at the plan's payer and they press Accept again. Paddle keeps one window a plan, which
 *  a Paddle page the old owner opened earlier might use: open only while it is in use. */
export const OWNER_CARD_WINDOW_MINUTES = 30;
export type OwnerCardResponse = z.infer<typeof ownerCardResponseSchema>;

/** What the server says when it refuses a hand-over, in the words the console shows. */
export const OWNER_REQUEST_WORDS = {
  owner_only: "Only the owner can choose a new owner.",
  not_staff: "That person isn't on your staff any more.",
  not_co_owner: "Only a co-owner can be made the owner. Make them a co-owner first.",
  paid_plan: "While a plan paid through Razorpay is running, the owner can't be changed yet.",
  plan_overdue: "A payment is overdue, so the owner can't be changed until it's paid.",
  plan_ending: "The plan is set to end, so the owner can't be changed. Keep the plan first, or wait until it ends.",
  card_unavailable: "Paying online isn't available right now, so the owner can't be changed. Please try again later.",
  email_unusable: "Paddle can't use the email address on your account, so your card can't be added here.",
  adding_card: "This co-owner is adding their card to become the owner. Cancel that request first.",
  card_saved: "They've already added their card, so they're the owner now.",
  payer_moving: "The plan is moving to the new owner. Please try again in a minute.",
  already_requested: "You've already asked someone to be the owner. Cancel that request to ask someone else.",
  no_request: "There's no request waiting.",
  request_gone: "This request has ended. Ask the owner to send it again if you still want to be the owner.",
} as const;
