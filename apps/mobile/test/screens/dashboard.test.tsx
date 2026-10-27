import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { App } from "../../src/App";
import { DASHBOARD_READS } from "../../src/screens/Dashboard";
import { weekOf } from "../../src/screens/dashboard/words";
import type { Ask } from "../../src/session/calls";
import { RAVI, fakeServer, kept, memoryStore, never, profile, refusal, tokens, type Reply, type Route } from "../kit";

const extra = { copyName: "Feature 2", apiUrl: "http://localhost:3000" };
const noWait = () => Promise.resolve();
const today = weekOf(new Date()).find((day) => day.today)?.key ?? "";

const ok = (body: unknown) => (): Reply => ({ status: 200, body });

const overview = (totalWorkouts: number, more: object = {}) => ({
  totalWorkouts,
  totalKcal: 6420,
  totalDurationMs: 1080 * 60_000,
  avgFormScore: 86,
  currentStreak: 12,
  longestStreak: 20,
  consistencyPct: 0,
  limitedToDays: null,
  ...more,
});
const gamification = (more: object = {}) => ({
  streak: { current: 12, longest: 20, lastActivityDate: today, freezesAvailable: 2 },
  xp: { total: 1240, level: 7, xpInLevel: 240, xpForNext: 300, progressPct: 80, nextLevelAt: 1300 },
  achievements: [
    { code: "first_workout", earnedAt: "2026-10-01T10:00:00.000Z" },
    { code: "streak_7", earnedAt: "2026-10-20T10:00:00.000Z" },
  ],
  ...more,
});
const challenge = (code: string, measure: string, target: number, current: number, more: object = {}) => ({
  code,
  measure,
  difficulty: "easy",
  target,
  current,
  done: current >= target,
  xp: 50,
  held: null,
  ...more,
});
const challenges = {
  weekStart: "2026-10-26",
  weekEnd: "2026-11-01",
  challenges: [
    challenge("train_days_3", "training_days", 3, 1),
    challenge("burn_kcal_1500", "kcal_burned", 1500, 1500),
    challenge("train_minutes_120", "training_minutes", 120, 30, { held: { code: "safe_mode" } }),
  ],
  xpThisWeek: 50,
};
const workoutRow = (id: string, startedAt: string) => ({
  id,
  startedAt,
  platform: "android",
  setsCount: 4,
  totalReps: 40,
  avgFormScore: 91,
  durationMs: 42 * 60_000,
  kcalPoint: 348,
  kcalCalcVersion: 1,
  qualityFlags: [],
});
const page = (items: unknown[], hasAnyWorkouts: boolean) => ({ items, nextCursor: null, limitedToDays: 90, hasAnyWorkouts });

/** A person with a few weeks of training. */
const trained: Record<string, Route> = {
  "/v1/progress/overview": ok(overview(24)),
  "/v1/gamification/me": ok(gamification()),
  "/v1/progress/trend": ok({ points: [{ date: today, kcal: 348, workouts: 2 }], limitedToDays: 90 }),
  "/v1/gamification/challenges": ok(challenges),
  "/v1/workouts": ok(page([workoutRow("1b6f0a3e-2c4d-4e5f-8a9b-0c1d2e3f4a5b", new Date().toISOString())], true)),
};

async function openApp(routes: Record<string, Route>, ask?: Ask) {
  const server = fakeServer({ "/v1/auth/refresh": ok({ tokens: tokens(2) }), ...routes });
  await render(<App extra={extra} ask={ask ?? server.ask} store={memoryStore(kept(1))} wait={noWait} />);
  return server;
}

const label = (name: string) => screen.queryAllByLabelText(new RegExp(`^${name}`));

