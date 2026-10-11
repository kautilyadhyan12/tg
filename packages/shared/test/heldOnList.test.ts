// What the Members list says about a person's membership (spec Part 3 §13.2, §18.2;
// ROADMAP 23a-i).
//
// The first block is the worst thing this job could do to a real person: the list reads
// "Paid" for somebody who owes the gym money, so nobody asks them for it. Every
// membership below is made by the rule that gives and changes one (`giveHeldMembership`,
// `moveHeldMembership`), and every day is read off the 2026 calendar: a monthly
// membership paid on 6 October is paid up to 6 November, the first day not paid for.
import { describe, expect, it } from "vitest";
import {
  HELD_LIVE_MAX,
  HELD_PAYMENT_WORDS,
  HELD_STATUS_WORDS,
  giveHeldMembership,
  heldLeftOn,
  heldListWords,
  heldMembershipView,
  heldOnList,
  heldOnListSchema,
  moveHeldMembership,
  type HeldForList,
  type HeldMembership,
  type HeldMembershipEvent,
  type HeldMembershipTerms,
} from "../src/index.js";

const monthly: HeldMembershipTerms = { kind: "recurring", termCount: 1, termUnit: "month", packClasses: null, packDays: null, priceMinor: 4500 };
const yearly: HeldMembershipTerms = { ...monthly, termUnit: "year", priceMinor: 40000 };
const threeMonths: HeldMembershipTerms = { ...monthly, kind: "one_time", termCount: 3, priceMinor: 12000 };
const freeWeek: HeldMembershipTerms = { ...monthly, kind: "trial", termCount: 7, termUnit: "day", priceMinor: 0 };
const freeMonthly: HeldMembershipTerms = { ...monthly, priceMinor: 0 };
const tenPack: HeldMembershipTerms = { kind: "pack", termCount: null, termUnit: null, packClasses: 10, packDays: 90, priceMinor: 30000 };
const dayPass: HeldMembershipTerms = { ...tenPack, packClasses: 1, packDays: 1, priceMinor: 1500 };

function given(type: HeldMembershipTerms, startsOn: string, paid: boolean, on: string): HeldMembership {
  const made = giveHeldMembership(type, startsOn, paid, on);
  if (!made.ok) throw new Error(`not given: ${made.reason}`);
  return made.membership;
}

function moved(m: HeldMembership, event: HeldMembershipEvent, on: string): HeldMembership {
  const move = moveHeldMembership(m, event, on);
  if (!move.ok) throw new Error(`refused: ${JSON.stringify(event)} on ${on}`);
  return move.membership;
}

let made = 0;
/** One membership of a person's, named as its type is. */
function held(typeName: string, membership: HeldMembership, extra: Partial<HeldForList> = {}): HeldForList {
  made += 1;
  return { id: `m${String(made).padStart(4, "0")}`, typeName, fromList: false, membership, ...extra };
}

const on = (list: readonly HeldForList[], today: string, listedUnheld: string | null = null) => heldOnList({ held: list, listedUnheld, today });

