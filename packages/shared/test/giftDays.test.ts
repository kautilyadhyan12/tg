// Refer a friend's free days on a membership (spec Part 3 §16.3; ROADMAP 20e-ii-b-ii-b).
//
// The worst thing this could do to a real person: move a date already begun, so a member is
// billed again for days they already paid for, shown as owing early, or shown paid when they
// owe. So the first block is every kind of membership, with each expected day read off the
// calendar (31 Jan + 1 month is 28 Feb, + 14 days is 14 Mar), and the sweep at the end holds
// the promise for thousands of memberships the table never names: nothing before the days
// moves, everything after them moves by exactly that many days.
import { describe, expect, it } from "vitest";
import {
  GIFT_DAYS_MAX,
  addDays,
  addGiftDays,
  giftDaysNextDay,
  giftDaysTarget,
  giveHeldMembership,
  heldMembershipView,
  moveHeldMembership,
  periodIndex,
  periodStart,
  shownRenewal,
  takeBackGiftDays,
  type HeldMembership,
  type HeldMembershipTerms,
} from "../src/index.js";

const monthly: HeldMembershipTerms = { kind: "recurring", termCount: 1, termUnit: "month", packClasses: null, packDays: null, priceMinor: 4999 };
const weekly: HeldMembershipTerms = { ...monthly, termUnit: "week" };
const threeMonths: HeldMembershipTerms = { ...monthly, kind: "one_time", termCount: 3 };
const freeWeek: HeldMembershipTerms = { ...monthly, kind: "trial", termCount: 7, termUnit: "day", priceMinor: 0 };
const tenPack: HeldMembershipTerms = { kind: "pack", termCount: null, termUnit: null, packClasses: 10, packDays: 60, priceMinor: 9000 };

function given(type: HeldMembershipTerms, startsOn: string, paid: boolean, today: string): HeldMembership {
  const made = giveHeldMembership(type, startsOn, paid, today);
  if (!made.ok) throw new Error(`not given: ${made.reason}`);
  return made.membership;
}

function plus(m: HeldMembership, days: number, today: string): HeldMembership {
  const added = addGiftDays(m, days, today);
  if (added === null) throw new Error(`no days given on ${today}`);
  return added.membership;
}

const renewsOn = (m: HeldMembership, today: string): string | null => heldMembershipView(m, today).renewsOn;
const endsOn = (m: HeldMembership, today: string): string | null => heldMembershipView(m, today).endsOn;

