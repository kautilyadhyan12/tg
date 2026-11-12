// CANCEL IN THE APP (ROADMAP 18l; spec Part 3 §14.8, "Cancelling"; Kd, rulings/2026-11-11-18l.md).
//
// A member, or whoever pays for them (18i), cancels a repeating membership on My membership, and any membership
// inside its cooling-off period with a full refund. What they may do is the front desk's own Cancel
// (`heldMembershipView`'s `can`, as the console's box offers it), less what staff decide: letting somebody out of a
// minimum term or a notice early for a reason (moving away, a medical reason) stays at the front desk. Money owed
// never stops a cancel; it stays owed.
//
// The sentences the phone shows, the email sends and the person's page reads are written here, so they never say
// two things. Pure: the day is passed in.
import { z } from "zod";
import { myCancelReasonSchema, myCancelWhenSchema, type MyCancelWhen } from "./appCancel.js";
import { heldMembershipView, type HeldMembership } from "./heldMemberships.js";
import { cardName } from "./memberCards.js";
import { formatMinor } from "./memberships.js";
import { dayWords } from "./paymentsDownload.js";

const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const minorSchema = z.number().int().min(0).max(99_999_999);
const markSchema = z.string().regex(/^[0-9a-f]{64}$/);

/** One way to cancel and the last day it runs. */
export interface MyCancelWay {
  when: MyCancelWhen;
  endsOn: string;
}

/** WHAT A MEMBER MAY DO IN THE APP, in the order the box lists them: the front desk's own Cancel as its box offers
 *  it, less letting them out early for a reason. Empty where there is nothing to do here: a membership paid once
 *  outside its cooling-off period; one over, set to end, or with its notice given; one a minimum term ends by
 *  itself. */
export function myCancelWays(stored: HeldMembership, today: string): MyCancelWay[] {
  const view = heldMembershipView(stored, today);
  const can = view.can;
  // Inside its cooling-off period they cancel with a full refund, held to nothing else (18v-iii).
  if (can.coolingOff !== null) return [{ when: "cooling_off", endsOn: today }];
  if (stored.kind !== "recurring" || !can.cancel || !stored.renews) return [];
  // Frozen, its dates stand still until it is unfrozen, so no day it would end on is true: it ends today where nothing holds
  // it, as at the desk; held by a minimum term or a notice, the front desk cancels it (round one, H1).
  if (view.status === "frozen") return myCancelFrozen(stored, today) ? [] : [{ when: "today", endsOn: today }];
  const paid = can.cancelAtPeriodEnd;
  // Inside a running minimum term (18v-i): it ends with the term, after the notice, or with what is paid past the
  // term; and early with the fee where it has one (18v-ii-b).
  if (can.releaseNeeded && view.contract !== null) {
    const ways: MyCancelWay[] = [];
    if (view.notice?.given !== true) {
      const end = can.cancelAtContractEnd;
      const afterNotice = can.cancelAfterNotice;
      if (end === null && afterNotice !== null) ways.push({ when: "notice", endsOn: afterNotice });
      else if (end === null && paid !== null && paid > view.contract.until) ways.push({ when: "period_end", endsOn: paid });
      else if (end !== null) ways.push({ when: "contract_end", endsOn: end });
    }
    if (can.leaveEarly !== null) ways.push({ when: "leave_early", endsOn: can.leaveEarly.endsOn });
    return ways;
  }
  // With a notice to cancel (18v-ii-a): after the notice, or with what is paid where that is as late.
  if (can.noticeEnds !== null) {
    if (view.notice?.given === true) return [];
    if (can.cancelAfterNotice !== null) return [{ when: "notice", endsOn: can.cancelAfterNotice }];
    return paid === null ? [] : [{ when: "period_end", endsOn: paid }];
  }
  // At the end of what is paid; today where nothing is paid past today, it is frozen, or it has not started.
  return paid !== null ? [{ when: "period_end", endsOn: paid }] : [{ when: "today", endsOn: today }];
}

/** Frozen, and held by a minimum term or a notice: the front desk cancels it (round one, H1). */
export function myCancelFrozen(stored: HeldMembership, today: string): boolean {
  const view = heldMembershipView(stored, today);
  return stored.kind === "recurring" && stored.renews && view.status === "frozen" && view.can.coolingOff === null && ((view.can.releaseNeeded && view.contract !== null) || view.can.noticeEnds !== null);
}