describe("the worst thing: nobody else's numbers on this person's Dashboard", () => {
  it("a reply to the person who signed out never lands on the next person's Dashboard", async () => {
    const ASHA = { ...RAVI, id: "2c9e7d41-5a3b-4f6e-8d2c-1b0a9f8e7d6c", email: "asha@example.com", displayName: "Asha" };
    // Ravi's reads hang until the test lets them go, with Ravi's own numbers; Asha's answer at once.
    const held: (() => void)[] = [];
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/auth/logout": ok({}),
      "/v1/auth/code/send": ok({ message: "Sent.", resendAfterSeconds: 60, expiresInSeconds: 600 }),
      "/v1/auth/code/verify": ok({ user: ASHA, isNewAccount: false, tokens: tokens(7) }),
      "/v1/users/me": ok(profile(true, ASHA)),
    });
    const ravis: Record<string, unknown> = {
      "/v1/progress/overview": overview(999, { totalKcal: 98765 }),
      "/v1/gamification/me": gamification({ xp: { total: 55555, level: 42, xpInLevel: 1, xpForNext: 2, progressPct: 50, nextLevelAt: 3 } }),
      "/v1/workouts": page([workoutRow("9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d", "2026-01-05T10:00:00.000Z")], true),
    };
    const ashas: Record<string, unknown> = {
      "/v1/progress/overview": overview(3, { totalKcal: 410, totalDurationMs: 90 * 60_000 }),
      "/v1/gamification/me": gamification({ achievements: [] }),
      "/v1/progress/trend": { points: [], limitedToDays: 90 },
      "/v1/gamification/challenges": challenges,
      "/v1/workouts": page([], false),
    };
    const ask: Ask = async (url, init) => {
      const path = new URL(url).pathname;
      const as = init.headers?.authorization;
      if (as === "Bearer access-2" && path in ravis) {
        await new Promise<void>((resolve) => held.push(resolve));
        return { ok: true, status: 200, json: () => Promise.resolve(ravis[path]) };
      }
      if (as === "Bearer access-7" && path in ashas) return { ok: true, status: 200, json: () => Promise.resolve(ashas[path]) };
      return server.ask(url, init);
    };
    await render(<App extra={extra} ask={ask} store={memoryStore(kept(1))} wait={noWait} />);
    expect(await screen.findByRole("header", { name: "Ravi" })).toBeTruthy();
    await waitFor(() => {
      expect(held).toHaveLength(3);
    });

    // Ravi signs out with his reads still away, and Asha signs in on the same phone.
    await fireEvent.press(screen.getByRole("tab", { name: "Me" }));
    await fireEvent.press(screen.getByRole("button", { name: "Sign out" }));
    const buttons = screen.getAllByRole("button", { name: "Sign out" });
    const inTheBox = buttons[1];
    if (inTheBox === undefined) throw new Error("the box's Sign out was expected");
    await fireEvent.press(inTheBox);
    await fireEvent.changeText(await screen.findByLabelText("Email"), "asha@example.com");
    await fireEvent.press(screen.getByRole("button", { name: "Continue" }));
    await fireEvent.changeText(await screen.findByLabelText("6-digit code"), "123456");
    await fireEvent.press(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("header", { name: "Asha" })).toBeTruthy();
    expect(await screen.findByText("410")).toBeTruthy();

    // Ravi's replies arrive now.
    await act(async () => {
      for (const go of held) go();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByText("410")).toBeTruthy();
    });
    for (const his of ["999", "98,765", "Level 42", "55,555 XP earned", "Ravi", "Mon 5 Jan · 42 min"]) {
      expect([his, screen.queryAllByText(new RegExp(his)).length]).toEqual([his, 0]);
    }
    expect(screen.getAllByText("Level 7")).toHaveLength(2);
    expect(screen.getByText("No workouts yet.")).toBeTruthy();
  });
});

