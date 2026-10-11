// WHAT THE MESSAGE RULE IS TOLD OF A PERSON'S MEMBERSHIPS AND BILLS (spec Part 3 §16.2;
// ROADMAP 20b-ii). The worst thing it could do: "Your payment is overdue" to somebody who
// owes nothing. That is the first test below.
import { describe, expect, it } from "vitest";
import { GYM_MESSAGE_STARTING_NUMBERS, GYM_MESSAGE_STARTING_ON, gymMessageDue, gymMessageOccasions, type GymMessageFacts } from "../src/gymMessages.js";
import { NO_MEMBERSHIP_FACTS, membershipMessageFacts, type BillForMessages, type HeldForMessages } from "../src/gymMessageMemberships.js";
import { giveHeldMembership, moveHeldMembership, type HeldMembership, type HeldMembershipEvent, type HeldMembershipTerms } from "../src/heldMemberships.js";

const TODAY = "2026-10-09";

const MONTHLY: HeldMembershipTerms = { kind: "recurring", termCount: 1, termUnit: "month", packClasses: null, packDays: null, priceMinor: 4999 };
const THREE_MONTHS: HeldMembershipTerms = { kind: "one_time", termCount: 3, termUnit: "month", packClasses: null, packDays: null, priceMinor: 12000 };
const DAY_PASS: HeldMembershipTerms = { kind: "one_time", termCount: 1, termUnit: "day", packClasses: null, packDays: null, priceMinor: 1000 };
const PACK: HeldMembershipTerms = { kind: "pack", termCount: null, termUnit: null, packClasses: 10, packDays: 60, priceMinor: 9000 };
const TRIAL: HeldMembershipTerms = { kind: "trial", termCount: 7, termUnit: "day", packClasses: null, packDays: null, priceMinor: 0 };
const PAID_TRIAL: HeldMembershipTerms = { ...TRIAL, termCount: 14, priceMinor: 500 };
const FREE_YEAR: HeldMembershipTerms = { kind: "one_time", termCount: 1, termUnit: "year", packClasses: null, packDays: null, priceMinor: 0 };

/** A membership as staff give it on `givenOn`, then moved by what staff did since. */
function given(type: HeldMembershipTerms, startsOn: string, opts: { paid?: boolean; givenOn?: string; then?: [HeldMembershipEvent, string][] } = {}): HeldMembership {
  const made = giveHeldMembership(type, startsOn, opts.paid ?? false, opts.givenOn ?? startsOn);
  if (!made.ok) throw new Error(`not given: ${made.reason}`);
  let m = made.membership;
  for (const [event, on] of opts.then ?? []) {
    const moved = moveHeldMembership(m, event, on);
    if (!moved.ok) throw new Error(`not moved: ${event.type}`);
    m = moved.membership;
  }
  return m;
}
const held = (id: string, membership: HeldMembership): HeldForMessages => ({ id, membership });
const bill = (id: string, membershipId: string, dueOn: string, open = true): BillForMessages => ({ id, membershipId, dueOn, open });

/** The rule's whole answer for one person holding these, at a gym that records payments. */
function occasions(memberships: readonly HeldForMessages[], bills: readonly BillForMessages[], today = TODAY, gym: Partial<GymMessageFacts["gym"]> = {}) {
  const facts: GymMessageFacts = {
    gym: { open: true, live: true, today, hour: 9, on: GYM_MESSAGE_STARTING_ON, numbers: GYM_MESSAGE_STARTING_NUMBERS, visitDays: [], billsOverdueAfterDays: 0, takesPayments: true, ...gym },
    person: {
      member: true,
      former: false,
      staff: false,
      off: [],
      joinedOn: "2026-01-05",
      joinedUtcOn: "2026-01-05",
      birthday: null,
      visits: 0,
      recentVisitDays: 0,
      lastVisitOn: null,
      lastSeenOn: null,
      ...membershipMessageFacts(memberships, bills, today),
    },
    sent: [],
  };
  return gymMessageOccasions(facts).map((o) => `${o.kind} ${o.occasion}`);
}