/** Whether the front desk could end it sooner than the app offers, for a reason: inside a minimum term or a notice. */
export function myCancelFrontDeskSooner(stored: HeldMembership, today: string): boolean {
  const view = heldMembershipView(stored, today);
  return stored.kind === "recurring" && stored.renews && view.can.cancel && view.can.coolingOff === null && ((view.can.releaseNeeded && view.contract !== null) || view.can.noticeEnds !== null);
}

// ── What the box says ──────────────────────────────────────────────────────────────────────────────────────────────

export const myCancelPaymentSchema = z.object({ dueOn: daySchema, amountMinor: minorSchema }).strict();
export type MyCancelPayment = z.infer<typeof myCancelPaymentSchema>;

/** Bookings made on it that end with it: class places and waits, and personal training sessions, each with the mark the
 *  cancel sends back so it ends exactly these. */
export const myCancelEndingSchema = z
  .object({
    classes: z.number().int().min(0),
    classesMark: markSchema.nullable(),
    sessions: z.number().int().min(0),
    sessionsMark: markSchema.nullable(),
  })
  .strict();
export type MyCancelEnding = z.infer<typeof myCancelEndingSchema>;

export const myCancelChoiceSchema = z
  .object({
    when: myCancelWhenSchema,
    endsOn: daySchema,
    button: z.string().min(1),
    /** The box's sentences, in the order they are read. */
    lines: z.array(z.string().min(1)).max(8),
    /** The payments still to come before it ends, after today, as their bills will open. */
    payments: z.array(myCancelPaymentSchema).max(400),
    ending: myCancelEndingSchema,
    /** `leave_early`: the early cancellation fee. */
    feeMinor: minorSchema.nullable(),
    /** `cooling_off`: what the full refund gives back. */
    refundMinor: minorSchema.nullable(),
    /** One value for exactly what this choice says, sent back with the cancel: refused where it changed. */
    key: markSchema,
  })
  .strict();
export type MyCancelChoice = z.infer<typeof myCancelChoiceSchema>;

/** The box under Cancel membership. `notes` are said under the choices: what is owed, and what only the front desk
 *  can do. Empty `choices` with a note says why there is nothing to press. */
export const myCancelAskSchema = z
  .object({
    membership: z.object({ id: z.uuid(), name: z.string() }).strict(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    choices: z.array(myCancelChoiceSchema).max(3),
    notes: z.array(z.string().min(1)).max(4),
  })
  .strict();
export type MyCancelAsk = z.infer<typeof myCancelAskSchema>;

export const myCancelRequestSchema = z
  .object({
    /** The same press sent twice is one cancel, answered as it was. */
    requestKey: z.uuid(),
    when: myCancelWhenSchema,
    key: markSchema,
  })
  .strict();
export type MyCancelRequest = z.infer<typeof myCancelRequestSchema>;

export const MY_CANCEL_REASON_QUESTION = "Why are you leaving?";

export const myCancelReasonRequestSchema = z.object({ reason: myCancelReasonSchema }).strict();
export type MyCancelReasonRequest = z.infer<typeof myCancelReasonRequestSchema>;

export const myCancelDoneSchema = z
  .object({
    cancelId: z.uuid(),
    /** "Cancelled. Gold Monthly ends on 30 Nov 2026." */
    line: z.string().min(1),
    endsOn: daySchema,
    /** Whether the confirmation email went to their address. */
    emailed: z.boolean(),
    /** The reason picked, once one is. */
    reason: myCancelReasonSchema.nullable(),
  })
  .strict();
export type MyCancelDone = z.infer<typeof myCancelDoneSchema>;

/** On My membership, each membership's Cancel: a button, a line saying who can or why not, or the line once it was
 *  cancelled in the app. Null where there is nothing to cancel. */
export const myMembershipCancelSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("can"), button: z.string().min(1) }).strict(),
  z.object({ state: z.literal("elsewhere"), line: z.string().min(1) }).strict(),
  z.object({ state: z.literal("cancelled"), line: z.string().min(1) }).strict(),
]);
export type MyMembershipCancel = z.infer<typeof myMembershipCancelSchema>;

