import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { missingPlanInputSchema, type OnboardingAnswers } from "@app/shared";
import { App } from "../../src/App";
import { SAVE_FAILED } from "../../src/screens/setup/useSetupAnswers";
import { fakeServer, kept, memoryStore, refusal, tokens, type Reply } from "../kit";

const extra = { copyName: "Feature 1", apiUrl: "http://localhost:3000" };
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

/** Signed in on this phone already, on Me, with setup opened from "Your plan". The stand-in keeps
 *  what each save sends; `failNext` refuses the next save. */
async function openSetup(start: Partial<OnboardingAnswers> = {}) {
  const held = { answers: { ...EMPTY, ...start }, failNext: false };
  const reply = (): Reply => {
    const missing = missingOf(held.answers);
    return { status: 200, body: { answers: { ...held.answers }, plan: missing.length > 0 ? null : PLAN, missing } };
  };
  const server = fakeServer({
    "/v1/auth/refresh": () => ({ status: 200, body: { tokens: tokens(2) } }),
    [SETUP]: (body) => {
      if (body !== undefined && held.failNext) {
        held.failNext = false;
        return refusal(400, "validation_failed", "Not saved.");
      }
      if (typeof body === "object" && body !== null) Object.assign(held.answers, body);
      return reply();
    },
  });
  const store = memoryStore(kept(1));
  await render(<App extra={extra} ask={server.ask} store={store} wait={noWait} />);
  await fireEvent.press(await screen.findByRole("tab", { name: "Me" }));
  await fireEvent.press(await screen.findByRole("button", { name: "Your plan" }));
  await screen.findByLabelText(/^Step \d+ of \d+$/);
  const saves = () => server.asked.filter((one) => one.path === SETUP && one.body !== undefined).map((one) => one.body);
  return { server, held, saves, store };
}

const press = (name: string) => fireEvent.press(screen.getByRole("button", { name }));
const selected = (name: string): unknown => {
  const state: unknown = screen.getByRole("button", { name }).props.accessibilityState;
  return typeof state === "object" && state !== null && "selected" in state ? state.selected : undefined;
};
const disabled = (name: string): unknown => {
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
    expect(stepOf()).toBe("Step 1 of 7");
    expect(disabled("Continue")).toBe(true);
    await press("Keep my weight");
    await press("Build muscle");
    await waitFor(() => {
      expect(disabled("Continue")).toBe(false);
    });
    // Keep my weight asks for no target, so the steps are six.
    expect(stepOf()).toBe("Step 1 of 6");
    await press("Continue");
    expect(await screen.findByRole("header", { name: "About you" })).toBeTruthy();
    expect(saves()).toEqual([{ weightGoal: "maintain" }, { fitnessGoals: ["muscle_gain"] }]);
    await press("Back");
    expect(await screen.findByRole("header", { name: "Your goal" })).toBeTruthy();
  });

  it("a person who left halfway comes back to the first question still open", async () => {
    await openSetup({ ...ALL, dayActivity: null, fitnessLevel: null });
    expect(await screen.findByRole("header", { name: "Your day" })).toBeTruthy();
    expect(stepOf()).toBe("Step 4 of 7");
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

  it("Equipment asks where before what, and Done closes setup once both are answered and saved", async () => {
    const { saves } = await openSetup({ ...ALL, availableEquipment: [], trainingPlaces: [] });
    await screen.findByRole("header", { name: "Equipment" });
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
    expect(screen.queryByRole("button", { name: "A gym" })).toBeNull();
    await press("Gym");
    await press("Yoga studio");
    expect(disabled("Done")).toBe(true);
    await press("No equipment");
    await press("Done");
    await waitFor(() => {
      expect(screen.queryByLabelText(/^Step \d+ of \d+$/)).toBeNull();
    });
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
