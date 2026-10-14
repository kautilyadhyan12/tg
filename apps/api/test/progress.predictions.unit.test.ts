// Progress's predictions (ROADMAP 35a; spec Part 2B §5): every gate, edge and band of
// the four rules, by hand-worked numbers. Today is Wednesday 2026-10-14 unless a case
// says otherwise.
import { describe, expect, it } from "vitest";
import {
  addDays,
  bestTime,
  calorieForecast,
  predictions,
  slotOf,
  steadyPace,
  weekGoal,
  type PredictionWorkout,
} from "../src/modules/workouts/predictions.js";

const TODAY = "2026-10-14"; // a Wednesday

const w = (day: string, o: Partial<Omit<PredictionWorkout, "day">> = {}): PredictionWorkout => ({
  day,
  hour: o.hour ?? 9,
  kcal: o.kcal === undefined ? 100 : o.kcal,
  durationMs: o.durationMs === undefined ? 30 * 60_000 : o.durationMs,
  formScore: o.formScore === undefined ? 80 : o.formScore,
});
const back = (n: number) => addDays(TODAY, -n);
/** A first workout long before any window: every day read is a day the person could train. */
const LONG_AGO = back(400);

describe("the next 7 days' calories", () => {
  it("is hidden below 5 workouts in the 28 days before today, and today and older days do not count", () => {
    const four = [1, 2, 3, 4].map((n) => w(back(n)));
    expect(calorieForecast(TODAY, [...four, w(TODAY), w(back(29))], back(29))).toEqual({ available: false, reason: "few_workouts", workouts: 4, needed: 5 });
    expect(calorieForecast(TODAY, [...four, w(back(28))], back(28)).available).toBe(true);
  });

  it("is hidden until the first workout is 7 days back", () => {
    const five = [1, 2, 3, 4, 5].map((n) => w(back(n)));
    expect(calorieForecast(TODAY, five, back(6))).toEqual({ available: false, reason: "too_new", workouts: 5, needed: 5 });
    expect(calorieForecast(TODAY, five, null)).toMatchObject({ available: false, reason: "too_new" });
    expect(calorieForecast(TODAY, five, back(7)).available).toBe(true);
  });

  it("never reads a day before the first workout as a day skipped", () => {
    // Started 8 days ago and burnt 300 every day since: 300 every day ahead, not 120.
    const ws = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => w(back(n), { kcal: 300 }));
    const f = calorieForecast(TODAY, ws, back(8));
    if (!f.available) throw new Error("hidden");
    for (const d of f.days) expect(d).toMatchObject({ kcalPoint: 300, kcalLow: 260, kcalHigh: 350 });
    // The same days with a first workout long before: the 3 older weeks were skipped.
    const long = calorieForecast(TODAY, ws, LONG_AGO);
    if (!long.available) throw new Error("hidden");
    expect(long.days.find((d) => d.date === "2026-10-15")?.kcalPoint).toBe(120);
  });

  it("weights the same weekday 4, 3, 2, 1 from the newest, with its spread as the band", () => {
    // Mondays 12, 5 Oct, 28 and 21 Sep: 400, 300, 200, 100. Mean 300; spread
    // (4·100 + 3·0 + 2·100 + 1·200) / 10 = 80, over the 15 % floor of 45.
    const mondays = [400, 300, 200, 100].map((kcal, k) => w(back(2 + 7 * k), { kcal }));
    const f = calorieForecast(TODAY, [...mondays, w(back(1), { kcal: 0 })], LONG_AGO);
    if (!f.available) throw new Error("hidden");
    expect(f.days.find((d) => d.date === "2026-10-19")).toEqual({ date: "2026-10-19", kcalPoint: 300, kcalLow: 220, kcalHigh: 380 });
  });

  it("counts a weekday with no workout as 0, and the band never goes under 0", () => {
    // Tuesdays: 500 on 13 Oct, none before. Mean 200; spread (4·300 + 3·200 + 2·200 + 1·200) / 10 = 240.
    const ws = [w(back(1), { kcal: 500 }), ...[2, 3, 4, 5].map((n) => w(back(n), { kcal: 0 }))];
    const f = calorieForecast(TODAY, ws, LONG_AGO);
    if (!f.available) throw new Error("hidden");
    expect(f.days.find((d) => d.date === "2026-10-20")).toEqual({ date: "2026-10-20", kcalPoint: 200, kcalLow: 0, kcalHigh: 440 });
  });

  it("never draws a band narrower than 15 % of its point, rounded to 10 kcal", () => {
    // Thursdays 8 Oct back to 17 Sep, 300 each: no spread, so ±45.
    const ws = [6, 13, 20, 27].map((n) => w(back(n), { kcal: 300 }));
    const f = calorieForecast(TODAY, [...ws, w(back(1), { kcal: 0 })], LONG_AGO);
    if (!f.available) throw new Error("hidden");
    expect(f.days.find((d) => d.date === "2026-10-15")).toEqual({ date: "2026-10-15", kcalPoint: 300, kcalLow: 260, kcalHigh: 350 });
  });

  it("reads the day a week from today from the 4 weeks before today, never today itself", () => {
    // Wednesdays 7 Oct, 30, 23 and 16 Sep at 100; today's 1000 is left out.
    const ws = [7, 14, 21, 28].map((n) => w(back(n), { kcal: 100 }));
    const f = calorieForecast(TODAY, [...ws, w(back(1), { kcal: 0 }), w(TODAY, { kcal: 1000 })], LONG_AGO);
    if (!f.available) throw new Error("hidden");
    expect(f.days.at(-1)).toEqual({ date: "2026-10-21", kcalPoint: 100, kcalLow: 90, kcalHigh: 120 });
  });

  it("adds up two workouts on one day, reads a missing figure as 0, and its totals are its days added up", () => {
    const ws = [w(back(1), { kcal: 150 }), w(back(1), { kcal: 250 }), w(back(2), { kcal: null }), w(back(3)), w(back(4))];
    const f = calorieForecast(TODAY, ws, LONG_AGO);
    if (!f.available) throw new Error("hidden");
    expect(f.days.map((d) => d.date)).toEqual(["2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18", "2026-10-19", "2026-10-20", "2026-10-21"]);
    // Tuesday 13 Oct: 400, weighted 4 of 10, so 160.
    expect(f.days.find((d) => d.date === "2026-10-20")?.kcalPoint).toBe(160);
    expect(f.totalPoint).toBe(f.days.reduce((n, d) => n + d.kcalPoint, 0));
    expect(f.totalLow).toBe(f.days.reduce((n, d) => n + d.kcalLow, 0));
    expect(f.totalHigh).toBe(f.days.reduce((n, d) => n + d.kcalHigh, 0));
  });
});

