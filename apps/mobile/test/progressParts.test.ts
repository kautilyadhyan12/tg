import { describe, expect, it } from "vitest";
import { bestTimeSchema, bodyMeasurementSchema, calorieForecastSchema, progressPredictionsSchema, weekGoalPredictionSchema, type BodyMeasurement, type SteadyPace } from "@app/shared";
import { average, bestIndex, columnCentres, firstFigure, guides, monotoneControls, monotonePath, rangeWords, tagWords } from "../src/screens/progress/chartRules";
import { activeDaysWords, daySaid, level, monthCells, monthRange, monthWords, nextMonth, squareSaid, yearColumns } from "../src/screens/progress/calendarRules";
import { entryRows, latestWeight, slices } from "../src/screens/progress/otherRules";
import { bestTimeMini, forecastMini, plateauMini, predictionsFrom, weekGoalMini } from "../src/screens/progress/predictionWords";

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
  steady: { available: true, steady: false, recentDays: 14, kcal: { before: 21, recent: 21, changePct: 0 }, minutes: { before: 58, recent: 38, changePct: -34.8 }, form: { before: 88, recent: 84, changePct: -4.6 } },
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
  it("calls the biggest move: workouts 35% shorter", () => {
    expect(plateauMini(REAL.steady)).toEqual({ value: "Shorter workouts", lines: ["Minutes 58 → 38 ▼35%", "Calories 21 → 21", "Form 88 → 84 ▼5%"], warm: true });
  });
  it("counts the weeks the weekly goal still waits for", () => {
    expect(weekGoalMini(REAL.weekGoal)).toEqual({ value: "2 of 3 weeks", lines: ["Ready next week"], warm: false, steps: { done: 2, of: 3 } });
  });
  it("says what it is read from", () => {
    expect(predictionsFrom(REAL.workouts)).toBe("From your 8 workouts");
    expect(predictionsFrom(1)).toBe("From your 1 workout");
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
    [pace({ steady: true, minutes: { before: 40, recent: 41, changePct: 2.5 } }), "Steady", ["Minutes 40 → 41 ▲3%"], false],
    [pace({ minutes: { before: 30, recent: 45, changePct: 50 } }), "Longer workouts", ["Minutes 30 → 45 ▲50%"], false],
    [pace({ kcal: { before: 300, recent: 200, changePct: -33.3 }, minutes: { before: 40, recent: 42, changePct: 5 } }), "Fewer calories", ["Minutes 40 → 42 ▲5%", "Calories 300 → 200 ▼33%"], true],
    [pace({ kcal: { before: 100, recent: 130, changePct: 30 } }), "More calories", ["Calories 100 → 130 ▲30%"], false],
    [pace({ form: { before: 70, recent: 85, changePct: 21.4 } }), "Form rising", ["Form 70 → 85 ▲21%"], false],
    [pace({ form: { before: 90, recent: 80, changePct: -11.1 } }), "Form slipping", ["Form 90 → 80 ▼11%"], true],
  ])("plateau %j", (s, value, lines, warm) => {
    expect(plateauMini(s)).toEqual({ value, lines, warm });
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
  const counts = new Map([["2026-10-14", 1], ["2026-10-26", 2], ["2026-11-04", 1], ["2026-11-05", 3]]);
  it("starts on Monday with blanks, each day its own workouts, a day after today never lit", () => {
    const oct = monthCells({ y: 2026, m: 10 }, counts, TODAY);
    // 1 Oct 2026 is a Thursday: three blanks before it.
    expect(oct.slice(0, 4).map((c) => c?.date ?? null)).toEqual([null, null, null, 1]);
    expect(oct.filter((c) => c !== null)).toHaveLength(31);
    expect(oct.find((c) => c?.date === 26)?.workouts).toBe(2);
    const nov = monthCells({ y: 2026, m: 11 }, counts, TODAY);
    expect(nov.find((c) => c?.date === 4)).toMatchObject({ workouts: 1, today: true, later: false });
    expect(nov.find((c) => c?.date === 5)).toMatchObject({ workouts: 0, later: true });
    expect(activeDaysWords(nov)).toBe("1 active day");
    expect(activeDaysWords(oct)).toBe("2 active days");
  });
  it("says each day in words for a screen reader", () => {
    const oct = monthCells({ y: 2026, m: 10 }, counts, TODAY);
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
