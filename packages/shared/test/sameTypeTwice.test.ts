// Would one person hold ONE membership type twice at once? The rule behind "They already
// have Gold Monthly" (the data-integrity pass over ROADMAP item 17: two staff pressing Add
// at one instant gave one person the type four times). Every class of case: each kind,
// each state, and the days either side of a last day, read off a 2026 calendar.
import { describe, expect, it } from "vitest";
import {
  giveHeldMembership,
  moveHeldMembership,
  sameTypeTwice,
  type HeldMembership,
  type HeldMembershipEvent,
  type HeldMembershipTerms,
} from "../src/index.js";

const monthly: HeldMembershipTerms = { kind: "recurring", termCount: 1, termUnit: "month", packClasses: null, packDays: null, priceMinor: 4999 };
const threeMonths: HeldMembershipTerms = { ...monthly, kind: "one_time", termCount: 3 };
const freeWeek: HeldMembershipTerms = { ...monthly, kind: "trial", termCount: 7, termUnit: "day", priceMinor: 0 };
const tenPack: HeldMembershipTerms = { kind: "pack", termCount: null, termUnit: null, packClasses: 10, packDays: 60, priceMinor: 9000 };

const TODAY = "2026-10-10";
function given(type: HeldMembershipTerms, startsOn: string, today = TODAY): HeldMembership {
  const made = giveHeldMembership(type, startsOn, true, today);
  if (!made.ok) throw new Error(`not given: ${made.reason}`);
  return made.membership;
}
function moved(m: HeldMembership, event: HeldMembershipEvent, today = TODAY): HeldMembership {
  const move = moveHeldMembership(m, event, today);
  if (!move.ok) throw new Error(`refused: ${JSON.stringify(event)}`);
  return move.membership;
}

// [what, the one they have, the one being given, twice?]
const cases: [string, HeldMembership, HeldMembership, boolean][] = [
  ["a repeating one, and the same again today", given(monthly, TODAY), given(monthly, TODAY), true],
  ["a repeating one, and the same again starting next year", given(monthly, TODAY), given(monthly, "2027-06-01"), true],
  ["a repeating one that started long ago", given(monthly, "2026-01-31", "2026-01-31"), given(monthly, TODAY), true],
  ["a repeating one still to start, and one from today", given(monthly, "2026-11-01"), given(monthly, TODAY), true],
  ["a repeating one that is frozen", moved(given(monthly, "2026-10-01", "2026-10-01"), { type: "freeze" }), given(monthly, "2026-12-01"), true],
  ["a repeating one cancelled today", moved(given(monthly, "2026-10-01", "2026-10-01"), { type: "cancel", when: "today" }), given(monthly, TODAY), false],
  // Paid to 1 November and stopping then: its last day is 31 October.
  ["a repeating one that stops on 31 Oct, and a new one from 1 Nov", moved(given(monthly, "2026-10-01", "2026-10-01"), { type: "cancel", when: "period_end" }), given(monthly, "2026-11-01"), false],
  ["a repeating one that stops on 31 Oct, and a new one from 31 Oct", moved(given(monthly, "2026-10-01", "2026-10-01"), { type: "cancel", when: "period_end" }), given(monthly, "2026-10-31"), true],
  // Three months from 4 October run through 3 January.
  ["a three-month one, and another over the same days", given(threeMonths, "2026-10-04", "2026-10-04"), given(threeMonths, TODAY), true],
  ["a three-month one, and the next from its last day", given(threeMonths, "2026-10-04", "2026-10-04"), given(threeMonths, "2027-01-03"), true],
  ["a three-month one, and the next from the day after its last", given(threeMonths, "2026-10-04", "2026-10-04"), given(threeMonths, "2027-01-04"), false],
  ["a three-month one that has ended", given(threeMonths, "2026-06-01", "2026-06-01"), given(threeMonths, TODAY), false],
  ["a three-month one that is frozen", moved(given(threeMonths, "2026-10-04", "2026-10-04"), { type: "freeze" }), given(threeMonths, "2027-03-01"), true],
  // A week's trial from 8 October runs through 14 October.
  ["a trial, and a second trial inside it", given(freeWeek, "2026-10-08", "2026-10-08"), given(freeWeek, "2026-10-14"), true],
  ["a trial, and a second one after it", given(freeWeek, "2026-10-08", "2026-10-08"), given(freeWeek, "2026-10-15"), false],
  ["a class pack, and a second pack the same day", given(tenPack, TODAY), given(tenPack, TODAY), false],
  ["a frozen class pack, and a second pack", moved(given(tenPack, TODAY), { type: "freeze" }), given(tenPack, TODAY), false],
];

describe("one membership type twice at once", () => {
  it.each(cases)("%s", (_what, has, next, twice) => {
    expect(sameTypeTwice(has, next, TODAY)).toBe(twice);
    // Which of the two is asked about first changes nothing.
    expect(sameTypeTwice(next, has, TODAY)).toBe(twice);
  });
});