describe("the list never reads Paid for somebody who owes", () => {
  const gold = () => held("Gold Monthly", given(monthly, "2026-10-06", true, "2026-10-06"));

  it("a membership paid up is Paid until the first day not paid for, and due from that day", () => {
    // Paid on 6 October for the month to 6 November. Nobody presses anything in between.
    expect(on([gold()], "2026-10-07")?.payment).toEqual({ state: "paid" });
    expect(on([gold()], "2026-11-05")?.payment).toEqual({ state: "paid" });
    expect(on([gold()], "2026-11-06")?.payment).toEqual({ state: "due", since: "2026-11-06" });
    expect(on([gold()], "2026-12-25")?.payment).toEqual({ state: "due", since: "2026-11-06" });
  });

  it("one unpaid membership beside a paid one makes the person's payment due", () => {
    const pack = held("PT 10", given(tenPack, "2026-10-01", false, "2026-10-01"));
    expect(on([gold(), pack], "2026-10-07")?.payment).toEqual({ state: "due", since: "2026-10-01" });
    // The other way round in the list of them: the same answer.
    expect(on([pack, gold()], "2026-10-07")?.payment).toEqual({ state: "due", since: "2026-10-01" });
  });

  it("every way of owing is due, and only nothing owing is Paid", () => {
    const today = "2026-10-07";
    const unpaidMonthly = held("Silver", given(monthly, "2026-10-03", false, "2026-10-03"));
    const frozenUnpaid = held("Silver", moved(given(monthly, "2026-10-01", false, "2026-10-01"), { type: "freeze" }, "2026-10-05"));
    const startsLaterUnpaid = held("Annual", given(yearly, "2026-10-20", false, today));
    const startsLaterPaid = held("Annual", given(yearly, "2026-10-20", true, today));
    const unpaidPack = held("PT 10", given(tenPack, "2026-10-02", false, "2026-10-02"));
    const paidPack = held("PT 10", given(tenPack, "2026-10-02", true, "2026-10-02"));
    const free = held("Free week", given(freeWeek, "2026-10-05", false, "2026-10-05"));
    const paidFrozen = held("Gold Monthly", moved(given(monthly, "2026-10-01", true, "2026-10-01"), { type: "freeze" }, "2026-10-05"));

    // [who holds what, what the Payment column says]
    const cases: [string, HeldForList[], unknown][] = [
      ["unpaid from its first day", [unpaidMonthly], { state: "due", since: "2026-10-03" }],
      ["frozen while unpaid: no day to say", [frozenUnpaid], { state: "due", since: null }],
      // Not owed before its day: it has a word of its own, and is never "Payment due".
      ["paid now, the next one unpaid and still to start", [gold(), startsLaterUnpaid], { state: "later", on: "2026-10-20" }],
      ["nothing held yet but one unpaid and still to start", [startsLaterUnpaid], { state: "later", on: "2026-10-20" }],
      ["free now, the next one unpaid and still to start", [free, startsLaterUnpaid], { state: "later", on: "2026-10-20" }],
      ["owed now beside one not owed yet: due, since the day already owed", [unpaidMonthly, startsLaterUnpaid], { state: "due", since: "2026-10-03" }],
      ["frozen while unpaid beside one not owed yet: due, with no day", [frozenUnpaid, startsLaterUnpaid], { state: "due", since: null }],
      ["free now, a pack unpaid", [free, unpaidPack], { state: "due", since: "2026-10-02" }],
      ["two unpaid: since the earlier day", [unpaidMonthly, unpaidPack], { state: "due", since: "2026-10-02" }],
      ["a day beside no day: the day", [frozenUnpaid, unpaidPack], { state: "due", since: "2026-10-02" }],
      ["paid, and a paid pack", [gold(), paidPack], { state: "paid" }],
      ["paid, and frozen paid", [paidFrozen], { state: "paid" }],
      ["paid, and the next one paid and still to start", [gold(), startsLaterPaid], { state: "paid" }],
      ["paid, and a free one", [gold(), free], { state: "paid" }],
      ["nothing to pay", [free], { state: "free" }],
    ];
    for (const [what, list, payment] of cases) {
      expect(on(list, today)?.payment, what).toEqual(payment);
    }
  });

  it("a payment is not due before its day: the day before, the day, the day after", () => {
    // Given on 7 October to start on the 16th, not paid. Nobody owes anything until the 16th.
    const annual = held("Annual", given(yearly, "2026-10-16", false, "2026-10-07"));
    expect(on([annual], "2026-10-07")?.payment).toEqual({ state: "later", on: "2026-10-16" });
    expect(on([annual], "2026-10-15")?.payment).toEqual({ state: "later", on: "2026-10-16" });
    expect(on([annual], "2026-10-16")?.payment).toEqual({ state: "due", since: "2026-10-16" });
    expect(on([annual], "2026-10-17")?.payment).toEqual({ state: "due", since: "2026-10-16" });
    // Two not owed yet: the nearer day.
    const pack = held("PT 10", given(tenPack, "2026-10-12", false, "2026-10-07"));
    expect(on([annual, pack], "2026-10-07")?.payment).toEqual({ state: "later", on: "2026-10-12" });
    expect(on([pack, annual], "2026-10-07")?.payment).toEqual({ state: "later", on: "2026-10-12" });
  });

  it("a membership that is over owes nothing here, as on the person's own page", () => {
    const cancelledUnpaid = held("Silver", moved(given(monthly, "2026-09-01", false, "2026-09-01"), { type: "cancel", when: "today" }, "2026-09-20"));
    expect(heldMembershipView(cancelledUnpaid.membership, "2026-10-07").payment).toBeNull();
    expect(on([gold(), cancelledUnpaid], "2026-10-07")?.payment).toEqual({ state: "paid" });
  });

  it("whichever memberships a person holds, in whatever order: Paid only where none of them is due", () => {
    const today = "2026-11-10";
    const pool: HeldForList[] = [
      held("Gold Monthly", given(monthly, "2026-10-06", true, "2026-10-06")), // paid to 6 Nov: due by the clock
      held("Gold Monthly", given(monthly, "2026-11-01", true, "2026-11-01")), // paid to 1 Dec
      held("Silver", given(monthly, "2026-11-02", false, "2026-11-02")),
      held("Three months", given(threeMonths, "2026-10-15", true, "2026-10-15")),
      held("Three months", given(threeMonths, "2026-10-15", false, "2026-10-15")),
      held("PT 10", given(tenPack, "2026-10-30", true, "2026-10-30")),
      held("PT 10", given(tenPack, "2026-10-30", false, "2026-10-30")),
      held("Free monthly", given(freeMonthly, "2026-10-01", false, "2026-10-01")),
      held("Annual", given(yearly, "2026-12-01", false, today)),
      held("Silver", moved(given(monthly, "2026-10-20", false, "2026-10-20"), { type: "freeze" }, "2026-11-01")),
      held("Day pass", given(dayPass, "2026-11-09", false, "2026-11-09")), // over since yesterday
      held("Silver", moved(given(monthly, "2026-09-01", false, "2026-09-01"), { type: "cancel", when: "today" }, "2026-09-20")),
    ];
    const dueSince = (m: HeldForList): string | null | undefined => {
      const payment = heldMembershipView(m.membership, today).payment;
      return payment?.state === "due" ? payment.since : undefined;
    };
    // Owed today: due with no day to say, or since a day that has come.
    const owes = (m: HeldForList) => {
      const since = dueSince(m);
      return since !== undefined && (since === null || since <= today);
    };
    const owesLater = (m: HeldForList) => {
      const since = dueSince(m);
      return typeof since === "string" && since > today;
    };
    const inUse = (m: HeldForList) => ["active", "frozen", "upcoming"].includes(heldMembershipView(m.membership, today).status);
    let sets = 0;
    for (let a = 0; a < pool.length; a++) {
      for (let b = a; b < pool.length; b++) {
        for (let c = b; c < pool.length; c++) {
          const list = [...new Set([pool[a], pool[b], pool[c]])].filter((m): m is HeldForList => m !== undefined);
          const using = list.filter(inUse);
          if (using.length === 0) continue;
          sets += 1;
          const expected = using.some(owes)
            ? "due"
            : using.some(owesLater)
              ? "later"
              : using.some((m) => heldMembershipView(m.membership, today).payment?.state === "paid")
                ? "paid"
                : "free";
          for (const order of [list, [...list].reverse()]) {
            expect(on(order, today)?.payment?.state, order.map((m) => m.id).join("+")).toBe(expected);
          }
        }
      }
    }
    // Every set of one, two or three of the ten in use, with or without the two that are over.
    expect(sets).toBeGreaterThan(200);
  });
});

