import { describe, expect, it } from "vitest";
import type { PersonalRecords, ProgressPeriod, ProgressTrend } from "@app/shared";
import {
  PERIODS,
  addDays,
  buckets,
  caloriesSaid,
  consistencyPct,
  consistencyWords,
  cutWords,
  dayKeyOf,
  noneWords,
  periodWindow,
  recordRows,
  recordsFrom,
  stepFor,
  stepTitle,
  streakWords,
  totals,
  type Window,
} from "../src/screens/progress/progressRules";

const TODAY = "2026-11-04"; // a Wednesday
const point = (date: string, workouts = 1, kcal = 300, durationMs = workouts * 30 * 60_000) => ({ date, workouts, kcal, durationMs });
const trend = (points: ProgressTrend["points"], limitedToDays: number | null = null): ProgressTrend => ({ points, runDays: [], limitedToDays });
const win = (period: ProgressPeriod, t: ProgressTrend, today = TODAY): Window => {
  const w = periodWindow(period, today, t);
  if (w === null) throw new Error("no window");
  return w;
};

// The worst thing (the plan's line): a number under "7 Days" that counts a different stretch of days.
// The server's 7d read starts exactly 7×24 hours ago, so its first day is an eighth calendar day, part of it.
describe("a period counts exactly its own calendar days, ending today", () => {
  it("7 Days is today and the 6 days before: the eighth day the server sends is not counted", () => {
    const t = trend([point("2026-10-28", 2, 999), point("2026-10-29"), point("2026-11-01"), point(TODAY, 1, 250)]);
    const w = win("7d", t);
    expect([w.from, w.to, w.days]).toEqual(["2026-10-29", TODAY, 7]);
    expect(totals(t.points, w)).toEqual({ workouts: 3, kcal: 850, durationMs: 90 * 60_000, daysTrained: 3 });
    expect(consistencyWords(totals(t.points, w), w)).toBe("3 of 7 days");
  });

  it.each([
    ["30d", 30, "2026-10-06"],
    ["90d", 90, "2026-08-07"],
    ["1y", 365, "2025-11-05"],
  ] as const)("%s is %i days from %s", (period, days, from) => {
    const before = addDays(from, -1);
    const t = trend([point(before, 1, 500), point(from, 1, 100), point(TODAY, 1, 100)]);
    const w = win(period, t);
    expect([w.from, w.days]).toEqual([from, days]);
    expect(totals(t.points, w)).toEqual({ workouts: 2, kcal: 200, durationMs: 60 * 60_000, daysTrained: 2 });
  });

  it("a day after the phone's today (a server a zone ahead) is not counted", () => {
    const t = trend([point(TODAY), point("2026-11-05", 3, 900)]);
    expect(totals(t.points, win("7d", t))).toEqual({ workouts: 1, kcal: 300, durationMs: 30 * 60_000, daysTrained: 1 });
  });

  it("every bar's days lie inside the window, and the bars add up to the totals", () => {
    const points = Array.from({ length: 400 }, (_, i) => point(addDays(TODAY, -i), (i % 3) + 1, 100 + i));
    for (const p of PERIODS) {
      const t = trend(points);
      const w = win(p.key, t);
      const bars = buckets(t.points, w);
      expect(bars[0]?.from).toBe(w.from);
      expect(bars.at(-1)?.to).toBe(w.to);
      for (const b of bars) expect(b.from <= b.to && b.from >= w.from && b.to <= w.to).toBe(true);
      for (let i = 1; i < bars.length; i += 1) expect(bars[i]?.from).toBe(addDays(bars[i - 1]?.to ?? "", 1));
      const sum = totals(t.points, w);
      expect([bars.reduce((n, b) => n + b.workouts, 0), bars.reduce((n, b) => n + b.kcal, 0)]).toEqual([sum.workouts, sum.kcal]);
    }
  });
});

describe("All Time", () => {
  it("starts at the first workout", () => {
    const t = trend([point("2026-10-20"), point(TODAY)]);
    expect([win("all", t).from, win("all", t).days]).toEqual(["2026-10-20", 16]);
  });
  it("has no window with no workout", () => {
    expect(periodWindow("all", TODAY, trend([]))).toBeNull();
  });
  it("starts no earlier than the plan's last N days", () => {
    const t = trend([point("2026-07-01"), point(TODAY)], 90);
    expect([win("all", t).from, win("all", t).days]).toEqual(["2026-08-07", 90]);
  });
});

