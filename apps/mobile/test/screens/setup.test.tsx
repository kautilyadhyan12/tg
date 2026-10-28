import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { AppState } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { CHECK_FIRST_PICK, CURRENT_DISCLAIMER_VERSION, DISCLAIMER_WORDINGS, deriveHealthFlags, missingPlanInputSchema, type OnboardingAnswers } from "@app/shared";
import { App } from "../../src/App";
import { SessionProvider, useSession } from "../../src/session/SessionProvider";
import { Setup } from "../../src/screens/setup/Setup";
import { ANSWER_FAILED, NOTE_VERSION, PLAN_NOTE_VERSION, TICK_FAILED } from "../../src/screens/setup/useHealthStep";
import { LOAD_FAILED, SAVE_FAILED } from "../../src/screens/setup/useSetupAnswers";
import { RAVI, fakeServer, kept, lost, memoryStore, profile, refusal, tokens, type Reply } from "../kit";

const extra = { copyName: "Feature 1", apiUrl: "http://localhost:3000" };
const NOTE_VERSION_SIGN_UP = CURRENT_DISCLAIMER_VERSION.sign_up;
const noWait = () => Promise.resolve();
/** The distance between two ticks of a scale. */
const TICK = 12;

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

/** The api's golden person (users.onboarding.routes.test.ts), working and all. */
const PLAN = {
  restingBurnKcal: 1420,
  dailyBurnKcal: 1817,
  targetKcal: 1267,
  dailyChangeKcal: -550,
  dailyChangeKcalByPace: { gentle: -275, steady: -550, brisk: -617 },
  proteinG: 140,
  carbsG: 98,
  fatG: 35,
  plannedTargetKg: 65,
  daysToTarget: 70,
  finishDate: "2026-11-19",
  flags: [],
  workings: {
    resting: { formula: "female", weightKg: 70, heightCm: 165, age: 30, constant: -161, kcal: 1420 },
    day: { activity: "sitting", factor: 1.2, kcal: 1704 },
    training: { kcalPerKgHour: 5, weightKg: 70, trainingDays: 3, sessionMinutes: 45, kcal: 113 },
    change: { pace: "steady", kgPerWeek: 0.5, kcalPerKg: 7700, kcal: -550 },
    beforeFloorKcal: 1267,
    floorKcal: 1200,
    protein: { gPerKg: 2, weightKg: 70, referenceBmi: null, wantedG: 140, buildMuscle: false },
    fatShare: 0.25,
    carbsFloorG: 50,
    finish: { kgToMove: 5, kcalPerKg: 7700 },
  },
};

const ALL: Partial<OnboardingAnswers> = {
  weightGoal: "lose",
  age: 30,
  gender: "female",
  heightCm: 165,
  weightKg: 70,
  targetWeightKg: 65,
  pace: "steady",
  dayActivity: "sitting",
  fitnessLevel: "beginner",
  trainingDays: 3,
  sessionMinutes: 45,
  availableEquipment: ["dumbbells"],
  trainingPlaces: ["home"],
};

function missingOf(a: OnboardingAnswers): string[] {
  const moves = a.weightGoal === "lose" || a.weightGoal === "gain";
  const present: Record<string, boolean> = {
    goal: a.weightGoal !== null,
    age: a.age !== null,
    gender: a.gender !== null,
    heightCm: a.heightCm !== null,
    weightKg: a.weightKg !== null,
    targetWeightKg: !moves || a.targetWeightKg !== null,
    pace: !moves || a.pace !== null,
    dayActivity: a.dayActivity !== null,
    trainingDays: a.trainingDays !== null,
    sessionMinutes: a.sessionMinutes !== null,
  };
  return missingPlanInputSchema.options.filter((k) => present[k] !== true);
}

const SETUP = "/v1/users/me/onboarding";
const HEALTH = "/v1/users/me/health-screening";
const CONSENTS = "/v1/users/me/consents";

type Stored = { hasCondition: boolean; checkFirst: "cleared" | "not_yet" | null } | null;
const screeningOf = (stored: Stored) =>
  stored === null
    ? { answered: false, hasCondition: null, checkFirst: null, safeMode: false, noCalorieCut: false, updatedAt: null }
    : { answered: true, ...stored, ...deriveHealthFlags(stored), updatedAt: "2026-10-28T09:00:00.000Z" };
const consentRow = (purpose: string, wordingVersion: string) => ({
  id: "6f1c1d1e-2a3b-4c5d-8e9f-0a1b2c3d4e5f",
  purpose,
  wordingVersion,
  wording: "The words.",
  appVersion: "1.0.0",
  recordedAt: "2026-10-28T09:00:00.000Z",
});

// Setup starts in the phone's own units (pounds on a US phone), so each test says which phone it is.
const realOptions = new Intl.DateTimeFormat().resolvedOptions();
let phoneLanguage = "en-IN";
beforeEach(() => {
  phoneLanguage = "en-IN";
  jest.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockImplementation(() => ({ ...realOptions, locale: phoneLanguage }));
});
afterEach(() => {
  jest.restoreAllMocks();
});

/** Signed in on this phone already, on Me, with setup opened from "Your plan"; or, `front`, as the
 *  app opens for somebody who has not finished setup. The stand-in keeps what each save sends;
 *  `failNext` refuses the next save. A finish is refused, as the server refuses it, while an answer
 *  setup needs is not stored, naming what is open; `invitations` are waiting. */
