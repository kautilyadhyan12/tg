// A MEMBERSHIP'S AGREEMENT AS MY MEMBERSHIP AND THE GYM TAB'S CARD SAY IT (ROADMAP Stage 5 item 20c). Only zod: the
// places read (`orgs.ts`) and My membership (`myMembership.ts`) import it, and `myAgreement.ts` pulls in the agreement's
// details, whose imports lead back to My membership.
import { z } from "zod";

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
    /** With `at_desk`: why, so the member knows who signs it there. */
    why: atDeskWhySchema.nullable().default(null),
  })
  .strict();
export type MyMembershipAgreement = z.infer<typeof myMembershipAgreementSchema>;

/** A membership of the caller's whose agreement they may sign in the app now, on the Gym tab's card. */
export const myAgreementToSignSchema = z.object({ membershipId: z.uuid(), name: z.string() }).strict();
export type MyAgreementToSign = z.infer<typeof myAgreementToSignSchema>;
export const MY_AGREEMENTS_TO_SIGN_MAX = 10;
