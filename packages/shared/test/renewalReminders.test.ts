// A reminder before a renewal or a minimum term's end (ROADMAP 18v-iv).
//
// The first block is the worst thing this job could do to a real person: tell them a charge is coming
// when none is, or name the wrong day. Every date below was read off a 2026–2028 calendar, not worked
// out by the code.
import { describe, expect, it } from "vitest";
import {
  giveHeldMembership,
  moveHeldMembership,
  lineReminders,
  renewalReminderDaysOffered,
  renewalReminderDue,
  renewalReminderNext,
  renewalReminderWords,
  saveGymMembershipTypeRequestSchema,
  type HeldMembership,
  type HeldMembershipEvent,
  type HeldMembershipTerms,
  type RenewalReminderPlan,
  type RenewalReminderWordsInput,
} from "../src/index.js";

const monthly: HeldMembershipTerms = { kind: "recurring", termCount: 1, termUnit: "month", packClasses: null, packDays: null, priceMinor: 5000 };
const yearly: HeldMembershipTerms = { ...monthly, termUnit: "year", priceMinor: 49900 };
const yearThenEnds: HeldMembershipTerms = { ...monthly, contractPeriods: 12, contractThen: "ends" };
const yearThenRenews: HeldMembershipTerms = { ...monthly, contractPeriods: 12, contractThen: "renews" };
const withNotice: HeldMembershipTerms = { ...monthly, noticeDays: 30 };

function given(type: HeldMembershipTerms, startsOn: string, today: string, paid = true): HeldMembership {
  const made = giveHeldMembership(type, startsOn, paid, today);
  if (!made.ok) throw new Error(`not given: ${made.reason}`);
  return made.membership;
}

function moved(m: HeldMembership, event: HeldMembershipEvent, today: string): HeldMembership {
  const move = moveHeldMembership(m, event, today);
  if (!move.ok) throw new Error(`refused: ${JSON.stringify(event)} on ${today}: ${move.reason}`);
  return move.membership;
}

const every = (days: number) => ({ when: "every_renewal" as const, days });
const termEnd = (days: number) => ({ when: "term_end" as const, days });

function next(plan: RenewalReminderPlan) {
  if (plan.kind !== "next") throw new Error(`no reminder: ${plan.reason}`);
  return plan.next;
}

describe("the worst thing: nobody is told a charge is coming that will not come", () => {
  it("a 12-month minimum term that ends is never told it renews, and is told it ends on 2 Nov 2027", () => {
    const m = { ...given(yearThenEnds, "2026-11-03", "2026-11-03"), paidPeriods: 11 };
    // The renewal that would be 3 Nov 2027 never comes.
    expect(renewalReminderNext(m, every(7), "2027-10-28")).toEqual({ kind: "none", reason: "not_renewing" });
    const end = next(renewalReminderNext(m, termEnd(30), "2027-10-04"));
    expect(end).toEqual({ occasion: "term", what: "ends", aboutOn: "2027-11-02", sendOn: "2027-10-04", periodIndex: null });
  });

  it("cancelled, set to end at the end of what is paid, or released: no reminder of either kind", () => {
    const start = given(monthly, "2026-11-03", "2026-11-03");
    const cancelled = moved(start, { type: "cancel", when: "today" }, "2026-11-20");
    const stopping = moved(start, { type: "cancel", when: "period_end" }, "2026-11-20");
    const released = moved(given(yearThenRenews, "2026-11-03", "2026-11-03"), { type: "cancel", when: "today", release: "moved" }, "2026-11-20");
    for (const m of [cancelled, stopping]) expect(renewalReminderNext(m, every(7), "2026-11-26")).toEqual({ kind: "none", reason: "not_renewing" });
    expect(renewalReminderNext(released, termEnd(30), "2026-11-26")).toEqual({ kind: "none", reason: "no_term" });
  });

  it("notice given: told of the one renewal the notice still runs to, and of none after", () => {
    // Notice of 30 days given on 10 Nov 2026 ends in the period from 3 Dec, so it runs to 2 Jan 2027.
    const m = moved(given(withNotice, "2026-11-03", "2026-11-03"), { type: "cancel", when: "notice" }, "2026-11-10");
    const dec = next(renewalReminderNext(m, every(7), "2026-11-26"));
    expect(dec).toMatchObject({ occasion: "renew:1", what: "renews", aboutOn: "2026-12-03" });
    const paidDec = { ...m, paidPeriods: 2 };
    expect(renewalReminderNext(paidDec, every(7), "2026-12-27")).toEqual({ kind: "none", reason: "not_renewing" });
  });

  it("a frozen membership is told nothing while its dates move", () => {
    const m = moved(given(monthly, "2026-11-03", "2026-11-03"), { type: "freeze" }, "2026-11-20");
    expect(renewalReminderNext(m, every(7), "2026-11-26")).toEqual({ kind: "none", reason: "frozen" });
    expect(renewalReminderNext(given(yearThenRenews, "2026-11-03", "2026-11-03"), termEnd(30), "2026-11-04").kind).toBe("next");
  });
});