describe("which membership the row names first", () => {
  const today = "2026-10-07";
  const active = (name: string, type: HeldMembershipTerms, startsOn: string) => held(name, given(type, startsOn, true, startsOn));
  const frozen = (name: string, startsOn: string) => held(name, moved(given(monthly, startsOn, true, startsOn), { type: "freeze" }, "2026-10-06"));
  const upcoming = (name: string, startsOn: string) => held(name, given(yearly, startsOn, true, today));

  it("running before frozen before still to start; a membership before a pack; then the newest", () => {
    // [what the person holds, the names in the row's order, the row's status]
    const cases: [string, HeldForList[], string[], string][] = [
      ["a monthly and a pack bought after it", [active("PT 10", tenPack, "2026-10-05"), active("Gold Monthly", monthly, "2026-09-10")], ["Gold Monthly", "PT 10"], "active"],
      ["a pack alone", [active("PT 10", tenPack, "2026-10-05")], ["PT 10"], "active"],
      ["a running pack and a frozen monthly", [frozen("Gold Monthly", "2026-09-10"), active("PT 10", tenPack, "2026-10-05")], ["PT 10", "Gold Monthly"], "active"],
      ["frozen, and one still to start", [upcoming("Annual", "2026-11-01"), frozen("Gold Monthly", "2026-09-10")], ["Gold Monthly", "Annual"], "frozen"],
      ["only one still to start", [upcoming("Annual", "2026-11-01")], ["Annual"], "upcoming"],
      ["two running memberships: the newer start", [active("Silver", monthly, "2026-08-01"), active("Gold Monthly", monthly, "2026-10-01")], ["Gold Monthly", "Silver"], "active"],
      ["a one-time membership and a monthly: the newer start", [active("Three months", threeMonths, "2026-10-02"), active("Gold Monthly", monthly, "2026-09-01")], ["Three months", "Gold Monthly"], "active"],
      ["two packs of one name", [active("PT 10", tenPack, "2026-10-05"), active("PT 10", tenPack, "2026-09-05")], ["PT 10"], "active"],
    ];
    for (const [what, list, names, status] of cases) {
      for (const order of [list, [...list].reverse()]) {
        const shown = on(order, today);
        expect(shown?.memberships, what).toEqual(names);
        expect(shown?.status, what).toBe(status);
      }
    }
  });

  it("two alike in every way read in one order, whichever comes first", () => {
    const a = held("Gold Monthly", given(monthly, "2026-10-01", true, "2026-10-01"), { id: "a" });
    const b = held("Silver", given(monthly, "2026-10-01", true, "2026-10-01"), { id: "b" });
    expect(on([a, b], today)?.memberships).toEqual(["Gold Monthly", "Silver"]);
    expect(on([b, a], today)?.memberships).toEqual(["Gold Monthly", "Silver"]);
  });

  it("a name the gym's old file gives is not a second membership of somebody who holds one", () => {
    // Ben's record says "Gold", his old software's name; staff gave him Gold Monthly here.
    const gold = active("Gold Monthly", monthly, "2026-10-05");
    expect(on([gold], today, "Gold")?.memberships).toEqual(["Gold Monthly"]);
  });

  it("holds no more names than a person can have memberships", () => {
    const many = Array.from({ length: 30 }, (_, n) => active(`Type ${String(n)}`, monthly, "2026-10-01"));
    const shown = on(many, today, "Gold");
    expect(shown?.memberships).toHaveLength(HELD_LIVE_MAX);
    expect(heldOnListSchema.safeParse(shown).success).toBe(true);
  });
});

