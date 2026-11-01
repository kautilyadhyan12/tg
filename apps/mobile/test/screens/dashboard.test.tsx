import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { App } from "../../src/App";
import { DASHBOARD_READS } from "../../src/screens/Dashboard";
import { dayWords, weekOf } from "../../src/screens/dashboard/words";
import type { Ask } from "../../src/session/calls";
import { goal } from "../goalFixture";
import { RAVI, fakeServer, isClockWords, kept, memoryStore, never, profile, refusal, tokens, type Reply, type Route } from "../kit";

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
  totalRuns: 0,
  runDurationMs: 0,
  runKcal: 0,
  limitedToDays: null,
  ...more,
});
const gamification = (more: object = {}) => ({
  streak: { current: 12, longest: 20, lastActivityDate: today, freezesAvailable: 3 },
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
const list = (items: unknown[]) => ({ items, nextCursor: null });
const runRow = (id: string, startedAt: string, routeName: string) => ({
  id,
  startedAt,
  durationS: 31 * 60,
  distanceM: 5230,
  routeName,
  kcalPoint: 310,
  source: "mobile",
});
const mealRow = (id: string, takenAt: string, mealName: string | null) => ({
  id,
  takenAt,
  mealType: "lunch",
  mealName,
  items: [],
  totals: { kcalPoint: 540, kcalLow: 480, kcalHigh: 600, proteinG: 30, carbsG: 60, fatG: 18 },
  confirmed: true,
  origin: "photo",
  portionSource: "default",
  nutritionSources: [],
  calcVersion: 1,
  itemsVersion: "v1",
});
const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

/** A person with a few weeks of training. */
const trained: Record<string, Route> = {
  "/v1/progress/overview": ok(overview(24)),
  "/v1/gamification/me": ok(gamification()),
  "/v1/progress/trend": ok({ points: [{ date: today, kcal: 348, workouts: 2 }], runDays: [], limitedToDays: 90 }),
  "/v1/gamification/challenges": ok(challenges),
  "/v1/nutrition/suggestions": ok({ status: "needs_plan" }),
  "/v1/workouts": ok(page([workoutRow("1b6f0a3e-2c4d-4e5f-8a9b-0c1d2e3f4a5b", hoursAgo(1))], true)),
  "/v1/geo/runs": ok(list([runRow("5d4c3b2a-1f0e-4d9c-8b7a-6f5e4d3c2b1a", hoursAgo(30), "Evening run")])),
  "/v1/nutrition/meals": ok(list([mealRow("6e5d4c3b-2a1f-4e0d-9c8b-7a6f5e4d3c2b", hoursAgo(3), null)])),
  "/v1/goals": ok({ goals: [goal({ kind: "training_days", period: "week", target: 4, current: 2 })], max: 30 }),
};
const nothingElse = { "/v1/geo/runs": ok(list([])), "/v1/nutrition/meals": ok(list([])) };

async function openApp(routes: Record<string, Route>, ask?: Ask) {
  const server = fakeServer({ "/v1/auth/refresh": ok({ tokens: tokens(2) }), ...routes });
  await render(<App extra={extra} ask={ask ?? server.ask} store={memoryStore(kept(1))} wait={noWait} />);
  return server;
}

const label = (name: string) => screen.queryAllByLabelText(new RegExp(`^${name}`));

describe("Your Rank's read", () => {
  it("a board that could not be read stops being said once the person has no gym", async () => {
    const gym = { id: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f", name: "Iron House", city: null, orgType: "gym", clockFormat: "12h", slug: "iron-house", timezone: "Asia/Kolkata", locale: "en", currencyDisplay: "INR", status: "active", staffRole: null, isMember: true, joinedAt: "2026-10-01T00:00:00.000Z" };
    let member = true;
    await openApp({
      ...trained,
      "/v1/orgs/mine": () => ({ status: 200, body: { orgs: member ? [gym] : [], formerOrgs: [] } }),
      [`/v1/orgs/${gym.id}/leaderboard`]: () => {
        throw new TypeError("Network request failed");
      },
    });
    expect(await screen.findByText("Some of your numbers couldn’t load.")).toBeTruthy();
    member = false;
    const [first, , second] = await screen.findAllByRole("tab");
    if (first === undefined || second === undefined) throw new Error("no tabs");
    await fireEvent.press(second);
    await fireEvent.press(first);
    await waitFor(() => {
      expect(screen.queryByText("Some of your numbers couldn’t load.")).toBeNull();
    });
    expect(screen.getByText("Coming soon")).toBeTruthy();
  });
});

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
      "/v1/geo/runs": list([runRow("8b7a6f5e-4d3c-4b2a-9f0e-1d2c3b4a5f6e", "2026-01-06T07:00:00.000Z", "Ravi's canal loop")]),
      "/v1/nutrition/meals": list([mealRow("9c8b7a6f-5e4d-4c3b-8a2f-1e0d9c8b7a6f", "2026-01-06T13:00:00.000Z", "Ravi's thali")]),
    };
    const ashas: Record<string, unknown> = {
      "/v1/progress/overview": overview(3, { totalKcal: 410, totalDurationMs: 90 * 60_000 }),
      "/v1/gamification/me": gamification({ achievements: [] }),
      "/v1/progress/trend": { points: [], runDays: [], limitedToDays: 90 },
      "/v1/gamification/challenges": challenges,
      "/v1/workouts": page([], false),
      "/v1/geo/runs": list([]),
      "/v1/nutrition/meals": list([]),
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
      expect(held).toHaveLength(5);
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
    for (const his of ["999", "98,765", "Level 42", "55,555 XP earned", "Ravi", "Mon 5 Jan", "Tue 6 Jan", "42 min · 91 form", "348 kcal", "canal loop", "thali", "5.2 km", "540 kcal"]) {
      expect([his, screen.queryAllByText(new RegExp(his)).length]).toEqual([his, 0]);
    }
    expect(screen.getAllByText("Level 7")).toHaveLength(1);
    expect(screen.getByText("No activity yet.")).toBeTruthy();
  });
});

