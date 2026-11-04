import { describe, expect, it } from "vitest";
import { bestTimeSchema, bodyMeasurementSchema, workoutListItemSchema, calorieForecastSchema, progressPredictionsSchema, weekGoalPredictionSchema, type BodyMeasurement, type SteadyPace } from "@app/shared";
import { average, bestIndex, columnCentres, firstFigure, guides, monotoneControls, monotonePath, rangeWords, tagWords } from "../src/screens/progress/chartRules";
import { activeDaysWords, clockWords, daySaid, daySum, dayTitle, dayWindow, dayWorkouts, level, monthCells, monthPickSaid, monthRange, monthsToPick, monthWords, nextMonth, squareSaid, windowWorkouts, yearColumns } from "../src/screens/progress/calendarRules";
import { addDays, dayKeyOf } from "../src/screens/progress/progressRules";
import { entryRows, latestWeight, slices } from "../src/screens/progress/otherRules";
import { bestTimeMini, forecastMini, plateauMini, predictionsFrom, tenths, weekGoalMini } from "../src/screens/progress/predictionWords";

const TODAY = "2026-11-04"; // a Wednesday

// The walk member's own reply from this folder's server (GET /v1/progress/predictions, 2026-11-04):
// a reply from outside this code, parsed by the app's own shape.
const REAL = progressPredictionsSchema.parse({
  calcVersion: 1,
  workouts: 8,
  forecast: {
    available: true,
    days: [
      { date: "2026-11-05", kcalPoint: 0, kcalLow: 0, kcalHigh: 0 },
      { date: "2026-11-06", kcalPoint: 0, kcalLow: 0, kcalHigh: 0 },
      { date: "2026-11-07", kcalPoint: 10, kcalLow: 0, kcalHigh: 20 },
      { date: "2026-11-08", kcalPoint: 0, kcalLow: 0, kcalHigh: 0 },
      { date: "2026-11-09", kcalPoint: 20, kcalLow: 0, kcalHigh: 40 },
      { date: "2026-11-10", kcalPoint: 10, kcalLow: 0, kcalHigh: 20 },
      { date: "2026-11-11", kcalPoint: 10, kcalLow: 0, kcalHigh: 20 },
    ],
    totalPoint: 50,
    totalLow: 0,
    totalHigh: 100,
  },
  weekGoal: { available: false, reason: "few_weeks", weeks: 2, needed: 3 },
  steady: { available: true, steady: false, recentDays: 14, kcal: { before: 21, recent: 21, changePct: 0 }, minutes: { before: 57.5, recent: 37.5, changePct: -34.8 }, form: { before: 87.5, recent: 83.5, changePct: -4.6 } },
  bestTime: { available: true, best: "evening", slots: [{ slot: "afternoon", workouts: 1, avgForm: 82 }, { slot: "evening", workouts: 7, avgForm: 86 }] },
  limitedToDays: null,
});

describe("the charts' line never shows a bar higher or lower than it was", () => {
  // Two equal weeks side by side bent a Catmull-Rom line above them in the drawing (Kd's 2nd picture).
  it.each([
    [[0, 42, 63, 63, 0]],
    [[10, 10, 10]],
    [[0, 100, 0, 100, 0]],
    [[5, 6, 40, 41, 3, 90, 0]],
  ])("over %j each piece stays between its two points", (values) => {
    const pts = values.map((v, i) => ({ x: i * 50, y: 200 - v }));
    for (const [k, seg] of monotoneControls(pts).entries()) {
      const a = pts[k]?.y ?? 0;
      const b = pts[k + 1]?.y ?? 0;
      for (const c of [seg.c1.y, seg.c2.y]) {
        expect(c).toBeGreaterThanOrEqual(Math.min(a, b) - 1e-9);
        expect(c).toBeLessThanOrEqual(Math.max(a, b) + 1e-9);
      }
    }
  });
  it("is one move and a curve for each piece", () => {
    expect(monotonePath([])).toBe("");
    expect(monotonePath([{ x: 0, y: 10 }])).toBe("M0 10");
    expect(monotonePath([{ x: 0, y: 10 }, { x: 30, y: 10 }])).toBe("M0 10 C10 10 20 10 30 10");
  });
  it("puts each point over the middle of its date's column", () => {
    const centres = columnCentres(348, 5, 8);
    [31.6, 102.8, 174, 245.2, 316.4].forEach((n, i) => {
      expect(centres[i]).toBeCloseTo(n, 5);
    });
    expect(columnCentres(100, 0, 8)).toEqual([]);
  });
});

