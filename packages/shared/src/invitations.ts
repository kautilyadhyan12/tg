// Joining a gym by invitation (Part 3 §10.2; ROADMAP 3b-ii-a): what is waiting for the
// signed-in person's own proved address, Join (the one tap) and No thanks.
import { z } from "zod";
import { orgTypeSchema } from "./orgs.js";
import { orgWords } from "./orgWords.js";

/** One invitation the signed-in person may answer. A declined one stays listed, with
 *  Join, while the person is still on the gym's list (RULINGS 2026-09-23). */
export const myInvitationSchema = z
  .object({
    id: z.string().uuid(),
    state: z.enum(["pending", "declined"]),
    gym: z
      .object({
        id: z.string().uuid(),
        name: z.string(),
        city: z.string().nullable(),
        orgType: orgTypeSchema,
      })
      .strict(),
    /** False while the gym has no live plan: Join would be refused, so the screen says
     *  so before the tap. */
    canTakeMembers: z.boolean(),
  })
  .strict();
export type MyInvitation = z.infer<typeof myInvitationSchema>;

export const myInvitationsResponseSchema = z
  .object({
    /** The address the invitations were looked up by: the account's own. */
    address: z.string(),
    /** False when this sign-in has not proved the address (an older session, or a
     *  password account nobody proved): nothing is looked up, and the screen asks the
     *  person to sign in again with a code. */
    addressProved: z.boolean(),
    invitations: z.array(myInvitationSchema),
  })
  .strict();
export type MyInvitationsResponse = z.infer<typeof myInvitationsResponseSchema>;

export const invitationParamsSchema = z.object({ invitationId: z.string().uuid() }).strict();

export const acceptInvitationResponseSchema = z
  .object({
    outcome: z.enum(["joined", "already_member"]),
    gym: z
      .object({
        id: z.string().uuid(),
        slug: z.string(),
        name: z.string(),
        orgType: orgTypeSchema,
      })
      .strict(),
  })
  .strict();
export type AcceptInvitationResponse = z.infer<typeof acceptInvitationResponseSchema>;

export const declineInvitationResponseSchema = z.object({ state: z.literal("declined") }).strict();
export type DeclineInvitationResponse = z.infer<typeof declineInvitationResponseSchema>;

/** Why Join or No thanks was refused. */
export type InvitationRefusal = "no_invitation" | "address_not_proved" | "gym_full" | "gym_not_taking_members" | "already_member";

/** The sentences a refusal is answered with. None says anything about another address
 *  or why a gym cannot take members (a stranger must not learn which gyms stopped
 *  paying). */
export const INVITATION_WORDS = {
  no_invitation: (address: string): string =>
    `No invitation for ${address}. Your gym invites the email address it has for you — sign in with that one, or ask the front desk to add this one.`,
  address_not_proved: (address: string): string => `To see your invitations, sign in again with a code sent to ${address}.`,
  gym_full: (gymName: string): string => `${gymName} has no free places right now — tell the front desk.`,
  gym_not_taking_members: (gymName: string, orgType: unknown): string =>
    `${gymName} can't take new ${orgWords(orgType).people} in the app right now — tell the front desk.`,
  already_member: (gymName: string, orgType: unknown): string => `You're already a ${orgWords(orgType).person} of ${gymName}.`,
} as const;