describe("the Dashboard, with the person's own numbers", () => {
  it("shows each box from its own read, as drawn", async () => {
    const server = await openApp(trained);
    // The four numbers.
    expect(await screen.findByText("24")).toBeTruthy();
    expect(screen.getByText("Total Sessions")).toBeTruthy();
    // The window the four cover, said once over them.
    expect(screen.getAllByText("all time")).toHaveLength(1);
    expect(screen.getByText("18h")).toBeTruthy();
    expect(screen.getByText("6,420")).toBeTruthy();
    expect(await screen.findAllByText("Level 7")).toHaveLength(1);
    expect(screen.getByText("1,240 XP earned")).toBeTruthy();
    // Experience points: the next level, two workouts this week, the streak and its freezes, each
    // number beside its own word.
    expect(screen.getByText("240/300 XP → Level 8")).toBeTruthy();
    expect(label("2 this week")).toHaveLength(1);
    expect(label("12 day streak")).toHaveLength(1);
    expect(label("3 freezes left")).toHaveLength(1);
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
    // Somebody with no gym: Your Rank waits for their own board.
    expect(screen.getAllByText("Coming soon")).toHaveLength(1);
    // Recent Activity: the workout, the meal and the run, newest first, each named by its day.
    expect(screen.getByText("Recent Activity")).toBeTruthy();
    const details = ["Workout · 42 min · 91 form", "Lunch · Meal scan", "Evening run · 31 min"];
    for (const detail of details) expect(screen.getByText(detail)).toBeTruthy();
    const order = screen.queryAllByText(/^(Workout ·|Lunch ·|Evening run ·)/).map((one) => String(one.props.children));
    expect(order).toEqual(details);
    expect(screen.getAllByText(dayWords(hoursAgo(1)) ?? "").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("348 kcal")).toBeTruthy();
    expect(screen.getByText("540 kcal")).toBeTruthy();
    expect(screen.getByText("5.2 km")).toBeTruthy();
    expect(screen.queryByText(/couldn’t load/)).toBeNull();
    // Recommended For You, with its first option, Food (ROADMAP 34d-iii).
    expect(screen.getByText("Recommended For You")).toBeTruthy();
    // Each read once, as the person signed in, and only these (the Gym tab's places are read at opening too).
    const reads = server.asked.filter((one) => !one.path.startsWith("/v1/auth/") && !one.path.startsWith("/v1/orgs/") && one.path !== "/v1/users/me");
    expect(reads.map((one) => one.path).sort()).toEqual(Object.values(DASHBOARD_READS).map((p) => p.split("?")[0]).sort());
    expect(new Set(reads.map((one) => one.headers.authorization))).toEqual(new Set(["Bearer access-2"]));
  });

  it("Total Sessions, the hours, the calories and the week count runs with the workouts", async () => {
    const otherDay = weekOf(new Date()).find((day) => !day.today)?.key ?? "";
    await openApp({
      ...trained,
      // 37 sessions: a number no day of the week's calendar can show.
      "/v1/progress/overview": ok(overview(24, { totalRuns: 13, runDurationMs: 30 * 60_000, runKcal: 100 })),
      "/v1/progress/trend": ok({
        points: [{ date: today, kcal: 348, workouts: 2 }],
        runDays: [
          { date: today, runs: 1 },
          { date: otherDay, runs: 1 },
        ],
        limitedToDays: 90,
      }),
    });
    expect(await screen.findByText("37")).toBeTruthy();
    expect(screen.getByText("Total Sessions")).toBeTruthy();
    expect(screen.getByText("18h 30m")).toBeTruthy();
    expect(screen.getByText("6,520")).toBeTruthy();
    expect(label("4 this week")).toHaveLength(1);
    expect(screen.getByText("2 of 7 days active")).toBeTruthy();
    expect(label("[A-Z][a-z]{2} \\d+, trained")).toHaveLength(2);
  });

  it("a new person: true zeros, and words for what is not there yet", async () => {
    await openApp({
      "/v1/progress/overview": ok(overview(0, { totalKcal: 0, totalDurationMs: 0 })),
      "/v1/gamification/me": ok(gamification({ achievements: [], streak: { current: 0, longest: 0, lastActivityDate: null, freezesAvailable: 1 }, xp: { total: 0, level: 1, xpInLevel: 0, xpForNext: 100, progressPct: 0, nextLevelAt: 100 } })),
      "/v1/progress/trend": ok({ points: [], runDays: [], limitedToDays: 90 }),
      "/v1/gamification/challenges": ok(challenges),
      "/v1/workouts": ok(page([], false)),
      ...nothingElse,
    });
    expect(await screen.findByText("No activity yet.")).toBeTruthy();
    expect(await screen.findByText("No badges yet.")).toBeTruthy();
    expect(screen.getByText("0 of 7 days active")).toBeTruthy();
    expect(screen.getByText("0 min")).toBeTruthy();
    expect(label("1 freeze left")).toHaveLength(1);
    expect(label("0 this week")).toHaveLength(1);
    expect(label("[A-Z][a-z]{2} \\d+, trained")).toHaveLength(0);
  });

  it("somebody whose workouts are older than the plan's window is not told they have none", async () => {
    await openApp({ ...trained, ...nothingElse, "/v1/workouts": ok(page([], true)), "/v1/progress/overview": ok(overview(0, { limitedToDays: 90 })) });
    expect(await screen.findByText("No activity in the last 90 days.")).toBeTruthy();
    expect(screen.getByText("last 90 days")).toBeTruthy();
    expect(screen.queryByText("No activity yet.")).toBeNull();
  });
});

