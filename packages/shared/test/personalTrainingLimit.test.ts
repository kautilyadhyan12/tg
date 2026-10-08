// A LIMIT ON PERSONAL TRAINING SESSIONS ON A MEMBERSHIP (ROADMAP 17e-v; spec Part 3 §13.5).
//
// The worst thing: a member refused a session they paid for, because somebody else's
// sessions or days outside their own week or month were counted against them; or the other
// way, sessions the gym never sold, because a limit was not held.
import { describe, expect, it } from "vitest";
import {
  PT_COUNTED,
  decidePtBook,
  giveHeldMembership,
  pickPtCover,
  ptAllowanceOf,
  ptCountedSpan,
  ptUsedOn,
  saveGymMembershipTypeRequestSchema,
  updateGymMembershipTypeRequestSchema,
  type HeldMembership,
  type HeldMembershipTerms,
  type MembershipLimitPeriod,
  type PtCountedDay,
  type PtCover,
  type PtHeld,
} from "../src/index.js";

const DAY = "2026-10-20"; // a Tuesday: its week is Monday 19 to Sunday 25 October

const monthly: HeldMembershipTerms = { kind: "recurring", termCount: 1, termUnit: "month", packClasses: null, packDays: null, priceMinor: 4999 };
const tenPack: HeldMembershipTerms = { kind: "pack", termCount: null, termUnit: null, packClasses: 10, packDays: 60, priceMinor: 9000 };

function given(type: HeldMembershipTerms, startsOn: string): HeldMembership {
  const made = giveHeldMembership(type, startsOn, true, startsOn);
  if (!made.ok) throw new Error(`not given: ${made.reason}`);
  return made.membership;
}
const gold = given(monthly, "2026-10-01");
const pack = (left: number): HeldMembership => ({ ...given(tenPack, "2026-10-01"), classesLeft: left });

const limited = (id: string, ptLimit: number, ptPeriod: MembershipLimitPeriod, used: number, membership = gold): PtHeld => ({
  id,
  membership,
  includesPt: true,
  ptLimit,
  ptPeriod,
  used,
});
const open = (id: string, membership = gold, includesPt = true): PtHeld => ({ id, membership, includesPt, ptLimit: null, ptPeriod: null, used: 0 });
const cover = (list: PtHeld[], gymHasTypes = true): PtCover => pickPtCover({ gymHasTypes, day: DAY, held: list });

describe("the worst thing: only a person's own sessions, in the session's own week or month, are counted", () => {
  const on = (membershipId: string, day: string, n = 1): PtCountedDay => ({ membershipId, day, n });
  const week = { id: "mine", ptPeriod: "week" as const };
  const month = { id: "mine", ptPeriod: "month" as const };

  it("somebody else's sessions are never counted against a membership", () => {
    const counted = [on("theirs", DAY, 9), on("another", "2026-10-21", 3)];
    expect(ptUsedOn(week, DAY, counted)).toBe(0);
    expect(ptUsedOn(month, DAY, counted)).toBe(0);
    expect(ptUsedOn(week, DAY, [...counted, on("mine", DAY)])).toBe(1);
  });

  it.each([
    // [what, the session's day, the day a session is counted on, in its week, in its month]
    ["the Sunday before the week", DAY, "2026-10-18", false, true],
    ["the week's Monday", DAY, "2026-10-19", true, true],
    ["the same day", DAY, "2026-10-20", true, true],
    ["the week's Sunday", DAY, "2026-10-25", true, true],
    ["the Monday after the week", DAY, "2026-10-26", false, true],
    ["the first of the month", DAY, "2026-10-01", false, true],
    ["the last of the month", DAY, "2026-10-31", false, true],
    ["the last day of the month before", DAY, "2026-09-30", false, false],
    ["the first day of the month after", DAY, "2026-11-01", false, false],
    ["a week that runs over the month's end: its Sunday is next month", "2026-10-31", "2026-11-01", true, false],
    ["a week that runs over the month's end: its Monday is this month", "2026-11-01", "2026-10-26", true, false],
    ["a week that runs over the year's end", "2027-01-01", "2026-12-28", true, false],
    ["the day before that week", "2027-01-01", "2026-12-27", false, false],
    ["the 29th of February in a leap year", "2028-02-01", "2028-02-29", false, true],
    ["the first of March after it", "2028-02-29", "2028-03-01", true, false],
    ["the same date a year earlier", DAY, "2025-10-20", false, false],
  ])("%s", (_what, day, countedOn, inWeek, inMonth) => {
    expect(ptUsedOn(week, day, [on("mine", countedOn)])).toBe(inWeek ? 1 : 0);
    expect(ptUsedOn(month, day, [on("mine", countedOn)])).toBe(inMonth ? 1 : 0);
  });

  it("several days add up, and a membership with no limit counts nothing", () => {
    const counted = [on("mine", "2026-10-19", 2), on("mine", "2026-10-25"), on("mine", "2026-10-02", 4), on("mine", "2026-11-02", 7)];
    expect(ptUsedOn(week, DAY, counted)).toBe(3);
    expect(ptUsedOn(month, DAY, counted)).toBe(7);
    expect(ptUsedOn({ id: "mine", ptPeriod: null }, DAY, counted)).toBe(0);
  });

  it("a free cancel is not one of the counted kinds; a late cancel and a missed session are", () => {
    expect([...PT_COUNTED].sort()).toEqual(["attended", "booked", "late_cancelled", "no_show"]);
  });

  it("the days read for a limit hold every week and month of the days asked", () => {
    expect(ptCountedSpan([DAY])).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(ptCountedSpan(["2026-10-31"])).toEqual({ from: "2026-10-01", to: "2026-11-01" });
    expect(ptCountedSpan(["2026-10-30", "2026-11-05"])).toEqual({ from: "2026-10-01", to: "2026-11-30" });
    expect(ptCountedSpan(["2027-01-01"])).toEqual({ from: "2026-12-28", to: "2027-01-31" });
    expect(ptCountedSpan([])).toBeNull();
  });
});

