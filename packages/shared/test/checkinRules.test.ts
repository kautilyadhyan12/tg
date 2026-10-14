// Who the front desk lets in (spec Part 3 §12.4; ROADMAP 16d).
//
// The worst thing this job could do to a real person: turn a paid-up member away at the
// door. That is the first block. Every membership below is made by the rule that gives and
// changes one (`giveHeldMembership`, `moveHeldMembership`) and read by the Members list's
// own rule (`heldOnList`), so the desk is tested against what a person really holds and
// never against a status typed here; every day is read off the 2026 calendar.
import { describe, expect, it } from "vitest";
import {
  CHECKIN_RULES_START,
  CHECKIN_STOP_WORDS,
  checkinRulesStopAnyone,
  checkinStop,
  checkinStopReasonSchema,
  giveHeldMembership,
  heldOnList,
  memberBillState,
  moveHeldMembership,
  type CheckinRules,
  type CheckinStopReason,
  type HeldForList,
  type HeldMembership,
  type HeldMembershipEvent,
  type HeldMembershipTerms,
} from "../src/index.js";

const monthly: HeldMembershipTerms = { kind: "recurring", termCount: 1, termUnit: "month", packClasses: null, packDays: null, priceMinor: 4500 };
const yearly: HeldMembershipTerms = { ...monthly, termUnit: "year", priceMinor: 40000 };
const threeMonths: HeldMembershipTerms = { ...monthly, kind: "one_time", termCount: 3, priceMinor: 12000 };
const freeWeek: HeldMembershipTerms = { ...monthly, kind: "trial", termCount: 7, termUnit: "day", priceMinor: 0 };
const tenPack: HeldMembershipTerms = { kind: "pack", termCount: null, termUnit: null, packClasses: 10, packDays: 90, priceMinor: 30000 };
const dayPass: HeldMembershipTerms = { ...tenPack, packClasses: 1, packDays: 1, priceMinor: 1500 };

const TODAY = "2026-10-12";