/** What the box's sentences are made from, worked out by the server. */
export interface MyCancelFacts {
  gymName: string;
  membershipName: string;
  /** Whoever pays for them pressed it (18i): the member's name, so the box says whose it is; null for their own. */
  forName: string | null;
  currency: string;
  today: string;
  way: MyCancelWay;
  /** It has not started yet. */
  upcoming: boolean;
  /** `notice`: its days. */
  noticeDays: number | null;
  /** `cooling_off`: its last day. */
  coolingOffUntil: string | null;
  /** Inside its minimum term: the term's last day. */
  termUntil: string | null;
  payments: readonly MyCancelPayment[];
  /** The card the app charges those to by itself, where it does. */
  card: { brand: string; last4: string } | null;
  feeMinor: number | null;
  refundMinor: number | null;
  ending: { classes: number; sessions: number };
  /** Something is paid for days after today, which ending it today does not refund. */
  paidAhead: boolean;
  /** Cancelled before it starts, the membership it was changed from on the next payment date renews again (18x). */
  renewsAgain: string | null;
}

/** "Gold Monthly", or "Dev's Gold Monthly" where whoever pays for them pressed it. */
const whose = (f: Pick<MyCancelFacts, "membershipName" | "forName">): string => (f.forName === null ? f.membershipName : `${f.forName}'s ${f.membershipName}`);

const plural = (n: number, one: string, many: string): string => `${String(n)} ${n === 1 ? one : many}`;
const noticeWords = (days: number): string => (days === 1 ? "1 day's notice" : `${String(days)} days' notice`);

/** What the button of a way says. */
export function myCancelButton(way: MyCancelWhen, feeMinor: number | null, currency: string): string {
  if (way === "cooling_off") return "Cancel with full refund";
  if (way === "leave_early") return feeMinor === null ? "Cancel early" : `Cancel early, ${formatMinor(feeMinor, currency)} fee`;
  return "Cancel membership";
}

/** The first sentence of a way: when it ends, and why that day. */
function endLine(f: MyCancelFacts): string {
  const name = whose(f);
  const on = dayWords(f.way.endsOn);
  switch (f.way.when) {
    case "cooling_off": {
      const until = dayWords(f.coolingOffUntil ?? f.today);
      const lead = f.forName === null ? `You're in your cooling-off period until ${until}.` : `${name} is in its cooling-off period until ${until}.`;
      return f.refundMinor !== null && f.refundMinor > 0
        ? `${lead} ${f.forName === null ? name : "It"} ends today, and ${f.gymName} refunds the ${formatMinor(f.refundMinor, f.currency)} you paid.`
        : `${lead} ${f.forName === null ? name : "It"} ends today, with nothing to pay.`;
    }
    case "period_end":
      return `${name} ends on ${on}, the last day you've paid for.`;
    case "today":
      return f.upcoming ? `${name} is cancelled before it starts.` : `${name} ends today.`;
    case "notice":
      return `${name} has ${noticeWords(f.noticeDays ?? 0)} to cancel, so it ends on ${on}.`;
    case "contract_end":
      return `${f.forName === null ? "Your" : `${f.forName}'s`} minimum term runs until ${dayWords(f.termUntil ?? f.way.endsOn)}, so ${name} ends on ${on}.`;
    case "leave_early": {
      const fee = f.feeMinor === null ? "the early cancellation fee" : `the early cancellation fee of ${formatMinor(f.feeMinor, f.currency)}`;
      return `Cancel early: you pay ${fee}, and ${name} ends ${f.way.endsOn === f.today ? "today" : `on ${on}`}.`;
    }
  }
}

/** The payments still to come: none, one, or how many and the last. */
function paymentsLine(f: MyCancelFacts): string {
  const card = f.card === null ? null : cardName(f.card);
  const list = f.payments;
  const first = list[0];
  const last = list[list.length - 1];
  if (first === undefined || last === undefined) return card === null ? "No more payments come due for it." : `${card} won't be charged again.`;
  if (list.length === 1) return card === null ? `One more payment of ${formatMinor(first.amountMinor, f.currency)} is due on ${dayWords(first.dueOn)}.` : `${card} is charged ${formatMinor(first.amountMinor, f.currency)} once more, on ${dayWords(first.dueOn)}.`;
  const same = list.every((p) => p.amountMinor === first.amountMinor);
  const total = list.reduce((n, p) => n + p.amountMinor, 0);
  const what = same ? `${String(list.length)} more payments of ${formatMinor(first.amountMinor, f.currency)}` : `${String(list.length)} more payments, ${formatMinor(total, f.currency)} in all,`;
  return `${what} are due, the last on ${dayWords(last.dueOn)}.${card === null ? "" : ` They're charged to ${card}.`}`;
}

