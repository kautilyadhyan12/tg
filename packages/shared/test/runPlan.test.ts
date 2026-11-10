// The run plan (ROADMAP 37d-i). The worst thing first: nobody in Safe mode is handed a run, and no
// run is planned more than 10 % past the longest of the last 30 days (Frandsen and colleagues, BJSM
// 2025), over every kind of person and week. Then the NHS Couch to 5K against the NHS's own printable
// plan, Daniels' paces against his published table, and every class of week.
import { describe, expect, it } from "vitest";
import {
  C25K_WARM_S,
  JOG_BANDS,
  RUN_GOALS,
  RUN_GOAL_PEAK,
  planDayPlus,
  c25kParts,
  pacesOf,
  runPlanAnswersSchema,
  runPlanOf,
  vdotOf,
  planWeekdayOf,
  type PlanDay,
  type RunDay,
  type RunPlan,
  type RunPlanAnswers,
  type RunPlanInput,
} from "../src/index.js";

const MONDAY = "2026-11-09";

const runnerAnswers = (over: Partial<RunPlanAnswers> = {}): RunPlanAnswers => ({
  doesRun: "yes",
  jog: "30plus",
  days: [1, 3, 5, 7],
  goal: "10k",
  weeklyM: 20_000,
  longestM: 8_000,
  race: { distanceM: 5000, timeS: 1500 },
  ...over,
});
const beginnerAnswers = (over: Partial<RunPlanAnswers> = {}): RunPlanAnswers => ({
  doesRun: "start",
  jog: "none",
  days: [1, 3, 5],
  goal: "5k",
  weeklyM: null,
  longestM: null,
  race: null,
  ...over,
});
const input = (answers: RunPlanAnswers, over: Partial<RunPlanInput> = {}): RunPlanInput => ({
  answers,
  startDay: MONDAY,
  raceDay: MONDAY,
  today: MONDAY,
  safeMode: false,
  runs: [],
  ...over,
});
const sessionM = (d: PlanDay): number => (d.session !== null && d.session.kind !== "walk_run" ? d.session.m : 0);
const daysOf = (plan: RunPlan): PlanDay[] => (plan.kind === "none" ? [] : plan.days);
const run = (day: string, distanceM: number, movingS = distanceM * 0.4, effort: number | null = null): RunDay => ({ day, distanceM, longestM: distanceM, movingS, effort });