describe("the charts' numbers", () => {
  it.each([
    [63, 60],
    [31.5, 30],
    [168, 100],
    [7, 7],
    [0, 0],
    [0.4, 0.4],
  ])("%d rounded down to its first figure is %d", (v, out) => {
    expect(firstFigure(v)).toBeCloseTo(out, 9);
  });
  it("guide lines: 0 and two even round steps, none above the top", () => {
    expect(guides(63)).toEqual([0, 30, 60]);
    expect(guides(168)).toEqual([0, 80, 160]);
    expect(guides(7)).toEqual([0, 3, 6]);
    expect(guides(1)).toEqual([0, 1]);
    expect(guides(0)).toEqual([0]);
  });
  it.each([1, 2, 5, 19, 63, 99, 100, 168, 999, 1000, 4321])("the guides under %d are evenly spaced whole numbers", (top) => {
    const g = guides(top);
    const step = g[1] ?? 0;
    expect(Number.isInteger(step)).toBe(true);
    g.forEach((v, i) => {
      expect(v).toBe(i * step);
    });
    expect(g.at(-1) ?? 0).toBeLessThanOrEqual(top);
    expect(2 * step).toBeGreaterThan(top / 4);
  });
  it("picks the highest bar, the later of two the same, none where all are 0", () => {
    expect(bestIndex([0, 42, 63, 63, 0])).toBe(3);
    expect(bestIndex([5, 1])).toBe(0);
    expect(bestIndex([0, 0])).toBeNull();
    expect(bestIndex([])).toBeNull();
  });
  it("averages every bar of the period, empty ones too", () => {
    expect(average([0, 42, 63, 63, 0])).toBeCloseTo(33.6);
    expect(average([])).toBe(0);
  });
  it.each([
    [{ from: "2026-10-21", to: "2026-10-21" }, "day", "21 Oct"],
    [{ from: "2026-10-19", to: "2026-10-25" }, "week", "19–25 Oct"],
    [{ from: "2026-10-26", to: "2026-11-01" }, "week", "26 Oct – 1 Nov"],
    [{ from: "2026-10-01", to: "2026-10-31" }, "month", "Oct 2026"],
    [{ from: "2025-11-05", to: "2025-11-30" }, "month", "5–30 Nov"],
    [{ from: "2024-03-01", to: "2024-12-31" }, "year", "2024"],
  ] as const)("%j by %s reads %s", (bar, step, words) => {
    expect(rangeWords(bar, step)).toBe(words);
  });
  it("tags the picked bar with its days and number", () => {
    expect(tagWords({ from: "2026-10-19", to: "2026-10-25" }, "week", 63)).toBe("19–25 Oct · 63");
    expect(tagWords({ from: "2026-10-19", to: "2026-10-25" }, "week", 1240)).toBe("19–25 Oct · 1,240");
  });
});

