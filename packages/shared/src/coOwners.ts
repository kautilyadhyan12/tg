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
