import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { App } from "../../src/App";
import type { Ask, AskInit } from "../../src/session/calls";
import { RECORDS_READ } from "../../src/screens/progress/ProgressPage";
import { dayKey, fakeServer, kept, memoryStore, refusal, tokens, type Reply } from "../kit";

const extra = { copyName: "Feature 2", apiUrl: "http://localhost:3000" };
const WORKOUT = "0d1e2f3a-4b5c-4d6e-9f80-910213243546";
const RECORDS = {
  maxKcalWorkout: { workoutId: WORKOUT, value: 410 },
  longestWorkout: { workoutId: WORKOUT, value: 52 * 60_000 },
  bestAvgForm: { workoutId: WORKOUT, value: 94 },
  totalWorkouts: 9,
  longestStreak: 3,
  limitedToDays: null,
};
const day = (back: number, workouts: number, kcal: number) => ({ date: dayKey(back), workouts, kcal, durationMs: workouts * 30 * 60_000 });
const STREAK = { totalWorkouts: 9, totalKcal: 0, totalDurationMs: 0, avgFormScore: null, currentStreak: 2, longestStreak: 5, consistencyPct: 0, totalRuns: 0, runDurationMs: 0, runKcal: 0, limitedToDays: null };
const trend = (points: ReturnType<typeof day>[], limitedToDays: number | null = null) => ({ points, runDays: [], limitedToDays });

type Answer = Reply | Promise<Reply>;

/** The server, with the trend answered by its period (the kit's fake reads only the path). */
function progressServer(byPeriod: Record<string, () => Answer>, records: () => Answer = () => ({ status: 200, body: RECORDS })) {
  const server = fakeServer({
    "/v1/auth/refresh": () => ({ status: 200, body: { tokens: tokens(2) } }),
    [RECORDS_READ]: records,
    // The streak's read; the Dashboard reads the same path.
    "/v1/progress/overview": () => ({ status: 200, body: STREAK }),
  });
  const periods: string[] = [];
  const ask: Ask = async (url: string, init: AskInit) => {
    const u = new URL(url);
    if (u.pathname !== "/v1/progress/trend" || u.searchParams.get("period") === "7d") return server.ask(url, init);
    const period = u.searchParams.get("period") ?? "";
    periods.push(period);
    const reply = await (byPeriod[period] ?? (() => ({ status: 200, body: trend([]) })))();
    return { ok: reply.status < 300, status: reply.status, json: () => Promise.resolve(reply.body) };
  };
  return { ask, periods };
}

async function openProgress(ask: Ask) {
  await render(<App extra={extra} store={memoryStore(kept(1))} ask={ask} />);
  await fireEvent.press(await screen.findByRole("tab", { name: "Me" }));
  await fireEvent.press(await screen.findByRole("button", { name: "Progress" }));
}

const ok = (body: unknown) => (): Reply => ({ status: 200, body });

