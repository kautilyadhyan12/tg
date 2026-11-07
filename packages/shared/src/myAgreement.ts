// A MEMBER SIGNS THEIR OWN MEMBERSHIP AGREEMENT IN THE APP (ROADMAP Stage 5 item 20c; 18u; spec Part 3 §14.8).
//
// Only the reader's own record (one their account alone holds) and only a membership the business asks an agreement
// for that nobody has signed: Members' "Agreement not signed" rule. A membership somebody else pays for is signed at the
// front desk, since the app never shows that member its price (16d); so is one whose record says they are under 18,
// where a parent or guardian signs. What is signed is the details and the words the screen showed, as at the desk.
import { z } from "zod";
import { agreementEmailedSchema, agreementFactsSchema, factsKeySchema } from "./membershipAgreement.js";
import { signedNameSchema, waiverToReadSchema } from "./waiver.js";
import { atDeskWhySchema } from "./myAgreementState.js";

/** What was signed, as kept: the details and the words of that day. */
export const mySignedAgreementSchema = z
  .object({ name: z.string(), at: z.string(), text: z.string(), facts: agreementFactsSchema, agreementName: z.string().nullable() })
  .strict();
export type MySignedAgreement = z.infer<typeof mySignedAgreementSchema>;

/** GET /v1/orgs/:gymId/memberships/:membershipId/agreement/mine. It names its business and membership, so a phone never
 *  shows one under another. `none`: nothing to sign (over, cancelled or frozen, or no agreement asked for). */
export const myAgreementResponseSchema = z
  .object({
    gymId: z.string().uuid(),
    membershipId: z.string().uuid(),
    gymName: z.string(),
    timezone: z.string(),
    membershipName: z.string(),
    state: z.enum(["to_sign", "signed", "at_desk", "none"]),
    /** With `at_desk`. */
    why: atDeskWhySchema.nullable(),
    /** With `to_sign`: the words to read, and the details worked out now with their key. */
    agreement: waiverToReadSchema.extend({ name: z.string().nullable() }).strict().nullable(),
    facts: agreementFactsSchema.nullable(),
    factsKey: factsKeySchema.nullable(),
    /** With `signed`. */
    signed: mySignedAgreementSchema.nullable(),
  })
  .strict();
export type MyAgreementResponse = z.infer<typeof myAgreementResponseSchema>;

export const signMyAgreementBodySchema = z.object({ agreementId: z.string().uuid(), factsKey: factsKeySchema, name: signedNameSchema }).strict();
export type SignMyAgreementBody = z.infer<typeof signMyAgreementBodySchema>;

export const signMyAgreementResponseSchema = z.object({ signed: mySignedAgreementSchema, emailed: agreementEmailedSchema }).strict();
export type SignMyAgreementResponse = z.infer<typeof signMyAgreementResponseSchema>;

export const MY_AGREEMENT_WORDS = {
  paid_by_other: "Someone else pays for this membership, so its agreement is signed at the front desk.",
  minor: "As you're under 18, a parent or guardian signs this agreement at the front desk.",
} as const;