describe("Predictions, from the walk member's real reply", () => {
  it("says the next 7 days' calories and each day's letter from its own date", () => {
    const f = forecastMini(REAL.forecast);
    expect([f.value, f.unit]).toEqual(["~50", "kcal"]);
    expect(f.days.map((d) => d.letter).join("")).toBe("TFSSMTW");
    expect(f.days.map((d) => [d.low, d.point, d.high])[4]).toEqual([0, 20, 40]);
  });
  it("names the best time of day and how many of the workouts fell in it", () => {
    expect(bestTimeMini(REAL.bestTime)).toEqual({ value: "Evening", lines: ["7 of 8 workouts", "5 pm – 10 pm"], warm: false, slot: "evening" });
  });
  it("calls the biggest move, every figure to one decimal so its sum adds up: 87.5 → 83.5 is 4.6% down", () => {
    expect(plateauMini(REAL.steady)).toEqual({
      value: "Shorter workouts",
      lines: ["Minutes 57.5 → 37.5 ▼34.8%", "Calories 21 → 21", "Form 87.5 → 83.5 ▼4.6%"],
      warm: true,
      // Drawn as rows across the card, the change on the right, so each stays on one line.
      figures: [
        { words: "Minutes 57.5 → 37.5", change: "▼34.8%" },
        { words: "Calories 21 → 21", change: "" },
        { words: "Form 87.5 → 83.5", change: "▼4.6%" },
      ],
    });
  });
  it("counts the weeks the weekly goal still waits for", () => {
    expect(weekGoalMini(REAL.weekGoal)).toEqual({ value: "2 of 3 weeks", lines: ["Ready next week"], warm: false, steps: { done: 2, of: 3 } });
  });
  it("says what it is read from", () => {
    expect(predictionsFrom(REAL.workouts)).toBe("From your 8 workouts");
    expect(predictionsFrom(1)).toBe("From your 1 workout");
  });
});

describe("a figure to one decimal", () => {
  it.each([
    [87.5, "87.5"],
    [21, "21"],
    [34.8, "34.8"],
    [4.6, "4.6"],
    [0.04, "0"],
    [1234.56, "1,234.6"],
    [99.96, "100"],
  ])("%d reads %s", (v, words) => {
    expect(tenths(v)).toBe(words);
  });
  it("leaves off a change too small to show", () => {
    expect(plateauMini({ available: true, steady: true, recentDays: 14, kcal: { before: 300, recent: 300.1, changePct: 0.03 }, minutes: null, form: null }).lines).toEqual(["Calories 300 → 300.1"]);
  });
});

