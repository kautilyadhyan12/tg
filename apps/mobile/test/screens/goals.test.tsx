import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import type { Goal } from "@app/shared";
import { App } from "../../src/App";
import type { Ask, AskInit } from "../../src/session/calls";
import { goal } from "../goalFixture";
import { RAVI, fakeServer, kept, memoryStore, profile, refusal, tokens, type Reply, type Route } from "../kit";

const extra = { copyName: "Feature 2", apiUrl: "http://localhost:3000" };
const noWait = () => Promise.resolve();
const ok = (body: unknown) => (): Reply => ({ status: 200, body });

const TRAIN = goal({ id: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d", kind: "training_days", period: "week", target: 4, current: 2 });
const MINUTES = goal({ id: "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e", kind: "active_minutes", period: "week", target: 150, current: 160, reached: true });
const PROTEIN = goal({ id: "3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f", kind: "protein", target: 140, current: 86 });
const FOOD = goal({ id: "4d5e6f7a-8b9c-4d0e-9f2a-3b4c5d6e7f80", kind: "food_logged_days", period: "week", target: 5, current: 1, setBy: "user" });
const MINOR_WEIGHT = goal({
  id: "5e6f7a8b-9c0d-4e1f-8a3b-4c5d6e7f8091",
  kind: "weight",
  direction: "at_most",
  target: null,
  current: null,
  reached: null,
  held: { code: "no_weight_loss", reasons: ["under_18"] },
});
const SQUAT = { id: "6f7a8b9c-0d1e-4f2a-9b4c-5d6e7f809102", slug: "squat", nameKey: "exercise.squat", family: "squat", tier: "T1", tracking: "pose", met: 5, difficulty: 2, equipment: null, muscles: null };
const PLANK = { ...SQUAT, id: "7a8b9c0d-1e2f-4a3b-8c5d-6e7f80910213", slug: "plank", tracking: "timer" };

/** The Dashboard's reads answer with nothing much; the goals routes are the test's. */
const quiet: Record<string, Route> = {
  "/v1/auth/refresh": ok({ tokens: tokens(2) }),
  "/v1/progress/overview": ok({ totalWorkouts: 0, totalKcal: 0, totalDurationMs: 0, avgFormScore: null, currentStreak: 0, longestStreak: 0, consistencyPct: 0, totalRuns: 0, runDurationMs: 0, runKcal: 0, limitedToDays: null }),
  "/v1/progress/trend": ok({ points: [], runDays: [], limitedToDays: 90 }),
  "/v1/workouts": ok({ items: [], nextCursor: null, limitedToDays: 90, hasAnyWorkouts: false }),
  "/v1/geo/runs": ok({ items: [], nextCursor: null }),
  "/v1/nutrition/meals": ok({ items: [], nextCursor: null }),
  "/v1/exercises": ok({ items: [SQUAT, PLANK], nextCursor: null }),
};

interface Goals {
  list: Goal[];
  /** How PUT and DELETE answer; by default as the server does. */
  put?: (id: string, body: unknown) => Reply | Promise<Reply>;
  remove?: (id: string) => Reply | Promise<Reply>;
}

/** A server holding the person's goals: GET lists them, PUT keeps one, DELETE removes one. */
function goalsServer(goals: Goals, more: Record<string, Route> = {}) {
  const server = fakeServer({ ...quiet, ...more, "/v1/goals": () => ({ status: 200, body: { goals: goals.list, max: 30 } }) });
  const ask: Ask = async (url: string, init: AskInit) => {
    const path = new URL(url).pathname;
    const id = /^\/v1\/goals\/(.+)$/.exec(path)?.[1];
    if (id === undefined) return server.ask(url, init);
    const body = init.body === undefined ? undefined : (JSON.parse(init.body) as unknown);
    server.asked.push({ method: init.method ?? "GET", path, body, headers: init.headers ?? {} });
    let reply: Reply;
    if (init.method === "DELETE") {
      reply = goals.remove === undefined ? { status: 204, body: undefined } : await goals.remove(id);
      if (reply.status === 204) goals.list = goals.list.filter((g) => g.id !== id);
    } else {
      reply = goals.put === undefined ? { status: 201, body: { goal: goal({ id, kind: "training_days", ...(body as object) }) } } : await goals.put(id, body);
      if (reply.status < 300) {
        const saved = (reply.body as { goal: Goal }).goal;
        goals.list = [...goals.list.filter((g) => g.id !== id), saved];
      }
    }
    return { ok: reply.status >= 200 && reply.status < 300, status: reply.status, json: () => Promise.resolve(reply.body) };
  };
  return { ...server, ask };
}

async function openGoals(goals: Goals, more: Record<string, Route> = {}) {
  const server = goalsServer(goals, more);
  await render(<App extra={extra} ask={server.ask} store={memoryStore(kept(1))} wait={noWait} />);
  await fireEvent.press(await screen.findByRole("button", { name: "Your Goals, View all" }));
  return server;
}

/** The page's own Add a goal, held at its foot; the Dashboard's empty box has one too. */
function pageAdd() {
  const button = screen.getAllByRole("button", { name: "Add a goal" }).at(-1);
  if (button === undefined) throw new Error("Add a goal was expected");
  return button;
}

const writes = (server: ReturnType<typeof goalsServer>) => server.asked.filter((one) => one.method === "PUT" || one.method === "DELETE");

describe("the worst thing: nobody is handed a weight to lose that the health rules hold, and nobody sees another's goals", () => {
  it("a 16-year-old's held weight goal shows no weight, says why, and offers nothing to type", async () => {
    await openGoals({ list: [MINOR_WEIGHT] });
    const row = await screen.findByRole("button", { name: "Weight, No weight loss, because you're under 18" });
    expect(screen.queryByText(/\d+ (kg|lb)/)).toBeNull();
    await fireEvent.press(row);
    expect(screen.getAllByText("No weight loss, because you're under 18").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByLabelText(/^Target/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.getByRole("button", { name: "Remove goal" })).toBeTruthy();
  });

  it("a goal the server refuses to add for the health rules is not added, and its sentence is said where Add was pressed", async () => {
    const server = await openGoals({
      list: [],
      put: () => refusal(409, "goal_held", "Your plan holds your weight steady, so it sets no weight to lose."),
    });
    await fireEvent.press(pageAdd());
    await fireEvent.press(screen.getByRole("radio", { name: "Weight" }));
    expect(screen.getByText("Your target weight in Your plan sets this goal.")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Add goal" }));
    expect(await screen.findByText("Your plan holds your weight steady, so it sets no weight to lose.")).toBeTruthy();
    expect(writes(server)).toHaveLength(1);
    expect(writes(server)[0]?.body).toEqual({ kind: "weight", period: null, target: null, exerciseId: null });
    expect(screen.queryByText("Goal added.")).toBeNull();
  });

  it("Ravi's goals, answered after he signs out, never reach Asha's Dashboard", async () => {
    const ASHA = { ...RAVI, id: "2c9e7d41-5a3b-4f6e-8d2c-1b0a9f8e7d6c", email: "asha@example.com", displayName: "Asha" };
    let letGo: (() => void) | null = null;
    const server = fakeServer({
      ...quiet,
      "/v1/auth/logout": ok({}),
      "/v1/auth/code/send": ok({ message: "Sent.", resendAfterSeconds: 60, expiresInSeconds: 600 }),
      "/v1/auth/code/verify": ok({ user: ASHA, isNewAccount: false, tokens: tokens(7) }),
      "/v1/users/me": ok(profile(true, ASHA)),
    });
    const ravis = { goals: [goal({ kind: "streak", target: 365, current: 200 })], max: 30 };
    const ashas = { goals: [goal({ kind: "protein", target: 90, current: 30 })], max: 30 };
    const ask: Ask = async (url, init) => {
      if (new URL(url).pathname !== "/v1/goals") return server.ask(url, init);
      if (init.headers?.authorization === "Bearer access-2") {
        await new Promise<void>((resolve) => (letGo = resolve));
        return { ok: true, status: 200, json: () => Promise.resolve(ravis) };
      }
      return { ok: true, status: 200, json: () => Promise.resolve(ashas) };
    };
    await render(<App extra={extra} ask={ask} store={memoryStore(kept(1))} wait={noWait} />);
    expect(await screen.findByRole("header", { name: "Ravi" })).toBeTruthy();
    await waitFor(() => {
      expect(letGo).not.toBeNull();
    });
    await fireEvent.press(screen.getByRole("tab", { name: "Me" }));
    await fireEvent.press(screen.getByRole("button", { name: "Sign out" }));
    const inTheBox = screen.getAllByRole("button", { name: "Sign out" })[1];
    if (inTheBox === undefined) throw new Error("the box's Sign out was expected");
    await fireEvent.press(inTheBox);
    await fireEvent.changeText(await screen.findByLabelText("Email"), "asha@example.com");
    await fireEvent.press(screen.getByRole("button", { name: "Continue" }));
    await fireEvent.changeText(await screen.findByLabelText("6-digit code"), "123456");
    await fireEvent.press(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText("Eat 90 g protein a day")).toBeTruthy();
    await act(async () => {
      letGo?.();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByText("Eat 90 g protein a day")).toBeTruthy();
    });
    expect(screen.queryByText(/365/)).toBeNull();
  });
});

describe("Your Goals on the Dashboard", () => {
  it("says how many are reached and shows the first three; View all opens every goal", async () => {
    const server = goalsServer({ list: [TRAIN, MINUTES, PROTEIN, FOOD] });
    await render(<App extra={extra} ask={server.ask} store={memoryStore(kept(1))} wait={noWait} />);
    expect(await screen.findByText("1 of 4 reached")).toBeTruthy();
    expect(screen.getByText("Train 4 days a week")).toBeTruthy();
    expect(screen.getByText("150 active minutes a week")).toBeTruthy();
    expect(screen.getByText("Eat 140 g protein a day")).toBeTruthy();
    expect(screen.queryByText("Log food 5 days a week")).toBeNull();

    await fireEvent.press(screen.getByRole("button", { name: "Your Goals, View all" }));
    expect(await screen.findByRole("button", { name: "Log food 5 days a week, 1 of 5 days this week" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Train 4 days a week, 2 of 4 days this week" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "150 active minutes a week, 160 of 150 minutes this week" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Eat 140 g protein a day, 86 of 140 g today" })).toBeTruthy();
  });

  it("an empty box's Add a goal opens the page with Add a goal already open", async () => {
    const server = goalsServer({ list: [] });
    await render(<App extra={extra} ask={server.ask} store={memoryStore(kept(1))} wait={noWait} />);
    expect(await screen.findByText("No goals yet.")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Add a goal" }));
    expect(await screen.findByRole("radio", { name: "Training days" })).toBeTruthy();
  });

  it("with no goals it says so, and Add a goal is there", async () => {
    await openGoals({ list: [] });
    expect(screen.getAllByText("No goals yet.").length).toBeGreaterThanOrEqual(1);
    expect(pageAdd()).toBeTruthy();
  });

  it("a failed read shows no number, and Try again reads it again", async () => {
    let up = false;
    const goals = { list: [TRAIN] };
    const server = goalsServer(goals);
    const ask: Ask = (url, init) =>
      new URL(url).pathname === "/v1/goals" && !up
        ? Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve(refusal(503, "unavailable", "Down").body) })
        : server.ask(url, init);
    await render(<App extra={extra} ask={ask} store={memoryStore(kept(1))} wait={noWait} />);
    await fireEvent.press(await screen.findByRole("button", { name: "Your Goals, View all" }));
    expect(await screen.findByText("Your goals couldn’t load.")).toBeTruthy();
    expect(screen.queryByText(/of 4/)).toBeNull();
    up = true;
    const tryAgain = screen.getAllByRole("button", { name: "Try again" }).at(-1);
    if (tryAgain === undefined) throw new Error("Try again was expected");
    await fireEvent.press(tryAgain);
    expect(await screen.findByRole("button", { name: "Train 4 days a week, 2 of 4 days this week" })).toBeTruthy();
  });
});

describe("change and remove", () => {
  it("changes the number once, however often Save is pressed, and says so", async () => {
    let answer: ((reply: Reply) => void) | null = null;
    const server = await openGoals({
      list: [TRAIN],
      put: () =>
        new Promise<Reply>((resolve) => {
          answer = resolve;
        }),
    });
    await fireEvent.press(await screen.findByRole("button", { name: "Train 4 days a week, 2 of 4 days this week" }));
    await fireEvent.changeText(screen.getByLabelText("Days a week"), "5");
    await fireEvent.press(screen.getByRole("button", { name: "Save" }));
    await fireEvent.press(screen.getByRole("button", { name: "Save" }));
    expect(writes(server)).toHaveLength(1);
    expect(writes(server)[0]).toMatchObject({ method: "PUT", path: `/v1/goals/${TRAIN.id}`, body: { kind: "training_days", period: "week", target: 5, exerciseId: null } });
    await act(async () => {
      answer?.({ status: 200, body: { goal: { ...TRAIN, target: 5 } } });
      await Promise.resolve();
    });
    expect(await screen.findByText("Goal saved.")).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Train 5 days a week, 2 of 5 days this week" })).toBeTruthy();
  });

  it("a number too big is not sent, and the box says the range", async () => {
    const server = await openGoals({ list: [TRAIN] });
    await fireEvent.press(await screen.findByRole("button", { name: "Train 4 days a week, 2 of 4 days this week" }));
    await fireEvent.changeText(screen.getByLabelText("Days a week"), "9");
    await fireEvent.press(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("Enter a number from 1 to 7.")).toBeTruthy();
    expect(writes(server)).toEqual([]);
  });

  it("a new period starts from its own number", async () => {
    const server = await openGoals({ list: [TRAIN] });
    await fireEvent.press(await screen.findByRole("button", { name: "Train 4 days a week, 2 of 4 days this week" }));
    await fireEvent.press(screen.getByRole("radio", { name: "Month" }));
    expect(screen.getByLabelText("Days a month").props.value).toBe("12");
    await fireEvent.press(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(writes(server)[0]?.body).toEqual({ kind: "training_days", period: "month", target: 12, exerciseId: null });
    });
  });

  it("Remove asks first; Cancel removes nothing; Remove removes it once", async () => {
    const server = await openGoals({ list: [TRAIN, PROTEIN] });
    await fireEvent.press(await screen.findByRole("button", { name: "Eat 140 g protein a day, 86 of 140 g today" }));
    // The rings' own number: nothing to type here.
    expect(screen.getByText("Your plan sets this number.")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Remove goal" }));
    expect(screen.getByText("Remove this goal?")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Cancel" }));
    expect(writes(server)).toEqual([]);
    await fireEvent.press(screen.getByRole("button", { name: "Remove goal" }));
    await fireEvent.press(screen.getByRole("button", { name: "Remove" }));
    expect(await screen.findByText("Goal removed.")).toBeTruthy();
    expect(writes(server)).toEqual([expect.objectContaining({ method: "DELETE", path: `/v1/goals/${PROTEIN.id}`, body: undefined })]);
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /^Eat 140 g protein/ })).toBeNull();
    });
    expect(screen.getByRole("button", { name: /^Train 4 days a week/ })).toBeTruthy();
  });

  it("a removal whose reply was lost, sent again, reads 404 and is done", async () => {
    await openGoals({ list: [PROTEIN], remove: () => refusal(404, "not_found", "Goal not found.") });
    await fireEvent.press(await screen.findByRole("button", { name: /^Eat 140 g protein/ }));
    await fireEvent.press(screen.getByRole("button", { name: "Remove goal" }));
    await fireEvent.press(screen.getByRole("button", { name: "Remove" }));
    expect(await screen.findByText("Goal removed.")).toBeTruthy();
  });

  it("no connection keeps the goal and says so in the box", async () => {
    const server = await openGoals({
      list: [TRAIN],
      put: () => {
        throw new TypeError("Network request failed");
      },
    });
    await fireEvent.press(await screen.findByRole("button", { name: /^Train 4 days a week/ }));
    await fireEvent.press(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("No connection. Try again.")).toBeTruthy();
    expect(writes(server)).toHaveLength(1);
    expect(screen.queryByText("Goal saved.")).toBeNull();
  });
});