describe("the Renews or ends column", () => {
  it("says the first membership's own day", () => {
    const gold = given(monthly, "2026-10-06", true, "2026-10-06");
    // [the membership, today, the day]
    const cases: [string, HeldForList, string, unknown][] = [
      ["a monthly renews a month on", held("Gold Monthly", gold), "2026-10-07", { what: "renews", on: "2026-11-06" }],
      ["its next renewal once that day has come", held("Gold Monthly", gold), "2026-11-06", { what: "renews", on: "2026-12-06" }],
      ["cancelled at the end of what is paid: it ends", held("Gold Monthly", moved(gold, { type: "cancel", when: "period_end" }, "2026-10-10")), "2026-10-11", { what: "ends", on: "2026-11-05" }],
      ["three months, to its last day", held("Three months", given(threeMonths, "2026-10-04", true, "2026-10-04")), "2026-10-07", { what: "ends", on: "2027-01-03" }],
      ["a pack, to its last day", held("PT 10", given(tenPack, "2026-10-04", true, "2026-10-04")), "2026-10-07", { what: "ends", on: "2027-01-01" }],
      ["frozen, since the day it was frozen", held("Gold Monthly", moved(gold, { type: "freeze" }, "2026-10-09")), "2026-10-20", { what: "frozen", on: "2026-10-09" }],
      ["still to start", held("Annual", given(yearly, "2026-10-20", true, "2026-10-07")), "2026-10-07", { what: "starts", on: "2026-10-20" }],
      ["cancelled today", held("Gold Monthly", moved(gold, { type: "cancel", when: "today" }, "2026-10-12")), "2026-10-20", { what: "cancelled", on: "2026-10-12" }],
      ["ended by its days", held("Free week", given(freeWeek, "2026-09-28", false, "2026-09-28")), "2026-10-07", { what: "ended", on: "2026-10-04" }],
    ];
    for (const [what, membership, today, day] of cases) {
      expect(on([membership], today)?.day, what).toEqual(day);
    }
  });

  it("a pack used up before its last day ended on no day the app knows", () => {
    const used = held("PT 10", { ...given(tenPack, "2026-10-04", true, "2026-10-04"), classesLeft: 0 });
    const shown = on([used], "2026-10-07");
    expect(shown?.status).toBe("ended");
    expect(shown?.day).toEqual({ what: "ended", on: null });
  });

  it("one taken from the gym's list keeps the list's own day", () => {
    // Paid a year ahead on a type set up as monthly: the rule renews every month, and the
    // list's day, the day they are paid up to, is the one printed.
    const paidAhead = held("Gold Monthly", { ...given(monthly, "2026-01-14", true, "2026-10-07"), paidPeriods: 12, paidFloor: 12 }, { fromList: true });
    expect(on([paidAhead], "2026-10-07")?.day).toEqual({ what: "renews", on: "2027-01-14" });
    // A free repeating one has nothing paid up to a day: none is printed.
    const freeFromList = held("Free monthly", given(freeMonthly, "2026-09-14", false, "2026-10-07"), { fromList: true });
    expect(on([freeFromList], "2026-10-07")?.day).toBeNull();
  });
});

