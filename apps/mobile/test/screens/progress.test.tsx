import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { App } from "../../src/App";
import type { Ask, AskInit } from "../../src/session/calls";
import { HEATMAP_READ, MEASUREMENTS_READ, PREDICTIONS_READ, RECORDS_READ } from "../../src/screens/progress/ProgressPage";
import { dayKey, fakeServer, kept, memoryStore, refusal, tokens, type Reply } from "../kit";

const extra = { copyName: "Feature 2", apiUrl: "http://localhost:3000" };
const WORKOUT = "0d1e2f3a-4b5c-4d6e-9f80-910213243546";
const RECORDS = {
  maxKcalWorkout: { workoutId: WORKOUT, value: 410, day: dayKey(9) },
  longestWorkout: { workoutId: WORKOUT, value: 52 * 60_000, day: dayKey(3) },
  bestAvgForm: { workoutId: WORKOUT, value: 94, day: dayKey(3) },
  totalWorkouts: 9,
  longestStreak: 3,
  limitedToDays: null,
};
// The walk member's own predictions from this folder's server (2026-11-04), its dates moved to today.
const PREDICTIONS = {
  calcVersion: 1,
  workouts: 8,
  forecast: { available: true, days: [1, 2, 3, 4, 5, 6, 7].map((n, i) => ({ date: dayKey(-n), kcalPoint: [0, 0, 10, 0, 20, 10, 10][i] ?? 0, kcalLow: 0, kcalHigh: [0, 0, 20, 0, 40, 20, 20][i] ?? 0 })), totalPoint: 50, totalLow: 0, totalHigh: 100 },
  weekGoal: { available: false, reason: "few_weeks", weeks: 2, needed: 3 },
  steady: { available: true, steady: false, recentDays: 14, kcal: { before: 21, recent: 21, changePct: 0 }, minutes: { before: 57.5, recent: 37.5, changePct: -34.8 }, form: { before: 87.5, recent: 83.5, changePct: -4.6 } },
  bestTime: { available: true, best: "evening", slots: [{ slot: "afternoon", workouts: 1, avgForm: 82 }, { slot: "evening", workouts: 7, avgForm: 86 }] },
  limitedToDays: null,
};
const day = (back: number, workouts: number, kcal: number) => ({ date: dayKey(back), workouts, kcal, durationMs: workouts * 30 * 60_000 });
const trend = (points: ReturnType<typeof day>[], limitedToDays: number | null = null) => ({ points, runDays: [], limitedToDays });
const FAMILIES = { families: [{ family: "F1", sets: 24 }], limitedToDays: null };
const HEATMAP = { days: [{ date: dayKey(0), count: 1, kcal: 21 }, { date: dayKey(1), count: 2, kcal: 42 }], limitedToDays: null };
const MEASUREMENTS = { items: [{ id: "76f3008b-7b75-4846-af4e-9e8278028445", measuredAt: new Date().toISOString(), weightKg: 69.85, metrics: {}, source: "self_reported", createdAt: new Date().toISOString() }], nextCursor: null };

type Answer = Reply | Promise<Reply>;
const ok = (body: unknown) => (): Reply => ({ status: 200, body });

/** The server: the trend and the families answered by their period, a day's workouts by its window
 *  (the kit's fake reads only the path). */
function progressServer(byPeriod: Record<string, () => Answer>, more: Record<string, () => Answer> = {}, byDay: (from: string, to: string) => Answer = () => ({ status: 200, body: { items: [], nextCursor: null, limitedToDays: null, hasAnyWorkouts: false } })) {
  const server = fakeServer({
    "/v1/auth/refresh": () => ({ status: 200, body: { tokens: tokens(2) } }),
    [PREDICTIONS_READ]: ok(PREDICTIONS),
    [RECORDS_READ]: ok(RECORDS),
    [HEATMAP_READ]: ok(HEATMAP),
    [MEASUREMENTS_READ.split("?")[0] ?? ""]: ok(MEASUREMENTS),
    "/v1/progress/distribution": ok(FAMILIES),
    ...more,
  });
  const periods: string[] = [];
  const days: { from: string; to: string }[] = [];
  const ask: Ask = async (url: string, init: AskInit) => {
    const u = new URL(url);
    if (u.pathname === "/v1/workouts") {
      const from = u.searchParams.get("from") ?? "";
      const to = u.searchParams.get("to") ?? "";
      // The Dashboard's recent workouts read the list too, with no day.
      if (from !== "") days.push({ from, to });
      const reply = await byDay(from, to);
      return { ok: reply.status < 300, status: reply.status, json: () => Promise.resolve(reply.body) };
    }
    if (u.pathname !== "/v1/progress/trend") return server.ask(url, init);
    const period = u.searchParams.get("period") ?? "";
    periods.push(period);
    const route = byPeriod[period];
    const reply = route === undefined ? { status: 200, body: trend([]) } : await route();
    return { ok: reply.status < 300, status: reply.status, json: () => Promise.resolve(reply.body) };
  };
  return { ask, periods, days, asked: server.asked };
}

