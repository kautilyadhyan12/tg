// Co-owners (ROADMAP Stage 2 item 4b-i; rulings/2026-10-16-4b-i.md). The gym's owner asks
// one of its staff to be a co-owner; the person asked accepts or declines. A co-owner can
// do everything in the console except add, change or remove co-owners, which stays with the
// owner, who pays and is never changed or removed by a co-owner.
import { z } from "zod";

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
// A gym paying through Paddle (4b-iii-a; Kd 2026-10-18) or Razorpay (4b-iii-b): Accept hands it
// over at once, and the old owner's plan stops renewing. It stays paid to the end of its month;
// then the new owner chooses their own plan and pays in their own name. A plan with money owed
// is not handed over yet.

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
      /** The gym's plan, paid by the owner, stops renewing on Accept: until when it is paid, and
       *  whether it is a paid trial; then the new owner chooses their own (4b-iii-a). Null with
       *  no such plan, or one already handed over to the owner by somebody else. */
      planStops: z
        .object({
          /** When the paid month ends; null when the payment company gives no date. */
          until: z.string().datetime().nullable(),
          /** A paid trial made before 2026-09-30: it ends with its trial, nothing charged. */
          trial: z.boolean(),
        })
        .nullable()
        .optional(),
      /** The gym's Square account, the old owner's, is disconnected on Accept (Kd, 2026-10-20). */
      squareConnected: z.boolean().optional(),
    })
    .nullable(),
});
export type MyOwnerRequestResponse = z.infer<typeof myOwnerRequestResponseSchema>;

export const answerOwnerRequestResponseSchema = z.object({ status: z.enum(["accepted", "declined"]) });
export type AnswerOwnerRequestResponse = z.infer<typeof answerOwnerRequestResponseSchema>;

/** What the server says when it refuses a hand-over, in the words the console shows. */
export const OWNER_REQUEST_WORDS = {
  owner_only: "Only the owner can choose a new owner.",
  not_staff: "That person isn't on your staff any more.",
  not_co_owner: "Only a co-owner can be made the owner. Make them a co-owner first.",
  plan_overdue: "A payment is overdue, so the owner can't be changed until it's paid.",
  plan_unclear: "This plan can't be handed over right now. Please write to support.",
  plan_renewing: "The plan is renewing, so the owner can't be changed right now. Please try again in an hour.",
  plan_changing: "The plan's size is being changed, so the owner can't be changed right now. Please try again in a minute.",
  handed_over_plan: "This plan was paid by the last owner and stops when its paid month ends, so it can't be managed here. Choose your own plan when it ends.",
  handed_over_plan_payer: "You handed over ownership, so this plan stops when its paid month ends and can't be managed here. The new owner chooses the next plan.",
  already_requested: "You've already asked someone to be the owner. Cancel that request to ask someone else.",
  no_request: "There's no request waiting.",
  request_gone: "This request has ended. Ask the owner to send it again if you still want to be the owner.",
} as const;

/** The owner's Cancel, pressed after the person had already accepted: the gym is theirs. */
export function ownerRequestAcceptedWords(name: string): string {
  const who = name.trim();
  return who === "" ? "They've already accepted, so they're the owner now." : `${who} has already accepted, so they're the owner now.`;
}
