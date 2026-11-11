// A MEMBERSHIP CANCELLED IN THE APP, AS STAFF READ IT (ROADMAP 18l; Kd, rulings/2026-11-11-18l.md): its line on the
// person's page and Overview's Cancelled in the app. Apart from `myCancel.ts`, which reads `heldMemberships.ts`, so
// `heldMemberships.ts` can hold the line without the two files importing each other.
import { z } from "zod";
import type { CancelWhen } from "./heldMemberships.js";
import { dayWords } from "./paymentsDownload.js";

const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** The ways a member may cancel in the app. Never a release: that is the front desk's. */
export const MY_CANCEL_WHENS = ["cooling_off", "period_end", "today", "notice", "contract_end", "leave_early"] as const satisfies readonly CancelWhen[];
export const myCancelWhenSchema = z.enum(MY_CANCEL_WHENS);
export type MyCancelWhen = z.infer<typeof myCancelWhenSchema>;

/** Why they are leaving: asked once the cancel is done, never before it, and never a must. A fixed list, so no typed word
 *  is kept; no health reason is asked. */
export const MY_CANCEL_REASONS = ["moving", "cost", "not_using", "other_gym", "service", "other"] as const;
export const myCancelReasonSchema = z.enum(MY_CANCEL_REASONS);
export type MyCancelReason = z.infer<typeof myCancelReasonSchema>;
export const MY_CANCEL_REASON_WORDS: Readonly<Record<MyCancelReason, string>> = {
  moving: "Moving away",
  cost: "Cost",
  not_using: "Not using it enough",
  other_gym: "Joining another place",
  service: "Not happy with the service",
  other: "Other reason",
};

/** A membership cancelled in the app, on the person's page: the gym's day, whoever pressed it (their record's name on
 *  the gym's list now; null where it is gone) and the reason they picked. */
export const appCancelSchema = z.object({ on: daySchema, byName: z.string().min(1).nullable(), reason: myCancelReasonSchema.nullable() }).strict();
export type AppCancel = z.infer<typeof appCancelSchema>;

/** "Cancelled in the app on 11 Nov 2026 by Maya Test · Reason: Cost". */
export function appCancelLine(c: AppCancel): string {
  const by = c.byName === null ? "" : ` by ${c.byName}`;
  const why = c.reason === null ? "" : ` · Reason: ${MY_CANCEL_REASON_WORDS[c.reason]}`;
  return `Cancelled in the app on ${dayWords(c.on)}${by}${why}`;
}

/** Overview's Cancelled in the app: the newest first, from the last `APP_CANCELS_DAYS` days. */
export const APP_CANCELS_DAYS = 30;
export const APP_CANCELS_SHOWN = 50;

export const appCancelRowSchema = z
  .object({
    id: z.uuid(),
    /** The record it is on; null once that record was deleted for good. */
    entryId: z.uuid().nullable(),
    name: z.string().nullable(),
    past: z.boolean(),
    membershipName: z.string(),
    on: daySchema,
    endsOn: daySchema,
    when: myCancelWhenSchema,
    reason: myCancelReasonSchema.nullable(),
  })
  .strict();
export type AppCancelRow = z.infer<typeof appCancelRowSchema>;

export const appCancelsResponseSchema = z
  .object({
    rows: z.array(appCancelRowSchema).max(APP_CANCELS_SHOWN),
    /** How many there are in those days, the rows among them. */
    count: z.number().int().min(0),
    /** The front desk lets in everyone on the gym's list (16d, where every gym starts), so somebody whose membership
     *  ended can still check in: the card says so, with the way to change it. */
    letsEveryoneIn: z.boolean(),
  })
  .strict();
export type AppCancelsResponse = z.infer<typeof appCancelsResponseSchema>;

/** One row's second line: "Gold Monthly · Cancelled 11 Nov 2026 · Ends 30 Nov 2026". */
export function appCancelRowWhat(row: Pick<AppCancelRow, "membershipName" | "on" | "endsOn" | "when">): string {
  const ends = row.when === "cooling_off" ? "Ended in its cooling-off period" : row.endsOn <= row.on ? "Ended that day" : `Ends ${dayWords(row.endsOn)}`;
  return `${row.membershipName} · Cancelled ${dayWords(row.on)} · ${ends}`;
}

export const APP_CANCELS_WORDS = {
  title: "Cancelled in the app",
  intro: `Members who cancelled in the app in the last ${String(APP_CANCELS_DAYS)} days. Each ends on the day shown.`,
  open: "Open their page",
  gone: "Deleted for good",
  /** Under the list, at a gym whose front desk lets everyone on its list in. */
  everyoneIn: "Your front desk lets in everyone on your list, so members who cancelled can still check in after their membership ends.",
  everyoneInButton: "Change who can check in",
  everyoneInAsk: "The owner can change who your front desk lets in.",
} as const;
