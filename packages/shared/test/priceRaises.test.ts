// Raise the price for members already on a line (ROADMAP 18w).
//
// The first block is the worst thing this job could do to a real person: charge them more than they agreed to,
// before their notice, inside their minimum term, or for a payment already made. Every date below was read off a
// 2026–2027 calendar, not worked out by the code.
import { describe, expect, it } from "vitest";
import {
  giveHeldMembership,
  moveHeldMembership,
  priceRaiseDue,
  priceRaiseNext,
  priceRaiseWords,
  raisedListedMinor,
  raisedOwnPriceMinor,
  priceRaiseRequestSchema,
  type HeldMembership,
  type HeldMembershipEvent,
  type HeldMembershipTerms,
  type PriceRaisePlan,
} from "../src/index.js";

const monthly: HeldMembershipTerms = { kind: "recurring", termCount: 1, termUnit: "month", packClasses: null, packDays: null, priceMinor: 5000 };
const yearly: HeldMembershipTerms = { ...monthly, termUnit: "year", priceMinor: 49900 };
const weekly: HeldMembershipTerms = { ...monthly, termUnit: "week", priceMinor: 1500 };
const termRenews: HeldMembershipTerms = { ...monthly, contractPeriods: 12, contractThen: "renews" };
const termEnds: HeldMembershipTerms = { ...monthly, contractPeriods: 12, contractThen: "ends" };
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

function next(plan: PriceRaisePlan) {
  if (plan.kind !== "next") throw new Error(`no raise: ${plan.reason}`);
  return plan.next;
}

// Gold Monthly from Tue 3 Nov 2026, the first month paid: payments on 3 Dec, 3 Jan, 3 Feb.
const ann = given(monthly, "2026-11-03", "2026-11-03");