describe("the Dashboard, with the person's own numbers", () => {
  it("shows each box from its own read, as drawn", async () => {
    const server = await openApp(trained);
    // The four numbers.
    expect(await screen.findByText("24")).toBeTruthy();
    expect(screen.getByText("Total Workouts")).toBeTruthy();
    expect(screen.getAllByText("all time")).toHaveLength(1);
    expect(screen.getByText("18h")).toBeTruthy();
    expect(screen.getByText("1,080 minutes · all time")).toBeTruthy();
    expect(screen.getByText("6,420")).toBeTruthy();
    expect(screen.getByText("kcal · all time")).toBeTruthy();
    expect(await screen.findAllByText("Level 7")).toHaveLength(2);
    expect(screen.getByText("1,240 XP earned")).toBeTruthy();
    // Experience points: the next level, two workouts this week, the streak and its freezes.
    expect(screen.getByText("240/300 XP → Level 8")).toBeTruthy();
    expect(screen.getByText("this week")).toBeTruthy();
    expect(screen.getAllByText("2").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.getByText("freezes left")).toBeTruthy();
    // This week: today ticked, one day of seven.
    expect(label("[A-Z][a-z]{2} \\d+, trained, today")).toHaveLength(1);
    expect(label("[A-Z][a-z]{2} \\d+, trained")).toHaveLength(1);
    expect(screen.getByText("1 of 7 days active")).toBeTruthy();
    // The week's challenges, each in words, a done one and one Safe mode holds.
    expect(screen.getByText("Train on 3 days")).toBeTruthy();
    expect(screen.getByText("1 of 3")).toBeTruthy();
    expect(screen.getByText("Burn 1,500 kcal")).toBeTruthy();
    expect(screen.getByText("Done")).toBeTruthy();
    expect(screen.getByText("Paused in Safe mode")).toBeTruthy();
    expect(screen.queryByText("30 of 120")).toBeNull();
    // Badges, newest first; the rank is not on the phone yet and says so.
    expect(screen.getByText("7-Day Streak")).toBeTruthy();
    expect(screen.getByText("First Workout")).toBeTruthy();
    expect(screen.getByText("Your Rank")).toBeTruthy();
    expect(screen.getAllByText("Coming soon")).toHaveLength(1);
    // A recent workout.
    expect(screen.getByText(/ · 42 min$/)).toBeTruthy();
    expect(screen.getByText("348 kcal")).toBeTruthy();
    expect(screen.getByText("91 form")).toBeTruthy();
    expect(screen.queryByText(/couldn’t load/)).toBeNull();
    // Recommended For You comes with its first option, Food (ROADMAP 34d-iii).
    expect(screen.queryByText("Recommended For You")).toBeNull();
    // Each read once, as the person signed in, and only these.
    const reads = server.asked.filter((one) => !one.path.startsWith("/v1/auth/") && one.path !== "/v1/users/me");
    expect(reads.map((one) => one.path).sort()).toEqual(Object.values(DASHBOARD_READS).map((p) => p.split("?")[0]).sort());
    expect(new Set(reads.map((one) => one.headers.authorization))).toEqual(new Set(["Bearer access-2"]));
  });

  it("a new person: true zeros, and words for what is not there yet", async () => {
    await openApp({
      "/v1/progress/overview": ok(overview(0, { totalKcal: 0, totalDurationMs: 0 })),
      "/v1/gamification/me": ok(gamification({ achievements: [], streak: { current: 0, longest: 0, lastActivityDate: null, freezesAvailable: 1 }, xp: { total: 0, level: 1, xpInLevel: 0, xpForNext: 100, progressPct: 0, nextLevelAt: 100 } })),
      "/v1/progress/trend": ok({ points: [], limitedToDays: 90 }),
      "/v1/gamification/challenges": ok(challenges),
      "/v1/workouts": ok(page([], false)),
    });
    expect(await screen.findByText("No workouts yet.")).toBeTruthy();
    expect(await screen.findByText("No badges yet.")).toBeTruthy();
    expect(screen.getByText("0 of 7 days active")).toBeTruthy();
    expect(screen.getByText("0 min")).toBeTruthy();
    expect(screen.getByText("freeze left")).toBeTruthy();
    expect(label("[A-Z][a-z]{2} \\d+, trained")).toHaveLength(0);
  });

  it("somebody whose workouts are older than the plan's window is not told they have none", async () => {
    await openApp({ ...trained, "/v1/workouts": ok(page([], true)), "/v1/progress/overview": ok(overview(0, { limitedToDays: 90 })) });
    expect(await screen.findByText("No workouts in the last 90 days.")).toBeTruthy();
    expect(screen.getAllByText(/last 90 days/).length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByText("No workouts yet.")).toBeNull();
  });
});