async function openSetup(
  start: Partial<OnboardingAnswers> = {},
  {
    health = null,
    ticks = [],
    healthLoadFails = false,
    front = false,
    invitations = [],
  }: {
    health?: Stored;
    ticks?: { purpose: string; wordingVersion: string }[];
    healthLoadFails?: boolean;
    front?: boolean;
    invitations?: object[];
  } = {},
) {
  const held = {
    answers: { ...EMPTY, ...start },
    failNext: false,
    health,
    failHealth: false,
    /** The next health save waits until `release` is called: true lands it, false refuses it. */
    holdHealth: false,
    release: (ok: boolean): void => {
      void ok;
    },
    failHealthLoad: healthLoadFails,
    failTick: false,
    ticks: ticks.map((t) => consentRow(t.purpose, t.wordingVersion)),
  };
  const reply = (): Reply => {
    const missing = missingOf(held.answers);
    return { status: 200, body: { answers: { ...held.answers }, plan: missing.length > 0 ? null : PLAN, missing } };
  };
  const server = fakeServer({
    "/v1/auth/refresh": () => ({ status: 200, body: { tokens: tokens(2) } }),
    "/v1/users/me": () => ({ status: 200, body: profile(true, RAVI, held.answers.onboardingCompleted) }),
    "/v1/orgs/invitations": () => ({ status: 200, body: { address: RAVI.email, addressProved: true, invitations } }),
    [SETUP]: (body) => {
      if (body !== undefined && held.failNext) {
        held.failNext = false;
        return refusal(400, "validation_failed", "Not saved.");
      }
      if (typeof body === "object" && body !== null && "onboardingCompleted" in body) {
        const open = [
          ...missingOf(held.answers),
          ...(held.health === null ? ["health"] : []),
          ...(held.answers.diet === null ? ["diet"] : []),
          ...(held.answers.mealsPerDay === null ? ["mealsPerDay"] : []),
        ];
        if (open.length > 0) return refusal(409, "onboarding_incomplete", "Finish setup first.", { missing: open });
      }
      if (typeof body === "object" && body !== null) Object.assign(held.answers, body);
      return reply();
    },
    [HEALTH]: (body) => {
      if (body === undefined && held.failHealthLoad) {
        held.failHealthLoad = false;
        return refusal(503, "unavailable", "Not now.");
      }
      if (body !== undefined && held.holdHealth) {
        held.holdHealth = false;
        return new Promise<Reply>((resolve) => {
          held.release = (ok) => {
            if (ok) held.health = body as Stored;
            resolve(ok ? { status: 200, body: { healthScreening: screeningOf(held.health) } } : refusal(503, "unavailable", "Not saved."));
          };
        });
      }
      if (body !== undefined) {
        if (held.failHealth) {
          held.failHealth = false;
          return refusal(503, "unavailable", "Not saved.");
        }
        held.health = body as Stored;
        if (held.health !== null) held.health = { hasCondition: held.health.hasCondition, checkFirst: held.health.checkFirst ?? null };
      }
      return { status: 200, body: { healthScreening: screeningOf(held.health) } };
    },
    [CONSENTS]: (body) => {
      if (body === undefined) return { status: 200, body: { consents: held.ticks, total: held.ticks.length } };
      if (held.failTick) {
        held.failTick = false;
        return refusal(503, "unavailable", "Not now.");
      }
      const row = consentRow((body as { purpose: string }).purpose, (body as { wordingVersion: string }).wordingVersion);
      held.ticks.unshift(row);
      return { status: 201, body: { consent: row } };
    },
  });
  const store = memoryStore(kept(1, RAVI, NOTE_VERSION_SIGN_UP, !front));
  await render(<App extra={extra} ask={server.ask} store={store} wait={noWait} />);
  if (!front) {
    await fireEvent.press(await screen.findByRole("tab", { name: "Me" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Your plan" }));
  }
  if (front) {
    // "You're invited" comes first for an invitation waiting; Not now goes on to setup.
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Not now" }) ??
          screen.queryByLabelText(/^Step \d+ of \d+$/) ??
          screen.queryByRole("tab", { name: "Dashboard" }),
      ).toBeTruthy();
    });
    const later = screen.queryByRole("button", { name: "Not now" });
    if (later !== null) await fireEvent.press(later);
    await waitFor(() => {
      expect(screen.queryByLabelText(/^Step \d+ of \d+$/) ?? screen.queryByRole("tab", { name: "Dashboard" })).toBeTruthy();
    });
  } else if (healthLoadFails) await screen.findByText(LOAD_FAILED);
  else await screen.findByLabelText(/^Step \d+ of \d+$/);
  const saves = () => server.asked.filter((one) => one.path === SETUP && one.body !== undefined).map((one) => one.body);
  const healthSaves = () => server.asked.filter((one) => one.path === HEALTH && one.body !== undefined).map((one) => one.body);
  const tickSaves = () => server.asked.filter((one) => one.path === CONSENTS && one.body !== undefined).map((one) => one.body);
  return { server, held, saves, healthSaves, tickSaves, store };
}

const press = (name: string | RegExp) => fireEvent.press(screen.getByRole("button", { name }));
const selected = (name: string | RegExp): unknown => {
  const state: unknown = screen.getByRole("button", { name }).props.accessibilityState;
  return typeof state === "object" && state !== null && "selected" in state ? state.selected : undefined;
};
const disabled = (name: string | RegExp): unknown => {
  const state: unknown = screen.getByRole("button", { name }).props.accessibilityState;
  return typeof state === "object" && state !== null && "disabled" in state ? state.disabled : undefined;
};
/** The person's own slide on a scale, let go on `row`. */
const slide = async (scale: string, row: number) => {
  const list = screen.getByTestId(`${scale} scale`);
  await fireEvent(list, "scrollBeginDrag");
  await fireEvent(list, "scrollEndDrag", { nativeEvent: { contentOffset: { x: 0, y: 0 }, velocity: { x: 2, y: 0 } } });
  await fireEvent(list, "momentumScrollEnd", { nativeEvent: { contentOffset: { x: row * TICK, y: 0 } } });
};
/** A screen reader's one step along a scale. */
const step = (scale: string, actionName: "increment" | "decrement") =>
  fireEvent(screen.getByLabelText(scale), "accessibilityAction", { nativeEvent: { actionName } });