describe("the worst thing: nobody pays the new price before their notice, inside a minimum term, or for a payment made", () => {
  it("30 days' notice on 6 Nov: 3 Dec is too soon, so the new price starts on 3 Jan 2027 and the email goes on 4 Dec", () => {
    expect(next(priceRaiseNext(ann, 30, "2026-11-06", 0))).toEqual({ fromPeriod: 2, fromOn: "2027-01-03", sendOn: "2026-12-04" });
  });

  it("7 days' notice on 6 Nov: from 3 Dec, emailed 26 Nov; 14 days: from 3 Dec, emailed 19 Nov", () => {
    expect(next(priceRaiseNext(ann, 7, "2026-11-06", 0))).toEqual({ fromPeriod: 1, fromOn: "2026-12-03", sendOn: "2026-11-26" });
    expect(next(priceRaiseNext(ann, 14, "2026-11-06", 0))).toEqual({ fromPeriod: 1, fromOn: "2026-12-03", sendOn: "2026-11-19" });
  });

  it("an email a day late never shortens the notice: on 27 Nov the 3 Dec payment is 6 days away, so it moves to 3 Jan", () => {
    const onTime = priceRaiseNext(ann, 7, "2026-11-26", 0);
    expect(next(onTime).fromOn).toBe("2026-12-03");
    expect(priceRaiseDue(onTime, "2026-11-26")).toBe(true);
    expect(next(priceRaiseNext(ann, 7, "2026-11-27", 0))).toEqual({ fromPeriod: 2, fromOn: "2027-01-03", sendOn: "2026-12-27" });
  });

  it("not due before its day: 25 Nov is a day early for the 26 Nov email", () => {
    expect(priceRaiseDue(priceRaiseNext(ann, 7, "2026-11-25", 0), "2026-11-25")).toBe(false);
  });

  it("a payment already billed or paid ahead keeps its price: billed to Dec, from 3 Jan; paid to Feb, from 3 Mar", () => {
    expect(next(priceRaiseNext(ann, 7, "2026-11-06", 1)).fromOn).toBe("2027-01-03");
    const paidAhead = { ...ann, paidPeriods: 4 };
    expect(next(priceRaiseNext(paidAhead, 7, "2026-11-06", 0))).toEqual({ fromPeriod: 4, fromOn: "2027-03-03", sendOn: "2027-02-24" });
  });

  it("the period running today is never raised, even with its bill still to open", () => {
    // Owing since 3 Dec (one period paid); on 10 Dec the running period is the one from 3 Dec.
    expect(next(priceRaiseNext(ann, 7, "2026-12-10", 0))).toEqual({ fromPeriod: 2, fromOn: "2027-01-03", sendOn: "2026-12-27" });
  });

  it("a 12-month minimum term from 3 Nov 2026 keeps its price to 2 Nov 2027: from 3 Nov 2027, emailed 4 Oct", () => {
    const m = given(termRenews, "2026-11-03", "2026-11-03");
    expect(next(priceRaiseNext(m, 30, "2026-11-06", 0))).toEqual({ fromPeriod: 12, fromOn: "2027-11-03", sendOn: "2027-10-04" });
  });

  it("a minimum term that ends the membership: no payment after it to raise", () => {
    expect(priceRaiseNext(given(termEnds, "2026-11-03", "2026-11-03"), 7, "2026-11-06", 0)).toEqual({ kind: "none", reason: "not_renewing" });
  });

  it("cancelled today, set to end at the end of what is paid, a free one, a one-off payment, a pack: never raised", () => {
    expect(priceRaiseNext(moved(ann, { type: "cancel", when: "today" }, "2026-11-06"), 7, "2026-11-06", 0).kind).toBe("none");
    expect(priceRaiseNext(moved(ann, { type: "cancel", when: "period_end" }, "2026-11-06"), 7, "2026-11-06", 0)).toEqual({ kind: "none", reason: "not_renewing" });
    expect(priceRaiseNext(given({ ...monthly, priceMinor: 0 }, "2026-11-03", "2026-11-03"), 7, "2026-11-06", -1)).toEqual({ kind: "none", reason: "not_renewing" });
    const once = given({ ...monthly, kind: "one_time" }, "2026-11-03", "2026-11-03");
    expect(priceRaiseNext(once, 7, "2026-11-06", 0)).toEqual({ kind: "none", reason: "not_renewing" });
    const pack = given({ kind: "pack", termCount: null, termUnit: null, packClasses: 10, packDays: 60, priceMinor: 9000 }, "2026-11-03", "2026-11-03");
    expect(priceRaiseNext(pack, 7, "2026-11-06", 0)).toEqual({ kind: "none", reason: "not_renewing" });
  });

  it("notice to cancel given on 10 Nov (30 days): its last day is 2 Jan 2027, so 7 days' notice raises 3 Dec, 30 days' raises nothing", () => {
    const m = moved(given(withNotice, "2026-11-03", "2026-11-03"), { type: "cancel", when: "notice" }, "2026-11-10");
    expect(next(priceRaiseNext(m, 7, "2026-11-10", 0)).fromOn).toBe("2026-12-03");
    expect(priceRaiseNext(m, 30, "2026-11-10", 0)).toEqual({ kind: "none", reason: "not_renewing" });
  });

  it("frozen: nothing until it is back, then from the first payment far enough from that day", () => {
    const frozen = moved(ann, { type: "freeze" }, "2026-11-10");
    expect(priceRaiseNext(frozen, 7, "2026-11-20", 0)).toEqual({ kind: "none", reason: "frozen" });
    // Back on 20 Nov after 10 days frozen: its payments move 10 days, to 13 Dec and 13 Jan.
    const back = moved(frozen, { type: "unfreeze" }, "2026-11-20");
    expect(next(priceRaiseNext(back, 7, "2026-11-20", 0))).toEqual({ fromPeriod: 1, fromOn: "2026-12-13", sendOn: "2026-12-06" });
  });

  it("starting later (1 Dec 2026): its first payment is never raised, so from 1 Jan 2027", () => {
    const later = given(monthly, "2026-12-01", "2026-11-06", false);
    expect(next(priceRaiseNext(later, 7, "2026-11-06", -1))).toEqual({ fromPeriod: 1, fromOn: "2027-01-01", sendOn: "2026-12-25" });
  });

  it("yearly from 1 Mar 2026: from 1 Mar 2027, emailed 30 Jan; weekly from Tue 3 Nov: 7 days' notice on 6 Nov, from Tue 17 Nov", () => {
    expect(next(priceRaiseNext(given(yearly, "2026-03-01", "2026-03-01"), 30, "2026-11-06", 0))).toEqual({ fromPeriod: 1, fromOn: "2027-03-01", sendOn: "2027-01-30" });
    // Weekly payments on 10 Nov and 17 Nov: 10 Nov is 4 days away.
    expect(next(priceRaiseNext(given(weekly, "2026-11-03", "2026-11-03"), 7, "2026-11-06", 0))).toEqual({ fromPeriod: 2, fromOn: "2026-11-17", sendOn: "2026-11-10" });
  });
});

