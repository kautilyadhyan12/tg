// WHO THE FRONT DESK LETS IN — Part 3 §12.4; ROADMAP Stage 2 item 16d.
//
// A gym chooses whom its desk checks in: everyone on its list (where every gym starts), or
// only people with a current membership; and whether somebody with an overdue payment is
// let in or sent to staff. `checkinStop` is the ONE rule that says who is stopped and why.
// The desk's scan, staff's search and the box in Settings that names who would be stopped
// all read it.
//
// It reads what the app itself holds for a person, the memberships given here and the
// bills opened here, and never a word from the gym's own file, which can be days old
// (RULINGS 2026-10-02). Pure: the gym's own day is passed in.
import { z } from "zod";
import { addDays } from "./heldMemberships.js";
import type { HeldOnList } from "./heldOnList.js";

export const checkinWhoSchema = z.enum(["everyone", "current_membership"]);
export type CheckinWho = z.infer<typeof checkinWhoSchema>;

export const checkinOverdueSchema = z.enum(["let_in", "see_staff"]);
export type CheckinOverdue = z.infer<typeof checkinOverdueSchema>;

export const checkinRulesSchema = z.object({ who: checkinWhoSchema, overdue: checkinOverdueSchema }).strict();
export type CheckinRules = z.infer<typeof checkinRulesSchema>;

/** Where every gym starts: nobody is stopped. */
export const CHECKIN_RULES_START: CheckinRules = { who: "everyone", overdue: "let_in" };

/** Whether the gym's choices can stop anybody at all. */
export const checkinRulesStopAnyone = (rules: CheckinRules): boolean => rules.who !== "everyone" || rules.overdue !== "let_in";

/** Why the desk sends somebody to staff. Staff are told; the desk's screen never is. */
export const checkinStopReasonSchema = z.enum(["no_membership", "not_started", "frozen", "ended", "cancelled", "overdue"]);
export type CheckinStopReason = z.infer<typeof checkinStopReasonSchema>;

export const CHECKIN_STOP_WORDS: Readonly<Record<CheckinStopReason, string>> = {
  no_membership: "No membership",
  not_started: "Membership not started",
  frozen: "Membership frozen",
  ended: "Membership ended",
  cancelled: "Membership cancelled",
  overdue: "Payment overdue",
};

export interface CheckinStopInput {
  rules: CheckinRules;
  /** The gym's owner or one of its staff: never stopped. */
  staff: boolean;
  /** What the Members list says the person holds here (`heldOnList`); null where the app
   *  holds nothing for them. */
  held: Pick<HeldOnList, "status"> | null;
  /** The day their oldest bill still open fell due, where one has; null otherwise. */
  owedSince: string | null;
  /** The gym's own day. */
  today: string;
  /** Days after its due date an unpaid bill reads Overdue (the gym's own number). */
  overdueAfterDays: number;
}

/** Why the desk sends this person to staff, or null where it lets them in.
 *
 *  A current membership is one that is running today: not one frozen, still to start,
 *  ended or cancelled, and not a membership word on the gym's file. A payment is overdue
 *  as a bill reads Overdue on the person's page (`memberBillState`): a bill still open,
 *  and the gym's own days of grace passed since it fell due. A payment that is due and
 *  not yet overdue stops nobody. */
export function checkinStop(input: CheckinStopInput): CheckinStopReason | null {
  if (input.staff) return null;
  if (input.rules.who === "current_membership") {
    const status = input.held?.status ?? null;
    if (status === null) return "no_membership";
    if (status === "upcoming") return "not_started";
    if (status !== "active") return status;
  }
  if (input.rules.overdue === "see_staff" && input.owedSince !== null && input.today > addDays(input.owedSince, input.overdueAfterDays)) {
    return "overdue";
  }
  return null;
}

// ── THE BOX IN SETTINGS (`org.manage`) ──

/** How many of the people who would be stopped the box is sent by name. */
export const CHECKIN_RULES_PREVIEW_NAMES = 500;

export const checkinRulesResponseSchema = z
  .object({
    rules: checkinRulesSchema,
    /** The gym's days of grace before a bill reads Overdue, for the box's own sentence. */
    overdueAfterDays: z.number().int().min(0),
  })
  .strict();
export type CheckinRulesResponse = z.infer<typeof checkinRulesResponseSchema>;

export const checkinRulesPreviewQuerySchema = checkinRulesSchema;

/** Who the desk would send to staff today under the choices asked, before they are saved. */
export const checkinRulesPreviewResponseSchema = z
  .object({
    rules: checkinRulesSchema,
    /** The people on the gym's list today, its own staff left out. */
    listed: z.number().int().min(0),
    stopped: z.number().int().min(0),
    /** The first of them by name, each with why. */
    people: z
      .array(z.object({ entryId: z.string().uuid(), name: z.string(), reason: checkinStopReasonSchema }).strict())
      .max(CHECKIN_RULES_PREVIEW_NAMES),
  })
  .strict();
export type CheckinRulesPreviewResponse = z.infer<typeof checkinRulesPreviewResponseSchema>;
