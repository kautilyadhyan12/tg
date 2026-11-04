// A REMINDER BEFORE A RENEWAL OR A MINIMUM TERM'S END (ROADMAP 18v-iv; Kd, 2026-11-04,
// `rulings/2026-11-04-18v-iv.md`). A repeating line of the price list with a price may ask for an email
// so many days before every renewal, or before its minimum term ends. It is read from the line as it is
// now, so it covers everybody already on it.
//
// THE WORST THING here is an email telling somebody a charge is coming when none is (they cancelled, gave
// notice, or their term ends), or naming the wrong day or amount. `renewalReminderNext` is the ONE rule: the
// queue, the line's box, a person's page and the check before each email all read it, from the membership as
// the person's page reads it, and it is pure.
import { addDays, heldMembershipView, periodIndex, periodStart, type HeldMembership, type HeldMembershipView } from "./heldMemberships.js";
import { formatMinor, type MembershipTermUnit, type RenewalReminderSetting } from "./memberships.js";
import { dayWords } from "./paymentsDownload.js";

/** What the email is about: a renewal; a minimum term that ends with the membership carrying on; or a
 *  membership that ends with its term (or with notice given that ends it there). */
export type RenewalReminderWhat = "renews" | "term_renews" | "ends";

/** Why there is no reminder to come. */
export type RenewalReminderNone =
  /** Frozen: its dates move until it is unfrozen. */
  | "frozen"
  /** Over, cancelled, set to end, notice given that ends it before, a term that ends it: no renewal to come. */
  | "not_renewing"
  /** No minimum term running (over, released, or left early). */
  | "no_term";

export interface RenewalReminderNextOne {
  /** One email ever for (membership, occasion): `renew:<period>` or `term`. */
  occasion: string;
  what: RenewalReminderWhat;
  /** The day the email names: the renewal, or the minimum term's (or the membership's) last day. */
  aboutOn: string;
  /** The first gym day it may go. On or after it, it is due. */
  sendOn: string;
  /** The period it carries on with, whose payment the email names; null where it ends. */
  periodIndex: number | null;
}

export type RenewalReminderPlan = { kind: "next"; next: RenewalReminderNextOne } | { kind: "none"; reason: RenewalReminderNone };

/** THE RULE: the reminder still to come for this membership on `today` (the gym's day), or why there is none.
 *  Read from the membership as its page reads it: a renewal is the start of the first period not paid ahead,
 *  and only one that will happen; a minimum term only while it runs. It is due once `today` reaches `sendOn`;
 *  the day it names is always after today (a renewal) or today at the latest (a term's last day). */
export function renewalReminderNext(m: HeldMembership, setting: RenewalReminderSetting, today: string, viewed?: HeldMembershipView): RenewalReminderPlan {
  const view = viewed ?? heldMembershipView(m, today);
  if (view.status === "frozen") return { kind: "none", reason: "frozen" };
  if (m.kind !== "recurring" || m.free || !m.renews || view.status === "ended" || view.status === "cancelled") {
    return setting.when === "term_end" ? { kind: "none", reason: "no_term" } : { kind: "none", reason: "not_renewing" };
  }

  if (setting.when === "every_renewal") {
    const index = Math.max(periodIndex(m, today) + 1, m.paidPeriods, 1);
    const aboutOn = periodStart(m, index);
    // A last day before that renewal (its term ends it, or notice given) means there is no renewal.
    if (view.endsOn !== null && view.endsOn < aboutOn) return { kind: "none", reason: "not_renewing" };
    return { kind: "next", next: { occasion: `renew:${String(index)}`, what: "renews", aboutOn, sendOn: addDays(aboutOn, -setting.days), periodIndex: index } };
  }

  const contract = view.contract;
  if (contract === null) return { kind: "none", reason: "no_term" };
  // Ending with the term, by the line or by notice given that ends it there, is an end, not a renewal.
  const ends = contract.then === "ends" || (view.endsOn !== null && view.endsOn <= contract.until);
  const aboutOn = ends && view.endsOn !== null ? view.endsOn : contract.until;
  const after = addDays(aboutOn, 1);
  return {
    kind: "next",
    next: {
      occasion: "term",
      what: ends ? "ends" : "term_renews",
      aboutOn,
      sendOn: addDays(after, -setting.days),
      periodIndex: ends ? null : periodIndex(m, after),
    },
  };
}