describe("free days move the next renewal or the last day, and nothing already begun", () => {
  it("a monthly membership paid to 15 November renews 14 days later, every month after too", () => {
    const m = given(monthly, "2026-10-15", true, "2026-10-15");
    const after = plus(m, 14, "2026-11-03");
    expect(renewsOn(m, "2026-11-03")).toBe("2026-11-15");
    expect(renewsOn(after, "2026-11-03")).toBe("2026-11-29");
    expect(heldMembershipView(after, "2026-11-03").payment).toEqual({ state: "paid", until: "2026-11-29" });
    expect(periodStart(after, 2)).toBe("2026-12-29");
    expect(periodStart(after, 3)).toBe("2027-01-29");
    // Nothing owed on the day the old renewal would have fallen.
    expect(heldMembershipView(after, "2026-11-15").payment).toEqual({ state: "paid", until: "2026-11-29" });
    expect(heldMembershipView(after, "2026-11-29").payment).toEqual({ state: "due", since: "2026-11-29" });
    expect(giftDaysNextDay(after, 1)).toEqual({ renews: true, day: "2026-11-29" });
  });

  it("at a month's end: started 31 January, renewing 28 February, renews 14 March", () => {
    const m = given(monthly, "2026-01-31", true, "2026-01-31");
    const after = plus(m, 14, "2026-02-10");
    expect(renewsOn(after, "2026-02-10")).toBe("2026-03-14");
    // 31 January + 2 months is 31 March, and 14 days on is 14 April.
    expect(periodStart(after, 2)).toBe("2026-04-14");
  });

  it("a member who owes for the month they are in still owes it, from the same day", () => {
    const m = given(monthly, "2026-10-15", true, "2026-10-15");
    const owing = heldMembershipView(m, "2026-11-20").payment;
    expect(owing).toEqual({ state: "due", since: "2026-11-15" });
    const added = addGiftDays(m, 14, "2026-11-20");
    expect(added?.from).toBe(2);
    const after = added?.membership ?? m;
    expect(heldMembershipView(after, "2026-11-20").payment).toEqual({ state: "due", since: "2026-11-15" });
    expect(periodStart(after, 1)).toBe("2026-11-15");
    expect(renewsOn(after, "2026-11-20")).toBe("2026-12-29");
  });

  it("a member paid three months ahead gets the days after what they paid for", () => {
    const m = { ...given(monthly, "2026-10-15", true, "2026-10-15"), paidPeriods: 3 };
    const added = addGiftDays(m, 14, "2026-11-03");
    expect(added?.from).toBe(3);
    const after = added?.membership ?? m;
    expect(periodStart(after, 1)).toBe("2026-11-15");
    expect(periodStart(after, 2)).toBe("2026-12-15");
    expect(heldMembershipView(after, "2026-11-03").payment).toEqual({ state: "paid", until: "2027-01-29" });
  });

  it("a weekly membership, 30 days", () => {
    const m = given(weekly, "2026-11-02", true, "2026-11-02");
    expect(renewsOn(plus(m, 30, "2026-11-04"), "2026-11-04")).toBe("2026-12-09");
  });

  it("a three-month membership ends 14 days later", () => {
    const m = given(threeMonths, "2026-10-04", true, "2026-10-04");
    expect(endsOn(m, "2026-11-03")).toBe("2027-01-03");
    const after = plus(m, 14, "2026-11-03");
    expect(endsOn(after, "2026-11-03")).toBe("2027-01-17");
    expect(giftDaysNextDay(after, 1)).toEqual({ renews: false, day: "2027-01-17" });
  });

  it("a class pack's last day moves; its classes do not", () => {
    const m = given(tenPack, "2026-10-04", true, "2026-10-04");
    const after = plus(m, 14, "2026-11-03");
    expect(endsOn(after, "2026-11-03")).toBe("2026-12-16");
    expect(after.classesLeft).toBe(10);
  });

  it("one that starts later keeps its start day and renews later", () => {
    const m = given(monthly, "2026-12-01", true, "2026-11-03");
    const after = plus(m, 14, "2026-11-03");
    expect(periodStart(after, 0)).toBe("2026-12-01");
    expect(heldMembershipView(after, "2026-11-03").status).toBe("upcoming");
    expect(heldMembershipView(after, "2026-11-03").payment).toEqual({ state: "paid", until: "2027-01-15" });
  });

  it("a frozen one is given them, says no date while frozen, and keeps both when unfrozen", () => {
    const m = given(monthly, "2026-10-15", true, "2026-10-15");
    const frozen = moveHeldMembership(m, { type: "freeze" }, "2026-11-01");
    if (!frozen.ok) throw new Error("not frozen");
    const added = addGiftDays(frozen.membership, 14, "2026-11-05");
    expect(added?.from).toBe(1);
    const after = added?.membership ?? m;
    expect(giftDaysNextDay(after, 1)).toBeNull();
    const back = moveHeldMembership(after, { type: "unfreeze" }, "2026-11-10");
    if (!back.ok) throw new Error("not unfrozen");
    // 15 November, 14 free days and 9 days frozen.
    expect(renewsOn(back.membership, "2026-11-10")).toBe("2026-12-08");
  });

  it("two gifts before the first one's days begin go together", () => {
    const m = given(monthly, "2026-10-15", true, "2026-10-15");
    const both = plus(plus(m, 14, "2026-11-03"), 7, "2026-11-05");
    expect(both.giftDays).toBe(21);
    expect(renewsOn(both, "2026-11-05")).toBe("2026-12-06");
  });

  it("a gift after the first one's days have begun leaves every date of the first where it was", () => {
    const m = given(monthly, "2026-10-15", true, "2026-10-15");
    const first = { ...plus(m, 14, "2026-11-03"), paidPeriods: 2 };
    expect(periodStart(first, 1)).toBe("2026-11-29");
    const added = addGiftDays(first, 10, "2026-12-05");
    expect(added?.from).toBe(2);
    const after = added?.membership ?? m;
    expect(after.frozenDays).toBe(14);
    expect(periodStart(after, 1)).toBe("2026-11-29");
    expect(periodStart(after, 2)).toBe("2027-01-08");
    expect(periodIndex(after, "2026-12-05")).toBe(1);
  });

  it("none for a free membership, one that is over, or a number of days out of range", () => {
    const m = given(monthly, "2026-10-15", true, "2026-10-15");
    expect(addGiftDays(given(freeWeek, "2026-11-01", false, "2026-11-01"), 14, "2026-11-03")).toBeNull();
    expect(addGiftDays(given(threeMonths, "2026-06-01", true, "2026-06-01"), 14, "2026-11-03")).toBeNull();
    expect(addGiftDays({ ...m, status: "cancelled", cancelledOn: "2026-11-01" }, 14, "2026-11-03")).toBeNull();
    expect(addGiftDays({ ...m, renews: false }, 14, "2026-11-20")).toBeNull();
    expect(addGiftDays(m, 0, "2026-11-03")).toBeNull();
    expect(addGiftDays(m, GIFT_DAYS_MAX + 1, "2026-11-03")).toBeNull();
    expect(addGiftDays(m, 1.5, "2026-11-03")).toBeNull();
    expect(addGiftDays(m, GIFT_DAYS_MAX, "2026-11-03")).not.toBeNull();
  });

  it("a member owing for the month after their first free days: that month's day stays", () => {
    const m = given(monthly, "2026-10-15", true, "2026-10-15");
    const first = plus(m, 14, "2026-11-03");
    expect(heldMembershipView(first, "2026-12-05").payment).toEqual({ state: "due", since: "2026-11-29" });
    const second = plus(first, 10, "2026-12-05");
    expect(heldMembershipView(second, "2026-12-05").payment).toEqual({ state: "due", since: "2026-11-29" });
    expect(renewsOn(second, "2026-12-05")).toBe("2027-01-08");
  });

  it("none where earlier free days and what is paid no longer meet: money instead, and no date moves", () => {
    const m = given(monthly, "2026-10-15", true, "2026-10-15");
    // Days waiting before 15 November, then paid two months ahead: a second gift would move
    // the month already paid for.
    const first = plus(m, 14, "2026-11-03");
    expect(addGiftDays({ ...first, paidPeriods: 3 }, 7, "2026-11-05")).toBeNull();
    // Days waiting at the end of two months paid, then the second month's payment undone: a
    // second gift would sit a month past what is paid and its message name a false renewal
    // (round one, H1). A second gift alone on that membership would go before period 1.
    const ahead = addGiftDays({ ...m, paidPeriods: 2 }, 14, "2026-10-20");
    expect(ahead?.from).toBe(2);
    const undone = { ...(ahead?.membership ?? m), paidPeriods: 1 };
    expect(addGiftDays(undone, 7, "2026-10-20")).toBeNull();
    expect(addGiftDays(m, 7, "2026-10-20")?.from).toBe(1);
    // A payment of the months after those days undone: the month from before them is owed.
    const owed = { ...plus({ ...m, paidPeriods: 3 }, 14, "2026-11-03"), paidPeriods: 1 };
    expect(addGiftDays(owed, 7, "2027-02-01")).toBeNull();
  });
});

