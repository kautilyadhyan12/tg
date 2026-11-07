// A MEMBER SIGNS THEIR OWN MEMBERSHIP AGREEMENT IN THE APP (ROADMAP Stage 5 item 20c; 18u; spec Part 3 §14.8).
//
// Only the reader's own record (one their account alone holds) and only a membership the business asks an agreement
// for that nobody has signed: Members' "Agreement not signed" rule. A membership somebody else pays for is signed at the
// front desk, since the app never shows that member its price (16d); so is one whose record says they are under 18,
// where a parent or guardian signs. What is signed is the details and the words the screen showed, as at the desk.
import { z } from "zod";
import { agreementEmailedSchema, agreementFactsSchema, factsKeySchema } from "./membershipAgreement.js";
import { signedNameSchema, waiverToReadSchema } from "./waiver.js";

const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Why a membership's agreement is signed at the front desk and not in the app. */
export const atDeskWhySchema = z.enum(["paid_by_other", "minor"]);
export type AtDeskWhy = z.infer<typeof atDeskWhySchema>;

/** A membership's agreement on My membership: to sign in the app, signed, or to sign at the front desk. `view`: what
 *  was signed may be opened in the app (not where somebody else pays: it holds the price). */
export const myMembershipAgreementSchema = z
  .object({
    state: z.enum(["to_sign", "signed", "at_desk"]),
    signedOn: daySchema.nullable(),
    signedName: z.string().nullable(),
    view: z.boolean(),
  })
  .strict();
export type MyMembershipAgreement = z.infer<typeof myMembershipAgreementSchema>;

/** A membership of the caller's whose agreement they may sign in the app now, on the Gym tab's card. */
export const myAgreementToSignSchema = z.object({ membershipId: z.string().uuid(), name: z.string() }).strict();
export type MyAgreementToSign = z.infer<typeof myAgreementToSignSchema>;
export const MY_AGREEMENTS_TO_SIGN_MAX = 10;

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
  shared: "Your membership agreement is signed at the front desk.",
} as const;