/** Is the reminder due on `today`? */
export function renewalReminderDue(plan: RenewalReminderPlan, today: string): plan is { kind: "next"; next: RenewalReminderNextOne } {
  return plan.kind === "next" && today >= plan.next.sendOn;
}

// ── THE EMAIL'S WORDS ──

export interface RenewalReminderWordsInput {
  gymName: string;
  /** The membership's line, "Gold Yearly". */
  typeName: string;
  /** Whose membership, where whoever is emailed pays for somebody else: their name. Null for their own. */
  forName: string | null;
  what: RenewalReminderWhat;
  aboutOn: string;
  /** What the renewal (or the first payment after the term) comes to, and its money; null where it ends. */
  amountMinor: number | null;
  currency: string;
  /** "month", "3 months": how often it is paid. */
  every: string;
  /** The card it will be charged to by itself, "Visa ending in 4242"; null where it is paid at the desk. */
  card: string | null;
  /** Its notice to cancel in days, and the last day if they gave notice today; null for none. */
  notice: { days: number; lastDay: string } | null;
  /** The minimum term's last day, where it can still be set to end with it. */
  endWithTermOn: string | null;
  /** Its last day, where it is set to end after this renewal (notice given): nothing to cancel. */
  lastDay: string | null;
}

export interface RenewalReminderWords {
  subject: string;
  /** The lines of the email, in order, after the greeting. */
  lines: string[];
}

/** "every month", "every 3 months". */
export function everyWords(termCount: number, termUnit: MembershipTermUnit): string {
  return termCount === 1 ? termUnit : `${String(termCount)} ${termUnit}s`;
}

/** The email, as the person reads it. */
export function renewalReminderWords(input: RenewalReminderWordsInput): RenewalReminderWords {
  const day = dayWords(input.aboutOn);
  const whose = input.forName === null ? "Your" : `${input.forName}'s`;
  const membership = `${whose} ${input.typeName} membership at ${input.gymName}`;
  const amount = input.amountMinor === null ? null : formatMinor(input.amountMinor, input.currency);
  const noticeLine = (lead: string): string | null =>
    input.notice === null
      ? null
      : `${lead} cancelling needs ${input.notice.days === 1 ? "1 day's" : `${String(input.notice.days)} days'`} notice: if you cancel today, the last day is ${dayWords(input.notice.lastDay)}.`;

  if (input.what === "ends") {
    return {
      subject: `${whose} membership at ${input.gymName} ends on ${day}`,
      lines: [`${membership} ends on ${day}.`, "If you'd like to keep coming, just let us know and we'll help you choose a membership."],
    };
  }
  if (input.what === "term_renews") {
    const carriesOn = amount === null ? "After that, it carries on until you cancel." : `After that, it carries on at ${amount} every ${input.every} until you cancel.`;
    const cancel =
      input.endWithTermOn !== null
        ? `If you'd like it to end with the minimum term instead, please let us know before ${dayWords(input.endWithTermOn)}.`
        : noticeLine("If you'd like it to stop,");
    return {
      subject: `${whose} minimum term at ${input.gymName} ends on ${day}`,
      lines: [
        `The minimum term of ${input.forName === null ? "your" : whose} ${input.typeName} membership at ${input.gymName} ends on ${day}.`,
        carriesOn,
        ...(cancel === null ? [] : [cancel]),
      ],
    };
  }
  const paid = input.card === null ? "The payment is due that day." : `It will be paid with ${input.forName === null ? "your" : "the"} ${input.card} that day.`;
  const cancel =
    input.lastDay !== null
      ? `It then ends on ${dayWords(input.lastDay)}.`
      : (noticeLine("If you'd rather it didn't renew,") ?? `If you'd rather it didn't renew, please let us know before ${day}.`);
  return {
    subject: `${whose} membership at ${input.gymName} renews on ${day}`,
    lines: [`${membership} renews on ${day}${amount === null ? "" : ` for ${amount}`}.`, paid, cancel],
  };
}
