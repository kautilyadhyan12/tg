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
  steady: { available: true, steady: false, recentDays: 14, kcal: { before: 21, recent: 21, changePct: 0 }, minutes: { before: 58, recent: 38, changePct: -34.8 }, form: { before: 88, recent: 84, changePct: -4.6 } },
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

/** The server: the trend and the families answered by their period (the kit's fake reads only the path). */
function progressServer(byPeriod: Record<string, () => Answer>, more: Record<string, () => Answer> = {}) {
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
  const ask: Ask = async (url: string, init: AskInit) => {
    const u = new URL(url);
    if (u.pathname !== "/v1/progress/trend") return server.ask(url, init);
    const period = u.searchParams.get("period") ?? "";
    periods.push(period);
    const route = byPeriod[period];
    const reply = route === undefined ? { status: 200, body: trend([]) } : await route();
    return { ok: reply.status < 300, status: reply.status, json: () => Promise.resolve(reply.body) };
  };
  return { ask, periods };
}

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
    expect(screen.getByLabelText("Plateau detector, Shorter workouts, Minutes 58 → 38 ▼35%, Calories 21 → 21, Form 88 → 84 ▼5%")).toBeTruthy();
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
    await fireEvent.press(screen.getByRole("radio", { name: "7 Days" }));
    expect(await screen.findByLabelText(/^Calories burned, 550 kcal: /)).toBeTruthy();
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
    expect(screen.getByRole("radio", { name: "30 Days" }).props.accessibilityState).toEqual({ selected: true });
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
    await fireEvent.press(screen.getByRole("radio", { name: "1 Year" }));
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
