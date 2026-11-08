import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { AccessibilityInfo, AppState } from "react-native";
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
const hidden = { includeHiddenElements: true };

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

type Node = { props: Record<string, unknown>; parent: Node | null };
/** The look's cover round a page's button, or null: what takes a touch before the button can. */
function coverOf(element: Node): Node | null {
  for (let at = element.parent; at !== null; at = at.parent) if (at.props.testID === "look only") return at;
  return null;
}
const covered = (element: Node) => {
  const cover = coverOf(element);
  if (cover === null) throw new Error("no cover");
  return cover;
};
const touchAndLetGo = async (cover: Node) => {
  await act(async () => {
    expect((cover.props.onStartShouldSetResponderCapture as () => boolean)()).toBe(true);
    (cover.props.onResponderRelease as () => void)();
    await Promise.resolve();
  });
};
const setupIsUp = async () => {
  expect(await screen.findByRole("header", { name: "Your goal" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
};
/** What a person who has not finished setup must not start: a run, a meal, a plan. */
const started = (server: { asked: { method: string; path: string }[] }) =>
  server.asked.filter((one) => one.method !== "GET" && /\/(runs|meals|diet-plan|workouts)/.test(one.path));

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the worst thing: nobody starts a workout, run, meal or plan before the health question and their age", () => {
  // Each tab's page, and a button on it that would start something, or open what does.
  it.each([
    ["Dashboard", "Start Training"],
    ["Workout", "Running"],
    ["Food", "Scan food"],
  ])("on %s, %s is under the look's cover, and a touch there opens setup, never the button", async (tab, button) => {
    const { server } = await signIn(notSetUp, 60_000);
    await fireEvent.press(await screen.findByRole("tab", { name: tab }));
    const [pressable, ...more] = await screen.findAllByRole("button", { name: button, ...hidden });
    if (pressable === undefined) throw new Error("no button");
    for (const one of more) expect(coverOf(one as unknown as Node)).not.toBeNull();
    // Hidden from a screen reader too, whose double tap would press the button itself.
    expect(screen.queryAllByRole("button", { name: button })).toEqual([]);
    await touchAndLetGo(covered(pressable));
    await setupIsUp();
    expect(started(server)).toEqual([]);
  });

  it("the tab bar is not covered: the person moves between tabs while looking", async () => {
    await signIn(notSetUp, 60_000);
    for (const tab of ["Workout", "Food", "Me", "Dashboard"]) {
      const bar = await screen.findByRole("tab", { name: tab });
      expect(coverOf(bar as unknown as Node)).toBeNull();
      await fireEvent.press(bar);
    }
    expect(screen.queryByRole("header", { name: "Your goal" })).toBeNull();
  });
});

describe("the look", () => {
  it("is the Dashboard first, covered, with no setup yet", async () => {
    await signIn(notSetUp, 60_000);
    expect(await screen.findByRole("tab", { name: "Dashboard" })).toBeTruthy();
    const [button] = await screen.findAllByRole("button", { name: "Start Training", ...hidden });
    if (button === undefined) throw new Error("no button");
    expect(coverOf(button)).not.toBeNull();
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

  it("is skipped with a screen reader on: setup at once", async () => {
    jest.spyOn(AccessibilityInfo, "isScreenReaderEnabled").mockResolvedValue(true);
    await signIn(notSetUp, 60_000);
    await setupIsUp();
  });

  it("is never given to somebody set up: no cover, and no setup", async () => {
    await signIn(setUp);
    const buttons = await screen.findAllByRole("button", { name: "Start Training" });
    for (const one of buttons) expect(coverOf(one as unknown as Node)).toBeNull();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, SHORT * 3));
    });
    expect(screen.queryByRole("header", { name: "Your goal" })).toBeNull();
  });

  it("is not given again on reopening: setup at once, and no tabs", async () => {
    const server = fakeServer({ "/v1/auth/refresh": () => ({ status: 200, body: { tokens: tokens(2) } }), "/v1/users/me": notSetUp, "/v1/users/me/onboarding": nothingAnswered });
    await render(<App extra={extra} ask={server.ask} store={memoryStore(kept(1, RAVI, undefined, false))} wait={noWait} lookMs={60_000} />);
    await setupIsUp();
    expect(screen.queryByRole("tab", { name: "Dashboard" })).toBeNull();
  });

  it("finished elsewhere while setup is up over the tabs: they are let through, uncovered", async () => {
    const turn = heldAppState();
    const { route } = await signIn(notSetUp);
    await setupIsUp();
    route.me = setUp;
    await turn("active");
    await waitFor(() => {
      expect(screen.queryByRole("header", { name: "Your goal" })).toBeNull();
    });
    const buttons = await screen.findAllByRole("button", { name: "Start Training" });
    for (const one of buttons) expect(coverOf(one as unknown as Node)).toBeNull();
  });
});
