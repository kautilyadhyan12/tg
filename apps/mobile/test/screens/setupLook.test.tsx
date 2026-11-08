import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { AppState } from "react-native";
import { missingPlanInputSchema, type OnboardingAnswers } from "@app/shared";
import { App } from "../../src/App";
import { LOOK_MS } from "../../src/screens/SetupGate";
import { RAVI, fakeServer, kept, memoryStore, profile, tokens, type Reply } from "../kit";

// 14d: a new sign-in looks at the tabs, then setup comes up over them and cannot be closed.

const extra = { copyName: "Feature 1", apiUrl: "http://localhost:3000" };
const noWait = () => Promise.resolve();
const SHORT = 150;
const notSetUp = (): Reply => ({ status: 200, body: profile(true, RAVI, false) });
const setUp = (): Reply => ({ status: 200, body: profile(true, RAVI, true) });

const EMPTY: OnboardingAnswers = {
  displayName: "Ravi",
  weightGoal: null,
  fitnessGoals: [],
  age: null,
  gender: null,
  heightCm: null,
  weightKg: null,
  targetWeightKg: null,
  pace: null,
  dayActivity: null,
  fitnessLevel: null,
  pushUpsMax: null,
  plankHoldSeconds: null,
  trainingDays: null,
  sessionMinutes: null,
  availableEquipment: [],
  trainingPlaces: [],
  diet: null,
  mealsPerDay: null,
  onboardingCompleted: false,
  updatedAt: null,
};
const nothingAnswered = (): Reply => ({ status: 200, body: { answers: EMPTY, plan: null, missing: missingPlanInputSchema.options } });

