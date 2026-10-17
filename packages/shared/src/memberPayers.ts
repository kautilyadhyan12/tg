// FAMILY PLANS: ONE PERSON PAYS FOR OTHERS (spec Part 3 §14.2; ROADMAP 18i).
//
// A record on a gym's list can name another record on the same list as the one who pays
// for it, as Mindbody's "Pays for" and PushPress's sub-accounts do. Each person keeps their
// own memberships, bills, bookings and pass; the payer is who staff take the money from,
// who a receipt names, and who is told in the app that a payment is overdue. One level
// only: somebody who is paid for pays for nobody, and a payer is paid for by nobody.
import { z } from "zod";

/** The most people one record pays for: a family, never a list. */
export const PAYS_FOR_MAX = 10;

/** A record as the box names it. `past`: off the gym's list (a past member). */
export const memberPayerPersonSchema = z
  .object({
    entryId: z.string().uuid(),
    name: z.string(),
    past: z.boolean(),
  })
  .strict();
export type MemberPayerPerson = z.infer<typeof memberPayerPersonSchema>;

/** One record's side of it: who pays for them, and whom they pay for (one of the two is
 *  always empty). `canChange`: the reader holds `billing.members` on a gym that can be
 *  changed. */
export const memberPayersResponseSchema = z
  .object({
    paidBy: memberPayerPersonSchema.nullable(),
    paysFor: z.array(memberPayerPersonSchema).max(PAYS_FOR_MAX),
    canChange: z.boolean(),
  })
  .strict();
export type MemberPayersResponse = z.infer<typeof memberPayersResponseSchema>;

/** Name the record that pays for this one; it replaces any payer they had. */
export const setMemberPayerRequestSchema = z.object({ payerEntryId: z.string().uuid() }).strict();
export type SetMemberPayerRequest = z.infer<typeof setMemberPayerRequestSchema>;

export const MEMBER_PAYER_WORDS = {
  payer_self: "A person can't pay for themselves.",
  payer_not_found: "That person isn't on your list any more.",
  payer_is_paid_for: "Somebody else pays for that person, so they can't pay for others too.",
  pays_for_others: "This person pays for others, so they pay their own bills too.",
  pays_for_full: `That person already pays for ${String(PAYS_FOR_MAX)} people, the most one person can.`,
  merge_two_payers: "Both records have somebody who pays for them. Remove one of the two, then merge.",
  merge_payer_and_paid_for: "One record pays for others and the other is paid for. Remove one of the two, then merge.",
} as const;