const stepOf = (): unknown => screen.getByLabelText(/^Step \d+ of \d+$/).props.accessibilityLabel;

describe("the worst thing: nobody's plan is built on an age, height or weight they never picked", () => {
  it("About you opens with every scale Not set, and opening it saves nothing", async () => {
    const { saves } = await openSetup({ weightGoal: "maintain" });
    expect(await screen.findByRole("header", { name: "About you" })).toBeTruthy();
    expect(screen.getAllByText("Not set")).toHaveLength(3);
    expect(saves()).toEqual([]);
  });

  it("a scale moving itself to a row picks nothing: a settle with no slide of the person's before it", async () => {
    const { saves } = await openSetup({ weightGoal: "maintain" });
    await screen.findByRole("header", { name: "About you" });
    for (const scale of ["Age", "Height", "Weight"]) {
      await fireEvent(screen.getByTestId(`${scale} scale`), "momentumScrollEnd", {
        nativeEvent: { contentOffset: { x: 40 * TICK, y: 0 } },
      });
    }
    expect(saves()).toEqual([]);
    expect(screen.getAllByText("Not set")).toHaveLength(3);
  });

  it("a units switch moves the scales and saves nothing", async () => {
    const { saves } = await openSetup({ weightGoal: "maintain" });
    await screen.findByRole("header", { name: "About you" });
    await press("Pounds, feet and inches");
    await press("Kilograms and centimetres");
    expect(saves()).toEqual([]);
  });

  it("only the person's own slide saves, the row it was let go on", async () => {
    const { saves } = await openSetup({ weightGoal: "maintain" });
    await screen.findByRole("header", { name: "About you" });
    await slide("Age", 22);
    await waitFor(() => {
      expect(saves()).toEqual([{ age: 40 }]);
    });
    expect(screen.getByText("40 years")).toBeTruthy();
  });

  it("a scale let go slowly, with no flick after it, saves the row it stopped on", async () => {
    const { saves } = await openSetup({ weightGoal: "maintain" });
    await screen.findByRole("header", { name: "About you" });
    const list = screen.getByTestId("Height scale");
    await fireEvent(list, "scrollBeginDrag");
    await fireEvent(list, "scrollEndDrag", { nativeEvent: { contentOffset: { x: 72 * TICK, y: 0 }, velocity: { x: 0, y: 0 } } });
    await waitFor(() => {
      expect(saves()).toEqual([{ heightCm: 172 }]);
    });
  });

  it("the resting row is saved only when the person moves the scale", async () => {
    const { saves } = await openSetup({ weightGoal: "maintain" });
    await screen.findByRole("header", { name: "About you" });
    await step("Weight", "increment");
    await waitFor(() => {
      expect(saves()).toEqual([{ weightKg: 70.1 }]);
    });
    expect(screen.getByText("70.1 kg")).toBeTruthy();
  });
});

// Everything but screen 9's food, with the health question answered and its note ticked or not.
const BEFORE_FOOD: Partial<OnboardingAnswers> = { ...ALL };
const TICKED = [{ purpose: "health_step", wordingVersion: NOTE_VERSION }];
const tickBox = () => screen.getByRole("checkbox", { name: "I have read and understood this" });
const ticked = (): unknown => {
  const state: unknown = tickBox().props.accessibilityState;
  return typeof state === "object" && state !== null && "checked" in state ? state.checked : undefined;
};
const NOT_YET = /^Not yet\./;
const CLEARED = /^A professional has cleared me\./;

describe("the worst thing: a health answer is saved exactly as the person tapped it", () => {
  it("Yes saves nothing until Check first is picked; Not yet is saved as Safe mode and the daily number is read again", async () => {
    const { healthSaves, saves, held } = await openSetup(BEFORE_FOOD);
    expect(await screen.findByRole("header", { name: "Health" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: NOT_YET })).toBeNull();
    await press("Yes");
    expect(await screen.findByText(CHECK_FIRST_PICK)).toBeTruthy();
    expect(healthSaves()).toEqual([]);
    expect(disabled("Continue")).toBe(true);
    await press(NOT_YET);
    await waitFor(() => {
      expect(healthSaves()).toEqual([{ hasCondition: true, checkFirst: "not_yet" }]);
    });
    expect(held.health).toEqual({ hasCondition: true, checkFirst: "not_yet" });
    await waitFor(() => {
      expect(saves()).toEqual([{}]);
    });
    expect(selected(NOT_YET)).toBe(true);
    expect(selected("Yes")).toBe(true);
    expect(screen.queryByText(CHECK_FIRST_PICK)).toBeNull();
  });

  it("No is saved as a no with no Check first, and cleared as cleared", async () => {
    const { healthSaves } = await openSetup(BEFORE_FOOD);
    await screen.findByRole("header", { name: "Health" });
    await press("No");
    await waitFor(() => {
      expect(healthSaves()).toEqual([{ hasCondition: false }]);
    });
    await press("Yes");
    await press(CLEARED);
    await waitFor(() => {
      expect(healthSaves()).toEqual([{ hasCondition: false }, { hasCondition: true, checkFirst: "cleared" }]);
    });
    // The same answer again sends nothing.
    await press(CLEARED);
    await press("Yes");
    expect(healthSaves()).toHaveLength(2);
  });

  it("an answer the server did not take goes back to the stored one, and says so", async () => {
    const { held } = await openSetup(BEFORE_FOOD, { health: { hasCondition: false, checkFirst: null } });
    await screen.findByRole("header", { name: "Health" });
    expect(selected("No")).toBe(true);
    held.failHealth = true;
    await press("Yes");
    await press(NOT_YET);
    expect(await screen.findByText(ANSWER_FAILED)).toBeTruthy();
    expect(selected("No")).toBe(true);
    expect(selected("Yes")).toBe(false);
    expect(held.health).toEqual({ hasCondition: false, checkFirst: null });
  });

  it("a stored Not yet opens as it was left, Safe mode picked", async () => {
    await openSetup(BEFORE_FOOD, { health: { hasCondition: true, checkFirst: "not_yet" } });
    await screen.findByRole("header", { name: "Health" });
    expect(selected("Yes")).toBe(true);
    expect(selected(NOT_YET)).toBe(true);
    expect(selected(CLEARED)).toBe(false);
  });
});