describe("Me → Progress", () => {
  // The worst thing: a number under one chip counted from another stretch of days. The 30 days' reply
  // comes late, after 7 Days is pressed; it must never be drawn under 7 Days.
  it("draws each period's own numbers under its chip, and drops a late answer for the chip left", async () => {
    let late: (r: Reply) => void = () => undefined;
    const server = progressServer({
      "30d": () => new Promise<Reply>((resolve) => { late = resolve; }),
    });
    // 7d goes through the kit's path-only route on the Dashboard; the page's own 7d read is the test's.
    const ask: Ask = (url, init) => (new URL(url).searchParams.get("period") === "7d" && new URL(url).pathname === "/v1/progress/trend"
      ? Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(trend([day(0, 1, 250), day(3, 1, 300), day(7, 4, 999)])) })
      : server.ask(url, init));
    await openProgress(ask);
    await waitFor(() => { expect(server.periods).toContain("30d"); });
    await fireEvent.press(screen.getByRole("radio", { name: "7 Days" }));
    expect(await screen.findByLabelText("550 calories burned")).toBeTruthy();
    // The eighth day back (day 7) is the server's part-day: not counted, in any box.
    expect(screen.getByLabelText("2 workouts")).toBeTruthy();
    expect(screen.getByLabelText("1h trained")).toBeTruthy();
    expect(screen.getByText("2 of 7 days")).toBeTruthy();
    expect(screen.getByText("Workouts Per Day")).toBeTruthy();
    await act(async () => { late({ status: 200, body: trend([day(0, 5, 5000)]) }); await Promise.resolve(); });
    expect(screen.queryByLabelText("5,000 calories burned")).toBeNull();
    expect(screen.getByLabelText("550 calories burned")).toBeTruthy();
  });

  it("opens on 30 Days, as drawn: the four boxes, and Me's picture no longer says Coming soon", async () => {
    const server = progressServer({ "30d": ok(trend([day(0, 1, 300), day(1, 2, 500), day(20, 1, 120)])) });
    await render(<App extra={extra} store={memoryStore(kept(1))} ask={server.ask} />);
    await fireEvent.press(await screen.findByRole("tab", { name: "Me" }));
    const card = await screen.findByRole("button", { name: "Progress" });
    expect(within(card).queryByText("Coming soon")).toBeNull();
    await fireEvent.press(card);
    expect(await screen.findByLabelText("920 calories burned")).toBeTruthy();
    expect(screen.getByRole("radio", { name: "30 Days" }).props.accessibilityState).toEqual({ selected: true });
    // The browser's four numbers: the period's workouts and time, its calories, and today's streak.
    expect(screen.getByLabelText("4 workouts")).toBeTruthy();
    expect(screen.getByLabelText("2h trained")).toBeTruthy();
    expect(screen.getByLabelText("Streak 2 days, longest 5 days")).toBeTruthy();
    expect(screen.getAllByText("Calories Burned")).toHaveLength(2);
    expect(screen.getByText("Each week")).toBeTruthy();
    expect(screen.getByText("Workouts Per Week")).toBeTruthy();
    expect(screen.getByText("Personal Records")).toBeTruthy();
    expect(screen.getByText("From all your workouts")).toBeTruthy();
    expect(screen.getByText("52 min")).toBeTruthy();
    expect(screen.getByText("410 kcal")).toBeTruthy();
    expect(screen.getByText("94")).toBeTruthy();
    expect(screen.getByText("Total workouts")).toBeTruthy();
    expect(screen.getByText("3 of 30 days")).toBeTruthy();
    expect(screen.getByText("10%")).toBeTruthy();
    expect(screen.queryByText(/Any older workouts/)).toBeNull();
  });

  it("says a plan's limit only where it cuts the period", async () => {
    const server = progressServer({
      "30d": ok(trend([day(0, 1, 300)], 90)),
      "1y": ok(trend([day(0, 1, 300)], 90)),
    }, ok({ ...RECORDS, limitedToDays: 90 }));
    await openProgress(server.ask);
    expect(await screen.findByText("1 of 30 days")).toBeTruthy();
    expect(screen.queryByText(/Your plan shows/)).toBeNull();
    expect(screen.getByText("From your last 90 days")).toBeTruthy();
    await fireEvent.press(screen.getByRole("radio", { name: "1 Year" }));
    expect(await screen.findByText("Your plan shows your last 90 days. Any older workouts are still saved.")).toBeTruthy();
    expect(screen.getByText("1 of 90 days")).toBeTruthy();
    expect(screen.getByText("Workouts Per Week")).toBeTruthy();
  });

  it("a period with no workout says so in place of the two charts, and keeps the records", async () => {
    const server = progressServer({ "30d": ok(trend([day(40, 1, 300)])) });
    await openProgress(server.ask);
    expect(await screen.findByText("No workouts in the last 30 days")).toBeTruthy();
    expect(screen.queryByText("Each week")).toBeNull();
    expect(screen.getByLabelText("0 workouts")).toBeTruthy();
    expect(screen.getByText("Personal Records")).toBeTruthy();
    expect(screen.getByText("0 of 30 days")).toBeTruthy();
  });

  it("with no workouts says so and nothing more", async () => {
    const server = progressServer({ "30d": ok(trend([])) }, ok({ ...RECORDS, maxKcalWorkout: null, longestWorkout: null, bestAvgForm: null, totalWorkouts: 0 }));
    await openProgress(server.ask);
    expect(await screen.findByText("No workouts yet")).toBeTruthy();
    expect(screen.queryByText("Calories Burned")).toBeNull();
    expect(screen.queryByText("Personal Records")).toBeNull();
  });

  it("a read that fails says so, and Try again reads again", async () => {
    let fail = true;
    const server = progressServer({ "30d": () => (fail ? refusal(503, "unavailable", "Down") : { status: 200, body: trend([day(0, 1, 300)]) }) });
    await openProgress(server.ask);
    expect(await screen.findByText("Your progress couldn’t load.")).toBeTruthy();
    fail = false;
    await fireEvent.press(screen.getByRole("button", { name: "Load your progress again" }));
    expect(await screen.findByText("1 of 30 days")).toBeTruthy();
  });
});