describe("this week's training-days goal", () => {
  /** Training days in each finished week, newest first; Monday of this week is 12 Oct. */
  const weeksOf = (counts: readonly number[]): PredictionWorkout[] =>
    counts.flatMap((n, k) => Array.from({ length: n }, (_, d) => w(addDays("2026-10-12", -7 * (k + 1) + d))));
  const firstOf = (weeks: number) => addDays("2026-10-12", -7 * weeks);

  it("is hidden with no goal, and below 3 finished weeks since the first workout", () => {
    expect(weekGoal(TODAY, weeksOf([3, 3, 3]), firstOf(3), null)).toEqual({ available: false, reason: "no_goal" });
    expect(weekGoal(TODAY, weeksOf([3, 3]), firstOf(2), 3)).toEqual({ available: false, reason: "few_weeks", weeks: 2, needed: 3 });
    expect(weekGoal(TODAY, [], null, 3)).toEqual({ available: false, reason: "few_weeks", weeks: 0, needed: 3 });
    expect(weekGoal(TODAY, weeksOf([3, 3, 3]), firstOf(3), 3).available).toBe(true);
  });

  it("never counts a week before the first workout as missed, and reads 6 weeks at most", () => {
    // Met in the 3 weeks since the first workout: on track, whatever came before.
    expect(weekGoal(TODAY, weeksOf([3, 3, 3]), firstOf(3), 3)).toMatchObject({ band: "on_track" });
    // Ten weeks of history: the 7th to 10th weeks back are not read.
    expect(weekGoal(TODAY, weeksOf([3, 3, 3, 3, 3, 3, 0, 0, 0, 0]), firstOf(10), 3)).toMatchObject({ band: "on_track" });
    // 16 of 21 over 6 weeks; a 7th week read would make it 20 of 28, under 75 %.
    expect(weekGoal(TODAY, weeksOf([3, 3, 3, 0, 0, 3, 0, 0, 0, 0]), firstOf(10), 3)).toMatchObject({ band: "on_track" });
  });

  it("counts the week of the first workout only when it began on a Monday or met the goal", () => {
    // Weeks back 1 to 3 hold 3, 0, 0 days; the 4th week back holds only its Sunday, the first workout.
    const sundayStart = addDays(firstOf(4), 6);
    const ws = [...weeksOf([3, 0, 0]), w(sundayStart)];
    // Not counted: 6 of 15 is doable (as a missed week it would be 6 of 18, tough).
    expect(weekGoal(TODAY, ws, sundayStart, 3)).toMatchObject({ band: "doable" });
    // Met in its few days, it counts: 6 + 3 of 18 is doable too, and the gate sees 4 weeks.
    expect(weekGoal(TODAY, [...weeksOf([3, 0, 0]), ...[4, 5, 6].map((d) => w(addDays(firstOf(4), d)))], addDays(firstOf(4), 4), 3)).toMatchObject({ band: "doable" });
    // Begun on a Monday it was a whole week: missed, it counts (6 of 18, tough).
    expect(weekGoal(TODAY, [...weeksOf([3, 0, 0]), w(firstOf(4))], firstOf(4), 3)).toMatchObject({ band: "tough" });
    // Two whole weeks met and a part week before them: too few weeks yet, never "doable".
    expect(weekGoal(TODAY, [...weeksOf([3, 3]), w(addDays(firstOf(3), 6))], addDays(firstOf(3), 6), 3)).toEqual({ available: false, reason: "few_weeks", weeks: 2, needed: 3 });
  });

  it("says reached once the week holds the goal, whatever the weeks before", () => {
    const thisWeek = [w("2026-10-12"), w("2026-10-13")];
    expect(weekGoal(TODAY, [...weeksOf([0, 0, 0]), ...thisWeek], firstOf(3), 2)).toEqual({
      available: true, target: 2, done: 2, daysLeft: 5, moreNeeded: 0, band: "reached",
    });
  });

  it("is tough when the days left cannot hold what is still needed, a day trained today not free again", () => {
    // Wednesday: 5 days left; 6 still needed.
    expect(weekGoal(TODAY, weeksOf([7, 7, 7]), firstOf(3), 6)).toMatchObject({ daysLeft: 5, moreNeeded: 6, band: "tough" });
    // 5 needed fit in 5 days; trained today, 4 needed in 4 days.
    expect(weekGoal(TODAY, weeksOf([7, 7, 7]), firstOf(3), 5)).toMatchObject({ daysLeft: 5, band: "on_track" });
    expect(weekGoal(TODAY, [...weeksOf([7, 7, 7]), w(TODAY), w(TODAY)], firstOf(3), 5)).toMatchObject({ done: 1, daysLeft: 4, moreNeeded: 4, band: "on_track" });
    expect(weekGoal(TODAY, [...weeksOf([7, 7, 7]), w(TODAY)], firstOf(3), 6)).toMatchObject({ daysLeft: 4, moreNeeded: 5, band: "tough" });
  });

  it("counts Monday to today, with all 7 days free on a Monday and one on a Sunday", () => {
    expect(weekGoal("2026-10-12", weeksOf([3, 3, 3]), firstOf(3), 3)).toMatchObject({ done: 0, daysLeft: 7 });
    expect(weekGoal("2026-10-18", [...weeksOf([3, 3, 3]), w("2026-10-12"), w("2026-10-17")], firstOf(3), 3)).toMatchObject({ done: 2, daysLeft: 1, moreNeeded: 1, band: "on_track" });
    // Last Sunday's workout is last week's, not this week's.
    expect(weekGoal(TODAY, [...weeksOf([3, 3, 3]), w("2026-10-11")], firstOf(3), 3)).toMatchObject({ done: 0 });
  });

  // Weeks are weighted 6 for last week down to 1 for six weeks back.
  it.each([
    // 6 weeks, 21 in all: 75 % is 15.75, 40 % is 8.4.
    { label: "weeks 1, 2, 3 and 6 met (16 of 21)", counts: [3, 3, 3, 0, 0, 3], band: "on_track" },
    { label: "weeks 1, 2 and 3 met (15 of 21)", counts: [3, 3, 3, 0, 0, 0], band: "doable" },
    { label: "weeks 1 and 4 met (9 of 21)", counts: [3, 0, 0, 3, 0, 0], band: "doable" },
    { label: "weeks 1 and 5 met (8 of 21)", counts: [3, 0, 0, 0, 3, 0], band: "tough" },
    // 5 weeks, 20 in all: exactly 75 % is on track.
    { label: "5 weeks, 15 of 20, exactly 75 %", counts: [3, 3, 3, 0, 0], band: "on_track" },
    { label: "5 weeks, 14 of 20", counts: [3, 3, 0, 3, 0], band: "doable" },
    // 3 weeks, 15 in all: exactly 40 % is doable.
    { label: "3 weeks, 6 of 15, exactly 40 %", counts: [3, 0, 0], band: "doable" },
    { label: "3 weeks, 5 of 15", counts: [0, 3, 0], band: "tough" },
    { label: "no week met", counts: [2, 2, 2], band: "tough" },
  ])("$label is $band", ({ counts, band }) => {
    expect(weekGoal(TODAY, weeksOf(counts), firstOf(counts.length), 3)).toMatchObject({ band, moreNeeded: 3 });
  });
});