describe("Predictions, every other state the server sends", () => {
  it.each([
    [{ available: false, reason: "few_workouts", workouts: 3, needed: 5 }, "Not yet", ["3 of 5 workouts in the last 4 weeks"]],
    [{ available: false, reason: "too_new", workouts: 6, needed: 5 }, "Not yet", ["Ready a week after your first workout"]],
  ] as const)("forecast %j", (f, value, lines) => {
    expect(forecastMini(calorieForecastSchema.parse(f))).toMatchObject({ value, lines, days: [] });
  });
  it.each([
    [{ available: false, workouts: 2, needed: 6 }, "Not yet", ["2 of 6 workouts with a form score"]],
    [{ available: true, best: null, slots: [{ slot: "morning", workouts: 1, avgForm: 80 }] }, "Not yet", ["Ready once one time of day has 2 workouts"]],
    [{ available: true, best: "morning", slots: [{ slot: "morning", workouts: 2, avgForm: 80 }] }, "Morning", ["2 of 2 workouts", "5 am – 12 pm"]],
    [{ available: true, best: "night", slots: [{ slot: "night", workouts: 3, avgForm: 70 }, { slot: "morning", workouts: 1, avgForm: 90 }] }, "Night", ["3 of 4 workouts", "10 pm – 5 am"]],
  ] as const)("best time %j", (b, value, lines) => {
    expect(bestTimeMini(bestTimeSchema.parse(b))).toMatchObject({ value, lines });
  });
  const pace = (over: Partial<Extract<SteadyPace, { available: true }>>): SteadyPace => ({ available: true, steady: false, recentDays: 14, kcal: null, minutes: null, form: null, ...over });
  it.each([
    [{ available: false, reason: "few_workouts", recent: 2, before: 3, needed: 8, neededEachSide: 3 } as const, "Not yet", ["5 of 8 workouts in the last 6 weeks"], false],
    [{ available: false, reason: "nothing_to_compare", recent: 4, before: 5, needed: 8, neededEachSide: 3 } as const, "Not yet", ["Nothing to compare yet"], false],
    [pace({ steady: true, minutes: { before: 40, recent: 41, changePct: 2.5 } }), "Steady", ["Minutes 40 → 41 ▲2.5%"], false],
    [pace({ minutes: { before: 30, recent: 45, changePct: 50 } }), "Longer workouts", ["Minutes 30 → 45 ▲50%"], false],
    [pace({ kcal: { before: 300, recent: 200, changePct: -33.3 }, minutes: { before: 40, recent: 42, changePct: 5 } }), "Fewer calories", ["Minutes 40 → 42 ▲5%", "Calories 300 → 200 ▼33.3%"], true],
    [pace({ kcal: { before: 100, recent: 130, changePct: 30 } }), "More calories", ["Calories 100 → 130 ▲30%"], false],
    [pace({ form: { before: 70, recent: 85, changePct: 21.4 } }), "Form rising", ["Form 70 → 85 ▲21.4%"], false],
    [pace({ form: { before: 90, recent: 80, changePct: -11.1 } }), "Form slipping", ["Form 90 → 80 ▼11.1%"], true],
  ])("plateau %j", (s, value, lines, warm) => {
    const mini = plateauMini(s);
    expect(mini).toMatchObject({ value, lines, warm });
    // Its rows say the same as its lines.
    expect((mini.figures ?? []).map((f) => (f.change === "" ? f.words : `${f.words} ${f.change}`))).toEqual(mini.figures === undefined ? [] : lines);
  });
  it.each([
    [{ available: false, reason: "no_goal" } as const, "No goal", ["No weekly training goal set"], null],
    [{ available: false, reason: "few_weeks", weeks: 0, needed: 3 } as const, "0 of 3 weeks", ["Ready in 3 weeks"], { done: 0, of: 3 }],
    [{ available: true, target: 4, done: 4, daysLeft: 3, moreNeeded: 0, band: "reached" } as const, "Reached", ["4 of 4 days this week"], { done: 4, of: 4 }],
    [{ available: true, target: 4, done: 2, daysLeft: 4, moreNeeded: 2, band: "on_track" } as const, "On track", ["2 of 4 days this week"], { done: 2, of: 4 }],
    [{ available: true, target: 4, done: 1, daysLeft: 3, moreNeeded: 3, band: "doable" } as const, "Doable", ["1 of 4 days this week", "3 more days to go"], { done: 1, of: 4 }],
    [{ available: true, target: 1, done: 0, daysLeft: 1, moreNeeded: 1, band: "doable" } as const, "Doable", ["0 of 1 day this week", "1 more day to go"], { done: 0, of: 1 }],
    [{ available: true, target: 5, done: 1, daysLeft: 1, moreNeeded: 4, band: "tough" } as const, "Tough week", ["1 of 5 days this week", "One workout keeps your streak going"], { done: 1, of: 5 }],
  ])("weekly goal %j", (w, value, lines, steps) => {
    expect(weekGoalMini(weekGoalPredictionSchema.parse(w))).toMatchObject({ value, lines, steps });
  });
});