describe("the person's own time zone", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const inZone = (zone: string) => {
    const real = new Intl.DateTimeFormat().resolvedOptions();
    jest.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({ ...real, timeZone: zone });
  };

  it("a phone in India with no zone on the server saves its own, and the week is read again in it", async () => {
    inZone("Asia/Kolkata");
    const saved: unknown[] = [];
    const server = await openApp({
      ...trained,
      "/v1/users/me": (body) => {
        if (body !== undefined) saved.push(body);
        return { status: 200, body: { user: { ...profile(true).user, timezone: saved.length > 0 ? "Asia/Kolkata" : null } } };
      },
    });
    await waitFor(() => {
      expect(saved).toEqual([{ timezone: "Asia/Kolkata" }]);
    });
    const changes = server.asked.filter((one) => one.path === "/v1/users/me" && one.method === "PATCH");
    expect(changes.map((one) => one.headers.authorization)).toEqual(["Bearer access-2"]);
    // The week, the streak and the totals are read once more, after the zone is saved.
    await waitFor(() => {
      expect(server.paths().filter((path) => path === "/v1/progress/trend")).toHaveLength(2);
    });
    expect(server.paths().filter((path) => path === "/v1/gamification/me")).toHaveLength(2);
    expect(server.paths().filter((path) => path === "/v1/progress/overview")).toHaveLength(2);
  });

  it("a zone the server already has is not saved again", async () => {
    inZone("Asia/Kolkata");
    const server = await openApp({
      ...trained,
      "/v1/users/me": () => ({ status: 200, body: { user: { ...profile(true).user, timezone: "Asia/Kolkata" } } }),
    });
    expect(await screen.findByText("24")).toBeTruthy();
    await waitFor(() => {
      expect(server.paths().filter((path) => path === "/v1/users/me").length).toBeGreaterThanOrEqual(1);
    });
    expect(server.asked.filter((one) => one.method === "PATCH")).toEqual([]);
    expect(server.paths().filter((path) => path === "/v1/progress/trend")).toHaveLength(1);
  });
});