describe("the worst thing: a run that hurts somebody", () => {
  it("nobody in Safe mode gets a plan, whatever they answered", () => {
    for (const answers of [runnerAnswers(), beginnerAnswers(), runnerAnswers({ goal: "half", weeklyM: 80_000, longestM: 25_000 })]) {
      expect(runPlanOf(input(answers, { safeMode: true }))).toEqual({ kind: "none", why: "safe_mode" });
    }
  });

  it("a no to running makes no plan", () => {
    const no: RunPlanAnswers = { doesRun: "no", jog: null, days: [], goal: null, weeklyM: null, longestM: null, race: null };
    expect(runPlanOf(input(no))).toEqual({ kind: "none", why: "not_for_me" });
  });

  it("no planned run is more than 10 % longer than the longest of the last 30 days, over every kind of runner and week", () => {
    let checked = 0;
    for (const goal of RUN_GOALS) {
      for (const weeklyM of [8_000, 20_000, 45_000, 90_000]) {
        for (const longestM of [1_500, 2_000, 3_000, 6_000, 12_000, 30_000]) {
          for (const days of [[2, 6], [1, 3, 5, 7], [1, 2, 3, 4, 5, 6, 7]]) {
            for (const week of [0, 1, 2, 5, 9]) {
              // Runs recorded each planned day at the planned distance, then the plan read week by week.
              const answers = runnerAnswers({ goal, weeklyM, longestM, days });
              const runs: RunDay[] = [];
              const today = planDayPlus(MONDAY, week * 7 + 2);
              for (let i = 0; i < week * 7 + 2; i += 1) {
                const day = planDayPlus(MONDAY, i);
                const plan = runPlanOf(input(answers, { today: day, runs }));
                const todays = daysOf(plan).find((d) => d.day === day);
                if (todays !== undefined && sessionM(todays) > 0) runs.push(run(day, sessionM(todays)));
              }
              const plan = runPlanOf(input(answers, { today, runs }));
              // The stated longest while it is from the last 30 days, and the runs really recorded: nothing else.
              const recorded = runs.filter((x) => x.day >= planDayPlus(today, -30)).map((x) => x.longestM);
              const known = week * 7 + 2 <= 30 ? Math.max(longestM, ...recorded) : Math.max(0, ...recorded);
              for (const d of daysOf(plan)) {
                expect(sessionM(d)).toBeLessThanOrEqual(Math.floor(known * 1.1));
                checked += 1;
              }
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(5000);
  });

  it("a runner who says 8 km is their longest is never planned a long run past 8.8 km in the first month", () => {
    const plan = runPlanOf(input(runnerAnswers({ weeklyM: 60_000, longestM: 8_000, goal: "half" })));
    expect(Math.max(...daysOf(plan).map(sessionM))).toBeLessThanOrEqual(8_800);
  });

  it("after a month with no runs recorded, nothing grows past the longest known", () => {
    const plan = runPlanOf(input(runnerAnswers({ longestM: 8_000 }), { today: planDayPlus(MONDAY, 45) }));
    expect(Math.max(...daysOf(plan).map(sessionM))).toBeLessThanOrEqual(8_000);
  });
});

describe("Couch to 5K: the NHS printable plan", () => {
  // The NHS's printable plan, run by run (digitalcampaignsstorage…/c25k_printable_plan.pdf): every run a
  // 5-minute walk before and after.
  const NHS: { week: number; run: number; runs: number[]; walks: number[] }[] = [
    { week: 1, run: 1, runs: [60, 60, 60, 60, 60, 60, 60, 60], walks: [90, 90, 90, 90, 90, 90, 90] },
    { week: 2, run: 1, runs: [90, 90, 90, 90, 90, 90], walks: [120, 120, 120, 120, 120] },
    { week: 3, run: 1, runs: [90, 180, 90, 180], walks: [90, 180, 90] },
    { week: 4, run: 1, runs: [180, 300, 180, 300], walks: [90, 150, 90] },
    { week: 5, run: 1, runs: [300, 300, 300], walks: [180, 180] },
    { week: 5, run: 2, runs: [480, 480], walks: [300] },
    { week: 5, run: 3, runs: [1200], walks: [] },
    { week: 6, run: 1, runs: [300, 480, 300], walks: [180, 180] },
    { week: 6, run: 2, runs: [600, 600], walks: [180] },
    { week: 6, run: 3, runs: [1500], walks: [] },
    { week: 7, run: 1, runs: [1500], walks: [] },
    { week: 8, run: 1, runs: [1680], walks: [] },
    { week: 9, run: 1, runs: [1800], walks: [] },
  ];
  it.each(NHS)("week $week run $run is the NHS's", ({ week, run: n, runs, walks }) => {
    const parts = c25kParts((week - 1) * 3 + n - 1);
    expect(parts[0]).toEqual({ kind: "walk", s: C25K_WARM_S });
    expect(parts.at(-1)).toEqual({ kind: "walk", s: C25K_WARM_S });
    const middle = parts.slice(1, -1);
    expect(middle.filter((p) => p.kind === "run").map((p) => p.s)).toEqual(runs);
    expect(middle.filter((p) => p.kind === "walk").map((p) => p.s)).toEqual(walks);
  });

  it("week 1 is 28½ minutes and week 9 is 40, walks included", () => {
    const total = (i: number) => c25kParts(i).reduce((t, p) => t + p.s, 0);
    expect(total(0)).toBe(1710);
    expect(total(24)).toBe(2400);
  });

  it("somebody who cannot yet jog starts at week 1, run 1, three runs a week with a day between", () => {
    const plan = runPlanOf(input(beginnerAnswers({ days: [1, 2, 3, 4, 5] })));
    expect(plan.kind).toBe("c25k");
    const planned = daysOf(plan).filter((d) => d.session !== null);
    expect(planned.map((d) => d.weekday)).toEqual([1, 3, 5]);
    expect(planned.map((d) => (d.session?.kind === "walk_run" ? `${String(d.session.week)}.${String(d.session.run)}` : ""))).toEqual(["1.1", "1.2", "1.3"]);
  });

  it.each([
    ["none", 1],
    ["upto5", 1],
    ["5to10", 4],
    ["10to20", 5],
    ["20to30", 6],
  ] as const)("can jog %s: starts at week %i", (jog, week) => {
    const plan = runPlanOf(input(beginnerAnswers({ jog })));
    expect(plan.kind === "c25k" ? plan.week : 0).toBe(week);
  });

  it("a recorded run long enough ticks the run off and the next waits; a short one counts for nothing", () => {
    const answers = beginnerAnswers();
    const runs = [run(MONDAY, 2000, 900), run(planDayPlus(MONDAY, 2), 600, 300)];
    const plan = runPlanOf(input(answers, { today: planDayPlus(MONDAY, 2), runs }));
    const days = daysOf(plan);
    expect(days[0]?.done).toBe(true);
    expect(days[2]?.done).toBe(false);
    expect(days[2]?.session?.kind === "walk_run" ? days[2].session.run : 0).toBe(2);
  });

  it("two runs in a day count once, and a missed week is never made up: the plan waits", () => {
    const answers = beginnerAnswers();
    const plan = runPlanOf(input(answers, { today: planDayPlus(MONDAY, 21), runs: [run(MONDAY, 2000, 900)] }));
    expect(plan.kind === "c25k" ? plan.week : 0).toBe(1);
    const next = daysOf(plan).find((d) => d.session !== null);
    expect(next?.session?.kind === "walk_run" ? next.session.run : 0).toBe(2);
  });

  it("after the ninth week the plan grows from the runs recorded, towards the distance picked", () => {
    const answers = beginnerAnswers({ jog: "20to30" });
    // Weeks 6 to 9: twelve runs, Monday, Wednesday and Friday.
    const runs: RunDay[] = [];
    for (let wk = 0; wk < 4; wk += 1) for (const d of [0, 2, 4]) runs.push(run(planDayPlus(MONDAY, wk * 7 + d), 4500, 2400));
    const plan = runPlanOf(input(answers, { today: planDayPlus(MONDAY, 28), runs }));
    expect(plan.kind).toBe("runner");
    expect(Math.max(...daysOf(plan).map(sessionM))).toBeLessThanOrEqual(Math.floor(4500 * 1.1));
  });
});

describe("a runner's week", () => {
  it("a small week and a short longest run are planned as they are, never raised", () => {
    for (const [weeklyM, longestM] of [[5_000, 2_000], [8_000, 3_000], [3_000, 1_500]] as const) {
      const plan = runPlanOf(input(runnerAnswers({ weeklyM, longestM, race: null })));
      expect(plan.kind).toBe("runner");
      expect(plan.kind === "runner" ? plan.weekM : 99_999).toBeLessThanOrEqual(weeklyM);
      expect(Math.max(...daysOf(plan).map(sessionM))).toBeLessThanOrEqual(Math.floor(longestM * 1.1));
    }
  });

  it("someone who can run 30 minutes but runs nothing now starts at Couch to 5K's last week", () => {
    for (const over of [{ weeklyM: 0 }, { longestM: 0 }]) {
      const plan = runPlanOf(input(runnerAnswers({ ...over, race: null })));
      expect(plan.kind === "c25k" ? plan.week : 0).toBe(9);
    }
  });

  it("starts at the week they run now, never more, with one long run on the weekend", () => {
    const plan = runPlanOf(input(runnerAnswers()));
    expect(plan.kind).toBe("runner");
    if (plan.kind !== "runner") return;
    expect(plan.weekM).toBeLessThanOrEqual(20_000);
    const long = plan.days.filter((d) => d.session?.kind === "long");
    expect(long.map((d) => d.weekday)).toEqual([7]);
    expect(sessionM(long[0] ?? plan.days[0] ?? { day: "", weekday: 1, session: null, done: false })).toBeLessThanOrEqual(20_000 * 0.3);
  });

  it("a beginner has one hard run a week, an experienced runner two, never next to the long run or each other", () => {
    for (const [weeklyM, hard] of [[20_000, 1], [40_000, 2]] as const) {
      const plan = runPlanOf(input(runnerAnswers({ weeklyM, longestM: 15_000, days: [1, 2, 3, 4, 5, 7] })));
      const hardDays = daysOf(plan).filter((d) => d.session?.kind === "steady" || d.session?.kind === "fast").map((d) => d.weekday);
      expect(hardDays).toHaveLength(hard);
      for (const h of hardDays) {
        expect(Math.min(Math.abs(h - 7), 7 - Math.abs(h - 7))).toBeGreaterThanOrEqual(2);
        for (const o of hardDays) if (o !== h) expect(Math.abs(o - h)).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("steady running is at most 10 % of the week", () => {
    const plan = runPlanOf(input(runnerAnswers({ weeklyM: 40_000, longestM: 15_000 })));
    for (const d of daysOf(plan)) {
      if (d.session?.kind === "steady" && d.session.reps !== null) expect(d.session.reps.count * d.session.reps.m).toBeLessThanOrEqual(4_000);
    }
  });

  it("grows 10 % a week at most from what was run, holds with nothing recorded, eases every fourth week", () => {
    const answers = runnerAnswers({ weeklyM: 20_000, longestM: 10_000 });
    const runs: RunDay[] = [];
    const weeks: number[] = [];
    for (let wk = 0; wk < 6; wk += 1) {
      const plan = runPlanOf(input(answers, { today: planDayPlus(MONDAY, wk * 7), runs }));
      if (plan.kind !== "runner") throw new Error("runner");
      weeks.push(plan.weekM);
      for (const d of plan.days) if (sessionM(d) > 0) runs.push(run(d.day, sessionM(d)));
    }
    // Each week at most 10 % over the last ordinary week before it (week 4 is the easier one).
    for (const [i, before] of [[1, 0], [2, 1], [4, 2], [5, 4]] as const) expect(weeks[i] ?? 0).toBeLessThanOrEqual(Math.ceil((weeks[before] ?? 0) * 1.1));
    expect(weeks[3] ?? 0).toBeLessThan(weeks[2] ?? 0);
    const held = runPlanOf(input(answers, { today: planDayPlus(MONDAY, 14) }));
    expect(held.kind === "runner" && held.held).toBe(true);
    expect(held.kind === "runner" ? held.weekM : 0).toBeLessThanOrEqual(20_000);
  });

  it("a week run short grows only from what was run, never back up by running more", () => {
    const answers = runnerAnswers({ weeklyM: 30_000, longestM: 12_000 });
    const plan = runPlanOf(input(answers, { today: planDayPlus(MONDAY, 14), runs: [run(planDayPlus(MONDAY, 7), 5000)] }));
    expect(plan.kind === "runner" ? plan.weekM : 99_999).toBeLessThanOrEqual(5_500);
    const tiny = runPlanOf(input(runnerAnswers({ weeklyM: 20_000, longestM: 8_000 }), { today: planDayPlus(MONDAY, 14), runs: [run(planDayPlus(MONDAY, 7), 1000)] }));
    expect(tiny.kind === "runner" ? tiny.weekM : 99_999).toBeLessThanOrEqual(1_100);
  });

  it("stops growing at the distance picked", () => {
    for (const goal of RUN_GOALS) {
      const answers = runnerAnswers({ goal, weeklyM: RUN_GOAL_PEAK[goal].weekM, longestM: RUN_GOAL_PEAK[goal].longM });
      const runs = Array.from({ length: 14 }, (_, i) => run(planDayPlus(MONDAY, i), RUN_GOAL_PEAK[goal].weekM / 4));
      const plan = runPlanOf(input(answers, { today: planDayPlus(MONDAY, 15), runs }));
      if (plan.kind !== "runner") throw new Error("runner");
      expect(plan.weekM).toBeLessThanOrEqual(RUN_GOAL_PEAK[goal].weekM + 400);
      expect(Math.max(...plan.ahead.map((a) => a.m ?? 0))).toBeLessThanOrEqual(RUN_GOAL_PEAK[goal].weekM);
    }
  });

  it("a race time older than six weeks gives paces by feel", () => {
    const plan = runPlanOf(input(runnerAnswers(), { today: planDayPlus(MONDAY, 43) }));
    expect(plan.kind === "runner" && plan.paces === null && plan.raceOld).toBe(true);
  });

  it("the race time's own day counts, never the plan's: two months old is by feel, however new the plan", () => {
    const plan = runPlanOf(input(runnerAnswers(), { startDay: planDayPlus(MONDAY, 50), raceDay: MONDAY, today: planDayPlus(MONDAY, 50) }));
    expect(plan.kind === "runner" && plan.paces === null && plan.raceOld).toBe(true);
  });

  it("no race time: paces by feel", () => {
    const plan = runPlanOf(input(runnerAnswers({ race: null })));
    expect(plan.kind === "runner" && plan.paces).toBeNull();
  });
});

describe("Daniels' paces against his published table", () => {
  // Daniels' Running Formula, VDOT table: VDOT 50 races 5 km in 19:57, runs threshold at 4:15 a km and
  // intervals at 3:55; VDOT 40 races 5 km in 24:08, threshold 5:06, intervals 4:42.
  it.each([
    [1197, 50, 255, 235],
    [1448, 40, 306, 282],
  ])("5 km in %i s: VDOT %i, steady near %i s/km, fast near %i s/km", (timeS, vdot, steady, fast) => {
    expect(Math.abs((vdotOf({ distanceM: 5000, timeS }) ?? 0) - vdot)).toBeLessThan(0.6);
    const paces = pacesOf({ distanceM: 5000, timeS });
    expect(Math.abs((paces?.steady[0] ?? 0) - steady)).toBeLessThanOrEqual(3);
    expect(Math.abs((paces?.fast ?? 0) - fast)).toBeLessThanOrEqual(3);
    // Easy is slower than steady at both ends, its slow end at 59 % of VDOT (the book's own share).
    expect(paces?.easy[0] ?? 0).toBeGreaterThan(paces?.steady[1] ?? 0);
  });

  it("a time faster than the world record, or slower than any table, is no race time", () => {
    expect(vdotOf({ distanceM: 5000, timeS: 600 })).toBeNull();
    expect(vdotOf({ distanceM: 5000, timeS: 4 * 3600 })).toBeNull();
  });
});

describe("the answers", () => {
  it("takes a runner's, a beginner's and a no", () => {
    expect(runPlanAnswersSchema.safeParse(runnerAnswers()).success).toBe(true);
    expect(runPlanAnswersSchema.safeParse(beginnerAnswers()).success).toBe(true);
    expect(runPlanAnswersSchema.safeParse({ doesRun: "no", jog: null, days: [], goal: null, weeklyM: null, longestM: null, race: null }).success).toBe(true);
  });

  it.each([
    ["one day", runnerAnswers({ days: [3] })],
    ["a day twice", runnerAnswers({ days: [1, 1, 3] })],
    ["day 8", runnerAnswers({ days: [1, 8] })],
    ["a runner with no week", runnerAnswers({ weeklyM: null })],
    ["a beginner's week", beginnerAnswers({ weeklyM: 10_000 })],
    ["no goal", runnerAnswers({ goal: null })],
    ["a 300 km week", runnerAnswers({ weeklyM: 300_000 })],
    ["a 5 km in 9 minutes", runnerAnswers({ race: { distanceM: 5000, timeS: 540 } })],
    ["Couch to 5K on two days side by side", beginnerAnswers({ days: [6, 7] })],
    ["a no with a goal", { doesRun: "no", jog: null, days: [], goal: "5k", weeklyM: null, longestM: null, race: null }],
  ])("refuses %s", (_name, answers) => {
    expect(runPlanAnswersSchema.safeParse(answers).success).toBe(false);
  });

  it("every band is a band the plan knows", () => {
    for (const jog of JOG_BANDS) expect(runPlanOf(input(jog === "30plus" ? runnerAnswers() : beginnerAnswers({ jog }))).kind).not.toBe("none");
  });

  it("weekdays run Monday 1 to Sunday 7", () => {
    expect(planWeekdayOf(MONDAY)).toBe(1);
    expect(planWeekdayOf(planDayPlus(MONDAY, 6))).toBe(7);
  });
});

describe("the plan follows what the person really ran and how it felt", () => {
  it("a run on Tuesday instead of Monday ticks Monday's run; a short one ticks nothing", () => {
    const answers = runnerAnswers({ weeklyM: 20_000, longestM: 10_000, days: [1, 3, 5, 7] });
    const before = runPlanOf(input(answers, { today: planDayPlus(MONDAY, 2) }));
    const monday = before.kind === "runner" ? sessionM(before.days[0] ?? { day: "", weekday: 1, session: null, done: false }) : 0;
    expect(monday).toBeGreaterThan(0);
    const moved = runPlanOf(input(answers, { today: planDayPlus(MONDAY, 2), runs: [run(planDayPlus(MONDAY, 1), monday)] }));
    expect(daysOf(moved)[0]?.done).toBe(true);
    expect(daysOf(moved).filter((d) => d.done)).toHaveLength(1);
    const short = runPlanOf(input(answers, { today: planDayPlus(MONDAY, 2), runs: [run(planDayPlus(MONDAY, 1), 500)] }));
    expect(daysOf(short).some((d) => d.done)).toBe(false);
  });

  it("a week whose runs felt very hard does not grow, and says so; one hard run among easy ones still grows", () => {
    const answers = runnerAnswers({ weeklyM: 20_000, longestM: 10_000 });
    const week1 = [0, 2, 4, 6].map((d) => planDayPlus(MONDAY, d));
    const hardRuns = week1.map((d) => run(d, 5_000, 1800, 9));
    const hard = runPlanOf(input(answers, { today: planDayPlus(MONDAY, 7), runs: hardRuns }));
    expect(hard.kind === "runner" && hard.hard).toBe(true);
    expect(hard.kind === "runner" ? hard.weekM : 99_999).toBeLessThanOrEqual(20_000);
    const mixed = runPlanOf(input(answers, { today: planDayPlus(MONDAY, 7), runs: week1.map((d, i) => run(d, 5_000, 1800, i === 0 ? 9 : 4)) }));
    expect(mixed.kind === "runner" && mixed.hard).toBe(false);
    expect(mixed.kind === "runner" ? mixed.weekM : 0).toBeGreaterThan(20_000);
  });

  it("Couch to 5K: a run that felt very hard is ticked and the next run is the same one again", () => {
    const answers = beginnerAnswers();
    const plan = runPlanOf(input(answers, { today: planDayPlus(MONDAY, 2), runs: [run(MONDAY, 2000, 900, 9)] }));
    expect(plan.kind === "c25k" && plan.repeat).toBe(true);
    expect(daysOf(plan)[0]?.done).toBe(true);
    const next = daysOf(plan).find((d) => !d.done && d.session !== null);
    expect(next?.session?.kind === "walk_run" ? next.session.run : 0).toBe(1);
    const easy = runPlanOf(input(answers, { today: planDayPlus(MONDAY, 2), runs: [run(MONDAY, 2000, 900, 5)] }));
    expect(easy.kind === "c25k" && easy.repeat).toBe(false);
  });
});
