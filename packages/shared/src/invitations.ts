// Joining a gym by invitation (Part 3 §10.2; ROADMAP 3b-ii-a): what is waiting for the
// signed-in person's own proved address, Join (the one tap) and No thanks.
import { z } from "zod";
import { meteredWindowSchema, type MeteredWindow } from "./entitlements.js";
import { orgTypeSchema } from "./orgs.js";
import { orgWords } from "./orgWords.js";

const planMeterSchema = z.object({ limit: z.number().int().nonnegative(), window: meteredWindowSchema }).strict();

/** One thing a person's own plan gives that the gym's does not (RULINGS 2026-09-23,
 *  gap D, as 3b-ii-b's plan settled it: the Join screen says what the gym now gives
 *  and what the person's own plan still adds, never a flat "the gym covers it"). */
export const ownPlanExtraSchema = z.discriminatedUnion("feature", [
  z.object({ feature: z.literal("meal_scan"), own: planMeterSchema, gym: planMeterSchema }).strict(),
  z.object({ feature: z.literal("route_gen"), own: planMeterSchema, gym: planMeterSchema }).strict(),
  /** `ownDays` null: all of it. */
  z.object({ feature: z.literal("history"), ownDays: z.number().int().positive().nullable(), gymDays: z.number().int().nonnegative() }).strict(),
  z.object({ feature: z.literal("all_exercises") }).strict(),
  z.object({ feature: z.literal("all_programs") }).strict(),
  z.object({ feature: z.literal("global_leaderboards") }).strict(),
  z.object({ feature: z.literal("no_watermark") }).strict(),
]);
export type OwnPlanExtra = z.infer<typeof ownPlanExtraSchema>;

/** The person pays for a plan of their own: what it still adds over this gym's, and
 *  where it is cancelled (only the person can: an App Store or Google Play plan is
 *  theirs, a web one was bought by them). */
export const yourPlanSchema = z
  .object({
    extras: z.array(ownPlanExtraSchema),
    cancelAt: z.enum(["app_store", "where_bought"]),
  })
  .strict();
export type YourPlan = z.infer<typeof yourPlanSchema>;

const meterWords = (meter: { limit: number; window: MeteredWindow }): string => `${String(meter.limit)} a ${meter.window}`;

/** The words for one extra: "20 meal scans a day instead of 7". */
export function ownPlanExtraWords(extra: OwnPlanExtra): string {
  switch (extra.feature) {
    case "meal_scan":
    case "route_gen": {
      const noun = `${extra.feature === "meal_scan" ? "meal scan" : "route plan"}${extra.own.limit === 1 ? "" : "s"}`;
      const gym = extra.own.window === extra.gym.window ? String(extra.gym.limit) : meterWords(extra.gym);
      return `${String(extra.own.limit)} ${noun} a ${extra.own.window} instead of ${gym}`;
    }
    case "history":
      return extra.ownDays === null
        ? `all of your history instead of the last ${String(extra.gymDays)} days`
        : `the last ${String(extra.ownDays)} days of history instead of ${String(extra.gymDays)}`;
    case "all_exercises":
      return "every exercise";
    case "all_programs":
      return "every programme";
    case "global_leaderboards":
      return "the worldwide leaderboards";
    case "no_watermark":
      return "sharing without the watermark";
  }
}

/** What the Join screen tells a person who pays for their own plan. */
export function yourPlanWords(gymName: string, plan: YourPlan): { lead: string; cancel: string } {
  const where =
    plan.cancelAt === "app_store"
      ? "in your phone's App Store or Google Play subscriptions"
      : "where you bought it";
  if (plan.extras.length === 0) {
    return {
      lead: `You pay for your own plan. Once you join, ${gymName} gives you everything your own plan does.`,
      cancel: `If you no longer need it, only you can cancel it, ${where}.`,
    };
  }
  const extras = plan.extras.map(ownPlanExtraWords);
  const listed = extras.length === 1 ? (extras[0] ?? "") : `${extras.slice(0, -1).join(", ")} and ${extras[extras.length - 1] ?? ""}`;
  return {
    lead: `You pay for your own plan. Once you join, ${gymName} gives you the app's features, and your own plan still adds ${listed}.`,
    cancel: `If you don't need that, only you can cancel it, ${where}.`,
  };
}

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
    /** The person said this invitation is not theirs ("Not me"). */
    notMe: z.boolean().default(false),
    /** Null unless the person pays for a plan of their own and the gym can take them. */
    yourPlan: yourPlanSchema.nullable().default(null),
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

/** "Not me": declined, and the gym told its address reached the wrong person. */
export const notMeInvitationResponseSchema = z.object({ state: z.literal("declined"), notMe: z.literal(true) }).strict();
export type NotMeInvitationResponse = z.infer<typeof notMeInvitationResponseSchema>;

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
  /** On the card after "Not me". */
  said_not_me: (gymName: string): string => `You told ${gymName} this invitation isn't for you. They'll check the address they have.`,
} as const;