describe("free days are taken back only while none of them is reached", () => {
  const m = given(monthly, "2026-10-15", true, "2026-10-15");
  const after = plus(m, 14, "2026-11-03");

  it("the same day, and up to the day before the first free day: the old renewal comes back", () => {
    for (const day of ["2026-11-03", "2026-11-14"]) {
      const back = takeBackGiftDays(after, 14, 1, day);
      expect(back?.giftDays).toBe(0);
      expect(renewsOn(back ?? after, day)).toBe("2026-11-15");
    }
  });

  it("from the first free day on, they stay", () => {
    expect(takeBackGiftDays(after, 14, 1, "2026-11-15")).toBeNull();
    expect(takeBackGiftDays(after, 14, 1, "2026-11-28")).toBeNull();
    expect(takeBackGiftDays(after, 14, 1, "2027-03-01")).toBeNull();
  });

  it("one of two gifts together: only its own days", () => {
    const both = plus(after, 7, "2026-11-05");
    const back = takeBackGiftDays(both, 14, 1, "2026-11-06");
    expect(back?.giftDays).toBe(7);
    expect(renewsOn(back ?? both, "2026-11-06")).toBe("2026-11-22");
  });

  it("days already folded by a later gift, or on one that is over, stay", () => {
    const folded = addGiftDays({ ...after, paidPeriods: 2 }, 10, "2026-12-05")?.membership ?? after;
    expect(takeBackGiftDays(folded, 14, 1, "2026-12-05")).toBeNull();
    expect(takeBackGiftDays({ ...after, status: "cancelled", cancelledOn: "2026-11-04" }, 14, 1, "2026-11-05")).toBeNull();
  });
});