describe("round one: nobody leaves Health on an answer the server does not hold", () => {
  const STORED_NO = { health: { hasCondition: false, checkFirst: null }, ticks: TICKED } as const;
  const onHealth = async (opts: Parameters<typeof openSetup>[1]) => {
    const set = await openSetup(BEFORE_FOOD, opts);
    await screen.findByRole("header", { name: "Food" });
    await press("Back");
    await screen.findByRole("header", { name: "Health" });
    return set;
  };

  it("Continue is held while an answer saves; a refused one is said under Continue and the stored No stays", async () => {
    const { held } = await onHealth({ ...STORED_NO });
    expect(disabled("Continue")).toBe(false);
    held.holdHealth = true;
    await press("Yes");
    await press(NOT_YET);
    await waitFor(() => {
      expect(disabled("Continue")).toBe(true);
    });
    expect(disabled("No")).toBe(true);
    expect(disabled("Yes")).toBe(true);
    expect(disabled(CLEARED)).toBe(true);
    held.release(false);
    expect(await screen.findByText(ANSWER_FAILED)).toBeTruthy();
    expect(selected("No")).toBe(true);
    expect(held.health).toEqual({ hasCondition: false, checkFirst: null });
    expect(screen.getByRole("header", { name: "Health" })).toBeTruthy();
  });

  it("Yes tapped over a stored No holds Continue until Check first is picked, or No is tapped again", async () => {
    const { healthSaves } = await onHealth({ ...STORED_NO });
    await press("Yes");
    expect(selected("Yes")).toBe(true);
    expect(disabled("Continue")).toBe(true);
    await press("No");
    expect(disabled("Continue")).toBe(false);
    expect(healthSaves()).toEqual([]);
    await press("Yes");
    await press(CLEARED);
    await waitFor(() => {
      expect(disabled("Continue")).toBe(false);
    });
    expect(healthSaves()).toEqual([{ hasCondition: true, checkFirst: "cleared" }]);
  });

  it("a tick on older words is asked again, and ticking it keeps the person on Health", async () => {
    await openSetup(BEFORE_FOOD, { health: { hasCondition: false, checkFirst: null }, ticks: [{ purpose: "health_step", wordingVersion: "v1" }] });
    await screen.findByRole("header", { name: "Health" });
    await fireEvent.press(tickBox());
    await waitFor(() => {
      expect(ticked()).toBe(true);
    });
    expect(screen.getByRole("header", { name: "Health" })).toBeTruthy();
    expect(disabled("Continue")).toBe(false);
  });

  it("a tick the server refuses stays unticked, says so, and Continue stays held", async () => {
    const { held } = await openSetup(BEFORE_FOOD, { health: { hasCondition: false, checkFirst: null } });
    await screen.findByRole("header", { name: "Health" });
    held.failTick = true;
    await fireEvent.press(tickBox());
    expect(await screen.findByText(TICK_FAILED)).toBeTruthy();
    expect(ticked()).toBe(false);
    expect(disabled("Continue")).toBe(true);
  });

  it("a tick held with the question unanswered does not open Continue", async () => {
    await openSetup(BEFORE_FOOD, { ticks: TICKED });
    await screen.findByRole("header", { name: "Health" });
    expect(ticked()).toBe(true);
    expect(disabled("Continue")).toBe(true);
  });

  it("a health answer that does not load shows no screen, and Try again loads it", async () => {
    await openSetup(BEFORE_FOOD, { healthLoadFails: true });
    expect(screen.queryByLabelText(/^Step \d+ of \d+$/)).toBeNull();
    await press("Try again");
    expect(await screen.findByRole("header", { name: "Health" })).toBeTruthy();
  });
});