describe("pickPtCover with a limit: what pays, and what is refused", () => {
  it.each([0, 1, 3])("4 a week with %i used pays, and nothing is charged", (used) => {
    expect(cover([limited("a", 4, "week", used)])).toEqual({ ok: true, membershipId: "a", chargePack: false });
  });
  it.each([
    [4, "week", "limit_week"],
    [5, "week", "limit_week"],
    [4, "month", "limit_month"],
    [200, "month", "limit_month"],
  ] as const)("4 a period with %i used in the %s is refused, naming the membership", (used, period, reason) => {
    expect(cover([limited("a", 4, period, used)])).toEqual({ ok: false, reason, membershipId: "a" });
  });
  it("the limit of 1 allows the first and refuses the second", () => {
    expect(cover([limited("a", 1, "month", 0)]).ok).toBe(true);
    expect(cover([limited("a", 1, "month", 1)]).ok).toBe(false);
  });
  it("past the limit a pack with a session left pays, and is charged", () => {
    expect(cover([limited("a", 4, "week", 4), open("p", pack(2))])).toEqual({ ok: true, membershipId: "p", chargePack: true });
  });
  it("with sessions left on the membership the pack is kept", () => {
    expect(cover([open("p", pack(2)), limited("a", 4, "week", 3)])).toEqual({ ok: true, membershipId: "a", chargePack: false });
  });
  it("past the limit with an empty pack, the limit is what is said", () => {
    expect(cover([limited("a", 4, "month", 4), open("p", pack(0))])).toEqual({ ok: false, reason: "limit_month", membershipId: "a" });
  });
  it("a membership with no limit pays before one with a limit, used or not", () => {
    expect(cover([limited("a", 4, "week", 4), open("b")])).toEqual({ ok: true, membershipId: "b", chargePack: false });
    expect(cover([limited("a", 4, "week", 0), open("b")])).toEqual({ ok: true, membershipId: "b", chargePack: false });
  });
  it("of two with limits, the one with sessions left pays", () => {
    expect(cover([limited("a", 2, "week", 2), limited("b", 8, "month", 7)])).toEqual({ ok: true, membershipId: "b", chargePack: false });
    expect(cover([limited("a", 2, "week", 2), limited("b", 8, "month", 8)])).toEqual({ ok: false, reason: "limit_week", membershipId: "a" });
  });
  it("a limit on a membership that is frozen, or has not started, refuses for that and not for the limit", () => {
    expect(cover([limited("f", 4, "week", 0, { ...gold, status: "frozen", frozenOn: "2026-10-05" })])).toEqual({ ok: false, reason: "no_membership" });
    expect(cover([limited("l", 4, "week", 0, given(monthly, "2026-10-21"))])).toEqual({ ok: false, reason: "no_membership" });
  });
  it("a membership without personal training is not made to pay by a limit beside it", () => {
    expect(cover([open("classes", gold, false), limited("a", 1, "week", 1)])).toEqual({ ok: false, reason: "limit_week", membershipId: "a" });
  });
  it("a limit with no period is no decision to pay: it is refused, never free", () => {
    const half: PtHeld = { id: "a", membership: gold, includesPt: true, ptLimit: 4, ptPeriod: null, used: 0 };
    expect(cover([half]).ok).toBe(false);
    const other: PtHeld = { id: "a", membership: gold, includesPt: true, ptLimit: null, ptPeriod: "week", used: 0 };
    expect(cover([other]).ok).toBe(false);
  });
  it("a gym that sells no memberships books anybody, as before", () => {
    expect(cover([limited("a", 1, "week", 9)], false)).toEqual({ ok: true, membershipId: null, chargePack: false });
  });
  it("a booking past the limit is refused in the limit's own word, after everything about the time", () => {
    const fine = { offers: true, offered: true, started: false, tooFar: false, notOpenYet: false, trainerBusy: false, trainerInClass: false, trainerOff: false, personBusy: false };
    const full = cover([limited("a", 4, "month", 4)]);
    expect(decidePtBook({ ...fine, cover: full })).toEqual({ kind: "refuse", reason: "limit_month" });
    expect(decidePtBook({ ...fine, trainerBusy: true, cover: full })).toEqual({ kind: "refuse", reason: "time_taken" });
  });
});