describe("which membership the days go on", () => {
  const row = (id: string, membership: HeldMembership) => ({ id, membership });
  const today = "2026-11-03";
  const renewing = given(monthly, "2026-10-15", true, "2026-10-15"); // renews 15 November
  const pack = given(tenPack, "2026-10-04", true, "2026-10-04"); // last day 2 December
  const frozen = { ...renewing, status: "frozen" as const, frozenOn: "2026-11-01" };
  const free = given(freeWeek, "2026-11-01", false, "2026-11-01");
  const over = given(threeMonths, "2026-06-01", true, "2026-06-01");

  it("the one whose next date comes first; a frozen one after those; nothing for none", () => {
    expect(giftDaysTarget([row("b", pack), row("a", renewing)], today)?.id).toBe("a");
    expect(giftDaysTarget([row("a", frozen), row("b", pack)], today)?.id).toBe("b");
    expect(giftDaysTarget([row("a", frozen)], today)?.id).toBe("a");
    expect(giftDaysTarget([row("a", free), row("b", pack)], today)?.id).toBe("b");
    expect(giftDaysTarget([row("a", free), row("b", over)], today)).toBeNull();
    expect(giftDaysTarget([], today)).toBeNull();
  });
});

// Not from the table: every kind, term, start, state and day the generator makes. For each,
// the period the day falls in, and every period start up to it, are where they were; the
// first period after the days, and every one after that, start exactly `days` later; and
// taking them back the same day puts every date from today on back where it was.
describe("the sweep: nothing already begun moves, and everything after moves by the days", () => {
  let seed = 20261103;
  const rand = (n: number): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % n;
  };
  const pick = <T>(xs: readonly T[]): T => xs[rand(xs.length)] as T;
  const TYPES: HeldMembershipTerms[] = [
    monthly,
    weekly,
    { ...monthly, termCount: 3 },
    { ...monthly, termUnit: "year" },
    threeMonths,
    { ...threeMonths, termCount: 10, termUnit: "day" },
    tenPack,
    { ...tenPack, packDays: 1, packClasses: 1 },
  ];
  const STARTS = ["2026-01-29", "2026-01-31", "2026-02-28", "2026-03-31", "2026-08-31", "2026-10-15", "2027-12-31", "2028-02-29"];

  it("holds for 4,000 memberships", () => {
    let given_ = 0;
    for (let i = 0; i < 4000; i += 1) {
      const startsOn = pick(STARTS);
      const type = pick(TYPES);
      let m = given(type, startsOn, true, startsOn);
      m = { ...m, paidPeriods: m.kind === "recurring" ? rand(6) : m.paidPeriods, frozenDays: pick([0, 0, 3, 40]) };
      if (rand(3) === 0) m = { ...m, giftDays: pick([1, 14]), giftFrom: rand(4) };
      if (rand(5) === 0) m = { ...m, status: "frozen", frozenOn: addDays(startsOn, rand(60)) };
      const today = addDays(startsOn, rand(200) - 20);
      if (m.status === "frozen" && m.frozenOn !== null && m.frozenOn > today) m = { ...m, frozenOn: today };
      const days = 1 + rand(GIFT_DAYS_MAX);
      const added = addGiftDays(m, days, today);
      if (added === null) continue;
      given_ += 1;
      const after = added.membership;
      const asOf = m.status === "frozen" && m.frozenOn !== null ? m.frozenOn : today;
      const now = periodIndex(m, asOf);
      expect(periodIndex(after, asOf)).toBe(now);
      // Earlier days folded move only periods before them, every one of them paid for.
      const folded = m.giftDays > 0 && m.giftFrom <= now;
      if (folded) expect(m.paidPeriods).toBeGreaterThanOrEqual(m.giftFrom);
      for (let p = folded ? m.giftFrom : 0; p <= now; p += 1) expect(periodStart(after, p)).toBe(periodStart(m, p));
      for (let p = now + 1; p < added.from; p += 1) expect(periodStart(after, p)).toBe(periodStart(m, p));
      for (let p = added.from; p < added.from + 4; p += 1) expect(periodStart(after, p)).toBe(addDays(periodStart(m, p), days));
      expect(added.from).toBeGreaterThan(now);
      if (m.kind === "recurring") expect(added.from).toBeGreaterThanOrEqual(m.paidPeriods);
      // The member is told the renewal the page then shows, never another day (round one, H1).
      const told = giftDaysNextDay(after, added.from);
      if (told !== null && told.renews) expect(told.day).toBe(shownRenewal(heldMembershipView(after, today)));
      // What is owed today, and since when, is what it was.
      expect(heldMembershipView(after, today).payment?.state).toBe(heldMembershipView(m, today).payment?.state);
      if (heldMembershipView(m, today).payment?.state === "due") expect(heldMembershipView(after, today).payment).toEqual(heldMembershipView(m, today).payment);
      const back = takeBackGiftDays(after, days, added.from, today);
      expect(back).not.toBeNull();
      for (let p = now; p < added.from + 4; p += 1) expect(periodStart(back ?? after, p)).toBe(periodStart(m, p));
    }
    expect(given_).toBeGreaterThan(1500);
  });
});
