import { describe, expect, it } from "vitest";
import {
  AT_RISK_AWAY_MAX_DAYS,
  AT_RISK_QUIET_DAYS,
  AT_RISK_WEEKS_CAME,
  addDays,
  atRiskCheckin,
  atRiskDaysLately,
  atRiskGymKeptOn,
  atRiskOf,
  atRiskOrder,
  atRiskSettingsSchema,
} from "../src/index.js";

const TODAY = "2026-10-12";
const back = (n: number): string => addDays(TODAY, -n);
/** A gym that checked somebody in every day of the last 200. */
const EVERY_DAY = Array.from({ length: 200 }, (_, i) => back(i));
/** Monday is 1, Sunday is 7. 12 October 2026, today here, is a Monday. */
const weekday = (n: number): number => ((((1 - n) % 7) + 7 - 1) % 7) + 1;
/** Real opening patterns, each by the weekdays the gym checks people in on. */
const TIMETABLES: { name: string; open: number[] }[] = [
  { name: "every day", open: [1, 2, 3, 4, 5, 6, 7] },
  { name: "closed on Sundays", open: [1, 2, 3, 4, 5, 6] },
  { name: "weekdays only", open: [1, 2, 3, 4, 5] },
  { name: "Monday, Wednesday and Friday", open: [1, 3, 5] },
  { name: "Tuesday and Thursday", open: [2, 4] },
  { name: "weekends only", open: [6, 7] },
  { name: "one class day a week, Saturday", open: [6] },
];
/** The days back, of the last 200, such a gym was open. */
const openDays = (open: number[]): number[] => Array.from({ length: 200 }, (_, i) => i).filter((n) => open.includes(weekday(n)));
const ask = (visitsBack: number[], over: Partial<Parameters<typeof atRiskOf>[0]> = {}) =>
  atRiskOf({ today: TODAY, quietDays: 14, weeksCame: 2, visitDays: visitsBack.map(back), gymDays: EVERY_DAY, ...over });

describe("atRiskOf: the worst thing first, nobody who came lately is named", () => {
  it("a visit on any of the last 14 days, today among them, is never at risk, however regular before", () => {
    const before = [20, 22, 27, 29, 34, 36, 41];
    for (let n = 0; n < 14; n += 1) {
      expect(ask([...before, n]), `a visit ${String(n)} days back`).toEqual({ atRisk: false, why: "came_lately" });
    }
  });

  it("the first day they are named is the gym's own number of days after their last visit", () => {
    for (const quietDays of AT_RISK_QUIET_DAYS) {
      const visits = (last: number) => [last, last + 8, last + 15];
      expect(ask(visits(quietDays - 1), { quietDays }).atRisk, `${String(quietDays - 1)} days at ${String(quietDays)}`).toBe(false);
      expect(ask(visits(quietDays), { quietDays }), `${String(quietDays)} days at ${String(quietDays)}`).toEqual({
        atRisk: true,
        lastVisitOn: back(quietDays),
        daysAway: quietDays,
        weeksCame: 3,
      });
    }
  });

  it("a visit dated after today (a gym that moved its clock) is a visit", () => {
    expect(ask([20, 27, -1])).toEqual({ atRisk: false, why: "came_lately" });
  });

  it("the order the visits arrive in changes nothing, and two on one day are one", () => {
    const a = ask([40, 20, 27, 20, 33]);
    const b = ask([20, 20, 27, 33, 40]);
    expect(a).toEqual(b);
    expect(a).toEqual({ atRisk: true, lastVisitOn: back(20), daysAway: 20, weeksCame: 3 });
  });
});

describe("atRiskOf: how regular they were, over the four weeks that ended on their last visit", () => {
  const cases: { name: string; visits: number[]; weeks: number }[] = [
    { name: "one visit only", visits: [20], weeks: 1 },
    { name: "seven visits in one week", visits: [20, 21, 22, 23, 24, 25, 26], weeks: 1 },
    { name: "the last day and seven days before it", visits: [20, 27], weeks: 2 },
    { name: "the last day and six days before it", visits: [20, 26], weeks: 1 },
    { name: "once in each of the four weeks", visits: [20, 27, 34, 41], weeks: 4 },
    { name: "the first and the fourth week", visits: [20, 47], weeks: 2 },
    { name: "a visit 28 days before the last is outside the four weeks", visits: [20, 48], weeks: 1 },
    { name: "years of visits long before count for nothing", visits: [20, 100, 107, 114, 121, 128], weeks: 1 },
  ];
  for (const c of cases) {
    for (const weeksCame of AT_RISK_WEEKS_CAME) {
      it(`${c.name}: ${String(c.weeks)} of 4, asked for ${String(weeksCame)}`, () => {
        const got = ask(c.visits, { weeksCame });
        if (c.weeks >= weeksCame) expect(got).toEqual({ atRisk: true, lastVisitOn: back(20), daysAway: 20, weeksCame: c.weeks });
        else expect(got).toEqual({ atRisk: false, why: "not_regular" });
      });
    }
  }
});