/** A workout of the day `back` days ago, at `hour` on the phone's clock, as the server lists it. */
const listed = (id: string, back: number, hour: number, minutes: number, form: number) => {
  const at = new Date();
  at.setDate(at.getDate() - back);
  at.setHours(hour, 30, 0, 0);
  return { id, startedAt: at.toISOString(), platform: "android", setsCount: 3, totalReps: 30, avgFormScore: form, durationMs: minutes * 60_000, kcalPoint: 21, kcalCalcVersion: 1, qualityFlags: [] };
};
const pickPeriod = async (now: string, to: string) => {
  await fireEvent.press(screen.getByRole("button", { name: `Period: ${now}. Change` }));
  await fireEvent.press(await screen.findByRole("button", { name: to }));
};

async function openProgress(ask: Ask) {
  await render(<App extra={extra} store={memoryStore(kept(1))} ask={ask} />);
  await fireEvent.press(await screen.findByRole("tab", { name: "Me" }));
  await fireEvent.press(await screen.findByRole("button", { name: "Progress" }));
}
const openTab = async (name: string) => {
  await fireEvent.press(await screen.findByRole("tab", { name }));
};

describe("Me → Progress", () => {
  it("opens on Overview: the four tabs, the Predictions and the records with their days", async () => {
    const server = progressServer({});
    await openProgress(server.ask);
    for (const name of ["Overview", "Trends", "Calendar", "Body"]) expect(await screen.findByRole("tab", { name })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Overview" }).props.accessibilityState).toEqual({ selected: true });
    expect(await screen.findByText("Predictions")).toBeTruthy();
    expect(screen.queryByText(/AI/)).toBeNull();
    expect(screen.getByText("From your 8 workouts")).toBeTruthy();
    expect(screen.getByLabelText("Best time, Evening, 7 of 8 workouts, 5 pm – 10 pm")).toBeTruthy();
    expect(screen.getByLabelText("Plateau detector, Shorter workouts, Minutes 57.5 → 37.5 ▼34.8%, Calories 21 → 21, Form 87.5 → 83.5 ▼4.6%")).toBeTruthy();
    expect(screen.getByLabelText("Weekly goal, 2 of 3 weeks, Ready next week")).toBeTruthy();
    expect(await screen.findByText("Personal Records")).toBeTruthy();
    expect(screen.getByText("From all your workouts")).toBeTruthy();
    expect(screen.getByLabelText(/^Longest workout, 52 min, \d+ \w{3}/)).toBeTruthy();
    expect(screen.getByLabelText("Total workouts, 9")).toBeTruthy();
    expect(screen.getByLabelText("Longest streak, 3 days")).toBeTruthy();
  });

  // The worst thing: a number under one chip counted from another stretch of days. The 30 days' reply
  // comes late, after 7 Days is pressed; it must never be drawn under 7 Days, and the eighth day back,
  // the server's part day, is in no box.
  it("Trends draws each period's own numbers under its chip, and drops a late answer for the chip left", async () => {
    let late: (r: Reply) => void = () => undefined;
    const server = progressServer({
      "30d": () => new Promise<Reply>((resolve) => { late = resolve; }),
      "7d": ok(trend([day(0, 1, 250), day(3, 1, 300), day(7, 4, 999)])),
    });
    await openProgress(server.ask);
    await openTab("Trends");
    await waitFor(() => { expect(server.periods).toContain("30d"); });
    await pickPeriod("Last 30 days", "Last 7 days");
    expect(await screen.findByLabelText(/^Calories burned, 550 kcal: /)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Period: Last 7 days. Change" })).toBeTruthy();
    expect(screen.getByLabelText("Consistency: 2 of 7 days with a workout, 29 percent")).toBeTruthy();
    expect(screen.getByText("Workouts Per Day")).toBeTruthy();
    expect(screen.getByText("· 1h")).toBeTruthy();
    await act(async () => { late({ status: 200, body: trend([day(0, 5, 5000)]) }); await Promise.resolve(); });
    expect(screen.queryByLabelText(/^Calories burned, 5,000 kcal/)).toBeNull();
    expect(screen.getByLabelText(/^Calories burned, 550 kcal: /)).toBeTruthy();
  });

  it("Trends on 30 Days: the calories, the weeks, consistency, the families by name", async () => {
    const server = progressServer({ "30d": ok(trend([day(0, 1, 300), day(1, 2, 500), day(20, 1, 120)])) });
    await openProgress(server.ask);
    await openTab("Trends");
    expect(await screen.findByLabelText(/^Calories burned, 920 kcal: /)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Period: Last 30 days. Change" })).toBeTruthy();
    expect(screen.getByText("Workouts Per Week")).toBeTruthy();
    expect(screen.getByLabelText("Consistency: 3 of 30 days with a workout, 10 percent")).toBeTruthy();
    expect(await screen.findByLabelText("Squats, 100 percent, 24 sets")).toBeTruthy();
    expect(screen.queryByText("F1")).toBeNull();
  });

  it("Trends says a plan's limit only where it cuts the period", async () => {
    const server = progressServer({ "30d": ok(trend([day(0, 1, 300)], 90)), "1y": ok(trend([day(0, 1, 300)], 90)) });
    await openProgress(server.ask);
    await openTab("Trends");
    expect(await screen.findByLabelText("Consistency: 1 of 30 days with a workout, 3 percent")).toBeTruthy();
    expect(screen.queryByText(/Your plan shows/)).toBeNull();
    await pickPeriod("Last 30 days", "Last year");
    expect(await screen.findByText("Your plan shows your last 90 days. Any older workouts are still saved.")).toBeTruthy();
    expect(screen.getByLabelText("Consistency: 1 of 90 days with a workout, 1 percent")).toBeTruthy();
  });

  it("Trends on a period with no workout says so in place of the charts", async () => {
    const server = progressServer({ "30d": ok(trend([day(40, 1, 300)])) });
    await openProgress(server.ask);
    await openTab("Trends");
    expect(await screen.findByText("No workouts in the last 30 days")).toBeTruthy();
    expect(screen.queryByText("Calories Burned")).toBeNull();
    expect(screen.getByLabelText("Consistency: 0 of 30 days with a workout, 0 percent")).toBeTruthy();
  });

  it("Calendar lights today and yesterday with their workouts, and turns to the year", async () => {
    const server = progressServer({});
    await openProgress(server.ask);
    await openTab("Calendar");
    expect(await screen.findByLabelText(/, today, 1 workout$/)).toBeTruthy();
    // Yesterday is in this month unless today is the 1st.
    if (new Date().getDate() > 1) expect(screen.getByLabelText(/ \d+ \w+, 2 workouts$/)).toBeTruthy();
    await fireEvent.press(screen.getByRole("radio", { name: "Year" }));
    expect(await screen.findByText("Last 365 days")).toBeTruthy();
    expect(screen.getByText("2 active days")).toBeTruthy();
  });

  // The worst thing the day box could do: show a workout under a day it was not done on. Each day
  // tapped reads its own window, and the answer for the day tapped first, coming late, is never drawn
  // under the day tapped after it.
  it("Calendar: a day tapped reads that day's own workouts, and drops a late answer for the day left", async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const keyOf = (d: Date) => `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    let late: (r: Reply) => void = () => undefined;
    const server = progressServer({}, {}, (from) => {
      if (new Date(from).getDate() === yesterday.getDate()) return new Promise<Reply>((resolve) => { late = resolve; });
      return { status: 200, body: { items: [listed("8d1b5b8e-1c3e-4f53-9d0e-8a9c2b1f0a11", 0, 7, 25, 91)], nextCursor: null, limitedToDays: null, hasAnyWorkouts: true } };
    });
    await openProgress(server.ask);
    await openTab("Calendar");
    // Yesterday is on this month's page unless today is the 1st; the year's squares hold it either way.
    if (new Date().getDate() === 1) await fireEvent.press(screen.getByRole("radio", { name: "Year" }));
    await fireEvent.press(await screen.findByRole("button", { name: /, 2 workouts$/ }));
    await waitFor(() => { expect(server.days).toHaveLength(1); });
    const asked = server.days[0];
    expect(asked === undefined ? "" : keyOf(new Date(asked.from))).toBe(keyOf(yesterday));
    expect(asked === undefined ? 0 : Date.parse(asked.to) - Date.parse(asked.from)).toBeGreaterThanOrEqual(23 * 3_600_000);
    await fireEvent.press(within(screen.getByTestId("sheet")).getByRole("button", { name: "Close" }));
    await fireEvent.press(screen.getByRole("button", { name: /, today, 1 workout$/ }));
    expect(await screen.findByLabelText("7:30 am · 25 min, 3 sets · 30 reps · form 91, 21 kcal")).toBeTruthy();
    await act(async () => {
      late({ status: 200, body: { items: [listed("2f6a9c4d-7e1b-4a8f-b3c2-5d6e7f8a9b0c", 1, 18, 40, 84), listed("5a4b3c2d-1e0f-4a9b-8c7d-6e5f4a3b2c1d", 1, 18, 35, 83)], nextCursor: null, limitedToDays: null, hasAnyWorkouts: true } });
      await Promise.resolve();
    });
    expect(screen.queryByLabelText(/form 84/)).toBeNull();
    expect(screen.getByLabelText("1 workout")).toBeTruthy();
  });

  it("Calendar: a day with no workout says so, and the month's name opens every month", async () => {
    const server = progressServer({});
    await openProgress(server.ask);
    await openTab("Calendar");
    const now = new Date();
    const name = `${["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][now.getMonth()] ?? ""} ${String(now.getFullYear())}`;
    await fireEvent.press(await screen.findByRole("button", { name: `${name}. Pick a month` }));
    expect(await screen.findByText("Pick a month")).toBeTruthy();
    const thisMonth = screen.getByRole("button", { name: new RegExp(`^${name}, \\d+ active days?$`) });
    expect(thisMonth.props.accessibilityState).toEqual({ selected: true, disabled: false });
    await fireEvent.press(thisMonth);
    await waitFor(() => { expect(screen.queryByText("Pick a month")).toBeNull(); });
    // A day before today with no workout: the 1st, or today's own page's first day when that is today.
    if (now.getDate() > 2) {
      await fireEvent.press(screen.getByRole("button", { name: / 1 \w+, no workout$/ }));
      expect(await screen.findByText("No workout this day")).toBeTruthy();
    }
  });

  it("builds every tab once: going back to a tab reads nothing again", async () => {
    const server = progressServer({});
    await openProgress(server.ask);
    expect(await screen.findByLabelText("Total workouts, 9")).toBeTruthy();
    await openTab("Trends");
    await openTab("Calendar");
    await openTab("Overview");
    expect(screen.getByLabelText("Total workouts, 9")).toBeTruthy();
    expect(server.asked.filter((a) => a.path === RECORDS_READ)).toHaveLength(1);
    expect(server.asked.filter((a) => a.path === HEATMAP_READ)).toHaveLength(1);
  });

  it("Body shows the newest weight in the person's units, and its entries", async () => {
    const server = progressServer({});
    await openProgress(server.ask);
    await openTab("Body");
    expect(await screen.findByText("Body Measurements")).toBeTruthy();
    expect(await screen.findByLabelText(/^Weight 69\.\d kg, /)).toBeTruthy();
    expect(screen.getByText("Recent entries")).toBeTruthy();
  });

  it("a read that fails says so where it failed, and Try again reads again", async () => {
    let fail = true;
    const server = progressServer({}, { [RECORDS_READ]: () => (fail ? refusal(503, "unavailable", "Down") : { status: 200, body: RECORDS }) });
    await openProgress(server.ask);
    expect(await screen.findByText("Personal records couldn’t load.")).toBeTruthy();
    expect(screen.getByText("Predictions")).toBeTruthy();
    fail = false;
    await fireEvent.press(screen.getByRole("button", { name: "Load personal records again" }));
    expect(await screen.findByLabelText("Total workouts, 9")).toBeTruthy();
  });

  it("Me's picture no longer says Coming soon", async () => {
    const server = progressServer({});
    await render(<App extra={extra} store={memoryStore(kept(1))} ask={server.ask} />);
    await fireEvent.press(await screen.findByRole("tab", { name: "Me" }));
    const card = await screen.findByRole("button", { name: "Progress" });
    expect(within(card).queryByText("Coming soon")).toBeNull();
  });
});
