// Billing everyone on one day of the month (spec Part 3 §14.8; ROADMAP Stage 2 item 18y).
//
// The first block is the worst thing this job could do to a real person: charge a member twice
// for the same days, or for days they never had. Every day from the start on falls in exactly
// one period, the part month ends the day before the gym's day, and every period after it
// starts on that day. The amounts below were worked out by hand from a calendar: days from the
// start up to the billing day, over the days of the whole period ending on it. The first case
// is PushPress's own help page (a member who joins on 9 April on a plan billed on the 1st has a
// first invoice for 9 to 30 April, then 1 May; its sum is the price over the days in the month
// times the days used).
import { describe, expect, it } from "vitest";
import {
  addDays,
  addTerms,
  billsToOpen,
  changeTo,
  dayOfMonthWords,
  fullFromOf,
  giveHeldMembership,
  heldMembershipView,
  moveHeldMembership,
  partMinor,
  partPeriod,
  periodIndex,
  periodListedMinor,
  periodStart,
  type HeldMembership,
  type HeldMembershipTerms,
} from "../src/index.js";

const monthly: HeldMembershipTerms = { kind: "recurring", termCount: 1, termUnit: "month", packClasses: null, packDays: null, priceMinor: 5000 };
const quarterly: HeldMembershipTerms = { ...monthly, termCount: 3, priceMinor: 12000 };
const yearly: HeldMembershipTerms = { ...monthly, termUnit: "year", priceMinor: 50000 };
const weekly: HeldMembershipTerms = { ...monthly, termUnit: "week" };
const paidOnce: HeldMembershipTerms = { ...monthly, kind: "one_time", termCount: 3 };
const pack: HeldMembershipTerms = { kind: "pack", termCount: null, termUnit: null, packClasses: 10, packDays: 60, priceMinor: 9000 };

function given(type: HeldMembershipTerms, startsOn: string, today: string, billDay: number | null): HeldMembership {
  const made = giveHeldMembership(type, startsOn, false, today, billDay);
  if (!made.ok) throw new Error(made.reason);
  return made.membership;
}

const dayOfMonth = (day: string): number => Number(day.slice(8, 10));