// 18a-ii: the list's Payment reads the bills. The worst it could do: somebody who left
// without paying is found by nobody, or somebody who owes nothing is chased.
describe("a bill left open is Payment due on the list, whatever became of the membership", () => {
  const today = "2026-10-07";
  const owing = (list: readonly HeldForList[], owedSince: string | null, listedUnheld: string | null = null) =>
    heldOnList({ held: list, listedUnheld, today, owedSince });
  const cancelled = held("Gold Monthly", moved(given(monthly, "2026-08-01", false, "2026-08-01"), { type: "cancel", when: "today" }, "2026-09-03"));
  const endedPass = held("Day pass", given(dayPass, "2026-07-10", false, "2026-07-10"));
  const paidUp = held("Gold Monthly", given(monthly, "2026-10-01", true, "2026-10-01"));

  it("a membership cancelled or ended unpaid: Payment due since the bill's own day", () => {
    expect(owing([cancelled], "2026-08-01")).toMatchObject({ status: "cancelled", payment: { state: "due", since: "2026-08-01" } });
    const ended = owing([endedPass], "2026-07-10");
    expect(ended).toMatchObject({ status: "ended", payment: { state: "due", since: "2026-07-10" } });
    if (ended === null) throw new Error("no row");
    expect(heldListWords(ended).payment).toBe("Payment due");
  });

  it("the same people with no bill open say nothing of payment: paid, cancelled by staff or refunded, nobody is chased", () => {
    expect(owing([cancelled], null)?.payment).toBeNull();
    expect(owing([endedPass], null)?.payment).toBeNull();
  });

  it("an old bill beside a membership that is paid up: due, since the old bill's day", () => {
    expect(owing([paidUp], null)?.payment).toEqual({ state: "paid" });
    expect(owing([paidUp], "2026-07-10")?.payment).toEqual({ state: "due", since: "2026-07-10" });
    expect(owing([paidUp, endedPass], "2026-07-10")).toMatchObject({ status: "active", memberships: ["Gold Monthly"], payment: { state: "due", since: "2026-07-10" } });
  });

  it("the earliest day owed is the one said, whichever way round the two are", () => {
    const unpaid = held("Gold Monthly", given(monthly, "2026-10-01", false, "2026-10-01"));
    expect(owing([unpaid], null)?.payment).toEqual({ state: "due", since: "2026-10-01" });
    expect(owing([unpaid], "2026-07-10")?.payment).toEqual({ state: "due", since: "2026-07-10" });
    expect(owing([unpaid], "2026-10-05")?.payment).toEqual({ state: "due", since: "2026-10-01" });
    // Frozen and owing has no day of its own to say: the bill's is said.
    const frozen = held("Gold Monthly", moved(unpaid.membership, { type: "freeze" }, "2026-10-03"));
    expect(owing([frozen], null)?.payment).toEqual({ state: "due", since: null });
    expect(owing([frozen], "2026-10-01")?.payment).toEqual({ state: "due", since: "2026-10-01" });
  });

  it("a payment whose day has not come, and a free membership, turn due only with a bill open", () => {
    const later = held("Gold Monthly", given(monthly, "2026-11-01", false, today));
    expect(owing([later], null)?.payment).toEqual({ state: "later", on: "2026-11-01" });
    expect(owing([later, endedPass], "2026-07-10")?.payment).toEqual({ state: "due", since: "2026-07-10" });
    const free = held("Staff", given(freeMonthly, "2026-10-01", false, "2026-10-01"));
    expect(owing([free], null)?.payment).toEqual({ state: "free" });
    expect(owing([free, endedPass], "2026-07-10")?.payment).toEqual({ state: "due", since: "2026-07-10" });
  });

  it("a month staff let off by cancelling its bill is Free on the list, never Paid; a paid membership beside it is Paid; owing still wins", () => {
    const letOff = { ...paidUp, notCharged: true };
    expect(owing([paidUp], null)?.payment).toEqual({ state: "paid" });
    expect(owing([letOff], null)?.payment).toEqual({ state: "free" });
    const ended = owing([letOff], null);
    if (ended === null) throw new Error("no row");
    expect(heldListWords(ended).payment).toBe("Free");
    const other = held("Ten classes", given(tenPack, "2026-10-02", true, "2026-10-02"));
    expect(owing([letOff, other], null)?.payment).toEqual({ state: "paid" });
    expect(owing([letOff], "2026-07-10")?.payment).toEqual({ state: "due", since: "2026-07-10" });
    // Owing again the month after: the flag says nothing about a month that is due.
    const unpaid = { ...held("Gold Monthly", given(monthly, "2026-10-01", false, "2026-10-01")), notCharged: true };
    expect(owing([unpaid], null)?.payment).toEqual({ state: "due", since: "2026-10-01" });
  });

  it("the gym's own words still answer where its list names a membership they never had here", () => {
    expect(owing([endedPass], "2026-07-10", "Silver")).toBeNull();
    expect(owing([], "2026-07-10")).toBeNull();
  });
});