describe("the day it is sent and the day it names", () => {
  it("a yearly membership from 3 Dec 2026, 30 days before: due from 3 Nov 2027, about 3 Dec 2027", () => {
    const m = given(yearly, "2026-12-03", "2026-12-03");
    const plan = renewalReminderNext(m, every(30), "2027-11-02");
    expect(next(plan)).toEqual({ occasion: "renew:1", what: "renews", aboutOn: "2027-12-03", sendOn: "2027-11-03", periodIndex: 1 });
    expect(renewalReminderDue(plan, "2027-11-02")).toBe(false);
    expect(renewalReminderDue(renewalReminderNext(m, every(30), "2027-11-03"), "2027-11-03")).toBe(true);
    // Late: a gym that turns it on with a week left still sends it, naming the real day.
    expect(renewalReminderDue(renewalReminderNext(m, every(30), "2027-11-26"), "2027-11-26")).toBe(true);
  });

  it("monthly, 7 days before: the renewal of 3 Dec 2026 is due from 26 Nov", () => {
    const m = given(monthly, "2026-11-03", "2026-11-03");
    expect(next(renewalReminderNext(m, every(7), "2026-11-25"))).toMatchObject({ aboutOn: "2026-12-03", sendOn: "2026-11-26" });
  });

  it("paid three months ahead: the reminder is about the first renewal not paid, 3 Feb 2027", () => {
    const m = { ...given(monthly, "2026-11-03", "2026-11-03"), paidPeriods: 3 };
    expect(next(renewalReminderNext(m, every(7), "2026-11-26"))).toMatchObject({ occasion: "renew:3", aboutOn: "2027-02-03", sendOn: "2027-01-27" });
  });

  it("first payment still owed: the next renewal is still the next one, 3 Dec 2026", () => {
    const m = given(monthly, "2026-11-03", "2026-11-03", false);
    expect(next(renewalReminderNext(m, every(7), "2026-11-26"))).toMatchObject({ occasion: "renew:1", aboutOn: "2026-12-03" });
  });

  it("still to start on 1 Dec 2026: its first renewal, 1 Jan 2027", () => {
    const m = given(monthly, "2026-12-01", "2026-11-04");
    expect(next(renewalReminderNext(m, every(7), "2026-11-04"))).toMatchObject({ occasion: "renew:1", aboutOn: "2027-01-01", sendOn: "2026-12-25" });
  });

  it("a 12-month term that renews, 30 days before its end: about 2 Nov 2027, sent from 4 Oct, the payment of 3 Nov", () => {
    const m = given(yearThenRenews, "2026-11-03", "2026-11-03");
    expect(next(renewalReminderNext(m, termEnd(30), "2027-01-15"))).toEqual({ occasion: "term", what: "term_renews", aboutOn: "2027-11-02", sendOn: "2027-10-04", periodIndex: 12 });
  });

  it("a term that renews but was set to end with it: told it ends", () => {
    const m = moved(given(yearThenRenews, "2026-11-03", "2026-11-03"), { type: "cancel", when: "contract_end" }, "2027-01-15");
    expect(next(renewalReminderNext(m, termEnd(30), "2027-10-04"))).toMatchObject({ what: "ends", aboutOn: "2027-11-02" });
  });

  it("past its minimum term: before the term ends there is nothing left to tell", () => {
    const m = { ...given(yearThenRenews, "2026-11-03", "2026-11-03"), paidPeriods: 13 };
    expect(renewalReminderNext(m, termEnd(30), "2027-11-10")).toEqual({ kind: "none", reason: "no_term" });
  });

  it("a line with no minimum term asks for none before its end", () => {
    expect(renewalReminderNext(given(monthly, "2026-11-03", "2026-11-03"), termEnd(30), "2026-11-04")).toEqual({ kind: "none", reason: "no_term" });
  });
});

