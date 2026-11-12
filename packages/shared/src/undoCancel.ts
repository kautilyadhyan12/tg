// UNDO CANCELLATION, FOR STAFF (ROADMAP 18l-ii-b; Kd, rulings/2026-11-11-18l.md; spec Part 3 §14.8, "Cancelling").
//
// A membership the front desk cancelled to end on a later day is put back as it was before, until that day: staff
// stopped the charges, so staff may start them again. Never a membership cancelled in the app: the member stopped
// those charges, so only the member starts them again (Keep my membership, 18l-ii-a). The box's sentences are written
// here, so the box and its tests never say two things. Pure.
import { z } from "zod";
import { cardName } from "./memberCards.js";
import { myCancelPaymentSchema, type MyCancelPayment } from "./myCancel.js";
import { formatMinor } from "./memberships.js";
import { dayWords } from "./paymentsDownload.js";

const minorSchema = z.number().int().min(0).max(99_999_999);
const markSchema = z.string().regex(/^[0-9a-f]{64}$/);

export const UNDO_CANCEL_BUTTON = "Undo cancellation";

export const undoCancelChoiceSchema = z
  .object({
    button: z.string().min(1),
    /** The box's sentences, in the order they are read. */
    lines: z.array(z.string().min(1)).max(6),
    /** The next payment once it renews again, as its bill will open; null where none comes due (a free one). */
    next: myCancelPaymentSchema.nullable(),
    /** Leaving early: the early cancellation fee taken off, not paid yet. */
    feeOffMinor: minorSchema.nullable(),
    /** One value for exactly what the box says, sent back with the press: refused where it changed. */
    key: markSchema,
  })
  .strict();
export type UndoCancelChoice = z.infer<typeof undoCancelChoiceSchema>;

/** The box under Undo cancellation. Null `choice` with a note says why it can't be undone. */
export const undoCancelAskSchema = z
  .object({
    membership: z.object({ id: z.uuid(), name: z.string() }).strict(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    question: z.string().min(1),
    choice: undoCancelChoiceSchema.nullable(),
    notes: z.array(z.string().min(1)).max(4),
  })
  .strict();
export type UndoCancelAsk = z.infer<typeof undoCancelAskSchema>;

export const undoCancelRequestSchema = z
  .object({
    /** The same press sent twice is one undo. */
    requestKey: z.uuid(),
    key: markSchema,
  })
  .strict();
export type UndoCancelRequest = z.infer<typeof undoCancelRequestSchema>;

/** What the box's sentences are made from, worked out by the server. */
export interface UndoCancelFacts {
  /** The person's name on the gym's list. */
  name: string;
  membershipName: string;
  currency: string;
  next: MyCancelPayment | null;
  /** The card the app charges the next payment to by itself, where it does. */
  card: { brand: string; last4: string } | null;
  feeOffMinor: number | null;
  /** The bookings the cancel ended: they stay cancelled. */
  ended: { classes: number; sessions: number };
}

const plural = (n: number, one: string, many: string): string => `${String(n)} ${n === 1 ? one : many}`;

/** "Undo the cancellation of Maya Test's Off-peak Monthly?" */
export function undoCancelQuestion(name: string, membershipName: string): string {
  return `Undo the cancellation of ${name}'s ${membershipName}?`;
}

/** THE BOX'S SENTENCES. */
export function undoCancelLines(f: UndoCancelFacts): string[] {
  const lines = ["It will keep renewing until it's cancelled again."];
  const card = f.card === null ? null : cardName(f.card);
  if (f.next === null) lines.push("There's nothing to pay for it.");
  else if (card !== null) lines.push(`Their next payment of ${formatMinor(f.next.amountMinor, f.currency)} will be charged to ${card} on ${dayWords(f.next.dueOn)}.`);
  else lines.push(`Their next payment is ${formatMinor(f.next.amountMinor, f.currency)} on ${dayWords(f.next.dueOn)}.`);
  if (f.feeOffMinor !== null && f.feeOffMinor > 0) lines.push(`The ${formatMinor(f.feeOffMinor, f.currency)} early cancellation fee will be removed from their bills.`);
  const parts = [
    f.ended.classes > 0 ? plural(f.ended.classes, "class booking", "class bookings") : null,
    f.ended.sessions > 0 ? plural(f.ended.sessions, "personal training session", "personal training sessions") : null,
  ].filter((p): p is string => p !== null);
  if (parts.length > 0) {
    const many = f.ended.classes + f.ended.sessions > 1;
    lines.push(`The ${parts.join(" and ")} cancelled with it ${many ? "aren't" : "isn't"} booked again.`);
  }
  return lines;
}

/** Said in the box's place once it is done. */
export function undoCancelDoneLine(membershipName: string): string {
  return `${membershipName} is reactivated and will keep renewing.`;
}

export const UNDO_CANCEL_WORDS = {
  dismiss: "Keep it cancelled",
  changed: "Something about this membership has changed. Close this and try again.",
  requestReused: "That undo was already used for another membership. Close this and try again.",
  /** Cancelled in the app: on the person's page beside its line, and the box's note. */
  inApp: "It can be undone only in the app.",
  frozen: "It's frozen. Unfreeze it first, then undo the cancellation.",
  feePaid: "The early cancellation fee is paid. Refund it first, then undo the cancellation.",
  over: "This membership has ended, so the cancellation can't be undone. Add a membership again instead.",
  /** Undone meanwhile (another member of staff, another tab): it renews, with nothing cancelled. */
  notCancelled: "It isn't cancelled any more, so there's nothing to undo.",
  /** Set to end by a cancel this page never kept: one made at the front desk before 18l-ii-b. */
  cantUndo: "This cancellation can't be undone.",
} as const;

/** Another membership starts after it, or in its place (Change membership): undoing it would bill both. */
export function undoCancelReplacedNote(name: string, newName: string, startsOn: string, replaces: boolean): string {
  if (!replaces) return `Another membership, ${newName}, starts on ${dayWords(startsOn)}, so this cancellation can't be undone.`;
  return `${name} is moving to ${newName} on ${dayWords(startsOn)}, so this cancellation can't be undone.`;
}