describe("somebody with nothing in use", () => {
  const today = "2026-10-07";
  const cancelled = held("Gold Monthly", moved(given(monthly, "2026-08-01", true, "2026-08-01"), { type: "cancel", when: "today" }, "2026-09-03"));
  const olderPass = held("Day pass", given(dayPass, "2026-07-10", true, "2026-07-10"));

  it("reads the newest one that is over, with no payment", () => {
    expect(on([olderPass, cancelled], today)).toEqual({ status: "cancelled", memberships: ["Gold Monthly"], day: { what: "cancelled", on: "2026-09-03" }, payment: null });
    expect(on([olderPass], today)).toEqual({ status: "ended", memberships: ["Day pass"], day: { what: "ended", on: "2026-07-10" }, payment: null });
  });

  it("names the one that finished last, whenever it started", () => {
    // Fay held a one-year membership for 300 days and bought a day pass 10 days ago. Staff
    // cancel the membership today: she is a cancelled member, not somebody whose day pass ended.
    const year = held("Gold Annual", moved(given(yearly, "2025-12-11", true, "2025-12-11"), { type: "cancel", when: "today" }, today));
    const pass = held("Day pass", given(dayPass, "2026-09-27", true, "2026-09-27"));
    for (const order of [[year, pass], [pass, year]]) {
      expect(on(order, today)).toEqual({ status: "cancelled", memberships: ["Gold Annual"], day: { what: "cancelled", on: today }, payment: null });
    }
  });

  it("orders the ones that are over by the day each finished, a membership before a pack on the same day, then the newest", () => {
    const ended = (name: string, type: HeldMembershipTerms, startsOn: string, extra: Partial<HeldForList> = {}) => held(name, given(type, startsOn, true, startsOn), extra);
    const cancelledOn = (name: string, type: HeldMembershipTerms, startsOn: string, day: string) =>
      held(name, moved(given(type, startsOn, true, startsOn), { type: "cancel", when: "today" }, day));
    // [what is over, the name the row gives, why]
    const cases: [string, HeldForList[], string][] = [
      ["a long one that ran out last week beside a pass from last month", [ended("Three months", threeMonths, "2026-07-01"), ended("Day pass", dayPass, "2026-09-10")], "Three months"],
      ["a pass yesterday beside a membership cancelled last month", [ended("Day pass", dayPass, "2026-10-06"), cancelledOn("Gold Monthly", monthly, "2026-06-01", "2026-09-05")], "Day pass"],
      ["a membership and a pack that finished the same day", [ended("Day pass", dayPass, "2026-09-30"), ended("Three months", threeMonths, "2026-07-01")], "Three months"],
      ["two cancelled the same day: the newer start", [cancelledOn("Silver", monthly, "2026-05-01", "2026-09-05"), cancelledOn("Gold Monthly", monthly, "2026-06-01", "2026-09-05")], "Gold Monthly"],
      // A pack used up before its last day finished on a day nobody stored; its start day stands in.
      ["a used-up pack bought after a membership ended", [held("PT 10", { ...given(tenPack, "2026-09-20", true, "2026-09-20"), classesLeft: 0 }), ended("Three months", threeMonths, "2026-06-01")], "PT 10"],
      ["a used-up pack bought before a membership ended", [held("PT 10", { ...given(tenPack, "2026-08-01", true, "2026-08-01"), classesLeft: 0 }), ended("Three months", threeMonths, "2026-06-10")], "Three months"],
      // The day somebody was cancelled is stored, so it counts as it stands: a gym that
      // moves its clock back can hold one cancelled on what is now tomorrow.
      ["one cancelled on a day after today", [cancelledOn("Gold Monthly", monthly, "2026-06-01", "2026-10-08"), cancelledOn("Silver", monthly, "2026-09-01", "2026-09-20")], "Gold Monthly"],
    ];
    for (const [what, list, name] of cases) {
      for (const order of [list, [...list].reverse()]) expect(on(order, today)?.memberships, what).toEqual([name]);
    }
    // Alike in every way: one order, whichever comes first.
    const a = ended("Day pass", dayPass, "2026-09-10", { id: "a" });
    const b = ended("Guest pass", dayPass, "2026-09-10", { id: "b" });
    expect(on([a, b], today)?.memberships).toEqual(["Day pass"]);
    expect(on([b, a], today)?.memberships).toEqual(["Day pass"]);
  });

  it("reads the gym's own words where its list names a membership they never had here", () => {
    expect(on([olderPass], today, "Gold")).toBeNull();
  });

  it("reads the gym's own words where they have held nothing", () => {
    expect(on([], today)).toBeNull();
    expect(on([], today, "Gold")).toBeNull();
  });

  it("a stored row the clock has ended is over, though nobody has written it so", () => {
    const pass = held("Day pass", given(dayPass, "2026-10-06", true, "2026-10-06"));
    expect(pass.membership.status).toBe("active");
    expect(on([pass], today)?.status).toBe("ended");
  });
});

