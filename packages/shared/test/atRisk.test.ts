import { describe, expect, it } from "vitest";
import {
  AT_RISK_AWAY_MAX_DAYS,
  AT_RISK_QUIET_DAYS,
  AT_RISK_WEEKS_CAME,
  addDays,
  atRiskCheckin,
  atRiskGymDays,
  atRiskOf,
  atRiskOrder,
  atRiskSettingsSchema,
} from "../src/index.js";

const TODAY = "2026-10-12";
const back = (n: number): string => addDays(TODAY, -n);
/** A gym that checked somebody in every day of the last 200. */
const EVERY_DAY = Array.from({ length: 200 }, (_, i) => back(i));
const ask = (visitsBack: number[], over: Partial<Parameters<typeof atRiskOf>[0]> = {}) =>
  atRiskOf({ today: TODAY, quietDays: 14, weeksCame: 2, visitDays: visitsBack.map(back), gymDays: EVERY_DAY, ...over });

describe("atRiskOf: the worst thing first, nobody who came lately is named", () => {
  it("a visit on any of the last 14 days, today among them, is never at risk, however regular before", () => {
    const before = [20, 22, 27, 29, 34, 36, 41];
    for (let n = 0; n < 14; n += 1) {
      expect(ask([...before, n]), `a visit ${n} days back`).toEqual({ atRisk: false, why: "came_lately" });
    }
  });

  it("the first day they are named is the gym's own number of days after their last visit", () => {
    for (const quietDays of AT_RISK_QUIET_DAYS) {
      const visits = (last: number) => [last, last + 8, last + 15];
      expect(ask(visits(quietDays - 1), { quietDays }).atRisk, `${quietDays - 1} days at ${quietDays}`).toBe(false);
      expect(ask(visits(quietDays), { quietDays }), `${quietDays} days at ${quietDays}`).toEqual({
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
      it(`${c.name}: ${c.weeks} of 4, asked for ${weeksCame}`, () => {
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

  it("anybody at a gym that checked nobody in since: it was shut, or stopped using check-in", () => {
    const upTo = (n: number) => EVERY_DAY.filter((day) => day <= back(n));
    expect(ask([20, 27], { gymDays: upTo(20) })).toEqual({ atRisk: false, why: "gym_quiet" });
    expect(ask([20, 27], { gymDays: [] })).toEqual({ atRisk: false, why: "gym_quiet" });
    // Their own last day is not a day since.
    expect(ask([20, 27], { gymDays: [back(20)] })).toEqual({ atRisk: false, why: "gym_quiet" });
  });

  it("the gym must have checked somebody in on half of its number of days since, rounded up", () => {
    for (const quietDays of AT_RISK_QUIET_DAYS) {
      const need = atRiskGymDays(quietDays);
      const days = (n: number) => Array.from({ length: n }, (_, i) => back(i));
      const visits = [quietDays + 5, quietDays + 12];
      expect(ask(visits, { quietDays, gymDays: days(need - 1) }), `${need - 1} gym days at ${quietDays}`).toEqual({ atRisk: false, why: "gym_quiet" });
      expect(ask(visits, { quietDays, gymDays: days(need) }).atRisk, `${need} gym days at ${quietDays}`).toBe(true);
    }
    expect(AT_RISK_QUIET_DAYS.map(atRiskGymDays)).toEqual([4, 5, 7, 11, 15]);
  });

  it("gym days after today, the same day twice, and days that are not days are not counted", () => {
    const gymDays = [back(-1), back(-2), back(-3), back(1), back(1), back(1), back(1), back(1), "soon", "2026-02-30", back(2), back(3)];
    expect(ask([20, 27], { gymDays })).toEqual({ atRisk: false, why: "gym_quiet" });
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

  it("too few days with a check-in lately", () => {
    expect(read(100, [0, 1, 2, 3, 4, 5])).toBe("stopped");
    expect(read(100, [0, 1, 2, 3, 4, 5, 6])).toBe("in_use");
    expect(read(100, [14, 15, 16, 17, 18, 19, 20, 21])).toBe("stopped");
    expect(read(100, [])).toBe("stopped");
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