describe("a plan's history limit", () => {
  it.each([
    ["7d", 90, null],
    ["30d", 90, null],
    ["90d", 90, null],
    ["1y", 90, 90],
    ["all", 90, 90],
    ["30d", 7, 7],
    ["1y", null, null],
    ["all", null, null],
  ] as const)("%s with a limit of %s days cuts to %s", (period, limit, cut) => {
    const t = trend([point(TODAY)], limit);
    const w = win(period, t);
    expect(w.cut).toBe(cut);
    // All Time starts at the first workout, here today; the others are the plan's whole N days.
    if (cut !== null) expect(w.days).toBe(period === "all" ? 1 : cut);
  });
  it("is said only when it cuts", () => {
    expect(cutWords(win("1y", trend([point(TODAY)], 90)))).toBe("Your plan shows your last 90 days. Any older workouts are still saved.");
    expect(cutWords(win("30d", trend([point(TODAY)], 90)))).toBeNull();
  });
});

describe("the step of the bars", () => {
  it.each([
    [1, "day"],
    [7, "day"],
    [14, "day"],
    [15, "week"],
    [30, "week"],
    [90, "week"],
    [91, "month"],
    [365, "month"],
    [400, "month"],
    [401, "year"],
  ] as const)("%i days go by %s", (days, step) => {
    expect(stepFor(days)).toBe(step);
  });
  it("names the box by its step", () => {
    expect(["day", "week", "month", "year"].map((s) => stepTitle(s as "day"))).toEqual([
      "Workouts Per Day",
      "Workouts Per Week",
      "Workouts Per Month",
      "Workouts Per Year",
    ]);
  });

  it("7 Days: one bar a day, named by its weekday, today last", () => {
    const t = trend([point(TODAY)]);
    const bars = buckets(t.points, win("7d", t));
    expect(bars.map((b) => b.label)).toEqual(["Thu", "Fri", "Sat", "Sun", "Mon", "Tue", "Wed"]);
    expect(bars.map((b) => b.workouts)).toEqual([0, 0, 0, 0, 0, 0, 1]);
    expect(bars.at(-1)?.said).toBe("Wednesday 4 Nov: 1 workout, 300 kcal");
  });

  it("30 Days: weeks from Monday, the first starting on the window's first day and named by it", () => {
    const t = trend([point("2026-10-06"), point("2026-10-12"), point("2026-10-13", 2, 400)]);
    const bars = buckets(t.points, win("30d", t));
    expect(bars.map((b) => [b.from, b.to, b.label])).toEqual([
      ["2026-10-06", "2026-10-11", "6 Oct"],
      ["2026-10-12", "2026-10-18", "12 Oct"],
      ["2026-10-19", "2026-10-25", "19 Oct"],
      ["2026-10-26", "2026-11-01", "26 Oct"],
      ["2026-11-02", TODAY, "2 Nov"],
    ]);
    expect(bars.map((b) => b.workouts)).toEqual([1, 3, 0, 0, 0]);
    expect(bars[0]?.said).toBe("6 Oct to 11 Oct: 1 workout, 300 kcal");
    expect(bars.at(-1)?.said).toBe("2 Nov to 4 Nov: no workouts");
  });

  it("90 Days: more than six weeks are named by the month where one begins", () => {
    const t = trend([point(TODAY)]);
    const labels = buckets(t.points, win("90d", t)).map((b) => b.label);
    expect(labels[0]).toBe("Aug");
    expect(labels.filter((l) => l !== "")).toEqual(["Aug", "Sep", "Oct", "Nov"]);
  });

  it("1 Year: thirteen months by their first letter, the first and last only part of a month", () => {
    const t = trend([point("2025-11-05", 1, 100), point("2025-11-30", 1, 100), point(TODAY, 1, 100)]);
    const bars = buckets(t.points, win("1y", t));
    expect(bars.map((b) => b.label).join("")).toBe("NDJFMAMJJASON");
    expect(bars[0]?.said).toBe("5 Nov 2025 to 30 Nov 2025: 2 workouts, 200 kcal");
    expect(bars.at(-1)?.said).toBe("1 Nov 2026 to 4 Nov 2026: 1 workout, 100 kcal");
  });

  it("All Time over more than 400 days goes by year", () => {
    const t = trend([point("2024-03-01"), point(TODAY)]);
    const bars = buckets(t.points, win("all", t));
    expect(bars.map((b) => [b.label, b.from, b.to])).toEqual([
      ["2024", "2024-03-01", "2024-12-31"],
      ["2025", "2025-01-01", "2025-12-31"],
      ["2026", "2026-01-01", TODAY],
    ]);
  });
});