describe("a period's price with a raise", () => {
  it("is its own until the email has gone, and the raise's from the period the email named", () => {
    expect(raisedListedMinor(5000, null, 5)).toBe(5000);
    expect(raisedListedMinor(5000, { priceMinor: 5500, fromPeriod: null }, 5)).toBe(5000);
    expect(raisedListedMinor(5000, { priceMinor: 5500, fromPeriod: 2 }, 1)).toBe(5000);
    expect(raisedListedMinor(5000, { priceMinor: 5500, fromPeriod: 2 }, 2)).toBe(5500);
    expect(raisedListedMinor(5000, { priceMinor: 5500, fromPeriod: 2 }, 9)).toBe(5500);
  });

  it("a discount off every payment still comes off the new price; one off the first payment alone does not", () => {
    expect(raisedOwnPriceMinor(6000, { offMinor: 500, payments: "every" })).toBe(5500);
    expect(raisedOwnPriceMinor(6000, { offMinor: 500, payments: "first" })).toBe(6000);
    expect(raisedOwnPriceMinor(6000, null)).toBe(6000);
    expect(raisedOwnPriceMinor(400, { offMinor: 500, payments: "every" })).toBe(0);
  });
});

describe("the email", () => {
  const base = { gymName: "Iron Works", typeName: "Gold Monthly", forName: null, fromMinor: 5413, toMinor: 5954, currency: "USD", every: "month", startsOn: "2027-01-03", notice: null };

  it("says the old and new price, the day, and how to stop", () => {
    expect(priceRaiseWords(base)).toEqual({
      subject: "The price of your membership at Iron Works is going up on 3 Jan 2027",
      lines: [
        "The price of your Gold Monthly membership at Iron Works is going up from $54.13 to $59.54 every month.",
        "The new price starts with the payment on 3 Jan 2027. Payments before then stay at $54.13.",
        "If you'd rather not carry on at the new price, please let us know before 3 Jan 2027.",
      ],
    });
  });

  it("for somebody the reader pays for, with notice to cancel", () => {
    const words = priceRaiseWords({ ...base, forName: "Sam Lee", notice: { days: 30, lastDay: "2027-01-02" } });
    expect(words.subject).toBe("The price of Sam Lee's membership at Iron Works is going up on 3 Jan 2027");
    expect(words.lines[0]).toBe("The price of Sam Lee's Gold Monthly membership at Iron Works is going up from $54.13 to $59.54 every month.");
    expect(words.lines[2]).toBe("If you'd rather not carry on at the new price, cancelling needs 30 days' notice: if you cancel today, the last day is 2 Jan 2027.");
  });
});

describe("what Save sends", () => {
  it("takes a notice of 7, 14 or 30 days and at least one membership; nothing else", () => {
    const id = "3f1c2a8e-5b7d-4c9a-8e2f-1a2b3c4d5e6f";
    expect(priceRaiseRequestSchema.safeParse({ noticeDays: 30, membershipIds: [id] }).success).toBe(true);
    for (const days of [0, 3, 21, 60]) expect(priceRaiseRequestSchema.safeParse({ noticeDays: days, membershipIds: [id] }).success).toBe(false);
    expect(priceRaiseRequestSchema.safeParse({ noticeDays: 7, membershipIds: [] }).success).toBe(false);
    expect(priceRaiseRequestSchema.safeParse({ noticeDays: 7, membershipIds: [id], priceMinor: 1 }).success).toBe(false);
  });
});