describe("the health note's tick and Food", () => {
  it("Continue waits for the answer and the tick; the tick is kept with today's words", async () => {
    const { tickSaves } = await openSetup(BEFORE_FOOD);
    await screen.findByRole("header", { name: "Health" });
    expect(screen.getByText(DISCLAIMER_WORDINGS.health_step[NOTE_VERSION] ?? "")).toBeTruthy();
    await press("No");
    await waitFor(() => {
      expect(selected("No")).toBe(true);
    });
    expect(disabled("Continue")).toBe(true);
    expect(screen.getByText("Tick this to continue.")).toBeTruthy();
    await fireEvent.press(tickBox());
    await waitFor(() => {
      expect(ticked()).toBe(true);
    });
    expect(tickSaves()).toEqual([{ purpose: "health_step", wordingVersion: NOTE_VERSION, appVersion: expect.any(String) as unknown }]);
    expect(disabled("Continue")).toBe(false);
    await press("Continue");
    expect(await screen.findByRole("header", { name: "Food" })).toBeTruthy();
  });

  it("a tick the server holds on today's words is shown ticked; one on older words is asked again", async () => {
    await openSetup(BEFORE_FOOD, { health: { hasCondition: false, checkFirst: null }, ticks: TICKED });
    expect(await screen.findByRole("header", { name: "Food" })).toBeTruthy();
    await press("Back");
    await screen.findByRole("header", { name: "Health" });
    expect(ticked()).toBe(true);
    await screen.unmount();
    await openSetup(BEFORE_FOOD, { health: { hasCondition: false, checkFirst: null }, ticks: [{ purpose: "health_step", wordingVersion: "v1" }] });
    expect(await screen.findByRole("header", { name: "Health" })).toBeTruthy();
    expect(ticked()).toBe(false);
  });

  it("Food saves the diet and the meals a day, and Continue goes on to the plan once both are saved", async () => {
    const { saves } = await openSetup(BEFORE_FOOD, { health: { hasCondition: false, checkFirst: null }, ticks: TICKED });
    await screen.findByRole("header", { name: "Food" });
    expect(stepOf()).toBe("Step 9 of 10");
    expect(disabled("Continue")).toBe(true);
    await press(/^Vegetarian with eggs\./);
    await press("4 meals a day");
    await waitFor(() => {
      expect(disabled("Continue")).toBe(false);
    });
    await press("Continue");
    expect(await screen.findByRole("header", { name: "Your plan" })).toBeTruthy();
    expect(stepOf()).toBe("Step 10 of 10");
    expect(saves()).toEqual([{ diet: "vegetarian_eggs" }, { mealsPerDay: 4 }]);
  });
});

describe("setup on the phone", () => {
  it("a US phone opens in pounds, and saves the pounds picked as kilograms", async () => {
    phoneLanguage = "en-US";
    const { saves } = await openSetup({ weightGoal: "maintain" });
    await screen.findByRole("header", { name: "About you" });
    expect(selected("Pounds, feet and inches")).toBe(true);
    await step("Weight", "increment");
    await waitFor(() => {
      expect(saves()).toEqual([{ weightKg: 69.9 }]);
    });
    expect(screen.getByText("154.1 lb")).toBeTruthy();
  });

  it("opens on the first question not answered, Continue waits for its answer, and Back goes back", async () => {
    const { saves } = await openSetup();
    expect(await screen.findByRole("header", { name: "Your goal" })).toBeTruthy();
    expect(stepOf()).toBe("Step 1 of 10");
    expect(disabled("Continue")).toBe(true);
    await press("Keep my weight");
    await press("Build muscle");
    await waitFor(() => {
      expect(disabled("Continue")).toBe(false);
    });
    // Keep my weight asks for no target, so the steps are six.
    expect(stepOf()).toBe("Step 1 of 9");
    await press("Continue");
    expect(await screen.findByRole("header", { name: "About you" })).toBeTruthy();
    expect(saves()).toEqual([{ weightGoal: "maintain" }, { fitnessGoals: ["muscle_gain"] }]);
    await press("Back");
    expect(await screen.findByRole("header", { name: "Your goal" })).toBeTruthy();
  });

  it("a person who left halfway comes back to the first question still open", async () => {
    await openSetup({ ...ALL, dayActivity: null, fitnessLevel: null });
    expect(await screen.findByRole("header", { name: "Your day" })).toBeTruthy();
    expect(stepOf()).toBe("Step 4 of 10");
  });

  it("the server's daily number is on every screen once it has one, and opens how it is worked out", async () => {
    await openSetup({ ...ALL, availableEquipment: [] });
    expect(await screen.findByRole("header", { name: "Equipment" })).toBeTruthy();
    expect(screen.getByText("1,267")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: /^Your daily number, 1,267 kcal a day/ }));
    expect(await screen.findByText("Reach 65 kg around Nov 19, 2026.")).toBeTruthy();
    expect(screen.getByText("140 g")).toBeTruthy();
    expect(screen.getByText("1,817")).toBeTruthy();
    expect(screen.getByText("These numbers are general guidance, not medical advice.")).toBeTruthy();
    await press("The formulas and sources");
    expect(screen.getByText(/^The Mifflin-St Jeor equation/)).toBeTruthy();
  });

  it("Equipment asks where before what, and Continue waits for both", async () => {
    const { saves } = await openSetup({ ...ALL, availableEquipment: [], trainingPlaces: [] });
    await screen.findByRole("header", { name: "Equipment" });
    expect(screen.queryByRole("button", { name: "A gym" })).toBeNull();
    await press("Gym");
    await press("Yoga studio");
    expect(disabled("Continue")).toBe(true);
    await press("No equipment");
    await press("Continue");
    expect(await screen.findByRole("header", { name: "Health" })).toBeTruthy();
    expect(saves()).toEqual([{ trainingPlaces: ["gym"] }, { trainingPlaces: ["gym", "yoga_studio"] }, { availableEquipment: ["none"] }]);
  });

  it("No equipment and a piece of equipment never go together", async () => {
    const { saves } = await openSetup({ ...ALL, availableEquipment: [] });
    await screen.findByRole("header", { name: "Equipment" });
    await press("Dumbbells");
    await press("No equipment");
    await waitFor(() => {
      expect(selected("No equipment")).toBe(true);
    });
    expect(selected("Dumbbells")).toBe(false);
    expect(saves().at(-1)).toEqual({ availableEquipment: ["none"] });
  });

  it("a target under the lowest healthy weight is said as it is picked, and can still be picked", async () => {
    const { saves } = await openSetup({ ...ALL, targetWeightKg: null, pace: null, heightCm: 170, weightKg: 60 });
    await screen.findByRole("header", { name: "Your target" });
    // The scale runs from 30.0 kg, a tick a tenth: 50.0 kg is the 200th row.
    await slide("Target weight", 200);
    await waitFor(() => {
      expect(saves()).toEqual([{ targetWeightKg: 50 }]);
    });
    expect(
      await screen.findByText(
        "Your target is below the lowest healthy weight for your height, 53.5 kg. Your plan will not take you below it.",
      ),
    ).toBeTruthy();
  });

  it("a Lose weight scale ends a tenth under the current weight", async () => {
    const { saves } = await openSetup({ ...ALL, targetWeightKg: null, pace: null });
    await screen.findByRole("header", { name: "Your target" });
    await slide("Target weight", 100_000);
    await waitFor(() => {
      expect(saves()).toEqual([{ targetWeightKg: 69.9 }]);
    });
  });

  it("an answer the server did not take goes back, and says so", async () => {
    const { held } = await openSetup();
    await screen.findByRole("header", { name: "Your goal" });
    held.failNext = true;
    await press("Lose weight");
    expect(await screen.findByText(SAVE_FAILED)).toBeTruthy();
    await waitFor(() => {
      expect(selected("Lose weight")).toBe(false);
    });
    expect(disabled("Continue")).toBe(true);
  });

  it("a new name typed on About you is the name on Me, and kept with the sign-in", async () => {
    const { store } = await openSetup({ weightGoal: "maintain" });
    await screen.findByRole("header", { name: "About you" });
    await fireEvent.changeText(screen.getByLabelText("Your name"), "  Ravi Kumar ");
    await press("Close");
    await waitFor(() => {
      expect(screen.getByText("Ravi Kumar")).toBeTruthy();
    });
    expect(store.value).toContain("Ravi Kumar");
  });

  it("Android's back leaves as the close button does: the name typed is saved, a blank one is not", async () => {
    const { saves } = await openSetup({ weightGoal: "maintain" });
    await screen.findByRole("header", { name: "About you" });
    await fireEvent.changeText(screen.getByLabelText("Your name"), "   ");
    await fireEvent(screen.getByTestId("setup"), "requestClose");
    expect(await screen.findByText("Type the name we should call you.")).toBeTruthy();
    expect(saves()).toEqual([]);
    await fireEvent.changeText(screen.getByLabelText("Your name"), "Ravi K");
    await fireEvent(screen.getByTestId("setup"), "requestClose");
    await waitFor(() => {
      expect(saves()).toEqual([{ displayName: "Ravi K" }]);
    });
    await waitFor(() => {
      expect(screen.getByText("Ravi K")).toBeTruthy();
    });
  });

  it("a blank name is not saved, and setup says what to do", async () => {
    const { saves } = await openSetup({ weightGoal: "maintain" });
    await screen.findByRole("header", { name: "About you" });
    await fireEvent.changeText(screen.getByLabelText("Your name"), "   ");
    await press("Close");
    expect(await screen.findByText("Type the name we should call you.")).toBeTruthy();
    expect(saves()).toEqual([]);
  });
});