describe("the words", () => {
  it.each([
    [0, 7, "0 of 7 days"],
    [1, 1, "1 of 1 day"],
    [1, 30, "1 of 30 days"],
    [12, 30, "12 of 30 days"],
    [365, 365, "365 of 365 days"],
  ])("%i days trained of %i reads %s", (daysTrained, days, words) => {
    const w: Window = { from: "2026-01-01", to: "2026-01-01", days, cut: null };
    expect(consistencyWords({ workouts: daysTrained, kcal: 0, durationMs: 0, daysTrained }, w)).toBe(words);
  });

  it.each([
    ["7d", "No workouts in the last 7 days"],
    ["30d", "No workouts in the last 30 days"],
    ["90d", "No workouts in the last 90 days"],
    ["1y", "No workouts in the last year"],
  ] as const)("%s with no workout reads %s", (period, words) => {
    const t = trend([point(addDays(TODAY, -400))]);
    const w = win(period, t);
    expect(totals(t.points, w).workouts).toBe(0);
    expect(noneWords(w)).toBe(words);
  });

  it.each([
    [0, 7, 0],
    [7, 30, 23],
    [1, 3, 33],
    [2, 3, 67],
    [30, 30, 100],
  ])("%i of %i days is %i%%", (daysTrained, days, pct) => {
    const w: Window = { from: "2026-01-01", to: "2026-01-01", days, cut: null };
    expect(consistencyPct({ workouts: daysTrained, kcal: 0, durationMs: 0, daysTrained }, w)).toBe(pct);
  });

  it.each([
    [0, "0 days"],
    [1, "1 day"],
    [12, "12 days"],
  ])("a streak of %i reads %s", (days, words) => {
    expect(streakWords(days)).toBe(words);
  });

  it("the calories box says each bar's number", () => {
    const t = trend([point(TODAY, 1, 1240)]);
    const bars = buckets(t.points, win("7d", t));
    expect(caloriesSaid(bars, 1240)).toBe("Calories burned, 1,240 kcal: Thursday 29 Oct, 0; Friday 30 Oct, 0; Saturday 31 Oct, 0; Sunday 1 Nov, 0; Monday 2 Nov, 0; Tuesday 3 Nov, 0; Wednesday 4 Nov, 1,240");
  });
});

describe("personal records", () => {
  const records = (over: Partial<PersonalRecords> = {}): PersonalRecords => ({
    maxKcalWorkout: { workoutId: "0d1e2f3a-4b5c-4d6e-9f80-910213243546", value: 410 },
    longestWorkout: { workoutId: "0d1e2f3a-4b5c-4d6e-9f80-910213243546", value: 52 * 60_000 },
    bestAvgForm: { workoutId: "0d1e2f3a-4b5c-4d6e-9f80-910213243546", value: 93.6 },
    totalWorkouts: 4,
    longestStreak: 3,
    limitedToDays: null,
    ...over,
  });
  it("reads as drawn", () => {
    expect(recordRows(records()).map((r) => [r.label, r.value])).toEqual([
      ["Longest workout", "52 min"],
      ["Most calories", "410 kcal"],
      ["Best form", "94"],
      ["Total workouts", "4"],
    ]);
  });
  it("an hour and more, and what has no record yet", () => {
    const rows = recordRows(records({ longestWorkout: { workoutId: "0d1e2f3a-4b5c-4d6e-9f80-910213243546", value: 65 * 60_000 }, bestAvgForm: null, maxKcalWorkout: null }));
    expect(rows.map((r) => [r.value, r.held])).toEqual([
      ["1h 5m", true],
      ["None yet", false],
      ["No score yet", false],
      ["4", true],
    ]);
  });
  // Records take no period: the box says what they are from, so nobody reads them as the chip's.
  it("say what they are from, whatever the chip", () => {
    expect(recordsFrom(records())).toBe("From all your workouts");
    expect(recordsFrom(records({ limitedToDays: 90 }))).toBe("From your last 90 days");
  });
});

describe("the phone's own day", () => {
  it("is the calendar day where the phone is", () => {
    expect(dayKeyOf(new Date(2026, 10, 4, 23, 59))).toBe("2026-11-04");
    expect(dayKeyOf(new Date(2026, 0, 1, 0, 0))).toBe("2026-01-01");
  });
});