describe("atRiskOf: who is never named", () => {
  it("somebody who never came", () => {
    expect(ask([])).toEqual({ atRisk: false, why: "never_came" });
  });

  it("somebody away longer than the longest absence listed", () => {
    expect(ask([AT_RISK_AWAY_MAX_DAYS, AT_RISK_AWAY_MAX_DAYS + 7]).atRisk).toBe(true);
    expect(ask([AT_RISK_AWAY_MAX_DAYS + 1, AT_RISK_AWAY_MAX_DAYS + 8])).toEqual({ atRisk: false, why: "away_too_long" });
  });

  it("anybody at a gym that recorded nobody since: it was shut, or stopped using check-in", () => {
    const upTo = (n: number) => EVERY_DAY.filter((day) => day <= back(n));
    expect(ask([20, 27], { gymDays: upTo(20) })).toEqual({ atRisk: false, why: "gym_quiet" });
    expect(ask([20, 27], { gymDays: [] })).toEqual({ atRisk: false, why: "gym_quiet" });
    // Their own last day is not a day since.
    expect(ask([20, 27], { gymDays: [back(20)] })).toEqual({ atRisk: false, why: "gym_quiet" });
  });

  for (const table of TIMETABLES) {
    it(`a gym open ${table.name}: a regular who stops is named, and nobody is while the gym itself was shut`, () => {
      const open = openDays(table.open);
      // The regular came on the gym's newest open day 14 or more back, and on one a week or more before it.
      const last = open.find((n) => n >= 14) ?? 0;
      const visits = [last, open.find((n) => n >= last + 7) ?? last];
      const gymDays = open.map(back);
      const got = ask(visits, { gymDays });
      expect(got.atRisk, JSON.stringify(got)).toBe(true);
      // Shut since their last visit: not theirs to answer for.
      expect(ask(visits, { gymDays: open.filter((n) => n >= last).map(back) })).toEqual({ atRisk: false, why: "gym_quiet" });
      // Open on under half of its usual days since: still not.
      const since = open.filter((n) => n < last);
      const usual = open.filter((n) => n >= last && n < last + 28).length;
      const half = Math.ceil((usual * last) / 56);
      const withSince = (count: number) => [...open.filter((n) => n >= last), ...since.slice(0, count)].map(back);
      if (half > 1) expect(ask(visits, { gymDays: withSince(half - 1) }), `${String(half - 1)} days since`).toEqual({ atRisk: false, why: "gym_quiet" });
      expect(ask(visits, { gymDays: withSince(Math.min(half, since.length)) }).atRisk, `${String(half)} days since`).toBe(true);
    });
  }

  it("at a gym open every day, ten of the twenty days since is half its rhythm and nine is not", () => {
    const before = EVERY_DAY.filter((day) => day <= back(20));
    const since = (count: number) => Array.from({ length: count }, (_, i) => back(i));
    expect(ask([20, 27], { gymDays: [...before, ...since(9)] })).toEqual({ atRisk: false, why: "gym_quiet" });
    expect(ask([20, 27], { gymDays: [...before, ...since(10)] }).atRisk).toBe(true);
    expect(atRiskGymKeptOn([...before, ...since(10)], back(20), TODAY)).toEqual({ since: 10, before: 28, keptOn: true });
  });

  it("gym days after today, the same day many times, and days that are not days are not counted", () => {
    const before = EVERY_DAY.filter((day) => day <= back(20));
    const junk = [back(-1), back(-2), back(-3), ...Array.from({ length: 8 }, () => back(1)), "soon", "2026-02-30", back(2), back(3)];
    expect(atRiskGymKeptOn([...before, ...junk], back(20), TODAY)).toEqual({ since: 3, before: 28, keptOn: false });
    expect(ask([20, 27], { gymDays: [...before, ...junk] })).toEqual({ atRisk: false, why: "gym_quiet" });
  });

  it("anything unreadable is no decision", () => {
    const unreadable = { atRisk: false, why: "unreadable" };
    expect(ask([20, 27], { today: "today" })).toEqual(unreadable);
    expect(ask([20, 27], { today: "2026-02-30" })).toEqual(unreadable);
    expect(ask([20, 27], { quietDays: 0 })).toEqual(unreadable);
    expect(ask([20, 27], { quietDays: 14.5 })).toEqual(unreadable);
    expect(ask([20, 27], { quietDays: Number.NaN })).toEqual(unreadable);
    expect(ask([20, 27], { weeksCame: 0 })).toEqual(unreadable);
    expect(ask([20, 27], { weeksCame: 5 })).toEqual(unreadable);
    expect(ask([20, 27], { visitDays: [back(20), "last week"] })).toEqual(unreadable);
    expect(ask([20, 27], { visitDays: [back(20), "2026-13-01"] })).toEqual(unreadable);
  });
});