// ── 14c: the place step, the plan, Finish, and setup in front of the tabs ───────────────────────

const EVERYTHING: Partial<OnboardingAnswers> = { ...ALL, diet: "non_vegetarian", mealsPerDay: 3 };
const ANSWERED_NO: Stored = { hasCondition: false, checkFirst: null };
const BOTH_TICKED = [...TICKED, { purpose: "plan_screen", wordingVersion: PLAN_NOTE_VERSION }];
const planTick = () => screen.getByRole("checkbox", { name: "I have read and understood this" });
const finishes = (saves: () => unknown[]) =>
  saves().filter((one) => typeof one === "object" && one !== null && "onboardingCompleted" in one);
const LOTUS = { id: "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a", name: "Lotus Yoga", city: null, orgType: "yoga_studio" };
const IRON = { id: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f", name: "Iron House", city: "Pune", orgType: "gym" };
const invitationFrom = (gym: { id: string; name: string; city: string | null; orgType: string }, id: string) => ({
  id,
  state: "pending",
  gym,
  canTakeMembers: true,
  notMe: false,
  yourPlan: null,
  waiver: null,
});

describe("the worst thing: nobody reaches the tabs without the health answer and both notes ticked", () => {
  it("a person who has not finished setup opens the app on setup, never the tabs, with no way to close it", async () => {
    await openSetup({}, { front: true });
    expect(await screen.findByRole("header", { name: "Your goal" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Dashboard" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
  });

  it("Finish waits for the plan's tick, and nothing is sent until it is pressed", async () => {
    const { saves, tickSaves } = await openSetup(EVERYTHING, { front: true, health: ANSWERED_NO, ticks: TICKED });
    expect(await screen.findByRole("header", { name: "Your plan" })).toBeTruthy();
    expect(disabled("Finish setup")).toBe(true);
    expect(screen.getByText("Tick this to finish setup.")).toBeTruthy();
    await press("Finish setup");
    expect(finishes(saves)).toEqual([]);
    await fireEvent.press(planTick());
    await waitFor(() => {
      expect(disabled("Finish setup")).toBe(false);
    });
    expect(tickSaves()).toEqual([{ purpose: "plan_screen", wordingVersion: PLAN_NOTE_VERSION, appVersion: expect.any(String) as unknown }]);
    expect(finishes(saves)).toEqual([]);
  });

  it("a health answer the server no longer holds stops Finish there, says so, and opens the question", async () => {
    const { held, saves } = await openSetup(EVERYTHING, { front: true, health: ANSWERED_NO, ticks: BOTH_TICKED });
    await screen.findByRole("header", { name: "Your plan" });
    // Reset on another device after this phone read it.
    held.health = null;
    await press("Finish setup");
    expect(await screen.findByText("Before you finish, answer the health question.")).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Dashboard" })).toBeNull();
    expect(finishes(saves)).toHaveLength(1);
    expect(held.answers.onboardingCompleted).toBe(false);
    await press("Go to Health");
    expect(await screen.findByRole("header", { name: "Health" })).toBeTruthy();
    expect(selected("No")).toBe(false);
    expect(selected("Yes")).toBe(false);
  });

  it("with every answer and both ticks, Finish is stored, says so, and Start opens the tabs; the phone remembers it", async () => {
    const { held, saves, store } = await openSetup(EVERYTHING, { front: true, health: ANSWERED_NO, ticks: BOTH_TICKED });
    await screen.findByRole("header", { name: "Your plan" });
    await press("Finish setup");
    expect(await screen.findByRole("header", { name: "You’re all set" })).toBeTruthy();
    expect(finishes(saves)).toEqual([{ availableEquipment: ["dumbbells"], onboardingCompleted: true }]);
    expect(held.answers.onboardingCompleted).toBe(true);
    expect(JSON.parse(store.value ?? "")).toMatchObject({ setupDone: true });
    await press("Start");
    expect(await screen.findByRole("tab", { name: "Dashboard" })).toBeTruthy();
  });
});

describe("the plan screen", () => {
  it("shows the week asked for and every answer, and Adjust goes to that answer and straight back", async () => {
    await openSetup(EVERYTHING, { health: ANSWERED_NO, ticks: BOTH_TICKED });
    await screen.findByRole("header", { name: "Your plan" });
    expect(screen.getByText("3 workouts a week, 45 minutes each")).toBeTruthy();
    expect(screen.getByText("Beginner · Home · Dumbbells")).toBeTruthy();
    expect(screen.getByText("3 days a week · 45 minutes")).toBeTruthy();
    await press("Adjust Your week");
    expect(await screen.findByRole("header", { name: "Your week" })).toBeTruthy();
    await press("Back to your plan");
    expect(await screen.findByRole("header", { name: "Your plan" })).toBeTruthy();
  });

  it("Adjust to a new weight goal asks its target first", async () => {
    await openSetup({ ...EVERYTHING, weightGoal: "maintain", targetWeightKg: null, pace: null }, { health: ANSWERED_NO, ticks: BOTH_TICKED });
    await screen.findByRole("header", { name: "Your plan" });
    await press("Adjust Your goal");
    await screen.findByRole("header", { name: "Your goal" });
    await press(/^Lose weight/);
    await waitFor(() => {
      expect(disabled("Continue")).toBe(false);
    });
    await press("Continue");
    expect(await screen.findByRole("header", { name: "Your target" })).toBeTruthy();
  });

  it("in Safe mode it names no workouts and says why", async () => {
    await openSetup(EVERYTHING, { health: { hasCondition: true, checkFirst: "not_yet" }, ticks: BOTH_TICKED });
    await screen.findByRole("header", { name: "Your plan" });
    expect(screen.queryByText("3 workouts a week, 45 minutes each")).toBeNull();
    expect(screen.getByText(/^Safe mode: no workout or run plans/)).toBeTruthy();
  });

  it("for somebody who finished long ago it is their plan, with Done, never Finish again", async () => {
    const { saves } = await openSetup({ ...EVERYTHING, onboardingCompleted: true }, { health: ANSWERED_NO, ticks: BOTH_TICKED });
    await screen.findByRole("header", { name: "Your plan" });
    expect(screen.queryByRole("button", { name: "Finish setup" })).toBeNull();
    await press("Done");
    await waitFor(() => {
      expect(screen.queryByLabelText(/^Step \d+ of \d+$/)).toBeNull();
    });
    expect(finishes(saves)).toEqual([]);
  });
});

describe("the place step", () => {
  it("is asked only while an invitation is waiting (Not now on You’re invited), named for the place that sent it", async () => {
    await openSetup(EVERYTHING, {
      front: true,
      health: ANSWERED_NO,
      ticks: BOTH_TICKED,
      invitations: [invitationFrom(LOTUS, "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e")],
    });
    await screen.findByRole("header", { name: "Your plan" });
    expect(stepOf()).toBe("Step 11 of 11");
    await press("Back");
    expect(await screen.findByRole("header", { name: "Your yoga studio" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "View invitation from Lotus Yoga" })).toBeTruthy();
    expect(disabled("Continue")).toBe(false);
  });

  it("two kinds of place are where you train", async () => {
    await openSetup(EVERYTHING, {
      front: true,
      health: ANSWERED_NO,
      ticks: BOTH_TICKED,
      invitations: [invitationFrom(LOTUS, "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e"), invitationFrom(IRON, "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d")],
    });
    await screen.findByRole("header", { name: "Your plan" });
    await press("Back");
    expect(await screen.findByRole("header", { name: "Where you train" })).toBeTruthy();
  });
});

describe("setup in front of the tabs", () => {
  it("Sign out asks first, and Cancel keeps the person where they were", async () => {
    const { store } = await openSetup({}, { front: true });
    await screen.findByRole("header", { name: "Your goal" });
    await press("Sign out");
    expect(screen.getByText("Sign out?")).toBeTruthy();
    await press("Cancel");
    expect(screen.queryByText("Sign out?")).toBeNull();
    expect(store.value).not.toBeNull();
  });

  it("a person who finished in the browser goes straight to the tabs, and the phone remembers it", async () => {
    const { store } = await openSetup({ ...EVERYTHING, onboardingCompleted: true }, { front: true });
    expect(await screen.findByRole("tab", { name: "Dashboard" })).toBeTruthy();
    expect(JSON.parse(store.value ?? "")).toMatchObject({ setupDone: true });
  });
});

describe("round one's gaps", () => {
  it("the health note not ticked holds Finish on the plan, says so, and opens Health", async () => {
    // No screen leads here with the note unticked; opened on the plan, as a goal opens setup on one answer.
    function OnceSignedIn() {
      const { state } = useSession();
      return state.kind === "in" ? <Setup open at="plan" onClose={() => undefined} /> : null;
    }
    const server = fakeServer({
      "/v1/auth/refresh": () => ({ status: 200, body: { tokens: tokens(2) } }),
      [SETUP]: () => ({ status: 200, body: { answers: { ...EMPTY, ...EVERYTHING }, plan: PLAN, missing: [] } }),
      [HEALTH]: () => ({ status: 200, body: { healthScreening: screeningOf(ANSWERED_NO) } }),
      [CONSENTS]: () => ({ status: 200, body: { consents: [consentRow("plan_screen", PLAN_NOTE_VERSION)], total: 1 } }),
    });
    await render(
      <SafeAreaProvider>
        <SessionProvider server={{ apiUrl: extra.apiUrl, ask: server.ask }} store={memoryStore(kept(1))} wait={noWait}>
          <OnceSignedIn />
        </SessionProvider>
      </SafeAreaProvider>,
    );
    expect(await screen.findByText("Read the note on the Health screen and tick it.")).toBeTruthy();
    expect(disabled("Finish setup")).toBe(true);
    await press("Finish setup");
    expect(server.asked.filter((one) => one.path === SETUP && one.body !== undefined)).toEqual([]);
    await press("Go to Health");
    expect(await screen.findByRole("header", { name: "Health" })).toBeTruthy();
  });

  it("in front of the tabs, Android's back on the first screen leaves nobody on the tabs", async () => {
    await openSetup({}, { front: true });
    await screen.findByRole("header", { name: "Your goal" });
    await fireEvent(screen.getByTestId("setup"), "requestClose");
    expect(screen.getByRole("header", { name: "Your goal" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Dashboard" })).toBeNull();
  });
});

describe("the setup gate's answers", () => {
  /** The app opened for a person not known to be set up, the profile route as each test says; the
   *  app's coming back to the front is called by hand. */
  async function openGate(profileRoute: () => Reply | Promise<Reply>) {
    const listeners: ((state: string) => void)[] = [];
    jest.spyOn(AppState, "addEventListener").mockImplementation((_type, handler) => {
      listeners.push(handler as (state: string) => void);
      return { remove: () => undefined };
    });
    const route = { now: profileRoute };
    const server = fakeServer({
      "/v1/auth/refresh": () => ({ status: 200, body: { tokens: tokens(2) } }),
      "/v1/users/me": () => route.now(),
      [SETUP]: () => ({ status: 200, body: { answers: EMPTY, plan: null, missing: missingOf(EMPTY) } }),
    });
    const store = memoryStore(kept(1, RAVI, NOTE_VERSION_SIGN_UP, false));
    await render(<App extra={extra} ask={server.ask} store={store} wait={noWait} />);
    return {
      route,
      store,
      front: async () => {
        await act(async () => {
          for (const one of listeners) one("active");
          await new Promise((resolve) => setTimeout(resolve, 20));
        });
      },
    };
  }
  const notSetUp = () => ({ status: 200, body: profile(true, RAVI, false) });
  const setUp = () => ({ status: 200, body: profile(true, RAVI, true) });

  it("with no answer the tabs open, and coming back to the front with 'not finished' puts setup in front", async () => {
    const gate = await openGate(lost);
    expect(await screen.findByRole("tab", { name: "Dashboard" })).toBeTruthy();
    gate.route.now = notSetUp;
    await gate.front();
    expect(await screen.findByRole("header", { name: "Your goal" })).toBeTruthy();
  });

  it("finished in the browser while setup is open: coming back to the front lets them through, and the phone keeps it", async () => {
    const gate = await openGate(notSetUp);
    expect(await screen.findByRole("header", { name: "Your goal" })).toBeTruthy();
    gate.route.now = setUp;
    await gate.front();
    expect(await screen.findByRole("tab", { name: "Dashboard" })).toBeTruthy();
    expect(JSON.parse(gate.store.value ?? "")).toMatchObject({ setupDone: true });
  });

  it("a person the phone knows is set up is not asked again", async () => {
    // The profile says not set up; asked, the gate would put setup in front.
    const server = fakeServer({
      "/v1/auth/refresh": () => ({ status: 200, body: { tokens: tokens(2) } }),
      "/v1/users/me": notSetUp,
    });
    await render(<App extra={extra} ask={server.ask} store={memoryStore(kept(1))} wait={noWait} />);
    expect(await screen.findByRole("tab", { name: "Dashboard" })).toBeTruthy();
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(screen.queryByRole("header", { name: "Your goal" })).toBeNull();
  });
});