describe("the calendar's month", () => {
  const YEAR_FIRST = "2025-11-05";
  const counts = new Map([["2026-10-14", 1], ["2026-10-26", 2], ["2026-11-04", 1], ["2026-11-05", 3]]);
  it("starts on Monday with blanks, each day its own workouts, a day after today never lit", () => {
    const oct = monthCells({ y: 2026, m: 10 }, counts, TODAY, YEAR_FIRST);
    // 1 Oct 2026 is a Thursday: three blanks before it.
    expect(oct.slice(0, 4).map((c) => c?.date ?? null)).toEqual([null, null, null, 1]);
    expect(oct.filter((c) => c !== null)).toHaveLength(31);
    expect(oct.find((c) => c?.date === 26)?.workouts).toBe(2);
    const nov = monthCells({ y: 2026, m: 11 }, counts, TODAY, YEAR_FIRST);
    expect(nov.find((c) => c?.date === 4)).toMatchObject({ workouts: 1, today: true, later: false });
    expect(nov.find((c) => c?.date === 5)).toMatchObject({ workouts: 0, later: true });
    expect(activeDaysWords(nov)).toBe("1 active day");
    expect(activeDaysWords(oct)).toBe("2 active days");
  });
  it("says each day in words for a screen reader", () => {
    const oct = monthCells({ y: 2026, m: 10 }, counts, TODAY, YEAR_FIRST);
    const say = (d: number) => {
      const c = oct.find((x) => x?.date === d);
      return c === null || c === undefined ? "" : daySaid(c);
    };
    expect(say(14)).toBe("Wednesday 14 October, 1 workout");
    expect(say(26)).toBe("Monday 26 October, 2 workouts");
    expect(say(15)).toBe("Thursday 15 October, no workout");
  });
  it("says a lit square of the year as its day, not its key", () => {
    expect(squareSaid({ key: "2026-10-26", workouts: 2, outside: false }, TODAY)).toBe("Monday 26 October, 2 workouts");
    expect(squareSaid({ key: TODAY, workouts: 1, outside: false }, TODAY)).toMatch(/, today, 1 workout$/);
  });
  // The review's High 3: a free member's first month opens before the plan's first day. Those days
  // were never sent, so they are faint, cannot be opened, and say nothing of workouts; never "no workout".
  it("a day before the first day the server sent is faint and says nothing of its workouts", () => {
    const planFirst = "2026-08-07"; // today and the 89 days before it
    const aug = monthCells({ y: 2026, m: 8 }, new Map([["2026-08-06", 2], ["2026-08-07", 1]]), TODAY, planFirst);
    const day = (d: number) => aug.find((c) => c?.date === d);
    expect(day(6)).toMatchObject({ before: true, workouts: 0 });
    expect(day(7)).toMatchObject({ before: false, workouts: 1 });
    const six = day(6);
    expect(six === null || six === undefined ? "" : daySaid(six)).toBe("Thursday 6 August");
    const eight = day(8);
    expect(eight === null || eight === undefined ? "" : daySaid(eight)).toBe("Saturday 8 August, no workout");
    expect(activeDaysWords(aug)).toBe("1 active day");
  });

  // The review's High 2: the server's year once began part way into a 366th day back, and the plan's
  // 90 days into a 91st. The calendar keeps only the days it draws, so no count takes such a day in.
  it("keeps only the server's days that it draws: the window's first day to today", () => {
    const sent = [
      { date: "2025-11-04", count: 1 },
      { date: "2025-11-05", count: 2 },
      { date: "2026-08-06", count: 1 },
      { date: "2026-08-07", count: 1 },
      { date: TODAY, count: 1 },
      { date: "2026-11-05", count: 4 },
    ];
    expect([...windowWorkouts(sent, TODAY, 365).keys()]).toEqual(["2025-11-05", "2026-08-06", "2026-08-07", TODAY]);
    expect([...windowWorkouts(sent, TODAY, 90).keys()]).toEqual(["2026-08-07", TODAY]);
  });

  it("moves a month at a time across a year's end, within the server's year of days", () => {
    expect(nextMonth({ y: 2026, m: 1 }, -1)).toEqual({ y: 2025, m: 12 });
    expect(nextMonth({ y: 2025, m: 12 }, 1)).toEqual({ y: 2026, m: 1 });
    expect(monthRange(TODAY, 365)).toEqual({ first: { y: 2025, m: 11 }, last: { y: 2026, m: 11 } });
    expect(monthRange(TODAY, 90)).toEqual({ first: { y: 2026, m: 8 }, last: { y: 2026, m: 11 } });
    expect(monthWords({ y: 2026, m: 10 })).toBe("October 2026");
  });
});

describe("the calendar's year", () => {
  it("is weeks Monday to Sunday from the year's first day to this week, a day outside drawn empty", () => {
    const cols = yearColumns(TODAY, 365, new Map([["2026-10-26", 2]]));
    const first = cols[0]?.squares ?? [];
    const last = cols.at(-1)?.squares ?? [];
    // The year's first day is Thursday 5 Nov 2025: its week starts on Monday 3 Nov.
    expect(first[0]?.key).toBe("2025-11-03");
    expect(first.filter((s) => s.outside).map((s) => s.key)).toEqual(["2025-11-03", "2025-11-04"]);
    expect(last.map((s) => s.outside)).toEqual([false, false, false, true, true, true, true]);
    expect(cols.flatMap((c) => c.squares).find((s) => s.key === "2026-10-26")?.workouts).toBe(2);
    expect(cols.map((c) => c.label).filter((l) => l !== "")).toEqual(["Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov"]);
  });
  it.each([
    [0, 0],
    [1, 1],
    [2, 2],
    [3, 3],
    [7, 3],
  ])("%i workouts light a square at level %i", (n, l) => {
    expect(level(n)).toBe(l);
  });
});