describe("a read that fails or is slow never shows a number it does not know", () => {
  it("every read fails: no number, one line, and Try again reads them again", async () => {
    let up = false;
    const failing = (route: Route): Route => (body) => (up ? route(body) : refusal(503, "unavailable", "Down"));
    await openApp(Object.fromEntries(Object.entries(trained).map(([path, route]) => [path, failing(route)])));
    expect(await screen.findByText("Some of your numbers couldn’t load.")).toBeTruthy();
    expect(screen.getByText("Total Workouts")).toBeTruthy();
    // No figure anywhere but the calendar's own dates.
    const figures = screen.queryAllByText(/\d/).map((one) => String(one.props.children));
    const dates = weekOf(new Date()).map((day) => String(day.date));
    expect(figures.filter((words) => !dates.includes(words))).toEqual([]);
    expect(label("[A-Z][a-z]{2} \\d+, trained")).toHaveLength(0);

    up = true;
    await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("24")).toBeTruthy();
    expect(await screen.findByText("1 of 7 days active")).toBeTruthy();
    expect(screen.queryByText("Some of your numbers couldn’t load.")).toBeNull();
  });

  it("one read that never answers leaves its own box unknown and the others drawn, with no failure line", async () => {
    await openApp({ ...trained, "/v1/gamification/me": never });
    expect(await screen.findByText("24")).toBeTruthy();
    expect(screen.getByText("1 of 7 days active")).toBeTruthy();
    expect(screen.queryByText(/^Level \d/)).toBeNull();
    expect(screen.queryByText("12")).toBeNull();
    expect(screen.getAllByText("–").length).toBeGreaterThanOrEqual(4);
    expect(screen.queryByText("No badges yet.")).toBeNull();
    expect(screen.queryByText("Some of your numbers couldn’t load.")).toBeNull();
  });

  it("a reply in the wrong shape is a failed read, not a blank or a zero", async () => {
    await openApp({ ...trained, "/v1/progress/overview": ok({ totalWorkouts: "lots" }) });
    expect(await screen.findByText("Some of your numbers couldn’t load.")).toBeTruthy();
    expect(screen.queryByText("lots")).toBeNull();
    expect(screen.getByText("1,240 XP earned")).toBeTruthy();
  });
});

describe("its buttons open where each thing lives", () => {
  it.each([
    ["Start Workout", "Workout"],
    ["Browse Exercises", "Workout"],
    ["Start Training", "Workout"],
    ["View Progress", "Me"],
    ["Latest Badges, View all", "Me"],
  ])("%s opens %s", async (button, tab) => {
    await openApp(trained);
    await screen.findByText("24");
    await fireEvent.press(screen.getByRole("button", { name: button }));
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: tab }).props.accessibilityState).toEqual({ selected: true });
    });
  });

  it("coming back to the Dashboard reads it again", async () => {
    const server = await openApp(trained);
    await screen.findByText("24");
    const overviews = () => server.paths().filter((path) => path === "/v1/progress/overview").length;
    expect(overviews()).toBe(1);
    await fireEvent.press(screen.getByRole("tab", { name: "Me" }));
    await fireEvent.press(screen.getByRole("tab", { name: "Dashboard" }));
    await waitFor(() => {
      expect(overviews()).toBe(2);
    });
  });
});