describe("the worst thing: no day billed twice, none missed", () => {
  it("every day from the start falls in exactly one period, the part month first, then whole ones from the gym's day", () => {
    let checked = 0;
    for (const type of [monthly, quarterly, yearly]) {
      for (const billDay of [1, 15, 28]) {
        for (let startsOn = "2026-01-01"; startsOn <= "2028-12-31"; startsOn = addDays(startsOn, 5)) {
          const m = given(type, startsOn, startsOn, billDay);
          if (dayOfMonth(startsOn) === billDay) {
            expect(m.fullFrom).toBeNull();
            continue;
          }
          const fullFrom = m.fullFrom;
          if (fullFrom === null) throw new Error("no billing day");
          // The part month: from the start to the day before the gym's day, and less than a month.
          expect(periodStart(m, 0)).toBe(startsOn);
          expect(periodStart(m, 1)).toBe(fullFrom);
          expect(dayOfMonth(fullFrom)).toBe(billDay);
          expect(fullFrom > startsOn && fullFrom <= addTerms(startsOn, 1, "month", 1)).toBe(true);
          // Every later period starts on the gym's day, one whole period after the last.
          const periods = type === yearly ? 3 : 6;
          for (let i = 1; i <= periods; i += 1) {
            expect(periodStart(m, i)).toBe(addTerms(fullFrom, type.termCount ?? 1, type.termUnit ?? "month", i - 1));
            expect(dayOfMonth(periodStart(m, i))).toBe(billDay);
          }
          // Each day is in the one period whose days hold it.
          for (let day = startsOn; day < periodStart(m, periods); day = addDays(day, type === yearly ? 9 : 1)) {
            const i = periodIndex(m, day);
            expect(periodStart(m, i) <= day && day < periodStart(m, i + 1)).toBe(true);
          }
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(1900);
  });

  it("the part month costs less than a whole period, never more, and is the price for its days", () => {
    for (const billDay of [1, 2, 14, 15, 27, 28]) {
      for (let startsOn = "2027-12-01"; startsOn <= "2028-03-31"; startsOn = addDays(startsOn, 1)) {
        const m = given(monthly, startsOn, startsOn, billDay);
        const part = partPeriod(m);
        if (part === null) continue;
        expect(part.days).toBeGreaterThan(0);
        expect(part.days).toBeLessThan(part.fullDays);
        expect(periodListedMinor(m, 0, 5000)).toBe(Math.floor((5000 * part.days) / part.fullDays));
        expect(periodListedMinor(m, 0, 5000)).toBeLessThan(5000);
        // Every later period is the whole price.
        expect(periodListedMinor(m, 1, 5000)).toBe(5000);
        expect(periodListedMinor(m, 7, 5000)).toBe(5000);
      }
    }
  });

  it("the bills: the part month's first, for exactly its days, then the whole month from the gym's day", () => {
    const m = given(monthly, "2026-10-15", "2026-10-15", 1);
    expect(billsToOpen(m, "2026-10-15", new Set())).toEqual([{ periodIndex: 0, dueOn: "2026-10-15", covers: { from: "2026-10-15", to: "2026-10-31" } }]);
    const paid = { ...m, paidPeriods: 1 };
    expect(billsToOpen(paid, "2026-10-31", new Set([0]))).toEqual([]);
    expect(billsToOpen(paid, "2026-11-01", new Set([0]))).toEqual([{ periodIndex: 1, dueOn: "2026-11-01", covers: { from: "2026-11-01", to: "2026-11-30" } }]);
    expect(heldMembershipView(paid, "2026-10-20")).toMatchObject({ renewsOn: "2026-11-01", payment: { state: "paid", until: "2026-11-01" } });
    expect(heldMembershipView({ ...paid, paidPeriods: 2 }, "2026-11-20")).toMatchObject({ renewsOn: "2026-12-01", payment: { state: "paid", until: "2026-12-01" } });
  });
});

describe("the part month's price, worked out by hand from the calendar", () => {
  const cases: [string, HeldMembershipTerms, string, number, { fullFrom: string; days: number; fullDays: number; minor: number }][] = [
    // PushPress's example: 9 to 30 April is 22 of April's 30 days.
    ["joins 9 Apr, billed on the 1st (PushPress)", monthly, "2026-04-09", 1, { fullFrom: "2026-05-01", days: 22, fullDays: 30, minor: 3666 }],
    ["joins 15 Oct, billed on the 1st", monthly, "2026-10-15", 1, { fullFrom: "2026-11-01", days: 17, fullDays: 31, minor: 2741 }],
    ["joins the day after the 1st", monthly, "2026-10-02", 1, { fullFrom: "2026-11-01", days: 30, fullDays: 31, minor: 4838 }],
    ["joins the day before the 1st", monthly, "2026-10-31", 1, { fullFrom: "2026-11-01", days: 1, fullDays: 31, minor: 161 }],
    ["joins 1 Feb, billed on the 28th", monthly, "2026-02-01", 28, { fullFrom: "2026-02-28", days: 27, fullDays: 31, minor: 4354 }],
    ["joins 29 Feb in a leap year, billed on the 1st", monthly, "2028-02-29", 1, { fullFrom: "2028-03-01", days: 1, fullDays: 29, minor: 172 }],
    ["joins 20 Dec, billed on the 15th: into the new year", monthly, "2026-12-20", 15, { fullFrom: "2027-01-15", days: 26, fullDays: 31, minor: 4193 }],
    ["every 3 months: the days over the 92 of Aug to Oct", quarterly, "2026-10-15", 1, { fullFrom: "2026-11-01", days: 17, fullDays: 92, minor: 2217 }],
    ["every year: the days over the year's 365", yearly, "2026-10-15", 1, { fullFrom: "2026-11-01", days: 17, fullDays: 365, minor: 2328 }],
  ];
  it.each(cases)("%s", (_, type, startsOn, billDay, want) => {
    const m = given(type, startsOn, startsOn, billDay);
    expect(m.fullFrom).toBe(want.fullFrom);
    expect(partPeriod(m)).toEqual({ days: want.days, fullDays: want.fullDays });
    expect(periodListedMinor(m, 0, type.priceMinor)).toBe(want.minor);
  });

  it("no part month: starting on the day, no day set, a weekly one, one paid once, a class pack", () => {
    expect(fullFromOf(monthly, "2026-10-01", 1)).toBeNull();
    expect(fullFromOf(monthly, "2026-10-15", 15)).toBeNull();
    expect(fullFromOf(monthly, "2026-10-15", null)).toBeNull();
    expect(fullFromOf(weekly, "2026-10-15", 1)).toBeNull();
    expect(fullFromOf(paidOnce, "2026-10-15", 1)).toBeNull();
    expect(fullFromOf(pack, "2026-10-15", 1)).toBeNull();
    const plain = given(monthly, "2026-10-15", "2026-10-15", null);
    expect(periodListedMinor(plain, 0, 5000)).toBe(5000);
    expect(periodStart(plain, 1)).toBe("2026-11-15");
  });

  it("a day the calendar does not have in every month is refused", () => {
    for (const day of [0, 29, 31, 1.5]) expect(() => fullFromOf(monthly, "2026-10-15", day)).toThrow();
  });

  it("rounds down to the cent", () => {
    expect(partMinor(1000, { days: 1, fullDays: 3 })).toBe(333);
    expect(partMinor(2000, { days: 2, fullDays: 3 })).toBe(1333);
  });
});

describe("a start before or after today", () => {
  it("one to start later: its first bill, opened today, is the part month", () => {
    const m = given(monthly, "2026-10-20", "2026-10-01", 1);
    expect(billsToOpen(m, "2026-10-01", new Set())).toEqual([{ periodIndex: 0, dueOn: "2026-10-20", covers: { from: "2026-10-20", to: "2026-10-31" } }]);
    expect(periodListedMinor(m, 0, 5000)).toBe(Math.floor((5000 * 12) / 31));
  });

  it("one started months ago: the periods before count as paid, and today's bill is a whole month", () => {
    const m = given(monthly, "2026-08-15", "2026-10-22", 1);
    expect(m.fullFrom).toBe("2026-09-01");
    expect(m.paidFloor).toBe(2);
    expect(billsToOpen(m, "2026-10-22", new Set())).toEqual([{ periodIndex: 2, dueOn: "2026-10-01", covers: { from: "2026-10-01", to: "2026-10-31" } }]);
    expect(periodListedMinor(m, 2, 5000)).toBe(5000);
  });

  it("a freeze in the part month moves the next billing day by the days frozen, as any freeze does", () => {
    const m = { ...given(monthly, "2026-10-15", "2026-10-15", 1), paidPeriods: 1 };
    const frozen = moveHeldMembership(m, { type: "freeze" }, "2026-10-20");
    if (!frozen.ok) throw new Error("not frozen");
    const back = moveHeldMembership(frozen.membership, { type: "unfreeze" }, "2026-10-25");
    if (!back.ok) throw new Error("not unfrozen");
    expect(heldMembershipView(back.membership, "2026-10-25").renewsOn).toBe("2026-11-06");
  });
});

describe("a change of membership where the gym bills on one day", () => {
  const from = { ok: true as const, creditMinor: 1000, daysLeft: 17, nextOn: "2026-11-01", byPeriod: [] };
  const gold = { id: "gold", kind: "recurring" as const, priceMinor: 8000, termCount: 1, termUnit: "month" as const };

  it("today: the new one's part month, less what the old one has paid for its days", () => {
    expect(changeTo(from, "basic", gold, "today", "2026-10-15", 1)).toEqual({
      ok: true,
      startsOn: "2026-10-15",
      fullFrom: "2026-11-01",
      creditMinor: 1000,
      // 8000 × 17 / 31 = 4387, less 1000.
      firstListedMinor: 3387,
      paidByChange: false,
    });
  });

  it("on the next payment date, the gym's own day: a whole month, no part", () => {
    expect(changeTo(from, "basic", gold, "next_payment", "2026-10-15", 1)).toMatchObject({ ok: true, startsOn: "2026-11-01", fullFrom: null, firstListedMinor: 8000 });
  });

  it("on the next payment date, not the gym's day: the part month up to it", () => {
    // 1 to 14 November, of the 31 days from 15 October to 15 November: 8000 × 14 / 31 = 3612.
    expect(changeTo(from, "basic", gold, "next_payment", "2026-10-15", 15)).toMatchObject({ ok: true, startsOn: "2026-11-01", fullFrom: "2026-11-15", firstListedMinor: 3612 });
  });

  it("with no day, as before", () => {
    expect(changeTo(from, "basic", gold, "today", "2026-10-15")).toMatchObject({ ok: true, fullFrom: null, firstListedMinor: 7000 });
  });
});

describe("a day of the month in words", () => {
  it.each([
    [1, "1st"],
    [2, "2nd"],
    [3, "3rd"],
    [4, "4th"],
    [11, "11th"],
    [12, "12th"],
    [13, "13th"],
    [21, "21st"],
    [22, "22nd"],
    [23, "23rd"],
    [28, "28th"],
  ])("%i is %s", (day, words) => {
    expect(dayOfMonthWords(day)).toBe(words);
  });
});