/** The bookings that end with it. */
function endingLine(f: MyCancelFacts): string | null {
  const parts = [
    f.ending.classes > 0 ? plural(f.ending.classes, "class booking", "class bookings") : null,
    f.ending.sessions > 0 ? plural(f.ending.sessions, "personal training session", "personal training sessions") : null,
  ].filter((p): p is string => p !== null);
  if (parts.length === 0) return null;
  const many = f.ending.classes + f.ending.sessions > 1;
  const after = f.way.endsOn === f.today ? "" : ` after ${dayWords(f.way.endsOn)}`;
  return `${f.forName === null ? "Your" : `${f.forName}'s`} ${parts.join(" and ")}${after} ${many ? "are" : "is"} cancelled too.`;
}

/** THE BOX'S SENTENCES for one way, in the order they are read, and the same in the confirmation email. */
export function myCancelLines(f: MyCancelFacts): string[] {
  const lines = [endLine(f)];
  if (f.way.when !== "cooling_off") lines.push(paymentsLine(f));
  if (f.way.when === "leave_early" && f.feeMinor !== null) lines.push(`The ${formatMinor(f.feeMinor, f.currency)} fee is added to your bill today. Pay it in the app or at the front desk.`);
  if (f.way.when === "today" && f.paidAhead) lines.push("Ending it today doesn't refund what you've paid for it. Ask the front desk about a refund.");
  const ending = endingLine(f);
  if (ending !== null) lines.push(ending);
  if (f.renewsAgain !== null) lines.push(`${f.renewsAgain} renews again, as it did before the change.`);
  return lines;
}

/** Under the choices: money owed before the cancel stays owed, and who can charge it. */
export function myCancelOwedNote(owedMinor: number, currency: string, gymName: string, savedCard: { brand: string; last4: string } | null): string {
  const pay = `You still owe ${formatMinor(owedMinor, currency)}. Pay it in the app or at the front desk.`;
  return savedCard === null ? pay : `${pay} ${gymName} can charge your saved card, ${cardName(savedCard)}, for it.`;
}

export const MY_CANCEL_WORDS = {
  /** Under the choices, inside a minimum term or a notice. */
  frontDeskSooner: "Moving away, or a medical reason? The front desk can end it sooner.",
  /** Nothing to press: a payment stands for days after the day it would end. */
  paidAhead: "You've paid for days after it would end, so the front desk cancels it. Ask them.",
  changed: "What you're cancelling has changed. Go back and look again.",
  cardCharging: "A payment for it is going through right now. Try again in a minute.",
  terminalWaiting: "A payment for it is waiting at the front desk. Try again in a few minutes.",
  appPaying: "A payment page for it is open. Finish that payment or close it first.",
  partPaid: "Part of a payment for it is paid and the rest is still owed, so the front desk cancels it. Ask them.",
  /** Frozen, and held by a minimum term or a notice (round one, H1). */
  frozen: "It's frozen, so the front desk cancels it. Ask them, or unfreeze it first.",
  requestReused: "That press was already used. Go back and look again.",
} as const;

/** On My membership, for somebody else pays for: who can cancel it. */
export function myCancelPaidByLine(payerName: string): string {
  return `${payerName} pays for this membership, so ${payerName} can cancel it in the app. Or ask the front desk.`;
}

/** Once it is cancelled: what the screen says, and what the confirmation says first. */
export function myCancelDoneLine(f: Pick<MyCancelFacts, "gymName" | "membershipName" | "forName" | "currency" | "today" | "way" | "refundMinor">): string {
  const name = whose(f);
  if (f.way.when === "cooling_off") return f.refundMinor !== null && f.refundMinor > 0 ? `Cancelled. ${f.gymName} refunds the ${formatMinor(f.refundMinor, f.currency)} you paid.` : `Cancelled. ${name} has ended.`;
  return f.way.endsOn === f.today ? `Cancelled. ${name} ends today.` : `Cancelled. ${name} ends on ${dayWords(f.way.endsOn)}.`;
}

/** My membership's line for one cancelled in the app: by the reader, or by whoever pays for them. */
export function myCancelledLine(on: string, byReader: boolean, byName: string | null): string {
  if (byReader) return `You cancelled it in the app on ${dayWords(on)}.`;
  return byName === null ? `Cancelled in the app on ${dayWords(on)}.` : `${byName} cancelled it in the app on ${dayWords(on)}.`;
}