describe("who is told a payment is overdue", () => {
  it("THE WORST THING: only somebody with an OPEN bill on a membership they are using today; never a bill that is paid, cancelled or refunded, never a membership that is frozen, cancelled, over, still to start or free", () => {
    // Every membership below has one bill that fell due on 1 October, eight days ago.
    const cases: [string, HeldMembership, boolean, boolean][] = [
      ["a monthly membership in use, its bill open", given(MONTHLY, "2026-10-01"), true, true],
      ["the same, its bill settled (paid, cancelled or refunded)", given(MONTHLY, "2026-10-01"), false, false],
      ["the same, paid by the count though a bill still reads open", given(MONTHLY, "2026-10-01", { paid: true }), true, true],
      ["a three-month membership in use, its bill open", given(THREE_MONTHS, "2026-10-01"), true, true],
      ["a class pack in use, its bill open", given(PACK, "2026-10-01"), true, true],
      ["a trial with a price, in use, its bill open", given(PAID_TRIAL, "2026-10-01"), true, true],
      ["a monthly membership frozen two days ago", given(MONTHLY, "2026-10-01", { then: [[{ type: "freeze" }, "2026-10-07"]] }), true, false],
      ["a monthly membership cancelled two days ago", given(MONTHLY, "2026-10-01", { then: [[{ type: "cancel", when: "today" }, "2026-10-07"]] }), true, false],
      ["a day pass that was over on 1 October", given(DAY_PASS, "2026-10-01"), true, false],
      ["a three-month membership that ended last week", given(THREE_MONTHS, "2026-07-01"), true, false],
      ["a membership that starts next week", given(MONTHLY, "2026-10-16", { givenOn: "2026-10-01" }), true, false],
      ["a free year, with a bill that should not exist", given(FREE_YEAR, "2026-10-01"), true, false],
      ["a pack with no class left", { ...given(PACK, "2026-10-01"), classesLeft: 0 }, true, false],
      ["a row the rule cannot read: a membership with no term", { ...given(MONTHLY, "2026-10-01"), termCount: null }, true, false],
    ];
    for (const [what, membership, open, told] of cases) {
      const got = occasions([held("m1", membership)], [bill("b1", "m1", "2026-10-01", open)]);
      expect(got.includes("payment_overdue bill:b1"), what).toBe(told);
      // And the bill itself is handed to the rule only where it may be told.
      expect(membershipMessageFacts([held("m1", membership)], [bill("b1", "m1", "2026-10-01", open)], TODAY).bills, what).toEqual(told ? [{ id: "b1", dueOn: "2026-10-01", paid: false }] : []);
    }
  });

  it("a bill of a membership that is not theirs, or of none, is nobody's", () => {
    const mine = held("m1", given(MONTHLY, "2026-10-01"));
    expect(occasions([mine], [bill("b9", "m9", "2026-10-01")])).toEqual([]);
    expect(occasions([], [bill("b1", "m1", "2026-10-01")])).toEqual([]);
    expect(membershipMessageFacts([], [], TODAY)).toEqual(NO_MEMBERSHIP_FACTS);
  });

  it("with two memberships only the open bill of the one in use is told, each bill once", () => {
    const running = held("m1", given(MONTHLY, "2026-09-01", { paid: true }));
    const cancelled = held("m2", given(THREE_MONTHS, "2026-09-01", { then: [[{ type: "cancel", when: "today" }, "2026-09-20"]] }));
    const bills = [bill("b1", "m1", "2026-09-01", false), bill("b2", "m1", "2026-10-01"), bill("b3", "m2", "2026-09-01")];
    expect(occasions([running, cancelled], bills)).toEqual(["payment_overdue bill:b2"]);
  });

  it("the whole rule: one notice a bill, none the day it is due, none from a gym that records no payments, and it cannot be switched off by the member", () => {
    const m = [held("m1", given(MONTHLY, "2026-10-08"))];
    const b = [bill("b1", "m1", "2026-10-08")];
    expect(occasions(m, b, "2026-10-08")).toEqual([]);
    expect(occasions(m, b, TODAY)).toEqual(["payment_overdue bill:b1"]);
    expect(occasions(m, b, TODAY, { takesPayments: false })).toEqual([]);
    expect(occasions(m, b, TODAY, { billsOverdueAfterDays: 7 })).toEqual([]);
    expect(occasions(m, b, "2026-10-16", { billsOverdueAfterDays: 7 })).toEqual(["payment_overdue bill:b1"]);
    const person = { member: true, former: false, staff: false, off: ["payment_overdue" as const], joinedOn: null, joinedUtcOn: null, birthday: null, visits: 0, recentVisitDays: 0, lastVisitOn: null, lastSeenOn: null };
    const facts: GymMessageFacts = {
      gym: { open: true, live: true, today: TODAY, hour: 9, on: GYM_MESSAGE_STARTING_ON, numbers: GYM_MESSAGE_STARTING_NUMBERS, visitDays: [], billsOverdueAfterDays: 0, takesPayments: true },
      person: { ...person, ...membershipMessageFacts(m, b, TODAY) },
      sent: [],
    };
    expect(gymMessageDue(facts).send).toEqual({ kind: "payment_overdue", occasion: "bill:b1" });
    expect(gymMessageDue({ ...facts, sent: [{ kind: "payment_overdue", occasion: "bill:b1", day: "2026-10-09" }] }).send).toBeNull();
    expect(gymMessageDue({ ...facts, person: { ...facts.person, former: true } }).send).toBeNull();
    expect(gymMessageDue({ ...facts, person: { ...facts.person, member: false } }).send).toBeNull();
  });
});

