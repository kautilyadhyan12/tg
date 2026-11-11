// Your own run plan (ROADMAP 37d-iii-b). Safe mode is the server's (geo.ownRunPlan.routes.test.ts); here the
// rules that pick and threshold, over every class of case: which plan shows before a pick, the 10 % line
// (Frandsen and colleagues, BJSM 2025: a run past 10 % over the longest of the last 30 days), which runs
// tick a day, and every suggested run turned into one's own.
import { describe, expect, it } from "vitest";
import {
  JOG_BANDS,
  OWN_FAST_LEAST_M,
  OWN_FAST_MOST_M,
  OWN_RUN_LEAST_M,
  OWN_STEADY_LEAST_M,
  OWN_STEADY_MOST_M,
  RUN_GOALS,
  RUN_LONGEST_MOST_M,
  c25kParts,
  hasOwnRun,
  overCap,
  ownCapOf,
  ownPlanOf,
  ownRunOf,
  ownSessionOf,
  ownWeekM,
  ownWeekSchema,
  planDayPlus,
  putOwnRunPlanRequestSchema,
  putRunChoiceRequestSchema,
  runChoiceOf,
  runPlanOf,
  type OwnRun,
  type OwnWeek,
  type PlanSession,
  type RunChoice,
  type RunDay,
  type RunPlanAnswers,
} from "../src/index.js";

const MONDAY = "2026-11-09";
const WEDNESDAY = "2026-11-11";
const REST: OwnWeek = [null, null, null, null, null, null, null];
const weekWith = (at: number, run: OwnRun): OwnWeek => REST.map((d, i) => (i === at ? run : d));
const ran = (day: string, longestM: number, movingS = Math.round(longestM * 0.36)): RunDay => ({ day, distanceM: longestM, longestM, movingS, effort: null });

describe("which plan shows before the person picks", () => {
  const easy: OwnRun = { kind: "easy", m: 5000 };
  const cases: [string, RunChoice | null, OwnWeek | null, RunChoice][] = [
    ["no pick, no week", null, null, "suggested"],
    ["no pick, a week of rest days", null, REST, "suggested"],
    ["no pick, a week with a run", null, weekWith(2, easy), "mine"],
    ["Suggested picked, a week with a run", "suggested", weekWith(2, easy), "suggested"],
    ["My plan picked, no week yet", "mine", null, "mine"],
    ["My plan picked, rest days only", "mine", REST, "mine"],
  ];
  it.each(cases)("%s", (_name, picked, week, shown) => {
    expect(runChoiceOf(picked, week)).toBe(shown);
  });
  it("a week of rest days is no plan of one's own", () => {
    expect(hasOwnRun(REST)).toBe(false);
    expect(hasOwnRun(null)).toBe(false);
    expect(hasOwnRun(weekWith(6, easy))).toBe(true);
  });
});

describe("the 10 % line: 10 % over the longest run of the last 30 days", () => {
  const cases: [string, RunDay[], { day: string; m: number } | null, number | null][] = [
    ["nothing run, nothing answered", [], null, null],
    ["an 8 km run 10 days ago", [ran(planDayPlus(WEDNESDAY, -10), 8000)], null, 8800],
    ["the longest of two", [ran(planDayPlus(WEDNESDAY, -3), 3000), ran(planDayPlus(WEDNESDAY, -12), 10_000)], null, 11_000],
    ["a run exactly 30 days ago counts", [ran(planDayPlus(WEDNESDAY, -30), 8000)], null, 8800],
    ["a run 31 days ago does not", [ran(planDayPlus(WEDNESDAY, -31), 8000)], null, null],
    ["a run today counts", [ran(WEDNESDAY, 9000)], null, 9900],
    ["a run dated after today is not counted", [ran(planDayPlus(WEDNESDAY, 1), 20_000)], null, null],
    ["the longest run answered 20 days ago, with a shorter run since", [ran(planDayPlus(WEDNESDAY, -2), 5000)], { day: planDayPlus(WEDNESDAY, -20), m: 8000 }, 8800],
    ["the longest run answered 40 days ago is too old", [ran(planDayPlus(WEDNESDAY, -2), 5000)], { day: planDayPlus(WEDNESDAY, -40), m: 15_000 }, 5500],
    ["a run of 2,345 m: the line rounds down", [ran(planDayPlus(WEDNESDAY, -1), 2345)], null, 2579],
  ];
  it.each(cases)("%s", (_name, runs, answeredLongest, capM) => {
    expect(ownCapOf({ today: WEDNESDAY, runs, answeredLongest })).toBe(capM);
  });

  const said: [string, PlanSession | null, number | null, boolean][] = [
    ["at the line", { kind: "easy", m: 8800, reps: null }, 8800, false],
    ["100 m past it", { kind: "long", m: 8900, reps: null }, 8800, true],
    ["a tempo run past it", ownSessionOf({ kind: "steady", m: 10_000 }, 30_000), 8800, true],
    ["no line known", { kind: "long", m: 30_000, reps: null }, null, false],
    ["a walk and run has no distance to hold to the line", ownSessionOf({ kind: "walk_run", index: 26 }, 0), 100, false],
    ["a rest day", null, 100, false],
  ];
  it.each(said)("said beside the run: %s", (_name, session, capM, over) => {
    expect(overCap(session, capM)).toBe(over);
  });
});

