import { fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { missingPlanInputSchema, type OnboardingAnswers } from "@app/shared";
import { App } from "../../src/App";
import { SAVE_FAILED } from "../../src/screens/setup/useSetupAnswers";
import { fakeServer, kept, memoryStore, refusal, tokens, type Reply } from "../kit";

const extra = { copyName: "Feature 1", apiUrl: "http://localhost:3000" };
const noWait = () => Promise.resolve();
const ROW = 40;

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
  await screen.findByText(/^Step \d+ of \d+$/);
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
/** A drag the person makes on a column, let go at `row`. */
const drag = async (column: string, row: number) => {
  const wheel = screen.getByLabelText(column);
  await fireEvent(wheel, "scrollBeginDrag");
  await fireEvent(wheel, "scrollEndDrag", { nativeEvent: { contentOffset: { y: 0 }, velocity: { y: 2 } } });
  await fireEvent(wheel, "momentumScrollEnd", { nativeEvent: { contentOffset: { y: row * ROW } } });
};

describe("the worst thing: nobody's plan is built on an age, height or weight they never picked", () => {
  it("About you opens with every wheel Not set, and opening it saves nothing", async () => {
    const { saves } = await openSetup({ weightGoal: "maintain" });
    expect(await screen.findByRole("header", { name: "About you" })).toBeTruthy();
    expect(screen.getAllByText("Not set")).toHaveLength(3);
    expect(saves()).toEqual([]);
  });

  it("a drag over a wheel nobody tapped is the page's, and saves nothing", async () => {
    const { saves } = await openSetup({ weightGoal: "maintain" });
    await screen.findByRole("header", { name: "About you" });
    await drag("Weight in whole kilograms", 45);
    await drag("Age", 12);
    await drag("Height in centimetres", 80);
    expect(saves()).toEqual([]);
    expect(screen.getAllByText("Not set")).toHaveLength(3);
  });

  it("a wheel moving itself to a row picks nothing; only the person's own drag does", async () => {
    const { saves } = await openSetup({ weightGoal: "maintain" });
    await screen.findByRole("header", { name: "About you" });
    const age = screen.getByLabelText("Age");
    await fireEvent.press(within(age).getByText("40"));
    await waitFor(() => {
      expect(saves()).toEqual([{ age: 40 }]);
    });
    // A settle with no drag before it, as when the wheel is moved to the saved row.
    await fireEvent(age, "momentumScrollEnd", { nativeEvent: { contentOffset: { y: 30 * ROW } } });
    expect(saves()).toEqual([{ age: 40 }]);
    // The person's own drag on the wheel they tapped, let go on 48.
    await drag("Age", 30);
    await waitFor(() => {
      expect(saves()).toEqual([{ age: 40 }, { age: 48 }]);
    });
  });

  it("the resting row is saved only when the person picks it, with + or a tap", async () => {
    const { saves } = await openSetup({ weightGoal: "maintain" });
    await screen.findByRole("header", { name: "About you" });
    await press("Weight: one more");
    await waitFor(() => {
      expect(saves()).toEqual([{ weightKg: 71 }]);
    });
    expect(screen.getByText("71.0 kg")).toBeTruthy();
  });
});

describe("setup on the phone", () => {
  it("opens on the first question not answered, and Continue waits for its answer", async () => {
    const { saves } = await openSetup();
    expect(await screen.findByRole("header", { name: "Your goal" })).toBeTruthy();
    expect(screen.getByText("Step 1 of 7")).toBeTruthy();
    expect(disabled("Continue")).toBe(true);
    await press("Keep my weight");
    await press("Build muscle");
    await waitFor(() => {
      expect(disabled("Continue")).toBe(false);
    });
    // Keep my weight asks for no target, so the steps are six.
    expect(screen.getByText("Step 1 of 6")).toBeTruthy();
    await press("Continue");
    expect(await screen.findByRole("header", { name: "About you" })).toBeTruthy();
    expect(saves()).toEqual([{ weightGoal: "maintain" }, { fitnessGoals: ["muscle_gain"] }]);
  });

  it("a person who left halfway comes back to the first question still open", async () => {
    await openSetup({ ...ALL, dayActivity: null, fitnessLevel: null });
    expect(await screen.findByRole("header", { name: "Your day" })).toBeTruthy();
    expect(screen.getByText("Step 4 of 7")).toBeTruthy();
  });

  it("the server's daily number is on every screen once it has one", async () => {
    await openSetup({ ...ALL, availableEquipment: [] });
    expect(await screen.findByRole("header", { name: "Equipment" })).toBeTruthy();
    expect(screen.getByText("1,267")).toBeTruthy();
    expect(screen.getByText("550 less than the 1,817 you burn a day.")).toBeTruthy();
    expect(screen.getByText("Reach 65 kg around Nov 19, 2026.")).toBeTruthy();
  });

  it("the last screen's Done closes setup once its saves have landed", async () => {
    const { saves } = await openSetup({ ...ALL, availableEquipment: [] });
    await screen.findByRole("header", { name: "Equipment" });
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
    await press("No equipment");
    await press("Done");
    await waitFor(() => {
      expect(screen.queryByText(/^Step \d+ of \d+$/)).toBeNull();
    });
    expect(saves()).toEqual([{ availableEquipment: ["none"] }]);
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
    await openSetup({ ...ALL, targetWeightKg: null, pace: null, heightCm: 170, weightKg: 60 });
    await screen.findByRole("header", { name: "Your target" });
    await fireEvent.press(within(screen.getByLabelText("Target weight in whole kilograms")).getByText("50"));
    expect(
      await screen.findByText(
        "Your target is below the lowest healthy weight for your height, 53.5 kg. Your plan will not take you below it.",
      ),
    ).toBeTruthy();
  });

  it("a weight above the current one is not on a Lose weight wheel", async () => {
    await openSetup({ ...ALL, targetWeightKg: null, pace: null });
    await screen.findByRole("header", { name: "Your target" });
    const wheel = screen.getByLabelText("Target weight in whole kilograms");
    expect(within(wheel).getByText("69")).toBeTruthy();
    expect(within(wheel).queryByText("71")).toBeNull();
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
    await fireEvent.changeText(screen.getByLabelText("What should we call you?"), "  Ravi Kumar ");
    await press("Close");
    await waitFor(() => {
      expect(screen.getByText("Ravi Kumar")).toBeTruthy();
    });
    expect(store.value).toContain("Ravi Kumar");
  });

  it("a blank name is not saved, and setup says what to do", async () => {
    const { saves } = await openSetup({ weightGoal: "maintain" });
    await screen.findByRole("header", { name: "About you" });
    await fireEvent.changeText(screen.getByLabelText("What should we call you?"), "   ");
    await press("Close");
    expect(await screen.findByText("Type the name we should call you.")).toBeTruthy();
    expect(saves()).toEqual([]);
  });
});