describe("a trial", () => {
  it("is the trial they are on today, free or not: never one frozen, cancelled, over or still to start", () => {
    const on = (membership: HeldMembership) => membershipMessageFacts([held("t1", membership)], [], TODAY).trial;
    expect(on(given(TRIAL, "2026-10-08"))).toEqual({ id: "t1", startsOn: "2026-10-08", endsOn: "2026-10-14", next: false });
    expect(on(given(PAID_TRIAL, "2026-10-08"))).toEqual({ id: "t1", startsOn: "2026-10-08", endsOn: "2026-10-21", next: false });
    expect(on(given(TRIAL, "2026-10-08", { then: [[{ type: "freeze" }, TODAY]] }))).toBeNull();
    expect(on(given(TRIAL, "2026-10-08", { then: [[{ type: "cancel", when: "today" }, TODAY]] }))).toBeNull();
    expect(on(given(TRIAL, "2026-10-01"))).toBeNull();
    expect(on(given(TRIAL, "2026-10-10", { givenOn: TODAY }))).toBeNull();
    expect(on(given(MONTHLY, "2026-10-08"))).toBeNull();
  });

  it("its check-in on day 2, its ending in the last two days, and no ending once another membership is theirs", () => {
    const trial = held("t1", given(TRIAL, "2026-10-08"));
    expect(occasions([trial], [], "2026-10-08")).toEqual([]);
    expect(occasions([trial], [], "2026-10-09")).toEqual(["trial_check_in trial:t1"]);
    expect(occasions([trial], [], "2026-10-11")).toEqual([]);
    expect(occasions([trial], [], "2026-10-12")).toEqual(["trial_ending trial:t1"]);
    expect(occasions([trial], [], "2026-10-14")).toEqual(["trial_ending trial:t1"]);
    expect(occasions([trial], [], "2026-10-15")).toEqual([]);
    // They bought a membership that starts when the trial stops: its end is no news.
    const bought = held("m1", given(MONTHLY, "2026-10-15", { givenOn: "2026-10-10", paid: true }));
    expect(occasions([trial, bought], [], "2026-10-12")).toEqual([]);
    expect(occasions([trial, bought], [], "2026-10-09")).toEqual(["trial_check_in trial:t1"]);
  });

  it("a freeze moves the last day and makes no second occasion: the row names it", () => {
    const frozenThenBack = given(TRIAL, "2026-10-01", { then: [[{ type: "freeze" }, "2026-10-03"], [{ type: "unfreeze" }, "2026-10-08"]] });
    // Seven days from 1 October, with five days frozen: its last day is 12 October.
    expect(membershipMessageFacts([held("t1", frozenThenBack)], [], TODAY).trial).toEqual({ id: "t1", startsOn: "2026-10-01", endsOn: "2026-10-12", next: false });
    expect(occasions([held("t1", frozenThenBack)], [], "2026-10-10")).toEqual(["trial_ending trial:t1"]);
  });

  it("with two trials the newest-started is the one they are on", () => {
    const first = held("t1", given(PAID_TRIAL, "2026-10-01"));
    const second = held("t2", given(TRIAL, "2026-10-08"));
    expect(membershipMessageFacts([first, second], [], TODAY).trial).toEqual({ id: "t2", startsOn: "2026-10-08", endsOn: "2026-10-14", next: true });
  });
});