describe("which runs tick a day of one's own plan", () => {
  const tuesday = planDayPlus(MONDAY, 1);
  const cases: [string, OwnWeek, RunDay[], number[]][] = [
    ["a run that day of half the distance", weekWith(0, { kind: "easy", m: 8000 }), [ran(MONDAY, 4000)], [0]],
    ["a run that day under half", weekWith(0, { kind: "easy", m: 8000 }), [ran(MONDAY, 3900)], []],
    ["a run on a rest day ticks the nearest run it covers", weekWith(0, { kind: "easy", m: 6000 }), [ran(tuesday, 6000)], [0]],
    ["a run on a rest day too short for the run near it", weekWith(0, { kind: "easy", m: 10_000 }), [ran(tuesday, 4000)], []],
    ["a walk and run, long enough", weekWith(0, { kind: "walk_run", index: 0 }), [ran(MONDAY, 2000, 1200)], [0]],
    ["a walk and run, too short", weekWith(0, { kind: "walk_run", index: 0 }), [ran(MONDAY, 1000, 300)], []],
    ["a run of last week ticks nothing this week", weekWith(0, { kind: "easy", m: 3000 }), [ran(planDayPlus(MONDAY, -1), 9000)], []],
    ["a run dated after today ticks nothing", weekWith(4, { kind: "easy", m: 3000 }), [ran(planDayPlus(MONDAY, 4), 9000)], []],
  ];
  it.each(cases)("%s", (_name, week, runs, ticked) => {
    // Every run here recorded after the week was saved.
    const days = ownPlanOf({ week, today: WEDNESDAY, runs, after: runs });
    expect(days.map((d) => d.day)).toEqual(Array.from({ length: 7 }, (_, i) => planDayPlus(MONDAY, i)));
    expect(days.flatMap((d, i) => (d.done ? [i] : []))).toEqual(ticked);
  });
});

describe("a run from before the week was saved fills only its own day (Kd, 2026-11-12)", () => {
  // `after`: the server's read of each day's longest run started once the week was saved, by the time.
  const tuesday = planDayPlus(MONDAY, 1);
  const saturday8 = weekWith(5, { kind: "easy", m: 8000 });
  const cases: [string, OwnWeek, RunDay[], RunDay[], number[]][] = [
    ["Monday's run on a rest day, from before the save: Saturday still to do", saturday8, [ran(MONDAY, 10_000)], [], []],
    ["the same run, recorded after the save: Saturday is done early", saturday8, [ran(MONDAY, 10_000)], [ran(MONDAY, 10_000)], [5]],
    ["a run on its own day, from before the save, still ticks it", weekWith(0, { kind: "easy", m: 5000 }), [ran(MONDAY, 5000)], [], [0]],
    ["Tuesday instead of Monday, after the save: Monday is done", weekWith(0, { kind: "easy", m: 5000 }), [ran(tuesday, 5000)], [ran(tuesday, 5000)], [0]],
    ["Tuesday instead of Monday, before the save: Monday stays to do", weekWith(0, { kind: "easy", m: 5000 }), [ran(tuesday, 5000)], [], []],
    ["the day of the save: a 9 km run that morning, a 3 km run after it; only the 3 km may fill Saturday, and it is too short", saturday8, [ran(WEDNESDAY, 9000)], [ran(WEDNESDAY, 3000)], []],
  ];
  it.each(cases)("%s", (_name, week, runs, after, ticked) => {
    const days = ownPlanOf({ week, today: WEDNESDAY, runs, after });
    expect(days.flatMap((d, i) => (d.done ? [i] : []))).toEqual(ticked);
  });
});