describe("add a goal", () => {
  it("offers only what the person can still add, opens filled in, and adds it once under one id of the phone's", async () => {
    let answer: (() => void) | null = null;
    const goals: Goals = { list: [PROTEIN, TRAIN] };
    goals.put = (id, body) =>
      new Promise<Reply>((resolve) => {
        answer = () => {
          resolve({ status: 201, body: { goal: goal({ id, kind: "training_days", target: 12, current: 2, ...(body as object) }) } });
        };
      });
    const server = await openGoals(goals);
    await fireEvent.press(pageAdd());
    // Protein has one period and is kept already; training days still has month and year.
    expect(screen.queryByRole("radio", { name: "Protein" })).toBeNull();
    await fireEvent.press(screen.getByRole("radio", { name: "Training days" }));
    expect(screen.queryByRole("radio", { name: "Week" })).toBeNull();
    expect(screen.getByRole("radio", { name: "Month", selected: true })).toBeTruthy();
    expect(screen.getByLabelText("Days a month").props.value).toBe("12");
    await fireEvent.press(screen.getByRole("button", { name: "Add goal" }));
    await fireEvent.press(screen.getByRole("button", { name: "Add goal" }));
    // Pressed twice while the first is away: sent once.
    const puts = writes(server);
    expect(puts).toHaveLength(1);
    await act(async () => {
      answer?.();
      await Promise.resolve();
    });
    expect(await screen.findByText("Goal added.")).toBeTruthy();
    expect(puts[0]?.path).toMatch(/^\/v1\/goals\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(puts[0]?.body).toEqual({ kind: "training_days", period: "month", target: 12, exerciseId: null });
    expect(goals.list).toHaveLength(3);
  });

  it("Add pressed again after a lost reply is sent under the same id, so it is still one goal", async () => {
    let first = true;
    const server = await openGoals({
      list: [],
      put: (id, body) => {
        if (first) {
          first = false;
          throw new TypeError("Network request failed");
        }
        return { status: 201, body: { goal: goal({ id, kind: "streak", target: 7, current: 0, ...(body as object) }) } };
      },
    });
    await fireEvent.press(pageAdd());
    await fireEvent.press(screen.getByRole("radio", { name: "Streak" }));
    await fireEvent.press(screen.getByRole("button", { name: "Add goal" }));
    expect(await screen.findByText("No connection. Try again.")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Add goal" }));
    expect(await screen.findByText("Goal added.")).toBeTruthy();
    const paths = writes(server).map((one) => one.path);
    expect(paths).toHaveLength(2);
    expect(paths[0]).toBe(paths[1]);
  });

  it("reps in one set names an exercise the camera counts in reps", async () => {
    const server = await openGoals({
      list: [],
      put: (id, body) => ({ status: 201, body: { goal: goal({ id, kind: "reps_in_set", exerciseSlug: "squat", target: 10, current: null, reached: false, ...(body as object) }) } }),
    });
    await fireEvent.press(pageAdd());
    await fireEvent.press(screen.getByRole("radio", { name: "Reps in one set" }));
    await fireEvent.press(screen.getByRole("button", { name: "Add goal" }));
    expect(screen.getByText("Pick an exercise.")).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Squat" })).toBeTruthy();
    // A timed hold has no reps.
    expect(screen.queryByRole("button", { name: "Plank" })).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Squat" }));
    await fireEvent.press(screen.getByRole("button", { name: "Add goal" }));
    expect(await screen.findByText("Goal added.")).toBeTruthy();
    expect(writes(server)[0]?.body).toEqual({ kind: "reps_in_set", period: null, target: 10, exerciseId: SQUAT.id });
  });
});

describe("a goal whose number is setup's opens setup on that answer", () => {
  const answers = {
    displayName: "Ravi",
    weightGoal: "gain",
    fitnessGoals: [],
    age: null,
    gender: null,
    heightCm: null,
    weightKg: 70,
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
  const setup = {
    "/v1/users/me/onboarding": ok({
      answers,
      plan: null,
      missing: ["age", "gender", "heightCm", "targetWeightKg", "pace", "dayActivity", "trainingDays", "sessionMinutes"],
    }),
  };
  const WANTS_TARGET = goal({ kind: "weight", direction: "at_least", target: null, current: 70, reached: null, needs: "target_weight" });

  it("Set target opens setup on Your target; closing it reads the goals again", async () => {
    const server = await openGoals({ list: [WANTS_TARGET] }, setup);
    expect(await screen.findByText("Pick a target weight to set this goal")).toBeTruthy();
    const before = server.paths().filter((p) => p === "/v1/goals").length;
    await fireEvent.press(screen.getByRole("button", { name: "Set target" }));
    expect(await screen.findByRole("header", { name: "Your target" })).toBeTruthy();
    await fireEvent.press(within(screen.getByTestId("setup")).getByRole("button", { name: "Close" }));
    await waitFor(() => {
      expect(server.paths().filter((p) => p === "/v1/goals").length).toBeGreaterThan(before);
    });
  });

  it("adding Weight says the target is Your plan's, and Change target opens it there", async () => {
    await openGoals({ list: [] }, setup);
    await fireEvent.press(pageAdd());
    await fireEvent.press(screen.getByRole("radio", { name: "Weight" }));
    expect(screen.getByText("Your target weight in Your plan sets this goal.")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Change target" }));
    expect(await screen.findByRole("header", { name: "Your target" })).toBeTruthy();
  });

  it("Protein's number is the plan's: See your plan opens setup", async () => {
    await openGoals({ list: [PROTEIN] }, setup);
    await fireEvent.press(await screen.findByRole("button", { name: /^Eat 140 g protein/ }));
    await fireEvent.press(screen.getByRole("button", { name: "See your plan" }));
    expect(await screen.findByTestId("setup")).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: /a day$/ })).toBeNull();
  });
});

describe("check-ins are a gym's: offered only to a member of a place", () => {
  const IRON = {
    id: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
    name: "Iron House",
    city: "Pune",
    orgType: "gym",
    slug: "iron-house",
    timezone: "Asia/Kolkata",
    locale: "en",
    currencyDisplay: "INR",
    status: "active",
    staffRole: null,
    isMember: true,
    joinedAt: "2026-10-01T00:00:00.000Z",
  };

  it("somebody in no gym is not offered Check-ins", async () => {
    await openGoals({ list: [] });
    await fireEvent.press(pageAdd());
    expect(screen.getByRole("radio", { name: "Training days" })).toBeTruthy();
    expect(screen.queryByRole("radio", { name: "Check-ins" })).toBeNull();
  });

  it("a member of a gym is", async () => {
    await openGoals({ list: [] }, { "/v1/orgs/mine": ok({ orgs: [IRON], formerOrgs: [] }) });
    await fireEvent.press(pageAdd());
    expect(await screen.findByRole("radio", { name: "Check-ins" })).toBeTruthy();
  });
});