describe("what is left, as a screen reads it", () => {
  const named = (h: PtHeld, typeName: string) => ({ ...h, typeName });
  it("the paying membership's limit, with what is left before this booking", () => {
    const held = [named(limited("a", 4, "week", 1), "Gold")];
    expect(ptAllowanceOf(cover(held), held)).toEqual({ membership: "Gold", limit: 4, period: "week", left: 3 });
  });
  it("nothing left names the membership whose sessions are used, never a number under 0", () => {
    const held = [named(limited("a", 4, "month", 6), "Gold")];
    expect(ptAllowanceOf(cover(held), held)).toEqual({ membership: "Gold", limit: 4, period: "month", left: 0 });
  });
  it("a pack that pays past the limit is not a limit, and neither is a membership without one", () => {
    const withPack = [named(limited("a", 4, "week", 4), "Gold"), named(open("p", pack(2)), "PT 10")];
    expect(ptAllowanceOf(cover(withPack), withPack)).toBeNull();
    const plain = [named(open("b"), "Platinum")];
    expect(ptAllowanceOf(cover(plain), plain)).toBeNull();
    expect(ptAllowanceOf({ ok: false, reason: "not_covered" }, plain)).toBeNull();
    expect(ptAllowanceOf({ ok: true, membershipId: null, chargePack: false }, plain)).toBeNull();
  });
});

describe("a membership type's limit, as a gym sends it", () => {
  const type = {
    name: "Gold",
    description: null,
    kind: "recurring",
    priceMinor: 9900,
    termCount: 1,
    termUnit: "month",
    packClasses: null,
    packDays: null,
    access: "all_classes",
    bookingsLimit: null,
    bookingsPeriod: null,
    classTypeIds: null,
    includesPt: true,
  };
  const save = (over: object) => saveGymMembershipTypeRequestSchema.safeParse({ ...type, ...over });

  it("left out of a new type is no limit", () => {
    const parsed = saveGymMembershipTypeRequestSchema.parse(type);
    expect([parsed.ptLimit, parsed.ptPeriod]).toEqual([null, null]);
  });
  it("a number with its period is kept", () => {
    expect(save({ ptLimit: 4, ptPeriod: "month" }).success).toBe(true);
    expect(save({ ptLimit: 1, ptPeriod: "week" }).success).toBe(true);
    expect(save({ ptLimit: 200, ptPeriod: "week" }).success).toBe(true);
  });
  it.each([
    ["a number with no period", { ptLimit: 4, ptPeriod: null }],
    ["a period with no number", { ptLimit: null, ptPeriod: "week" }],
    ["none", { ptLimit: 0, ptPeriod: "week" }],
    ["under none", { ptLimit: -1, ptPeriod: "week" }],
    ["more than the most", { ptLimit: 201, ptPeriod: "week" }],
    ["half a session", { ptLimit: 2.5, ptPeriod: "week" }],
    ["a number as text", { ptLimit: "4", ptPeriod: "week" }],
    ["a year", { ptLimit: 4, ptPeriod: "year" }],
    ["a day", { ptLimit: 4, ptPeriod: "day" }],
    ["a limit on a type without personal training", { ptLimit: 4, ptPeriod: "week", includesPt: false }],
  ])("refused: %s", (_what, over) => {
    expect(save(over).success).toBe(false);
  });
  it("a pack has no limit a week or a month: its own count is its limit", () => {
    const aPack = { ...type, kind: "pack", termCount: null, termUnit: null, packClasses: 10, packDays: 90 };
    expect(saveGymMembershipTypeRequestSchema.safeParse(aPack).success).toBe(true);
    expect(saveGymMembershipTypeRequestSchema.safeParse({ ...aPack, ptLimit: 4, ptPeriod: "week" }).success).toBe(false);
  });
  it("a change must say the limit outright: left out, it would take the limit off everybody who holds the type", () => {
    const stamped = { ...type, updatedAt: "2026-10-08T10:00:00.000Z" };
    expect(updateGymMembershipTypeRequestSchema.safeParse(stamped).success).toBe(false);
    expect(updateGymMembershipTypeRequestSchema.safeParse({ ...stamped, ptLimit: null }).success).toBe(false);
    expect(updateGymMembershipTypeRequestSchema.safeParse({ ...stamped, ptLimit: null, ptPeriod: null }).success).toBe(true);
    expect(updateGymMembershipTypeRequestSchema.safeParse({ ...stamped, ptLimit: 4, ptPeriod: "month" }).success).toBe(true);
  });
});