describe("atRiskCheckin: what the page says about the gym's own check-ins", () => {
  const read = (firstBack: number | null, gymBack: number[], quietDays = 14) =>
    atRiskCheckin({ today: TODAY, quietDays, firstCheckinOn: firstBack === null ? null : back(firstBack), gymDays: gymBack.map(back) });

  it("nobody was ever checked in", () => {
    expect(read(null, [])).toBe("none");
  });

  it("check-in began less than the gym's number of days ago: nobody can have stopped yet", () => {
    expect(read(13, [0, 1, 2, 3, 4, 5, 6, 7])).toBe("new");
    expect(read(14, [0, 1, 2, 3, 4, 5, 6, 7])).toBe("in_use");
  });

  for (const table of TIMETABLES) {
    it(`a gym open ${table.name} is in use, by every number of days it may pick`, () => {
      for (const quietDays of AT_RISK_QUIET_DAYS) expect(read(199, openDays(table.open), quietDays), `${String(quietDays)} days`).toBe("in_use");
    });
  }

  it("far fewer days with a check-in lately than is usual at this gym", () => {
    const older = Array.from({ length: 80 }, (_, i) => i + 14);
    // Open every day before; six of the last fourteen is under half, seven is half.
    expect(read(100, [...older, 0, 1, 2, 3, 4, 5])).toBe("stopped");
    expect(read(100, [...older, 0, 1, 2, 3, 4, 5, 6])).toBe("in_use");
    // The desk was used until fourteen days ago and not since.
    expect(read(100, older)).toBe("stopped");
    expect(read(100, [])).toBe("stopped");
  });

  it("how many of the last days anybody came", () => {
    expect(atRiskDaysLately([0, 1, 2, 13, 14, 15, -1].map(back), TODAY, 14)).toBe(4);
    expect(atRiskDaysLately([], TODAY, 14)).toBe(0);
    expect(atRiskDaysLately([back(1)], "today", 14)).toBe(0);
  });
});

describe("the gym's two numbers, and the list's order", () => {
  it("only the numbers on the pickers are taken", () => {
    for (const quietDays of AT_RISK_QUIET_DAYS) {
      for (const weeksCame of AT_RISK_WEEKS_CAME) expect(atRiskSettingsSchema.safeParse({ quietDays, weeksCame }).success).toBe(true);
    }
    for (const bad of [{ quietDays: 3, weeksCame: 2 }, { quietDays: 14, weeksCame: 0 }, { quietDays: 14, weeksCame: 5 }, { quietDays: "14", weeksCame: 2 }, { quietDays: 14 }, { quietDays: 14, weeksCame: 2, gymId: "x" }]) {
      expect(atRiskSettingsSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("the most regular first, then who stopped most lately, then by name, then by id", () => {
    const p = (name: string, weeksCame: number, daysAway: number, entryId: string) => ({ name, weeksCame, daysAway, entryId, userId: null });
    const people = [p("Zed", 2, 15, "d"), p("Amy", 4, 30, "c"), p("Bo", 4, 16, "b"), p("Bo", 4, 16, "a"), p("Al", 4, 16, "e")];
    expect([...people].sort(atRiskOrder).map((x) => `${x.name}:${x.entryId}`)).toEqual(["Al:e", "Bo:a", "Bo:b", "Amy:c", "Zed:d"]);
  });
});