describe("the days a line offers, and what a line may hold", () => {
  it("before every renewal, fewer days than one period: a week 3, a month 3 to 14, 3 months and a year all", () => {
    expect(renewalReminderDaysOffered("every_renewal", 1, "week")).toEqual([3]);
    expect(renewalReminderDaysOffered("every_renewal", 1, "month")).toEqual([3, 7, 14]);
    expect(renewalReminderDaysOffered("every_renewal", 3, "month")).toEqual([3, 7, 14, 30, 45, 60]);
    expect(renewalReminderDaysOffered("every_renewal", 1, "year")).toEqual([3, 7, 14, 30, 45, 60]);
    expect(renewalReminderDaysOffered("term_end", 1, "week")).toEqual([3, 7, 14, 30, 45, 60]);
  });

  const line = {
    name: "Gold",
    description: null,
    kind: "recurring",
    priceMinor: 5000,
    termCount: 1,
    termUnit: "month",
    packClasses: null,
    packDays: null,
    access: "all_classes",
    bookingsLimit: null,
    bookingsPeriod: null,
    classTypeIds: null,
    includesPt: false,
    ptLimit: null,
    ptPeriod: null,
  };
  const parsed = (extra: object) => saveGymMembershipTypeRequestSchema.safeParse({ ...line, ...extra }).success;

  it("refuses 30 days before every monthly renewal, before the term's end with no term, on a free line, and a day not offered", () => {
    expect(parsed({ renewalReminderDays: 7 })).toBe(true);
    expect(parsed({ renewalReminderDays: 30 })).toBe(false);
    expect(parsed({ termReminderDays: 30 })).toBe(false);
    expect(parsed({ termReminderDays: 30, contractPeriods: 12, contractThen: "renews" })).toBe(true);
    expect(parsed({ renewalReminderDays: 7, priceMinor: 0 })).toBe(false);
    expect(parsed({ renewalReminderDays: 10 })).toBe(false);
    expect(parsed({ renewalReminderDays: 3, kind: "one_time", termCount: null, termUnit: null })).toBe(false);
    expect(parsed({ renewalReminderDays: 7, termReminderDays: 30, contractPeriods: 12, contractThen: "renews" })).toBe(true);
    expect(lineReminders({ renewalReminderDays: 7, termReminderDays: 30 })).toEqual([
      { when: "every_renewal", days: 7 },
      { when: "term_end", days: 30 },
    ]);
  });
});

describe("the email's words", () => {
  const base: RenewalReminderWordsInput = {
    gymName: "Iron Gym",
    typeName: "Gold Yearly",
    forName: null,
    what: "renews",
    aboutOn: "2026-12-03",
    amountMinor: 49900,
    currency: "USD",
    every: "year",
    card: null,
    notice: null,
    endWithTermOn: null,
    lastDay: null,
  };

  it("a renewal paid at the desk", () => {
    expect(renewalReminderWords(base)).toEqual({
      subject: "Your membership at Iron Gym renews on 3 Dec 2026",
      lines: [
        "Your Gold Yearly membership at Iron Gym renews on 3 Dec 2026 for $499.00.",
        "The payment is due that day.",
        "If you'd rather it didn't renew, please let us know before 3 Dec 2026.",
      ],
    });
  });

  it("a renewal on a card, with notice, for somebody the reader pays for", () => {
    const words = renewalReminderWords({ ...base, forName: "Sam Lee", card: "Visa ending in 4242", notice: { days: 30, lastDay: "2027-01-02" } });
    expect(words.lines).toEqual([
      "Sam Lee's Gold Yearly membership at Iron Gym renews on 3 Dec 2026 for $499.00.",
      "It will be paid with the Visa ending in 4242 that day.",
      "If you'd rather it didn't renew, cancelling needs 30 days' notice: if you cancel today, the last day is 2 Jan 2027.",
    ]);
  });

  it("a renewal inside a running minimum term: no offer to stop it, the term's last day instead (round one, H1)", () => {
    expect(renewalReminderWords({ ...base, every: "month", term: { until: "2027-11-02", ends: false } }).lines[2]).toBe("The minimum term runs until 2 Nov 2027.");
    expect(renewalReminderWords({ ...base, every: "month", term: { until: "2027-11-02", ends: true } }).lines[2]).toBe("The minimum term runs until 2 Nov 2027, then it ends.");
    // Even with a notice to cancel: inside the term, notice cannot stop this payment.
    const noticed = renewalReminderWords({ ...base, notice: { days: 30, lastDay: "2027-01-02" }, term: { until: "2027-11-02", ends: false } });
    expect(noticed.lines.join(" ")).not.toContain("cancel");
  });

  it("notice already given: no offer to cancel, its last day", () => {
    expect(renewalReminderWords({ ...base, lastDay: "2027-01-02" }).lines[2]).toBe("It then ends on 2 Jan 2027.");
  });

  it("a minimum term that ends and carries on monthly", () => {
    const words = renewalReminderWords({ ...base, typeName: "Gold Monthly", what: "term_renews", aboutOn: "2027-11-02", amountMinor: 4999, every: "month", endWithTermOn: "2027-11-02" });
    expect(words).toEqual({
      subject: "Your minimum term at Iron Gym ends on 2 Nov 2027",
      lines: [
        "The minimum term of your Gold Monthly membership at Iron Gym ends on 2 Nov 2027.",
        "After that, it carries on at $49.99 every month until you cancel.",
        "If you'd like it to end with the minimum term instead, please let us know before 2 Nov 2027.",
      ],
    });
  });

  it("a membership that ends", () => {
    expect(renewalReminderWords({ ...base, forName: "Sam Lee", what: "ends", aboutOn: "2027-11-02", amountMinor: null })).toEqual({
      subject: "Sam Lee's membership at Iron Gym ends on 2 Nov 2027",
      lines: ["Sam Lee's Gold Yearly membership at Iron Gym ends on 2 Nov 2027.", "If you'd like to keep coming, just let us know and we'll help you choose a membership."],
    });
  });
});