describe("a read that fails or is slow never shows a number it does not know", () => {
  it("every read fails: no number, one line, and Try again reads them again", async () => {
    let up = false;
    const failing = (route: Route): Route => (body) => (up ? route(body) : refusal(503, "unavailable", "Down"));
    await openApp(Object.fromEntries(Object.entries(trained).map(([path, route]) => [path, failing(route)])));
    expect(await screen.findByText("Some of your numbers couldn’t load.")).toBeTruthy();
    expect(screen.getByText("Total Sessions")).toBeTruthy();
    // No figure anywhere but the calendar's own dates and the clock's time.
    const figures = screen.queryAllByText(/\d/).map((one) => String(one.props.children));
    const dates = weekOf(new Date()).map((day) => String(day.date));
    expect(figures.filter((words) => !dates.includes(words) && !isClockWords(words))).toEqual([]);
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

  it("one of Recent Activity's three lists failing shows no list at all, never one missing the newest", async () => {
    await openApp({ ...trained, "/v1/nutrition/meals": () => refusal(503, "unavailable", "Down") });
    expect(await screen.findByText("Some of your numbers couldn’t load.")).toBeTruthy();
    expect(screen.getByText("24")).toBeTruthy();
    expect(screen.queryByText("Workout · 42 min · 91 form")).toBeNull();
    expect(screen.queryByText("Evening run · 31 min")).toBeNull();
    expect(screen.queryByText(/^No activity/)).toBeNull();
  });

  it("a reply in the wrong shape is a failed read, not a blank or a zero", async () => {
    await openApp({ ...trained, "/v1/progress/overview": ok({ totalWorkouts: "lots" }) });
    expect(await screen.findByText("Some of your numbers couldn’t load.")).toBeTruthy();
    expect(screen.queryByText("lots")).toBeNull();
    expect(screen.getByText("1,240 XP earned")).toBeTruthy();
  });
});

describe("its buttons open where each thing lives", () => {
  // Start Training is on the page twice: under the greeting, and in Ready to start.
  it.each([
    ["Start Training", 0, "Workout"],
    ["Start Training", 1, "Workout"],
    ["Browse Exercises", 0, "Workout"],
    ["View Progress", 0, "Me"],
    ["Latest Badges, View all", 0, "Me"],
  ] as const)("%s (%i) opens %s", async (button, which, tab) => {
    await openApp(trained);
    await screen.findByText("24");
    const pressed = screen.getAllByRole("button", { name: button })[which];
    if (pressed === undefined) throw new Error(`${button} ${String(which)} was expected`);
    expect(screen.getAllByRole("button", { name: button })).toHaveLength(button === "Start Training" ? 2 : 1);
    await fireEvent.press(pressed);
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