describe("the words the Filter, the counts and the download use", () => {
  it("are the row's own", () => {
    const today = "2026-10-07";
    const gold = held("Gold Monthly", given(monthly, "2026-10-06", true, "2026-10-06"));
    const pack = held("PT 10", given(tenPack, "2026-10-01", false, "2026-10-01"));
    const shown = on([gold, pack], today);
    if (shown === null) throw new Error("nothing shown");
    expect(heldListWords(shown)).toEqual({ status: "Active", memberships: ["Gold Monthly", "PT 10"], payment: "Payment due" });
    const over = on([held("Gold Monthly", moved(gold.membership, { type: "cancel", when: "today" }, "2026-10-06"))], today);
    if (over === null) throw new Error("nothing shown");
    expect(heldListWords(over)).toEqual({ status: "Cancelled", memberships: ["Gold Monthly"], payment: null });
    expect(Object.values(HELD_STATUS_WORDS)).toEqual(["Not started", "Active", "Frozen", "Ended", "Cancelled"]);
    expect(HELD_PAYMENT_WORDS).toEqual({ due: "Payment due", later: "Not due yet", paid: "Paid", free: "Free" });
    const notYet = on([held("Annual", given(yearly, "2026-10-20", false, today))], today);
    if (notYet === null) throw new Error("nothing shown");
    expect(heldListWords(notYet)).toEqual({ status: "Not started", memberships: ["Annual"], payment: "Not due yet" });
  });
});