describe("a steady pace", () => {
  const recent = (n: number, o: Partial<Omit<PredictionWorkout, "day">> = {}) => Array.from({ length: n }, (_, i) => w(back(i), o));
  const before = (n: number, o: Partial<Omit<PredictionWorkout, "day">> = {}) => Array.from({ length: n }, (_, i) => w(back(14 + i), o));

  it("is hidden below 8 workouts in 6 weeks, or below 3 on either side", () => {
    expect(steadyPace(TODAY, [...recent(4), ...before(3)])).toEqual({ available: false, reason: "few_workouts", recent: 4, before: 3, needed: 8, neededEachSide: 3 });
    expect(steadyPace(TODAY, [...recent(2), ...before(8)])).toMatchObject({ available: false, recent: 2, before: 8 });
    expect(steadyPace(TODAY, [...recent(8), ...before(2)])).toMatchObject({ available: false, recent: 8, before: 2 });
    expect(steadyPace(TODAY, [...recent(4), ...before(4)]).available).toBe(true);
  });

  it("takes the last 14 days against the 28 before them, and nothing older", () => {
    // 13 days back is recent, 14 is before, 41 is before, 42 is not read.
    const ws = [w(back(13)), w(back(0)), w(back(1)), w(back(6)), w(back(14)), w(back(41)), w(back(20)), w(back(42)), w(back(43)), w(back(5))];
    expect(steadyPace(TODAY, ws)).toMatchObject({ available: true, kcal: { before: 100, recent: 100 } });
    expect(steadyPace(TODAY, ws.filter((x) => x.day !== back(20)))).toMatchObject({ available: false, recent: 5, before: 2 });
  });

  it.each([
    { label: "4.9 % more calories", recentKcal: 1049, steady: true },
    { label: "5.0 % more calories", recentKcal: 1050, steady: false },
    { label: "4.9 % fewer calories", recentKcal: 951, steady: true },
    { label: "5.0 % fewer calories", recentKcal: 950, steady: false },
    // Rounded the same either way: 4.95 % up and down are both 5.0.
    { label: "4.95 % more calories", recentKcal: 1049.5, steady: false },
    { label: "4.95 % fewer calories", recentKcal: 950.5, steady: false },
  ])("$label: steady $steady", ({ recentKcal, steady }) => {
    const s = steadyPace(TODAY, [...recent(4, { kcal: recentKcal }), ...before(4, { kcal: 1000 })]);
    expect(s).toMatchObject({ available: true, steady, recentDays: 14 });
  });

  it("is not steady when one figure moved, though the others did not", () => {
    const s = steadyPace(TODAY, [...recent(4, { formScore: 90 }), ...before(4, { formScore: 80 })]);
    expect(s).toMatchObject({ steady: false, kcal: { changePct: 0 }, minutes: { before: 30, recent: 30, changePct: 0 }, form: { before: 80, recent: 90, changePct: 12.5 } });
  });

  it("leaves out a figure nobody has or that was 0 before, and judges on the rest", () => {
    const s = steadyPace(TODAY, [...recent(4, { formScore: null, kcal: 50 }), ...before(4, { formScore: null, kcal: 0 })]);
    expect(s).toMatchObject({ available: true, steady: true, kcal: null, form: null, minutes: { changePct: 0 } });
    // Form on one side only.
    expect(steadyPace(TODAY, [...recent(4), ...before(4, { formScore: null })])).toMatchObject({ form: null });
  });

  it("averages only the workouts that have a figure", () => {
    const s = steadyPace(TODAY, [...recent(2, { formScore: 70 }), ...recent(2, { formScore: null }), ...before(4, { formScore: 70 })]);
    expect(s).toMatchObject({ form: { before: 70, recent: 70, changePct: 0 } });
  });

  it("is hidden when no figure can be compared", () => {
    const none = { kcal: null, durationMs: null, formScore: null };
    expect(steadyPace(TODAY, [...recent(4, none), ...before(4, none)])).toEqual({
      available: false, reason: "nothing_to_compare", recent: 4, before: 4, needed: 8, neededEachSide: 3,
    });
  });
});