describe("a membership that is ending", () => {
  const ending = (memberships: readonly HeldForMessages[], today = TODAY) => membershipMessageFacts(memberships, [], today).ending;

  it("is one with a last day that they are using today: one time, a pack, or a repeating one set to stop; never one that renews, a trial, or one not running", () => {
    expect(ending([held("m1", given(THREE_MONTHS, "2026-07-15"))])).toEqual({ id: "m1", startsOn: "2026-07-15", endsOn: "2026-10-14" });
    expect(ending([held("m1", given(PACK, "2026-09-01"))])).toEqual({ id: "m1", startsOn: "2026-09-01", endsOn: "2026-10-30" });
    const stopping = given(MONTHLY, "2026-09-15", { paid: true, then: [[{ type: "cancel", when: "period_end" }, "2026-10-01"]] });
    expect(ending([held("m1", stopping)])).toEqual({ id: "m1", startsOn: "2026-09-15", endsOn: "2026-10-14" });
    expect(ending([held("m1", given(MONTHLY, "2026-09-15", { paid: true }))])).toBeNull();
    expect(ending([held("m1", given(TRIAL, "2026-10-08"))])).toBeNull();
    expect(ending([held("m1", given(THREE_MONTHS, "2026-07-15", { then: [[{ type: "freeze" }, "2026-10-01"]] }))])).toBeNull();
    expect(ending([held("m1", given(THREE_MONTHS, "2026-07-15", { then: [[{ type: "cancel", when: "today" }, "2026-10-01"]] }))])).toBeNull();
    expect(ending([held("m1", given(THREE_MONTHS, "2026-07-01"))])).toBeNull();
    expect(ending([held("m1", given(THREE_MONTHS, "2026-10-16", { givenOn: TODAY }))])).toBeNull();
    // A free one ends as any other does.
    expect(ending([held("m1", given(FREE_YEAR, "2025-10-15"))])).toEqual({ id: "m1", startsOn: "2025-10-15", endsOn: "2026-10-14" });
  });

  it("is no news once another of theirs runs on past it: renewed already, a monthly beside it, one frozen, one still to start", () => {
    const old = held("m1", given(THREE_MONTHS, "2026-07-15"));
    expect(ending([old, held("m2", given(THREE_MONTHS, "2026-10-15", { givenOn: TODAY }))])).toBeNull();
    expect(ending([old, held("m2", given(MONTHLY, "2026-09-01", { paid: true }))])).toBeNull();
    expect(ending([old, held("m2", given(MONTHLY, "2026-09-01", { then: [[{ type: "freeze" }, "2026-10-01"]] }))])).toBeNull();
    // A trial beside it, or one that is cancelled or already over, carries nothing on.
    expect(ending([old, held("t1", given(TRIAL, "2026-10-08"))])?.id).toBe("m1");
    expect(ending([old, held("m2", given(MONTHLY, "2026-09-01", { then: [[{ type: "cancel", when: "today" }, "2026-10-01"]] }))])?.id).toBe("m1");
    expect(ending([old, held("m2", given(THREE_MONTHS, "2026-06-01"))])?.id).toBe("m1");
    // Two that end, one after the other: only the later is the end of anything.
    expect(ending([old, held("m2", given(PACK, "2026-09-01"))])?.id).toBe("m2");
  });

  it("the whole rule: told from seven days before the last day, once, and a day pass never", () => {
    const m = [held("m1", given(THREE_MONTHS, "2026-07-15"))];
    expect(occasions(m, [], "2026-10-06")).toEqual([]);
    expect(occasions(m, [], "2026-10-07")).toEqual(["membership_ending ends:m1"]);
    expect(occasions(m, [], "2026-10-14")).toEqual(["membership_ending ends:m1"]);
    expect(occasions(m, [], "2026-10-15")).toEqual([]);
    expect(occasions([held("d1", given(DAY_PASS, TODAY))], [])).toEqual([]);
  });
});