describe("one's own tempo and interval runs keep the suggested plan's limits", () => {
  const steadyOf = (m: number, weekM: number) => {
    const sOwn = ownSessionOf({ kind: "steady", m }, weekM);
    return sOwn.kind === "steady" && sOwn.reps !== null ? sOwn.reps : null;
  };
  const fastOf = (m: number, weekM: number) => {
    const sOwn = ownSessionOf({ kind: "fast", m }, weekM);
    return sOwn.kind === "fast" && sOwn.reps !== null ? sOwn.reps : null;
  };

  it("at every distance from the least to 60 km, in weeks of that run alone up to 250 km: steady at most 10 % of the week and 5 km, fast at most 8 % and 10 km, else the smallest", () => {
    let checked = 0;
    for (const extraM of [0, 15_000, 40_000, 190_000]) {
      for (let m = OWN_STEADY_LEAST_M; m <= RUN_LONGEST_MOST_M; m += 100) {
        const weekM = m + extraM;
        const r = steadyOf(m, weekM);
        expect(r).not.toBeNull();
        if (r === null) continue;
        const most = Math.min(weekM * 0.1, m - 3000, OWN_STEADY_MOST_M);
        expect(r.count * r.m <= most || (r.count === 1 && r.m === 1000)).toBe(true);
        expect(r.count * r.m).toBeLessThanOrEqual(m - 3000);
        checked += 1;
      }
      for (let m = OWN_FAST_LEAST_M; m <= RUN_LONGEST_MOST_M; m += 100) {
        const weekM = m + extraM;
        const r = fastOf(m, weekM);
        expect(r).not.toBeNull();
        if (r === null) continue;
        const most = Math.min(weekM * 0.08, m - 3000, OWN_FAST_MOST_M);
        expect(r.count * r.m <= most || r.count === 2).toBe(true);
        expect(r.count * r.m).toBeLessThanOrEqual(m - 3000);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(4000);
  });

  const named: [string, { count: number; m: number } | null, { count: number; m: number }][] = [
    ["the review's 20 km tempo run in a 20 km week: 2 × 1 km, never 10 × 1.6 km", steadyOf(20_000, 20_000), { count: 2, m: 1000 }],
    ["a 60 km tempo run in a 250 km week: 5 km at most, 3 × 1.6 km", steadyOf(60_000, 250_000), { count: 3, m: 1600 }],
    ["an 8 km tempo run in a 25 km week: 2 × 1 km, as the suggested plan has it", steadyOf(8000, 25_000), { count: 2, m: 1000 }],
    ["a 4 km tempo run alone in its week: the smallest, 1 × 1 km", steadyOf(4000, 4000), { count: 1, m: 1000 }],
    ["a 60 km interval run in a 60 km week: 8 % is 4.8 km, 6 × 800 m", fastOf(60_000, 60_000), { count: 6, m: 800 }],
    ["a 60 km interval run in a 250 km week: 10 km at most, 12 × 800 m", fastOf(60_000, 250_000), { count: 12, m: 800 }],
    ["a 4.6 km interval run alone in its week: the smallest, 2 × 800 m", fastOf(4600, 4600), { count: 2, m: 800 }],
  ];
  it.each(named)("%s", (_name, got, want) => {
    expect(got === null ? null : { count: got.count, m: got.m }).toEqual(want);
  });

  it("the week's distance leaves out walk-and-run days", () => {
    expect(ownWeekM([{ kind: "easy", m: 5000 }, { kind: "walk_run", index: 3 }, null, { kind: "steady", m: 6000 }, null, null, null])).toBe(11_000);
  });
});

describe("one's own runs, step by step", () => {
  it("every Couch to 5K run is the NHS run of its week, and comes back as the same run", () => {
    for (let index = 0; index < 27; index += 1) {
      const s = ownSessionOf({ kind: "walk_run", index }, 0);
      expect(s).toEqual({ kind: "walk_run", week: Math.floor(index / 3) + 1, run: (index % 3) + 1, parts: c25kParts(index) });
      expect(ownRunOf(s)).toEqual({ kind: "walk_run", index });
    }
  });

  it("every run the app suggests, for every kind of person and week, can be kept as one's own, the same kind and distance", () => {
    const answers: RunPlanAnswers[] = [];
    for (const jog of JOG_BANDS) {
      for (const goal of RUN_GOALS) {
        for (const days of [[1, 3, 5], [2, 4, 6, 7], [1, 2, 3, 4, 5, 6, 7]]) {
          if (jog === "30plus") {
            for (const weeklyM of [5000, 20_000, 60_000, 120_000]) answers.push({ doesRun: "yes", jog, days, goal, weeklyM, longestM: Math.round(weeklyM / 3), race: null });
          } else {
            answers.push({ doesRun: "start", jog, days, goal, weeklyM: null, longestM: null, race: null });
          }
        }
      }
    }
    let sessions = 0;
    for (const a of answers) {
      const plan = runPlanOf({ answers: a, startDay: MONDAY, raceDay: null, today: MONDAY, safeMode: false, runs: [] });
      if (plan.kind === "none") continue;
      const week = plan.days.map((d) => (d.session === null ? null : ownRunOf(d.session)));
      expect(ownWeekSchema.safeParse(week).success).toBe(true);
      const weekM = ownWeekM(week);
      plan.days.forEach((d, i) => {
        const own = week[i];
        if (d.session === null || own === null || own === undefined) return;
        const kept = ownSessionOf(own, weekM);
        expect(kept.kind).toBe(d.session.kind);
        if (kept.kind !== "walk_run" && d.session.kind !== "walk_run") expect(kept.m).toBe(d.session.m);
        else expect(kept).toEqual(d.session);
      });
      sessions += week.filter((d) => d !== null).length;
    }
    expect(sessions).toBeGreaterThan(200);
  });
});

describe("what the phone may send", () => {
  const refused: [string, unknown][] = [
    ["six days", { days: REST.slice(0, 6) }],
    ["a run under 1 km", { days: weekWith(0, { kind: "easy", m: OWN_RUN_LEAST_M - 100 }) }],
    ["a run in part metres", { days: weekWith(0, { kind: "easy", m: 1050 }) }],
    ["a run past 60 km", { days: weekWith(0, { kind: "long", m: RUN_LONGEST_MOST_M + 100 }) }],
    ["a tempo run too short for a repeat", { days: weekWith(0, { kind: "steady", m: OWN_STEADY_LEAST_M - 100 }) }],
    ["an interval run too short for two", { days: weekWith(0, { kind: "fast", m: OWN_FAST_LEAST_M - 100 }) }],
    ["a Couch to 5K run past its last", { days: weekWith(0, { kind: "walk_run", index: 27 }) }],
    ["a run with its own repeats", { days: [{ kind: "fast", m: 6000, reps: { count: 30, m: 800, restS: 1 } }, null, null, null, null, null, null] }],
    ["somebody else's id beside the week", { days: REST, userId: "x" }],
  ];
  it.each(refused)("refused: %s", (_name, body) => {
    expect(putOwnRunPlanRequestSchema.safeParse(body).success).toBe(false);
  });
  it("a week of rest days, and the two picks, are taken; a gym's plan is not one yet", () => {
    expect(putOwnRunPlanRequestSchema.safeParse({ days: REST }).success).toBe(true);
    expect(putRunChoiceRequestSchema.safeParse({ choice: "mine" }).success).toBe(true);
    expect(putRunChoiceRequestSchema.safeParse({ choice: "suggested" }).success).toBe(true);
    expect(putRunChoiceRequestSchema.safeParse({ choice: "gym" }).success).toBe(false);
  });
});