describe("Exercise Categories", () => {
  it("names the families, the three with most sets, the rest as Other, a family not known by name in Other too", () => {
    const s = slices({ families: [{ family: "F1", sets: 24 }, { family: "F5", sets: 10 }, { family: "F10", sets: 4 }, { family: "F9", sets: 1 }, { family: "F99", sets: 1 }] });
    expect(s).toEqual([
      { name: "Squats", sets: 24, pct: 60 },
      { name: "Push-ups", sets: 10, pct: 25 },
      { name: "Holds", sets: 4, pct: 10 },
      { name: "Other", sets: 2, pct: 5 },
    ]);
  });
  it("the walk member's 30 days: all squats", () => {
    expect(slices({ families: [{ family: "F1", sets: 24 }] })).toEqual([{ name: "Squats", sets: 24, pct: 100 }]);
    expect(slices({ families: [] })).toEqual([]);
  });
});

describe("Body", () => {
  // The walk member's own entry, as this folder's server sends it.
  const typed = bodyMeasurementSchema.parse({ id: "76f3008b-7b75-4846-af4e-9e8278028445", measuredAt: "2026-10-28T17:04:06.302Z", weightKg: 69.85, metrics: {}, source: "self_reported", createdAt: "2026-10-28T17:04:06.302Z" });
  const logged: BodyMeasurement = { id: "86f3008b-7b75-4846-af4e-9e8278028445", measuredAt: "2026-11-01T08:00:00.000Z", weightKg: null, metrics: { waist_cm: 80, hips_cm: 95 }, source: "manual", createdAt: "2026-11-01T08:00:00.000Z" };
  it("shows the newest entry with a weight, in the person's units", () => {
    expect(latestWeight([logged, typed])?.id).toBe(typed.id);
    expect(latestWeight([logged])).toBeNull();
    expect(entryRows([logged, typed], "metric").map((r) => [r.how, r.weight, r.more])).toEqual([
      ["Logged", "–", "2 measurements"],
      ["Typed by you", "69.9 kg", null],
    ]);
    expect(entryRows([typed], "imperial")[0]?.weight).toBe("154 lb");
  });
});