/** The app's coming back to the front, and going behind, called by hand. */
function heldAppState() {
  const listeners: ((state: string) => void)[] = [];
  jest.spyOn(AppState, "addEventListener").mockImplementation((_type, handler) => {
    listeners.push(handler as (state: string) => void);
    return { remove: () => undefined };
  });
  return async (state: "active" | "background") => {
    await act(async () => {
      for (const one of listeners) one(state);
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  };
}

/** Signed in by code just now, the profile route as each test says. */
async function signIn(me: () => Reply, lookMs = SHORT) {
  const route = { me };
  const server = fakeServer({
    "/v1/auth/code/send": () => ({ status: 200, body: { message: "We emailed you a 6-digit code.", resendAfterSeconds: 60, expiresInSeconds: 600 } }),
    "/v1/auth/code/verify": () => ({ status: 200, body: { user: RAVI, isNewAccount: false, tokens: tokens(1) } }),
    "/v1/auth/refresh": () => ({ status: 200, body: { tokens: tokens(2) } }),
    "/v1/users/me": () => route.me(),
    "/v1/users/me/onboarding": nothingAnswered,
  });
  await render(<App extra={extra} ask={server.ask} store={memoryStore(null)} wait={noWait} lookMs={lookMs} />);
  await fireEvent.changeText(await screen.findByLabelText("Email"), RAVI.email);
  await fireEvent.press(screen.getByRole("button", { name: "Continue" }));
  await fireEvent.changeText(await screen.findByLabelText("6-digit code"), "123456");
  await fireEvent.press(screen.getByRole("button", { name: "Continue" }));
  return { server, route };
}

const press = (name: string) => fireEvent.press(screen.getByRole("button", { name }));
const looking = async (ms: number) => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
};
const setupIsUp = async () => {
  expect(await screen.findByRole("header", { name: "Your goal" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  expect(screen.getAllByRole("button", { name: "Sign out" }).length).toBeGreaterThan(0);
};
/** What a person who has not finished setup must not start: a run, a meal, a plan. */
const started = (server: { asked: { method: string; path: string }[] }) =>
  server.asked.filter((one) => one.method !== "GET" && /\/(runs|meals|diet-plan|workouts)/.test(one.path));

const { notifications, reset } = jest.requireMock<{ notifications: { permission: unknown }; reset: () => void }>("expo-notifications");
const ASK_NOTIFICATIONS = { granted: false, canAskAgain: true, status: "undetermined" };

afterEach(() => {
  jest.restoreAllMocks();
  reset();
});

describe("the worst thing: nobody starts a workout, run, meal or plan before the health question and their age", () => {
  // Each place, and the button on it that starts a run, logs a meal or makes a plan.
  it.each([
    ["Food", null, "Scan food"],
    ["Food", null, "Build my own"],
    ["Workout", "Running", "Start run"],
  ])("on %s, %s %s opens setup at once, and nothing is started", async (tab, part, button) => {
    const { server } = await signIn(notSetUp, 60_000);
    await fireEvent.press(await screen.findByRole("tab", { name: tab }));
    if (part !== null) await press(part);
    await fireEvent.press((await screen.findAllByRole("button", { name: button }))[0] ?? screen.getByRole("button", { name: button }));
    await setupIsUp();
    expect(started(server)).toEqual([]);
  });

  it("Me's Your plan opens the setup that cannot be closed, not one with a close button", async () => {
    await signIn(notSetUp, 60_000);
    await fireEvent.press(await screen.findByRole("tab", { name: "Me" }));
    await press("Your plan");
    await setupIsUp();
  });

  it("looking around is free: tabs, Workout's parts and the pages open, and setup waits", async () => {
    await signIn(notSetUp, 60_000);
    for (const tab of ["Workout", "Food", "Me", "Dashboard"]) await fireEvent.press(await screen.findByRole("tab", { name: tab }));
    await fireEvent.press(await screen.findByRole("tab", { name: "Workout" }));
    await press("Running");
    expect(await screen.findByRole("button", { name: "Start run" })).toBeTruthy();
    await fireEvent.press(await screen.findByRole("tab", { name: "Dashboard" }));
    const [startTraining] = screen.getAllByRole("button", { name: "Start Training" });
    if (startTraining === undefined) throw new Error("no Start Training");
    await fireEvent.press(startTraining);
    expect(await screen.findByRole("button", { name: "Running" })).toBeTruthy();
    expect(screen.queryByRole("header", { name: "Your goal" })).toBeNull();
  });
});

describe("the look", () => {
  it("is the Dashboard first, with no setup yet", async () => {
    await signIn(notSetUp, 60_000);
    expect(await screen.findByRole("tab", { name: "Dashboard" })).toBeTruthy();
    await looking(SHORT * 2);
    expect(screen.queryByRole("header", { name: "Your goal" })).toBeNull();
  });

  it("then setup comes up by itself, with no way to close it", async () => {
    await signIn(notSetUp);
    await setupIsUp();
  });

  it("lasts eight seconds", () => {
    expect(LOOK_MS).toBe(8_000);
  });

  it("counts only while the app is in front", async () => {
    const turn = heldAppState();
    // Behind another app from the start, so the test does not race the look on a slow machine.
    const before = Object.getOwnPropertyDescriptor(AppState, "currentState");
    Object.defineProperty(AppState, "currentState", { value: "background", configurable: true, writable: true });
    try {
      await signIn(notSetUp, SHORT);
      await screen.findByRole("tab", { name: "Dashboard" });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, SHORT * 4));
      });
      expect(screen.queryByRole("header", { name: "Your goal" })).toBeNull();
      await turn("active");
      await setupIsUp();
    } finally {
      if (before === undefined) Reflect.deleteProperty(AppState, "currentState");
      else Object.defineProperty(AppState, "currentState", before);
    }
  });

  it("is never given to somebody set up: no setup, and Build my own goes ahead", async () => {
    await signIn(setUp);
    await looking(SHORT * 3);
    expect(screen.queryByRole("header", { name: "Your goal" })).toBeNull();
    await fireEvent.press(await screen.findByRole("tab", { name: "Food" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Build my own" }));
    await looking(SHORT);
    expect(screen.queryByRole("header", { name: "Your goal" })).toBeNull();
  });

  it("is not given again on reopening: setup at once, and no tabs", async () => {
    const server = fakeServer({ "/v1/auth/refresh": () => ({ status: 200, body: { tokens: tokens(2) } }), "/v1/users/me": notSetUp, "/v1/users/me/onboarding": nothingAnswered });
    await render(<App extra={extra} ask={server.ask} store={memoryStore(kept(1, RAVI, undefined, false))} wait={noWait} lookMs={60_000} />);
    await setupIsUp();
    expect(screen.queryByRole("tab", { name: "Dashboard" })).toBeNull();
  });

  it("the notifications box waits for setup: not over the look, nor over setup, and asked once it is finished", async () => {
    notifications.permission = ASK_NOTIFICATIONS;
    const turn = heldAppState();
    const { route } = await signIn(notSetUp, 400);
    await screen.findByRole("tab", { name: "Dashboard" });
    expect(screen.queryByText("Turn on notifications?")).toBeNull();
    await setupIsUp();
    expect(screen.queryByText("Turn on notifications?")).toBeNull();
    route.me = setUp;
    await turn("active");
    expect(await screen.findByText("Turn on notifications?")).toBeTruthy();
  });

  it("finished elsewhere while setup is up over the tabs: they are let through, and Build my own goes ahead", async () => {
    const turn = heldAppState();
    const { route } = await signIn(notSetUp);
    await setupIsUp();
    route.me = setUp;
    await turn("active");
    await waitFor(() => {
      expect(screen.queryByRole("header", { name: "Your goal" })).toBeNull();
    });
    await fireEvent.press(await screen.findByRole("tab", { name: "Food" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Build my own" }));
    await looking(SHORT);
    expect(screen.queryByRole("header", { name: "Your goal" })).toBeNull();
  });
});