function given(type: HeldMembershipTerms, startsOn: string, paid: boolean, on = startsOn): HeldMembership {
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
const one = (typeName: string, membership: HeldMembership): HeldForList => {
  made += 1;
  return { id: `m${String(made).padStart(4, "0")}`, typeName, fromList: false, membership };
};

interface Person {
  held: readonly HeldForList[];
  /** The membership word on the gym's own file that names nothing they hold here. */
  listedUnheld?: string | null;
  /** The day their oldest open bill fell due. */
  owedSince?: string | null;
  staff?: boolean;
  /** Signed the waiver in use; null (the start) where the gym asks for none. */
  waiverSigned?: boolean | null;
}

const ALL_RULES: CheckinRules[] = [
  { who: "everyone", overdue: "let_in", waiver: "let_in" },
  { who: "everyone", overdue: "see_staff", waiver: "let_in" },
  { who: "current_membership", overdue: "let_in", waiver: "let_in" },
  { who: "current_membership", overdue: "see_staff", waiver: "let_in" },
];
const STRICT: CheckinRules = { who: "current_membership", overdue: "see_staff", waiver: "let_in" };

function stop(person: Person, rules: CheckinRules, overdueAfterDays = 0, today = TODAY): CheckinStopReason | null {
  const owedSince = person.owedSince ?? null;
  return checkinStop({
    rules,
    staff: person.staff ?? false,
    held: heldOnList({ held: person.held, listedUnheld: person.listedUnheld ?? null, today, owedSince }),
    owedSince,
    today,
    overdueAfterDays,
    waiverSigned: person.waiverSigned ?? null,
  });
}

describe("a paid-up member is never turned away", () => {
  const paidUp: [string, Person][] = [
    ["a monthly membership paid this month", { held: [one("Gold Monthly", given(monthly, "2026-10-01", true))] }],
    ["a monthly membership paid on its very first day, today", { held: [one("Gold Monthly", given(monthly, TODAY, true))] }],
    ["a monthly membership on the last day it is paid up to", { held: [one("Gold Monthly", given(monthly, "2026-09-13", true))] }],
    ["a year paid in January", { held: [one("Gold Yearly", given(yearly, "2026-01-05", true))] }],
    ["three months paid once, in its last week", { held: [one("3 Months", given(threeMonths, "2026-07-18", true))] }],
    ["a free trial week, on its last day", { held: [one("Free Week", given(freeWeek, "2026-10-06", false))] }],
    ["a class pack with classes left", { held: [one("PT 10", given(tenPack, "2026-09-01", true))] }],
    ["a day pass bought today", { held: [one("Day Pass", given(dayPass, TODAY, true))] }],
    [
      "a membership frozen and unfrozen again",
      { held: [one("Gold Monthly", moved(moved(given(monthly, "2026-10-01", true), { type: "freeze" }, "2026-10-03"), { type: "unfreeze" }, "2026-10-08"))] },
    ],
    [
      "a membership set to stop at the end of what is paid, still running",
      { held: [one("Gold Monthly", moved(given(monthly, "2026-10-01", true), { type: "cancel", when: "period_end" }, "2026-10-05"))] },
    ],
    [
      "a running membership beside an old one that was cancelled",
      {
        held: [
          one("Gold Monthly", given(monthly, "2026-10-01", true)),
          one("Silver", moved(given(monthly, "2026-06-01", true), { type: "cancel", when: "today" }, "2026-06-20")),
        ],
      },
    ],
    [
      "a running membership beside a frozen pack",
      { held: [one("Gold Monthly", given(monthly, "2026-10-01", true)), one("PT 10", moved(given(tenPack, "2026-09-01", true), { type: "freeze" }, "2026-09-20"))] },
    ],
    [
      "a running membership, with the gym's old file still calling them Expired",
      { held: [one("Gold Monthly", given(monthly, "2026-10-01", true))], listedUnheld: "Expired" },
    ],
  ];

  it.each(paidUp)("%s: let in under every choice a gym can make", (_name, person) => {
    for (const rules of ALL_RULES) {
      for (const days of [0, 7, 60]) expect(stop(person, rules, days), JSON.stringify(rules)).toBeNull();
    }
  });
});

describe("where every gym starts, nobody is stopped", () => {
  const anybody: [string, Person][] = [
    ["nothing held in the app", { held: [] }],
    ["only a word on the gym's file", { held: [], listedUnheld: "Gold" }],
    ["a membership that ended", { held: [one("3 Months", given(threeMonths, "2026-01-01", true))] }],
    ["a cancelled membership with a bill a year old", { held: [one("Silver", moved(given(monthly, "2025-09-01", false), { type: "cancel", when: "today" }, "2025-09-20"))], owedSince: "2025-09-01" }],
    ["a frozen membership", { held: [one("Gold Monthly", moved(given(monthly, "2026-10-01", true), { type: "freeze" }, "2026-10-05"))] }],
  ];

  it.each(anybody)("%s", (_name, person) => {
    expect(stop(person, CHECKIN_RULES_START)).toBeNull();
    expect(checkinRulesStopAnyone(CHECKIN_RULES_START)).toBe(false);
  });

  it("any other choice can stop somebody", () => {
    for (const rules of ALL_RULES.slice(1)) expect(checkinRulesStopAnyone(rules)).toBe(true);
  });
});

describe("only members with a current membership", () => {
  const rules: CheckinRules = { who: "current_membership", overdue: "let_in", waiver: "let_in" };
  const cases: [string, Person, CheckinStopReason | null][] = [
    ["nothing held in the app", { held: [] }, "no_membership"],
    ["only a word on the gym's file, whatever it says", { held: [], listedUnheld: "Active Gold" }, "no_membership"],
    ["a membership that starts next week", { held: [one("Gold Monthly", given(monthly, "2026-10-19", true, TODAY))] }, "not_started"],
    ["a membership that starts tomorrow", { held: [one("Gold Monthly", given(monthly, "2026-10-13", true, TODAY))] }, "not_started"],
    ["a frozen membership", { held: [one("Gold Monthly", moved(given(monthly, "2026-10-01", true), { type: "freeze" }, "2026-10-05"))] }, "frozen"],
    ["three months that ran out yesterday", { held: [one("3 Months", given(threeMonths, "2026-07-12", true))] }, "ended"],
    ["a trial week that ran out", { held: [one("Free Week", given(freeWeek, "2026-10-01", false))] }, "ended"],
    ["a day pass from yesterday", { held: [one("Day Pass", given(dayPass, "2026-10-11", true))] }, "ended"],
    ["a class pack with no class left", { held: [one("PT 10", { ...given(tenPack, "2026-09-01", true), classesLeft: 0 })] }, "ended"],
    ["a membership cancelled last week", { held: [one("Gold Monthly", moved(given(monthly, "2026-09-01", true), { type: "cancel", when: "today" }, "2026-10-05"))] }, "cancelled"],
    [
      "a membership set to stop at the end of what was paid, now past it",
      { held: [one("Gold Monthly", moved(given(monthly, "2026-09-01", true), { type: "cancel", when: "period_end" }, "2026-09-10"))] },
      "ended",
    ],
    ["a frozen membership and one still to start: the frozen one answers", {
      held: [one("Gold Monthly", moved(given(monthly, "2026-10-01", true), { type: "freeze" }, "2026-10-05")), one("PT 10", given(tenPack, "2026-10-20", true, TODAY))],
    }, "frozen"],
    // A repeating membership is never ended for being unpaid: it is current, and whether
    // it is let in while it owes is the other choice.
    ["a monthly membership never paid, still running", { held: [one("Gold Monthly", given(monthly, "2026-09-01", false))], owedSince: "2026-09-01" }, null],
  ];

  it.each(cases)("%s", (_name, person, expected) => {
    expect(stop(person, rules)).toBe(expected);
  });

  it("the gym's owner and staff are let in, whatever they hold", () => {
    for (const [, person] of cases) expect(stop({ ...person, staff: true }, STRICT)).toBeNull();
  });
});

describe("a payment overdue is sent to staff", () => {
  const rules: CheckinRules = { who: "everyone", overdue: "see_staff", waiver: "let_in" };
  const running = (owedSince: string | null): Person => ({ held: [one("Gold Monthly", given(monthly, "2026-09-01", false))], owedSince });

  // The day a bill first reads Overdue, for each of the gym's days of grace: the day after
  // its due date and the grace.
  it.each([
    [0, "2026-10-12", null],
    [0, "2026-10-11", "overdue"],
    [3, "2026-10-09", null],
    [3, "2026-10-08", "overdue"],
    [7, "2026-10-05", null],
    [7, "2026-10-04", "overdue"],
    [60, "2026-08-13", null],
    [60, "2026-08-12", "overdue"],
  ] as const)("%i days of grace, a bill due on %s", (days, dueOn, expected) => {
    expect(stop(running(dueOn), rules, days)).toBe(expected);
    // The desk and the person's page say Overdue on the same day.
    expect(memberBillState({ status: "open", dueOn }, TODAY, days) === "overdue").toBe(expected === "overdue");
  });

  it("no bill open is never overdue, whatever the membership itself says is due", () => {
    // A repeating membership taken from a gym's file reads Payment due with no bill of ours.
    expect(stop(running(null), rules)).toBeNull();
    expect(stop(running(null), STRICT)).toBeNull();
  });

  it("a bill left owing on a membership that is over stops them too", () => {
    const person: Person = { held: [one("Silver", moved(given(monthly, "2026-08-01", false), { type: "cancel", when: "today" }, "2026-09-03"))], owedSince: "2026-08-01" };
    expect(stop(person, rules)).toBe("overdue");
    // With both choices on, the membership is what staff are told first.
    expect(stop(person, STRICT)).toBe("cancelled");
    expect(stop(person, { who: "current_membership", overdue: "let_in", waiver: "let_in" })).toBe("cancelled");
  });

  it("the gym's owner and staff are let in with a bill overdue", () => {
    expect(stop({ ...running("2026-09-01"), staff: true }, STRICT)).toBeNull();
  });

  it("somebody with nothing held and no bill is let in while everyone is", () => {
    expect(stop({ held: [] }, rules)).toBeNull();
  });
});

describe("a waiver not signed is sent to staff (3e-ii)", () => {
  const rules: CheckinRules = { who: "everyone", overdue: "let_in", waiver: "see_staff" };
  const paid: Person = { held: [one("Gold Monthly", given(monthly, "2026-10-01", true))] };
  const cases: [string, Person, CheckinStopReason | null][] = [
    ["signed the waiver in use", { ...paid, waiverSigned: true }, null],
    ["has not signed it", { ...paid, waiverSigned: false }, "no_waiver"],
    ["has not signed it and holds nothing here", { held: [], waiverSigned: false }, "no_waiver"],
    ["the gym asks for no waiver", { ...paid, waiverSigned: null }, null],
    ["the gym asks for none, and nothing held", { held: [], waiverSigned: null }, null],
  ];

  it.each(cases)("%s", (_name, person, expected) => {
    expect(stop(person, rules)).toBe(expected);
  });

  it("is never asked while the gym lets everybody in", () => {
    for (const [, person] of cases) expect(stop(person, CHECKIN_RULES_START)).toBeNull();
    expect(checkinRulesStopAnyone(rules)).toBe(true);
  });

  it("the gym's owner and staff are let in without a signature", () => {
    expect(stop({ ...paid, waiverSigned: false, staff: true }, rules)).toBeNull();
  });

  it("a membership or a payment is what staff are told first", () => {
    const all: CheckinRules = { who: "current_membership", overdue: "see_staff", waiver: "see_staff" };
    expect(stop({ held: [], waiverSigned: false }, all)).toBe("no_membership");
    expect(stop({ held: [one("Gold Monthly", given(monthly, "2026-09-01", false))], owedSince: "2026-09-01", waiverSigned: false }, all)).toBe("overdue");
    expect(stop({ ...paid, waiverSigned: false }, all)).toBe("no_waiver");
  });
});

describe("the words staff read", () => {
  it("has a line for every reason", () => {
    for (const reason of checkinStopReasonSchema.options) expect(CHECKIN_STOP_WORDS[reason]).toMatch(/^(No membership|Membership |Payment overdue|Waiver not signed)/);
  });
});