// The day box (Kd's click-through, 35c-i): the worst thing it could do is show a workout under a day it
// was not done on. Its window is the day as the phone's own clock keys it, the same keys the calendar's
// cells and today use: its first instant and its last are that day, the instant it ends is the next.
describe("a day tapped on the calendar", () => {
  // With the days the clocks change in Europe (29 Mar, 25 Oct) and America (8 Mar, 1 Nov).
  const keys = ["2026-10-26", "2026-01-01", "2025-12-31", "2026-03-29", "2026-10-25", "2026-03-08", "2026-11-01", "2024-02-29", TODAY];
  it.each(keys)("reads %s from its first instant to the first instant of the next day, and no further", (key) => {
    const { from, to } = dayWindow(key);
    expect(dayKeyOf(new Date(from))).toBe(key);
    expect(dayKeyOf(new Date(Date.parse(from) - 1))).toBe(addDays(key, -1));
    expect(dayKeyOf(new Date(Date.parse(to) - 1))).toBe(key);
    expect(dayKeyOf(new Date(to))).toBe(addDays(key, 1));
    expect(from).toMatch(/Z$/);
    expect(to).toMatch(/Z$/);
  });

  it("names the day, with its year only when it is not this year's", () => {
    expect(dayTitle("2026-10-26", TODAY)).toBe("Monday 26 October");
    expect(dayTitle("2025-12-31", TODAY)).toBe("Wednesday 31 December 2025");
  });

  it.each([
    [new Date(2026, 9, 26, 18, 30), "6:30 pm"],
    [new Date(2026, 9, 27, 13, 55), "1:55 pm"],
    [new Date(2026, 9, 27, 0, 5), "12:05 am"],
    [new Date(2026, 9, 27, 12, 0), "12:00 pm"],
    [new Date(2026, 9, 27, 9, 7), "9:07 am"],
  ])("tells the time %s as %s", (at, words) => {
    expect(clockWords(at)).toBe(words);
  });

  // The walk member's own two workouts of 26 October (aihg_b, 2026-11-04), as the server lists them,
  // the newest first.
  const item = (o: Record<string, unknown>) =>
    workoutListItemSchema.parse({ platform: "android", setsCount: 3, totalReps: 30, kcalCalcVersion: 1, qualityFlags: [], ...o });
  const late = item({ id: "8d1b5b8e-1c3e-4f53-9d0e-8a9c2b1f0a11", startedAt: new Date(2026, 9, 26, 18, 31).toISOString(), durationMs: 35 * 60_000, avgFormScore: 83, kcalPoint: 21 });
  const early = item({ id: "2f6a9c4d-7e1b-4a8f-b3c2-5d6e7f8a9b0c", startedAt: new Date(2026, 9, 26, 18, 30).toISOString(), durationMs: 40 * 60_000, avgFormScore: 84, kcalPoint: 21 });

  it("lists the day's workouts earliest first, each with its time, minutes, sets, reps, form and calories", () => {
    expect(dayWorkouts([late, early]).map((w) => [w.when, w.what, w.kcal])).toEqual([
      ["6:30 pm · 40 min", "3 sets · 30 reps · form 84", "21"],
      ["6:31 pm · 35 min", "3 sets · 30 reps · form 83", "21"],
    ]);
    expect(dayWorkouts([early])[0]?.said).toBe("6:30 pm · 40 min, 3 sets · 30 reps · form 84, 21 kcal");
    expect(daySum([late, early])).toEqual({ workouts: "2", trained: "1h 15m", kcal: "42" });
  });

  it("leaves out what a workout does not have, and never adds up a number nobody has", () => {
    const bare = item({ id: "5a4b3c2d-1e0f-4a9b-8c7d-6e5f4a3b2c1d", startedAt: new Date(2026, 9, 26, 7, 0).toISOString(), setsCount: 1, totalReps: 1, durationMs: null, avgFormScore: null, kcalPoint: null });
    expect(dayWorkouts([bare]).map((w) => [w.when, w.what, w.kcal])).toEqual([["7:00 am", "1 set · 1 rep", null]]);
    expect(daySum([bare])).toEqual({ workouts: "1", trained: null, kcal: null });
    expect(daySum([bare, early])).toEqual({ workouts: "2", trained: "40 min", kcal: "21" });
  });
});

describe("the box that picks a month", () => {
  const counts = new Map([["2026-10-14", 1], ["2026-10-26", 2], ["2026-10-27", 1], ["2025-11-20", 0], ["2025-12-02", 1]]);
  it("holds every month of the server's year, the newest year first, this year's later months shut", () => {
    const years = monthsToPick({ y: 2025, m: 11 }, { y: 2026, m: 11 }, counts);
    expect(years.map((y) => y.year)).toEqual([2026, 2025]);
    expect(years[0]?.months.map((p) => p.label)).toEqual(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]);
    expect(years[0]?.months.filter((p) => !p.open).map((p) => p.label)).toEqual(["Dec"]);
    expect(years[1]?.months.map((p) => p.label)).toEqual(["Nov", "Dec"]);
    expect(years[1]?.months.every((p) => p.open)).toBe(true);
  });
  it("counts each month's days with a workout, not its workouts", () => {
    const years = monthsToPick({ y: 2025, m: 11 }, { y: 2026, m: 11 }, counts);
    const oct = years[0]?.months.find((p) => p.label === "Oct");
    expect(oct?.active).toBe(3);
    expect(years[1]?.months.map((p) => p.active)).toEqual([0, 1]);
    expect(oct === undefined ? "" : monthPickSaid(oct)).toBe("October 2026, 3 active days");
  });
  it("is one year where the server's days are all this year's", () => {
    expect(monthsToPick({ y: 2026, m: 8 }, { y: 2026, m: 11 }, counts).map((y) => y.months.filter((p) => p.open).map((p) => p.label))).toEqual([["Aug", "Sep", "Oct", "Nov"]]);
  });
});