describe("the best time of day", () => {
  it.each([
    [0, "night"], [4, "night"], [5, "morning"], [11, "morning"], [12, "afternoon"],
    [16, "afternoon"], [17, "evening"], [21, "evening"], [22, "night"], [23, "night"],
  ] as const)("%i o'clock is %s", (hour, slot) => {
    expect(slotOf(hour)).toBe(slot);
  });

  it("is hidden below 6 workouts with a form score in 90 days", () => {
    const five = [1, 2, 3, 4, 5].map((n) => w(back(n)));
    expect(bestTime(TODAY, [...five, w(back(6), { formScore: null }), w(back(90))])).toEqual({ available: false, workouts: 5, needed: 6 });
    expect(bestTime(TODAY, [...five, w(back(89))]).available).toBe(true);
  });

  it("names the highest average form among times with 2 workouts, never one alone", () => {
    const ws = [
      w(back(1), { hour: 7, formScore: 70 }), w(back(2), { hour: 7, formScore: 80 }),
      w(back(3), { hour: 18, formScore: 90 }), w(back(4), { hour: 18, formScore: 84 }),
      w(back(5), { hour: 13, formScore: 100 }),
      w(back(6), { hour: 23, formScore: 60 }),
    ];
    expect(bestTime(TODAY, ws)).toEqual({
      available: true,
      best: "evening",
      slots: [
        { slot: "morning", workouts: 2, avgForm: 75 },
        { slot: "afternoon", workouts: 1, avgForm: 100 },
        { slot: "evening", workouts: 2, avgForm: 87 },
        { slot: "night", workouts: 1, avgForm: 60 },
      ],
    });
  });

  it("gives a tie to the time with more workouts, then to the earlier time of day", () => {
    const morning3 = [1, 2, 3].map((n) => w(back(n), { hour: 8, formScore: 80 }));
    const evening2 = [4, 5].map((n) => w(back(n), { hour: 19, formScore: 80 }));
    const night2 = [6, 7].map((n) => w(back(n), { hour: 2, formScore: 80 }));
    expect(bestTime(TODAY, [...evening2, ...morning3, ...night2])).toMatchObject({ best: "morning" });
    const afternoon2 = [8, 9].map((n) => w(back(n), { hour: 13, formScore: 10 }));
    expect(bestTime(TODAY, [...night2, ...evening2, ...afternoon2])).toMatchObject({ best: "evening" });
  });

  it("compares averages exactly, not as rounded", () => {
    // 81 against 80.6: both shown as 81, and the higher one wins over the time with more workouts.
    const ws = [
      w(back(1), { hour: 8, formScore: 81 }), w(back(2), { hour: 8, formScore: 81 }),
      ...[3, 4, 5, 6, 7].map((n, i) => w(back(n), { hour: 19, formScore: i < 3 ? 81 : 80 })),
    ];
    expect(bestTime(TODAY, ws)).toMatchObject({ best: "morning" });
  });
});

describe("the four together", () => {
  it("leaves out a workout dated after today, counts the 90 days read, and gives the same answer twice", () => {
    const ws = [...[1, 2, 3, 4, 5, 6].map((n) => w(back(n))), w(back(95)), w(addDays(TODAY, 1), { kcal: 5000 })];
    const input = { today: TODAY, workouts: ws, firstWorkoutDay: back(95), weeklyTarget: 3, limitedToDays: 90 };
    const p = predictions(input);
    expect(p.workouts).toBe(6);
    expect(p.calcVersion).toBe(1);
    expect(p.limitedToDays).toBe(90);
    if (!p.forecast.available) throw new Error("hidden");
    expect(p.forecast.days.every((d) => d.kcalHigh < 5000)).toBe(true);
    expect(predictions(input)).toEqual(p);
  });
});
