// Your own run plan (ROADMAP 37d-iii-b). Safe mode is the server's (geo.ownRunPlan.routes.test.ts); here the
// rules that pick and threshold, over every class of case: which plan shows before a pick, the 10 % line
// (Frandsen and colleagues, BJSM 2025: a run past 10 % over the longest of the last 30 days), which runs
// tick a day, and every suggested run turned into one's own.
import { describe, expect, it } from "vitest";
import {
  JOG_BANDS,
  OWN_FAST_LEAST_M,
  OWN_RUN_LEAST_M,
  OWN_STEADY_LEAST_M,
  RUN_GOALS,
  RUN_LONGEST_MOST_M,
  c25kParts,
  hasOwnRun,
  overCap,
  ownPlanOf,
  ownRunOf,
  ownSessionOf,
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
  const week = weekWith(5, { kind: "long", m: 12_000 });
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
    expect(ownPlanOf({ week, today: WEDNESDAY, runs, answeredLongest }).capM).toBe(capM);
  });

  const said: [string, PlanSession | null, number | null, boolean][] = [
    ["at the line", { kind: "easy", m: 8800, reps: null }, 8800, false],
    ["100 m past it", { kind: "long", m: 8900, reps: null }, 8800, true],
    ["a tempo run past it", ownSessionOf({ kind: "steady", m: 10_000 }), 8800, true],
    ["no line known", { kind: "long", m: 30_000, reps: null }, null, false],
    ["a walk and run has no distance to hold to the line", ownSessionOf({ kind: "walk_run", index: 26 }), 100, false],
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
    const plan = ownPlanOf({ week, today: WEDNESDAY, runs, answeredLongest: null });
    expect(plan.days.map((d) => d.day)).toEqual(Array.from({ length: 7 }, (_, i) => planDayPlus(MONDAY, i)));
    expect(plan.days.flatMap((d, i) => (d.done ? [i] : []))).toEqual(ticked);
  });
});

describe("one's own runs, step by step", () => {
  it("a tempo run and an interval run keep their repeats at every distance allowed; nothing becomes an easy run", () => {
    for (let m = OWN_STEADY_LEAST_M; m <= RUN_LONGEST_MOST_M; m += 100) {
      const s = ownSessionOf({ kind: "steady", m });
      expect(s.kind === "steady" && s.reps !== null && s.reps.count >= 1 && s.m === m).toBe(true);
    }
    for (let m = OWN_FAST_LEAST_M; m <= RUN_LONGEST_MOST_M; m += 100) {
      const s = ownSessionOf({ kind: "fast", m });
      expect(s.kind === "fast" && s.reps !== null && s.reps.count >= 2 && s.m === m).toBe(true);
    }
  });

  it("every Couch to 5K run is the NHS run of its week, and comes back as the same run", () => {
    for (let index = 0; index < 27; index += 1) {
      const s = ownSessionOf({ kind: "walk_run", index });
      expect(s).toEqual({ kind: "walk_run", week: Math.floor(index / 3) + 1, run: (index % 3) + 1, parts: c25kParts(index) });
      expect(ownRunOf(s)).toEqual({ kind: "walk_run", index });
    }
  });

  it("every run the app suggests, for every kind of person and week, can be kept as one's own", () => {
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
      // Kept as one's own, each run is the same run again.
      plan.days.forEach((d, i) => {
        const own = week[i];
        if (d.session !== null && own !== null && own !== undefined) expect(ownSessionOf(own)).toEqual(d.session.kind === "walk_run" ? d.session : ownSessionOf(ownRunOf(d.session)));
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
