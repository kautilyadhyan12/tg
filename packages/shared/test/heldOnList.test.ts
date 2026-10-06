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
      ["paid now, the next one unpaid and still to start", [gold(), startsLaterUnpaid], { state: "due", since: "2026-10-20" }],
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
    const owes = (m: HeldForList) => heldMembershipView(m.membership, today).payment?.state === "due";
    const inUse = (m: HeldForList) => ["active", "frozen", "upcoming"].includes(heldMembershipView(m.membership, today).status);
    let sets = 0;
    for (let a = 0; a < pool.length; a++) {
      for (let b = a; b < pool.length; b++) {
        for (let c = b; c < pool.length; c++) {
          const list = [...new Set([pool[a], pool[b], pool[c]])].filter((m): m is HeldForList => m !== undefined);
          const using = list.filter(inUse);
          if (using.length === 0) continue;
          sets += 1;
          const expected = using.some(owes) ? "due" : using.some((m) => heldMembershipView(m.membership, today).payment?.state === "paid") ? "paid" : "free";
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

describe("somebody with nothing in use", () => {
  const today = "2026-10-07";
  const cancelled = held("Gold Monthly", moved(given(monthly, "2026-08-01", true, "2026-08-01"), { type: "cancel", when: "today" }, "2026-09-03"));
  const olderPass = held("Day pass", given(dayPass, "2026-07-10", true, "2026-07-10"));

  it("reads the newest one that is over, with no payment", () => {
    expect(on([olderPass, cancelled], today)).toEqual({ status: "cancelled", memberships: ["Gold Monthly"], day: { what: "cancelled", on: "2026-09-03" }, payment: null });
    expect(on([olderPass], today)).toEqual({ status: "ended", memberships: ["Day pass"], day: { what: "ended", on: "2026-07-10" }, payment: null });
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
    expect(HELD_PAYMENT_WORDS).toEqual({ due: "Payment due", paid: "Paid", free: "Free" });
  });
});