// Reports counts a person as left from this day (ROADMAP 21c-ii; spec Part 3 §16.9.4).
describe("the day Reports counts somebody as left", () => {
  const today = "2026-10-15";
  const ended = (name: string, type: HeldMembershipTerms, startsOn: string) => held(name, given(type, startsOn, true, startsOn));
  const cancelledOn = (name: string, type: HeldMembershipTerms, startsOn: string, day: string) =>
    held(name, moved(given(type, startsOn, true, startsOn), { type: "cancel", when: "today" }, day));
  const usedUp = (startsOn: string) => held("PT 10", { ...given(tenPack, startsOn, true, startsOn), classesLeft: 0 });
  const running = held("Gold Monthly", given(monthly, "2026-10-01", true, "2026-10-01"));
  const overdue = held("Gold Monthly", given(monthly, "2026-08-01", true, "2026-08-01"));
  const frozen = held("Gold Monthly", moved(given(monthly, "2026-09-01", true, "2026-09-01"), { type: "freeze" }, "2026-09-20"));
  const toStart = held("Annual", given(yearly, "2026-10-22", false, today));
  const stopped = held("Gold Monthly", moved(given(monthly, "2026-08-05", true, "2026-08-05"), { type: "cancel", when: "period_end" }, "2026-08-20"));
  const lastDayToday = ended("One month", { ...threeMonths, termCount: 1 }, "2026-09-16");
  const lastDayYesterday = ended("One month", { ...threeMonths, termCount: 1 }, "2026-09-15");
  const trialOver = held("Free week", given(freeWeek, "2026-07-10", false, "2026-07-10"));

  // [who, what they hold, what the gym's list names that they never held, the day they left]
  const cases: [string, HeldForList[], string | null, string | null][] = [
    ["nothing held: the gym's own words", [], null, null],
    ["nothing held, and the list names a membership", [], "Gold", null],
    ["running and paid", [running], null, null],
    ["running and two months overdue", [overdue], null, null],
    ["frozen", [frozen], null, null],
    ["still to start", [toStart], null, null],
    ["on its last day", [lastDayToday], null, null],
    ["an earlier one over and a new one running", [ended("Three months", threeMonths, "2026-06-01"), running], null, null],
    ["an earlier one cancelled and a new one still to start", [cancelledOn("Gold Monthly", monthly, "2026-06-01", "2026-09-05"), toStart], null, null],
    ["over, but the list names a membership they never held here", [lastDayYesterday], "Platinum", null],
    ["the day after its last day", [lastDayYesterday], null, "2026-10-14"],
    ["a free trial that ran out", [trialOver], null, "2026-07-16"],
    ["cancelled by staff: the day it was cancelled", [cancelledOn("Gold Monthly", monthly, "2026-09-01", "2026-10-03")], null, "2026-10-03"],
    ["stopped at the end of what was paid: its last day", [stopped], null, "2026-09-04"],
    // No day was stored for a pack's last class, so today stands in until its own last day passes.
    ["a pack used up with its last day still ahead", [usedUp("2026-09-20")], null, today],
    ["a pack used up, its last day gone", [usedUp("2026-06-01")], null, "2026-08-29"],
    ["a pack never used up, its last day gone", [ended("PT 10", tenPack, "2026-06-01")], null, "2026-08-29"],
    ["two over: the one that finished last is the one dated", [ended("Three months", threeMonths, "2026-06-01"), cancelledOn("Gold Monthly", monthly, "2026-08-01", "2026-10-02")], null, "2026-10-02"],
    ["two over, the cancelled one first: the later last day", [cancelledOn("Gold Monthly", monthly, "2026-06-01", "2026-07-05"), lastDayYesterday], null, "2026-10-14"],
    // A gym that moved its clock back can hold one cancelled on what is now tomorrow.
    ["cancelled on a day after today: never later than today", [cancelledOn("Gold Monthly", monthly, "2026-09-01", "2026-10-16")], null, today],
  ];

  it("is the day of the membership the list names, for exactly the people it reads as Ended or Cancelled", () => {
    for (const [what, list, listedUnheld, day] of cases) {
      for (const order of [list, [...list].reverse()]) {
        const input = { held: order, listedUnheld, today };
        expect(heldLeftOn(input), what).toBe(day);
        const status = heldOnList(input)?.status;
        expect(heldLeftOn(input) !== null, what).toBe(status === "ended" || status === "cancelled");
      }
    }
  });

  it("a bill left open changes nothing: owing is not leaving, and leaving is not paying", () => {
    for (const [what, list, listedUnheld, day] of cases) {
      expect(heldLeftOn({ held: list, listedUnheld, today, owedSince: "2026-09-01" }), what).toBe(day);
    }
  });

  it("the day before, the day and the day after a last day", () => {
    const left = (on: string) => heldLeftOn({ held: [lastDayToday], listedUnheld: null, today: on });
    expect([left("2026-10-14"), left("2026-10-15"), left("2026-10-16"), left("2026-12-25")]).toEqual([null, null, "2026-10-15", "2026-10-15"]);
  });

  it("a pack with no class left is dated by its last class, and that day never moves", () => {
    // Ten classes from 20 September, the last of them taken on 12 October; its own last day is 18 December.
    const pack = (usedUpOn: string | null, over: Partial<HeldMembership> = {}) =>
      held("PT 10", { ...given(tenPack, "2026-09-20", true, "2026-09-20"), classesLeft: 0, ...over }, { usedUpOn });
    const left = (m: HeldForList, on: string) => heldLeftOn({ held: [m], listedUnheld: null, today: on });
    const days = ["2026-10-13", "2026-10-31", "2026-11-02", "2026-12-18", "2026-12-19", "2027-03-01"];
    expect(days.map((on) => left(pack("2026-10-12"), on))).toEqual(days.map(() => "2026-10-12"));
    // A pack is charged when a class is booked. While the last class is today or still to
    // come they have not left, though the list reads "Ended"; from the day after, they
    // left on the day of that class, and it never moves.
    const booked = pack("2026-10-20");
    expect(["2026-10-15", "2026-10-19", "2026-10-20"].map((on) => left(booked, on))).toEqual([null, null, null]);
    expect(["2026-10-21", "2026-11-02", "2027-01-05"].map((on) => left(booked, on))).toEqual(["2026-10-20", "2026-10-20", "2026-10-20"]);
    expect(heldOnList({ held: [booked], listedUnheld: null, today: "2026-10-15" })?.status).toBe("ended");
    // A class dated after the pack's own last day does not move the day past it.
    expect(left(pack("2026-12-30"), "2027-01-10")).toBe("2026-12-18");
    // Classes left: the last class says nothing, and it runs to its last day.
    expect(left(pack("2026-10-12", { classesLeft: 3 }), "2026-11-02")).toBeNull();
    expect(left(pack("2026-10-12", { classesLeft: 3 }), "2026-12-19")).toBe("2026-12-18");
    // Cancelled by staff after the last class: the day it was cancelled, which is stored.
    const cancelled = held("PT 10", { ...moved(given(tenPack, "2026-09-20", true, "2026-09-20"), { type: "cancel", when: "today" }, "2026-10-14"), classesLeft: 0 }, { usedUpOn: "2026-10-12" });
    expect(left(cancelled, "2026-11-02")).toBe("2026-10-14");
    // The list's own row is not changed by it.
    expect(heldOnList({ held: [pack("2026-10-12")], listedUnheld: null, today: "2026-11-02" })).toEqual(
      heldOnList({ held: [pack(null)], listedUnheld: null, today: "2026-11-02" }),
    );
  });

  it("a pack with no class left and no class recorded: the day moves with today until its last day, then stays", () => {
    const pack = usedUp("2026-09-20");
    const left = (on: string) => heldLeftOn({ held: [pack], listedUnheld: null, today: on });
    // Ninety days from 20 September: its last day is 18 December.
    expect([left("2026-10-15"), left("2026-12-18"), left("2026-12-19"), left("2027-03-01")]).toEqual(["2026-10-15", "2026-12-18", "2026-12-18", "2026-12-18"]);
  });
});
