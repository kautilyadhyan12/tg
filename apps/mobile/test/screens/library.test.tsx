// Workout → Exercises: the Exercise Library on the phone (ROADMAP Stage 5 63a). The worst thing it could do to
// a person is open an exercise without its caution, so that is tested first, on every tab of the page. The
// exercises are the real files, sent as the server publishes them.
import { readdirSync, readFileSync } from "node:fs";
import type { OnboardingAnswers } from "@app/shared";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { File, Paths } from "expo-file-system";
import { App } from "../../src/App";
import { Gesture, State } from "react-native-gesture-handler";
import { fireGestureHandler, getByGestureTestId } from "react-native-gesture-handler/jest-utils";
import { FIGURES, type FigureName } from "../../src/library/figures";
import { DOUBLE_TAP_ZOOM, toStage, WHOLE, zoomAbout, type View as Zoom } from "../../src/library/stage";
import { forgetStores } from "../../src/library/myWorkout";
import { LIBRARY_PATH } from "../../src/library/store";
import type { Ask } from "../../src/session/calls";
import { fakeServer, kept, lost, memoryStore, RAVI, refusal, tokens, type Reply } from "../kit";

const extra = { copyName: "Exercise 2", apiUrl: "http://localhost:3000" };
const FOLDER = `${__dirname}/../../../../packages/shared/library/exercises/`;
const METS: Record<string, number> = { squat: 3, plank: 2.8, barbell_curl: 3.5 };
const PLANK_CAUTION = "If you feel pain in your lower back, stop at once and see a qualified professional.";

function download(more: Record<string, unknown>[] = [], fingerprint = "a".repeat(64)) {
  const exercises = readdirSync(FOLDER).map((name) => {
    const file = JSON.parse(readFileSync(`${FOLDER}${name}`, "utf8")) as Record<string, unknown>;
    return { ...file, status: "live", met: METS[String(file.id)] ?? 3 };
  });
  return { fingerprint, version: 1, list: { exercises: [...exercises, ...more], camera: [] } };
}

const ANSWERS: OnboardingAnswers = {
  displayName: "Ravi", weightGoal: null, fitnessGoals: [], age: null, gender: null, heightCm: null, weightKg: null, targetWeightKg: null,
  pace: null, dayActivity: null, fitnessLevel: null, pushUpsMax: null, plankHoldSeconds: null, trainingDays: null, sessionMinutes: null,
  availableEquipment: [], trainingPlaces: [], diet: null, mealsPerDay: null, onboardingCompleted: true, updatedAt: null,
};

/** The server: the Library answered as the api does (304 to the copy's own fingerprint), setup's answers with
 *  `gender`. `library` may change between calls (no internet, then back). */
function libraryServer(
  opts: { library?: () => Reply; gender?: OnboardingAnswers["gender"]; weightKg?: number | null; onboarding?: () => Reply | Promise<Reply>; records?: Record<string, () => Reply> } = {},
) {
  let library = opts.library ?? ((): Reply => ({ status: 200, body: download() }));
  const records = Object.fromEntries(
    ["barbell_curl", "plank", "squat"].map((id) => [`/v1/training/exercises/${id}/records`, opts.records?.[id] ?? (() => ({ status: 200, body: noRecords(id) }))]),
  );
  const server = fakeServer({
    "/v1/auth/refresh": () => ({ status: 200, body: { tokens: tokens(2) } }),
    "/v1/users/me/onboarding":
      opts.onboarding ?? (() => ({ status: 200, body: { answers: { ...ANSWERS, gender: opts.gender ?? null, weightKg: opts.weightKg ?? null }, plan: null, missing: ["goal"] } })),
    ...records,
  });
  const libraryAsks: (string | undefined)[] = [];
  const ask: Ask = async (url, init) => {
    if (new URL(url).pathname !== LIBRARY_PATH) return server.ask(url, init);
    const tag = init.headers?.["if-none-match"];
    libraryAsks.push(tag);
    const reply = library();
    if (reply.status === 200 && tag === `"${(reply.body as { fingerprint: string }).fingerprint}"`) {
      return { ok: false, status: 304, json: () => Promise.reject(new Error("a 304 has no body")) };
    }
    return { ok: reply.status < 300, status: reply.status, json: () => Promise.resolve(reply.body) };
  };
  return { ask, libraryAsks, set: (next: () => Reply) => { library = next; } };
}

/** An exercise's records as the server answers them for somebody who never did it (63c). */
function noRecords(exercise: string) {
  return { exercise, reps: { heaviest: null, mostReps: null, bestEstimated1rm: null, mostLifted: null }, time: { longestHold: null, heaviest: null }, recent: [], days: {}, limitedToDays: null };
}

const W = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ON = (day: number) => new Date(2026, 10, day, 18, 0).toISOString();
const done = (workout: number, reps: number, grams: number | null) => ({ workoutId: W(workout), startedAt: ON(workout), position: 0, done: reps, weightGrams: grams });
const best = (workout: number, heaviestGrams: number, mostReps: number) => ({ workoutId: W(workout), startedAt: ON(workout), reps: { heaviestGrams, mostReps }, time: { longestHold: null, heaviestGrams: null } });

/** Barbell Curl as the drawing has it: 35 kg x 8 on 14 Nov, 15 reps at 20 kg on 2 Nov, an estimate of 44.3 kg,
 *  880 kg in one workout, and the last three times. */
const CURL_RECORDS = {
  exercise: "barbell_curl",
  reps: { heaviest: done(14, 8, 35_000), mostReps: done(2, 15, 20_000), bestEstimated1rm: { ...done(14, 8, 35_000), estimateGrams: 44_333 }, mostLifted: { workoutId: W(14), startedAt: ON(14), grams: 880_000 } },
  time: { longestHold: null, heaviest: null },
  recent: [best(2, 25_000, 15), best(6, 30_000, 10), best(14, 35_000, 8)],
  // The server's own day of each workout (in the zone it was done in), never the phone's.
  days: { [W(2)]: "2026-11-02", [W(6)]: "2026-11-06", [W(14)]: "2026-11-14" },
  limitedToDays: null,
};

/** A point inside a shape: the middle of the widest run across it, on the row through its middle. */
function insideOf(d: string): [number, number] {
  const p = (d.match(/-?\d+/g) ?? []).map(Number);
  const ys = p.filter((_, i) => i % 2 === 1);
  const y = (Math.min(...ys) + Math.max(...ys)) / 2 + 0.5;
  const xs: number[] = [];
  const n = p.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi, xj, yj] = [p[i * 2] ?? 0, p[i * 2 + 1] ?? 0, p[j * 2] ?? 0, p[j * 2 + 1] ?? 0];
    if (yi > y !== yj > y) xs.push(((xj - xi) * (y - yi)) / (yj - yi) + xi);
  }
  xs.sort((a, b) => a - b);
  let best: [number, number, number] = [0, y, -1];
  for (let i = 0; i + 1 < xs.length; i += 2) {
    const a = xs[i] ?? 0;
    const b = xs[i + 1] ?? 0;
    if (b - a > best[2]) best = [(a + b) / 2, y, b - a];
  }
  return [best[0], best[1]];
}

const noInternet = (): Reply => {
  throw new Error("Network request failed");
};

/** Lets the app's own waits finish inside act, so what they set is drawn. */
const settle = (ms: number) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });

async function openLibrary(ask: Ask) {
  await render(<App extra={extra} store={memoryStore(kept(1))} ask={ask} />);
  await fireEvent.press(await screen.findByRole("tab", { name: "Workout" }));
}
const openExercise = async (name: RegExp) => {
  await fireEvent.press(await screen.findByRole("button", { name }));
};

beforeEach(() => {
  // The phone's files outlive a test in the stand-in: each test starts on a phone that never opened the Library.
  for (const one of Paths.document.list()) if (one.name.startsWith("library-") || one.name.startsWith("figure-") || one.name.startsWith("my-workout-") || one.name.startsWith("workout") || one.name.startsWith("saved-")) one.delete();
  forgetStores();
});

describe("an exercise's page never hides its caution", () => {
  it("the plank's caution is shown above the tabs, on Muscles, Instructions and Mistakes alike", async () => {
    await openLibrary(libraryServer().ask);
    await openExercise(/^Plank,/);
    for (const tab of ["Muscles", "Instructions", "Mistakes"]) {
      await fireEvent.press(screen.getByRole("button", { name: tab }));
      const alert = await screen.findByRole("alert");
      expect(alert.props.accessibilityLabel).toBe(`Caution: ${PLANK_CAUTION}`);
      expect(within(alert).getByText(PLANK_CAUTION)).toBeTruthy();
    }
  });

  it("an exercise with no caution shows no warning box", async () => {
    await openLibrary(libraryServer().ask);
    await openExercise(/^Squat,/);
    expect(await screen.findByLabelText("To start, 3 sets of 12 reps")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("the Library", () => {
  it("lists the exercises A to Z, each card saying its level, muscles, target and effort", async () => {
    const server = libraryServer();
    await openLibrary(server.ask);
    expect(await screen.findByText("3 Exercises")).toBeTruthy();
    expect(screen.getByText("3 exercises · A to Z")).toBeTruthy();
    const cards = screen.getAllByRole("button", { name: /^(Barbell Curl|Plank|Squat),/ }).map((c) => String(c.props.accessibilityLabel));
    expect(cards).toEqual([
      "Barbell Curl, Intermediate, Biceps, 3 × 10 reps, Moderate intensity",
      "Plank, Intermediate, Abs · Transverse abdominis, 3 × 30 s, Light intensity",
      "Squat, Beginner, Quadriceps · Glutes, 3 × 12 reps, Moderate intensity",
    ]);
    expect(server.libraryAsks).toEqual([undefined]);
  });

  it("search reads names, other names and muscles; nothing found clears back to all of them", async () => {
    await openLibrary(libraryServer().ask);
    const box = await screen.findByPlaceholderText("Search exercises");
    await fireEvent.changeText(box, "front plank");
    expect(await screen.findByText("1 exercise")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Plank,/ })).toBeTruthy();
    await fireEvent.changeText(box, "biceps");
    expect(await screen.findByRole("button", { name: /^Barbell Curl,/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Squat,/ })).toBeNull();
    await fireEvent.changeText(box, "burpee");
    expect(await screen.findByText("No exercises match “burpee”")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Clear search and filters" }));
    expect(await screen.findByText("3 exercises · A to Z")).toBeTruthy();
  });

  it("the kinds offered are only those the Library holds, and a picked one narrows the list", async () => {
    const plank = JSON.parse(readFileSync(`${FOLDER}plank.json`, "utf8")) as { text: { en: Record<string, unknown> } } & Record<string, unknown>;
    const catCow = { ...plank, id: "cat_cow", status: "live", kind: "mobility", met: 2.3, text: { en: { ...plank.text.en, name: "Cat-Cow", otherNames: [] } } };
    await openLibrary(libraryServer({ library: () => ({ status: 200, body: download([catCow]) }) }).ask);
    expect(await screen.findByText("4 Exercises")).toBeTruthy();
    expect(screen.getAllByRole("radio").map((c) => String(c.props.accessibilityLabel))).toEqual(["All", "Strength", "Mobility"]);
    await fireEvent.press(screen.getByRole("radio", { name: "Mobility" }));
    expect(await screen.findByText("1 exercise · A to Z")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Cat-Cow,/ })).toBeTruthy();
  });

  it("with no Library published yet it says so, never that the connection failed", async () => {
    await openLibrary(libraryServer({ library: () => refusal(404, "no_library", "No Library yet.") }).ask);
    expect(await screen.findByText("Exercises aren’t available yet")).toBeTruthy();
    expect(screen.queryByText("Check your connection.")).toBeNull();
  });

  it("with no internet on the very first open it says so, and Try again loads it", async () => {
    const server = libraryServer({ library: noInternet });
    await openLibrary(server.ask);
    expect(await screen.findByText("Couldn’t load the exercises")).toBeTruthy();
    server.set(() => ({ status: 200, body: download() }));
    await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("3 Exercises")).toBeTruthy();
  });

  it("once opened, it is kept: the next open asks only whether it changed, and works with no internet", async () => {
    const server = libraryServer();
    await openLibrary(server.ask);
    expect(await screen.findByText("3 Exercises")).toBeTruthy();
    await screen.unmount();
    await openLibrary(server.ask);
    await settle(500);
    expect(screen.getByText("3 Exercises")).toBeTruthy();
    expect(server.libraryAsks).toEqual([undefined, `"${"a".repeat(64)}"`]);
    await screen.unmount();
    server.set(noInternet);
    await openLibrary(server.ask);
    await settle(500);
    expect(screen.getByText("3 Exercises")).toBeTruthy();
    expect(screen.queryByText("Couldn’t load the exercises")).toBeNull();
  });

  it("a retired exercise stays out of the list; a word the app does not know is shown plainly", async () => {
    const plank = JSON.parse(readFileSync(`${FOLDER}plank.json`, "utf8")) as Record<string, unknown>;
    await openLibrary(libraryServer({ library: () => ({ status: 200, body: download([
      { ...plank, id: "old_crunch", status: "retired", text: { en: { ...(plank.text as { en: object }).en, name: "Old Crunch", otherNames: [] } } },
      { ...plank, id: "copenhagen", status: "live", kind: "calisthenics", level: "elite", text: { en: { ...(plank.text as { en: object }).en, name: "Copenhagen Plank", otherNames: [] } } },
    ]) }) }).ask);
    expect(await screen.findByText("4 Exercises")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Old Crunch,/ })).toBeNull();
    expect(screen.getByRole("button", { name: /^Copenhagen Plank, Elite,/ })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Calisthenics" })).toBeTruthy();
  });
});

describe("Filters and Find by muscle (63b)", () => {
  const listed = () => screen.queryAllByRole("button", { name: /^(Barbell Curl|Plank|Squat),/ }).map((c) => String(c.props.accessibilityLabel).split(",")[0]);
  const openFilters = async () => {
    await fireEvent.press(await screen.findByRole("button", { name: /^Filters/ }));
    return screen.findByText("Filters");
  };
  const STAGE = { width: 360, height: 560 };
  /** Gives the body a size, as the phone does when it lays the screen out. */
  const layOut = async () => {
    await fireEvent(await screen.findByTestId("muscle-stage"), "layout", { nativeEvent: { layout: { x: 0, y: 0, ...STAGE } } });
  };
  const fromCard = async () => {
    await fireEvent.press(await screen.findByRole("button", { name: "Find by muscle. Tap a muscle on the body." }));
    await layOut();
  };
  /** Where a muscle's shape shows on the stage, with the body as `view` zooms it. */
  const onStage = (figure: FigureName, muscle: string, view: Zoom = WHOLE) => {
    const part = FIGURES[figure].find((p) => p.m === muscle);
    if (part === undefined) throw new Error(`${figure} has no ${muscle}`);
    const [dx, dy] = insideOf(part.d);
    return toStage(view, dx, dy, STAGE.width, STAGE.height);
  };
  /** A finger's tap on the stage, inside a muscle's shape on the person's figure. */
  const tapMuscle = (figure: FigureName, muscle: string, id = "muscle-tap", view: Zoom = WHOLE) => {
    const at = onStage(figure, muscle, view);
    return act(() => {
      fireGestureHandler<ReturnType<typeof Gesture.Tap>>(getByGestureTestId(id), [
        { state: State.BEGAN, x: at.x, y: at.y },
        { state: State.ACTIVE, x: at.x, y: at.y },
        { state: State.END, x: at.x, y: at.y },
      ]);
    });
  };

  it("each choice says how many it shows, and Show opens exactly that many: the worst thing is a false count", async () => {
    await openLibrary(libraryServer({ gender: "male" }).ask);
    await openFilters();
    expect(screen.getByRole("checkbox", { name: "Beginner, 1 exercise" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Intermediate, 2 exercises" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "No equipment, 2 exercises" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Barbell, 1 exercise" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Manual tracking, 3 exercises" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Strength, 3 exercises" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show 3 exercises" })).toBeTruthy();

    await fireEvent.press(screen.getByRole("checkbox", { name: "Intermediate, 2 exercises" }));
    // The other groups count within it: of the two intermediate exercises, one needs a barbell, one nothing.
    expect(await screen.findByRole("checkbox", { name: "Barbell, 1 exercise" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "No equipment, 1 exercise" })).toBeTruthy();
    await fireEvent.press(screen.getByRole("checkbox", { name: "No equipment, 1 exercise" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Show 1 exercise" }));
    await waitFor(() => { expect(listed()).toEqual(["Plank"]); });
    expect(screen.getByText("1 exercise · A to Z")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Filters, 2 on" })).toBeTruthy();
    // Each choice is a tag on the Library; letting one go widens the list again.
    await fireEvent.press(screen.getByRole("button", { name: "Remove No equipment" }));
    await waitFor(() => { expect(listed()).toEqual(["Barbell Curl", "Plank"]); });
    await fireEvent.press(screen.getByRole("button", { name: "Clear all" }));
    await waitFor(() => { expect(listed()).toEqual(["Barbell Curl", "Plank", "Squat"]); });
  });

  it("a tap picks the exact muscle and the same tap lets it go; its exercises show at once, and Show in Library keeps it", async () => {
    await openLibrary(libraryServer({ gender: "male" }).ask);
    await fromCard();
    // No panel until a muscle is picked: a line over the body says what to do (Kd at the click-through).
    expect(screen.getByText("Pinch to zoom · tap a muscle")).toBeTruthy();
    expect(screen.queryByTestId("muscle-panel")).toBeNull();
    await tapMuscle("male-front", "biceps");
    expect(screen.getByTestId("muscle-panel")).toBeTruthy();
    expect(screen.queryByText("Pinch to zoom · tap a muscle")).toBeNull();
    expect(await screen.findByRole("button", { name: "Barbell Curl, Primary · Intermediate · 3 × 10 reps" })).toBeTruthy();
    expect(screen.getByText("1 exercise")).toBeTruthy();
    await tapMuscle("male-front", "biceps");
    expect(await screen.findByText("Tap a muscle to see its exercises")).toBeTruthy();
    expect(screen.queryByTestId("muscle-panel")).toBeNull();
    // Not the whole thigh: the vastus lateralis alone, under its group's name.
    await tapMuscle("male-front", "vastus_lateralis");
    expect(await screen.findByText("Vastus lateralis")).toBeTruthy();
    expect(screen.getByText("Quadriceps")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Squat, Primary · Beginner · 3 × 12 reps" })).toBeTruthy();
    // A muscle no exercise works yet can still be tapped, and says so.
    await tapMuscle("male-front", "upper_chest");
    expect(await screen.findByText("No exercises for this muscle yet.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Show in Library" })).toBeNull();
    await tapMuscle("male-front", "vastus_lateralis");
    await fireEvent.press(await screen.findByRole("button", { name: "Show in Library" }));
    await waitFor(() => { expect(listed()).toEqual(["Squat"]); });
    expect(screen.getByRole("button", { name: "Remove Vastus lateralis" })).toBeTruthy();
  });

  it("the person's own figure only; the back has its own muscles; an exercise opens over the body", async () => {
    await openLibrary(libraryServer({ gender: "female" }).ask);
    await fromCard();
    expect(screen.getAllByTestId("figure-female-front").length).toBeGreaterThan(0);
    expect(screen.queryAllByTestId("figure-male-front")).toHaveLength(0);
    await fireEvent.press(screen.getByRole("button", { name: "Back" }));
    await layOut();
    await tapMuscle("female-back", "biceps_femoris");
    expect(await screen.findByText("Biceps femoris")).toBeTruthy();
    expect(screen.getByText("Hamstrings")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Squat, Secondary · Beginner · 3 × 12 reps" }));
    expect(await screen.findByLabelText("To start, 3 sets of 12 reps")).toBeTruthy();
  });

  it("a double tap zooms without picking, and Fit body puts it back", async () => {
    await openLibrary(libraryServer({ gender: "male" }).ask);
    await fromCard();
    // A window of its own on Android: without its own gesture root the screen fails there (found on the phone).
    expect(within(screen.getByTestId("muscle-gesture-root")).getByTestId("muscle-stage")).toBeTruthy();
    // A single tap waits until a double tap has failed, and neither is a tap once the finger moves (round one's T1, T2).
    const tap = getByGestureTestId("muscle-tap");
    const doubleTap = getByGestureTestId("muscle-double-tap");
    expect(tap.config.requireToFail ?? []).toContain(doubleTap.handlerTag);
    expect(tap.config).toMatchObject({ maxDist: 10 });
    expect(doubleTap.config).toMatchObject({ maxDist: 10 });
    await tapMuscle("male-front", "abs", "muscle-double-tap");
    expect(await screen.findByRole("button", { name: "Fit body" })).toBeTruthy();
    expect(screen.getByText("Tap a muscle to see its exercises")).toBeTruthy();
    expect(screen.queryByTestId("muscle-panel")).toBeNull();
    // Zoomed, a tap is read where the muscle now shows (round one's T3).
    const at = onStage("male-front", "abs");
    const zoomed = zoomAbout(WHOLE, DOUBLE_TAP_ZOOM, at.x, at.y, STAGE.width, STAGE.height);
    await tapMuscle("male-front", "obliques", "muscle-tap", zoomed);
    expect(await screen.findByText("Obliques")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Plank, Secondary · Intermediate · 3 × 30 s" })).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Fit body" }));
    await waitFor(() => { expect(screen.queryByRole("button", { name: "Fit body" })).toBeNull(); });
  });

  it("Filters' Muscle opens the body; the muscle picked there is counted with the rest", async () => {
    await openLibrary(libraryServer({ gender: "male" }).ask);
    await openFilters();
    await fireEvent.press(screen.getByRole("button", { name: "Muscle, any. Choose on the body." }));
    await layOut();
    await tapMuscle("male-front", "biceps");
    // Choosing for Filters: the exercises are listed, not opened.
    expect(await screen.findByLabelText("Barbell Curl, Primary · Intermediate · 3 × 10 reps")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Use this muscle" }));
    expect(await screen.findByRole("button", { name: "Muscle, Biceps. Change on the body." })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Barbell, 1 exercise" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "No equipment, 0 exercises" })).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Show 1 exercise" }));
    await waitFor(() => { expect(listed()).toEqual(["Barbell Curl"]); });
    expect(screen.getByRole("button", { name: "Remove Biceps" })).toBeTruthy();
  });

  it("the ✕ leaves the Library as it was; Clear all empties the choices", async () => {
    await openLibrary(libraryServer({ gender: "male" }).ask);
    await openFilters();
    await fireEvent.press(screen.getByRole("checkbox", { name: "Beginner, 1 exercise" }));
    expect(await screen.findByRole("button", { name: "Show 1 exercise" })).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Clear all" }));
    expect(await screen.findByRole("button", { name: "Show 3 exercises" })).toBeTruthy();
    await fireEvent.press(screen.getByRole("checkbox", { name: "Beginner, 1 exercise" }));
    await fireEvent.press(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => { expect(listed()).toEqual(["Barbell Curl", "Plank", "Squat"]); });
    expect(screen.getByRole("button", { name: "Filters" })).toBeTruthy();
  });

  it("a choice a search has hidden still shows, lit, to be let go; the Library says the filters hide the match, not the word", async () => {
    await openLibrary(libraryServer({ gender: "male" }).ask);
    await openFilters();
    await fireEvent.press(screen.getByRole("checkbox", { name: "Barbell, 1 exercise" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Show 1 exercise" }));
    await fireEvent.changeText(await screen.findByPlaceholderText("Search exercises"), "plank");
    // The Plank matches "plank": it is Barbell that hides it.
    expect(await screen.findByText("No exercises match these filters")).toBeTruthy();
    expect(screen.queryByText("No exercises match “plank”")).toBeNull();
    await openFilters();
    const barbell = screen.getByRole("checkbox", { name: "Barbell, 0 exercises" });
    expect(barbell.props.accessibilityState).toMatchObject({ checked: true, disabled: false });
    await fireEvent.press(barbell);
    expect(await screen.findByRole("button", { name: "Show 1 exercise" })).toBeTruthy();
  });

  it("a lit kind chip on the Library lets its kind go", async () => {
    await openLibrary(libraryServer({ gender: "male" }).ask);
    await fireEvent.press(await screen.findByRole("radio", { name: "Strength" }));
    expect(screen.getByRole("radio", { name: "Strength" }).props.accessibilityState).toMatchObject({ selected: true });
    await fireEvent.press(screen.getByRole("radio", { name: "Strength" }));
    expect(screen.getByRole("radio", { name: "All" }).props.accessibilityState).toMatchObject({ selected: true });
  });

  it("its numbers count within the search, and the kind chips and its Kind are one choice", async () => {
    await openLibrary(libraryServer({ gender: "male" }).ask);
    await fireEvent.changeText(await screen.findByPlaceholderText("Search exercises"), "plank");
    await openFilters();
    expect(screen.getByRole("button", { name: "Show 1 exercise" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Intermediate, 1 exercise" })).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: /^Beginner/ })).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Close" }));
    await fireEvent.changeText(screen.getByPlaceholderText("Search exercises"), "");
    await fireEvent.press(await screen.findByRole("radio", { name: "Strength" }));
    await openFilters();
    expect(screen.getByRole("checkbox", { name: "Strength, 3 exercises" }).props.accessibilityState).toMatchObject({ checked: true });
  });

  it("the Find by muscle card is not shown while searching", async () => {
    await openLibrary(libraryServer({ gender: "male" }).ask);
    expect(await screen.findByRole("button", { name: "Find by muscle. Tap a muscle on the body." })).toBeTruthy();
    await fireEvent.changeText(screen.getByPlaceholderText("Search exercises"), "squat");
    await waitFor(() => { expect(screen.queryByRole("button", { name: /^Find by muscle/ })).toBeNull(); });
  });
});

describe("an exercise's page", () => {
  it("Muscles names its three rows from its file; Instructions swipe; Mistakes pairs each fault with its fix; Sources open from ⓘ", async () => {
    await openLibrary(libraryServer().ask);
    await openExercise(/^Squat,/);
    expect(await screen.findByText("Quadriceps (rectus femoris, vastus lateralis, vastus medialis) · Glutes (gluteus maximus)")).toBeTruthy();
    expect(screen.getByText("Hamstrings (biceps femoris, semitendinosus and semimembranosus) · Adductors · Adductor magnus")).toBeTruthy();
    expect(screen.getByText("Glutes (gluteus medius) · Abs (rectus abdominis) · Transverse abdominis · Obliques · Lower back (erector spinae)")).toBeTruthy();
    for (const row of ["Primary", "Secondary", "Stabilisers"]) expect(screen.getByText(row)).toBeTruthy();
    expect(screen.getByText("Manual tracking")).toBeTruthy();
    expect(screen.getByLabelText("To start, 3 sets of 12 reps")).toBeTruthy();
    expect(screen.getByLabelText("No equipment")).toBeTruthy();

    await fireEvent.press(screen.getByRole("button", { name: "Instructions" }));
    expect(await screen.findByLabelText(/^Step 1 of 6\. Stand with your feet/)).toBeTruthy();
    expect(screen.getByLabelText(/^Step 2 of 6\./)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();

    await fireEvent.press(screen.getByRole("button", { name: "Mistakes" }));
    expect(await screen.findByText("Heels lift off the floor.")).toBeTruthy();
    expect(screen.getByText("Keep your whole foot down and lower only as far as your heels stay flat.")).toBeTruthy();

    expect(screen.queryByText(/National Academy of Sports Medicine/)).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Sources" }));
    expect(await screen.findByText("National Academy of Sports Medicine (NASM), Exercise Library: Prisoner Squat (muscles worked)")).toBeTruthy();
  });

  it.each([
    ["female", "female"],
    ["male", "male"],
    ["other", "male"],
    ["prefer_not_to_say", "male"],
    [null, "male"],
  ] as const)("setup's answer %s shows the %s figures only, with no switch", async (gender, figure) => {
    await openLibrary(libraryServer({ gender }).ask);
    await openExercise(/^Plank,/);
    await waitFor(() => { expect(screen.getAllByTestId(`figure-${figure}-front`).length).toBeGreaterThan(0); });
    const other = figure === "female" ? "male" : "female";
    expect(screen.queryAllByTestId(`figure-${other}-front`)).toHaveLength(0);
    expect(screen.queryAllByTestId(`figure-${other}-back`)).toHaveLength(0);
    expect(screen.queryByRole("radio", { name: "Male" })).toBeNull();
    expect(screen.queryByRole("radio", { name: "Female" })).toBeNull();
  });

  it("until the setup answer is known no figure is drawn, on the cards or the page: never the other one first", async () => {
    // Setup's answer held back until the test has looked, then let go, so no request outlives the test.
    let release: (reply: Reply) => void = () => undefined;
    const held = () => new Promise<Reply>((resolve) => { release = resolve; });
    await openLibrary(libraryServer({ gender: "female", onboarding: held }).ask);
    expect(await screen.findByText("3 Exercises")).toBeTruthy();
    const anyFigure = () => ["male", "female"].flatMap((x) => ["front", "back"].flatMap((y) => screen.queryAllByTestId(`figure-${x}-${y}`)));
    expect(anyFigure()).toHaveLength(0);
    await openExercise(/^Plank,/);
    await settle(300);
    expect(anyFigure()).toHaveLength(0);
    // The muscles are still named in words.
    expect(screen.getByText("Abs (rectus abdominis) · Transverse abdominis")).toBeTruthy();
    release(refusal(500, "server_error", "Not now."));
    await settle(50);
  });

  it("once known, the person's own figure is kept: with no answer from the server it is still hers", async () => {
    const server = libraryServer({ gender: "female" });
    await openLibrary(server.ask);
    await waitFor(() => { expect(screen.getAllByTestId("figure-female-front").length).toBeGreaterThan(0); });
    await screen.unmount();
    await openLibrary(libraryServer({ onboarding: lost }).ask);
    await waitFor(() => { expect(screen.getAllByTestId("figure-female-front").length).toBeGreaterThan(0); });
    expect(screen.queryAllByTestId("figure-male-front")).toHaveLength(0);
  });
});

describe("your records, calories and My Workout on an exercise's page (63c)", () => {
  it("the worst thing: on one phone, each person sees only their own My Workout", async () => {
    const SITA = { ...RAVI, id: "3d1f9b2a-8c4e-4f6a-9b7d-2e5c8a1f0d3b", email: "sita@example.com", displayName: "Sita" };
    await openLibrary(libraryServer().ask);
    await openExercise(/^Squat,/);
    await fireEvent.press(await screen.findByRole("button", { name: "Add to workout" }));
    expect(await screen.findByText("1 in My Workout")).toBeTruthy();
    await screen.unmount();
    // The app closed; Sita signs in on the same phone.
    forgetStores();
    await render(<App extra={extra} store={memoryStore(kept(1, SITA))} ask={libraryServer().ask} />);
    await fireEvent.press(await screen.findByRole("tab", { name: "Workout" }));
    await fireEvent.press(await screen.findByRole("button", { name: "My Workout" }));
    expect(await screen.findByText("No exercises yet")).toBeTruthy();
    expect(screen.queryByText("Squat")).toBeNull();
    await screen.unmount();
    // Ravi again: his own list, read from his own file.
    forgetStores();
    await openLibrary(libraryServer().ask);
    await fireEvent.press(await screen.findByRole("button", { name: "My Workout, 1" }));
    expect(await screen.findByText("Squat")).toBeTruthy();
  });

  it("records as the loaded bar, the LED timer and the last times; the plates add up to the weight", async () => {
    await openLibrary(libraryServer({ records: { barbell_curl: () => ({ status: 200, body: CURL_RECORDS }) } }).ask);
    await openExercise(/^Barbell Curl,/);
    expect(await screen.findByLabelText("Heaviest, 35 kg for 8 reps, 14 Nov")).toBeTruthy();
    expect(screen.getByLabelText("One-rep max, an estimate, about 44.3 kg")).toBeTruthy();
    // A 20 kg bar with a 5 and a 2.5 a side is 35 kg; the estimate's 2.5 and 2 a side lie beyond them.
    expect(screen.getByLabelText("A bar loaded with 5, 2.5 kilogram plates a side")).toBeTruthy();
    expect(screen.getAllByTestId("plate-lifted")).toHaveLength(4);
    expect(screen.getAllByTestId("plate-estimate")).toHaveLength(4);
    expect(screen.getByLabelText("Most reps, 15, at 20 kg · 2 Nov")).toBeTruthy();
    expect(screen.getByLabelText("Best volume, 880 kg, all sets · 14 Nov")).toBeTruthy();
    expect(screen.getByText("HEAVIEST SET · YOUR LAST 3 TIMES")).toBeTruthy();
    expect(screen.getByLabelText("14 Nov, 35, your record")).toBeTruthy();
    // "PR" is said in words once, for somebody new to gyms (Kd asked what it meant).
    expect(screen.getByText("PR · your personal record")).toBeTruthy();
    expect(screen.getByLabelText("6 Nov, 30")).toBeTruthy();
  });

  it("no records yet: one line, no box; records that cannot load say so, and Try again asks again", async () => {
    let fail = true;
    const server = libraryServer({ records: { squat: () => (fail ? refusal(500, "server_error", "Not now.") : { status: 200, body: noRecords("squat") }) } });
    await openLibrary(server.ask);
    await openExercise(/^Plank,/);
    expect(await screen.findByText("Your best hold shows here after your first workout.")).toBeTruthy();
    expect(screen.queryByTestId("records")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Close" }));
    await openExercise(/^Squat,/);
    expect(await screen.findByText("Your records couldn’t load.")).toBeTruthy();
    fail = false;
    await fireEvent.press(screen.getByRole("button", { name: "Load your records again" }));
    expect(await screen.findByText("Your best set shows here after your first workout.")).toBeTruthy();
  });

  it("calories a minute for the person's weight; with none, at 70 kg with the button to add it", async () => {
    await openLibrary(libraryServer({ weightKg: 82 }).ask);
    await openExercise(/^Barbell Curl,/);
    // MET 3.5 at 82 kg is 4.8 a minute.
    expect(await screen.findByText("About 5 kcal a minute for you, at 82 kg")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add your weight" })).toBeNull();
    await screen.unmount();
    forgetStores();
    await openLibrary(libraryServer({ weightKg: null }).ask);
    await openExercise(/^Barbell Curl,/);
    expect(await screen.findByText("About 4 kcal a minute at 70 kg")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Add your weight" }));
    expect(await screen.findByRole("button", { name: "Log measurements" })).toBeTruthy();
  });

  it("after Add your weight, coming back from Progress, the page says the weight now known (review H2)", async () => {
    let asked = 0;
    const answers = () => ({ status: 200, body: { answers: { ...ANSWERS, weightKg: asked++ === 0 ? null : 82 }, plan: null, missing: ["goal"] } });
    await openLibrary(libraryServer({ onboarding: answers }).ask);
    await openExercise(/^Barbell Curl,/);
    expect(await screen.findByText("About 4 kcal a minute at 70 kg")).toBeTruthy();
    const pageCloses = screen.getAllByRole("button", { name: "Close" });
    await fireEvent.press(screen.getByRole("button", { name: "Add your weight" }));
    expect(await screen.findByRole("button", { name: "Log measurements" })).toBeTruthy();
    // Progress's own ✕: the one that was not there before it opened over the exercise's page.
    const progressClose = screen.getAllByRole("button", { name: "Close" }).find((c) => !pageCloses.includes(c));
    if (progressClose === undefined) throw new Error("Progress has no Close");
    await fireEvent.press(progressClose);
    await waitFor(() => { expect(screen.queryByRole("button", { name: "Log measurements" })).toBeNull(); });
    expect(await screen.findByText("About 5 kcal a minute for you, at 82 kg")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add your weight" })).toBeNull();
  });

  it("no calories line until the weight is heard: never 'at 70 kg' of somebody whose weight is on its way", async () => {
    let release: (reply: Reply) => void = () => undefined;
    const held = () => new Promise<Reply>((resolve) => { release = resolve; });
    await openLibrary(libraryServer({ onboarding: held }).ask);
    await openExercise(/^Barbell Curl,/);
    await settle(300);
    expect(screen.queryByText(/kcal a minute/)).toBeNull();
    release({ status: 200, body: { answers: { ...ANSWERS, weightKg: 82 }, plan: null, missing: ["goal"] } });
    expect(await screen.findByText("About 5 kcal a minute for you, at 82 kg")).toBeTruthy();
  });

  it("Add to workout once, no repeats; Open shows My Workout with its count; ✕ removes; Browse exercises goes back", async () => {
    await openLibrary(libraryServer().ask);
    await openExercise(/^Barbell Curl,/);
    await fireEvent.press(await screen.findByRole("button", { name: "Add to workout" }));
    expect(await screen.findByText("1 in My Workout")).toBeTruthy();
    // Pressed again it comes out, and in again.
    await fireEvent.press(screen.getByRole("button", { name: "Added to workout. Press to take it out" }));
    expect(screen.queryByText("1 in My Workout")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Add to workout" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Open My Workout" }));
    expect(await screen.findByRole("button", { name: "My Workout, 1" })).toBeTruthy();
    // Curl 3 × (30 s + 60 s) less the last rest: 210 s, about 4 min. No weight given: the calories say at what weight.
    expect(screen.getByText(/^1 exercise · about 4 min · about \d+ kcal at 70 kg$/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add your weight" })).toBeTruthy();
    expect(screen.getByText("3 × 10 reps · rest 1:00")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start workout" }).props.accessibilityState).toMatchObject({ disabled: false });
    await fireEvent.press(screen.getByRole("button", { name: "Remove Barbell Curl" }));
    expect(await screen.findByText("No exercises yet")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Browse exercises" }));
    expect(await screen.findByText("3 Exercises")).toBeTruthy();
  });

  it("an exercise opens its page from My Workout's set-up, already added", async () => {
    await openLibrary(libraryServer().ask);
    await openExercise(/^Plank,/);
    await fireEvent.press(await screen.findByRole("button", { name: "Add to workout" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Open My Workout" }));
    await fireEvent.press(await screen.findByRole("button", { name: /^Plank, .*Set up its sets$/ }));
    await fireEvent.press(await screen.findByRole("button", { name: "About Plank" }));
    expect(await screen.findByRole("button", { name: "Added to workout. Press to take it out" })).toBeTruthy();
    expect(screen.getByRole("alert").props.accessibilityLabel).toBe(`Caution: ${PLANK_CAUTION}`);
  });
});

describe("setting up My Workout's sets (64a-i)", () => {
  const openMine = async () => {
    await fireEvent.press(await screen.findByRole("button", { name: /^My Workout/ }));
  };
  const add = async (name: RegExp) => {
    await openExercise(name);
    await fireEvent.press(await screen.findByRole("button", { name: "Add to workout" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Close" }));
  };
  const row = (name: string) => screen.findByRole("button", { name: new RegExp(`^${name}, .*Set up its sets$`) });
  const names = () => screen.getAllByRole("button", { name: /Set up its sets$/ }).map((b) => String(b.props.accessibilityLabel).split(",")[0]);
  const keptFile = (ids: string[]) => {
    const file = new File(Paths.document, `my-workout-${RAVI.id}.json`);
    if (file.exists) file.delete();
    file.create();
    file.write(JSON.stringify({ v: 1, ids }));
  };

  it("the worst thing: the list the earlier version kept comes through the update whole, and what is set up is kept", async () => {
    keptFile(["barbell_curl", "squat", "plank"]);
    await openLibrary(libraryServer().ask);
    await fireEvent.press(await screen.findByRole("button", { name: "My Workout, 3" }));
    expect(await screen.findByText("3 × 10 reps · rest 1:00")).toBeTruthy();
    expect(screen.getByText("3 × 12 reps · rest 1:00")).toBeTruthy();
    expect(screen.getByText("3 × 30 s · rest 1:00")).toBeTruthy();
    await fireEvent.press(await row("Squat"));
    await fireEvent.press(screen.getByRole("button", { name: "More reps" }));
    await fireEvent.press(screen.getByRole("button", { name: "Done" }));
    expect(await screen.findByText("3 × 13 reps · rest 1:00")).toBeTruthy();
    await settle(50);
    await screen.unmount();
    // The app closed and opened again: every exercise there, in its order, Squat as it was set up.
    forgetStores();
    await openLibrary(libraryServer().ask);
    await fireEvent.press(await screen.findByRole("button", { name: "My Workout, 3" }));
    expect(await screen.findByText("3 × 13 reps · rest 1:00")).toBeTruthy();
    expect(names()).toEqual(["Barbell Curl", "Squat", "Plank"]);
  });

  it("the weight plate; every set changes together, or one set alone", async () => {
    await openLibrary(libraryServer().ask);
    await add(/^Barbell Curl,/);
    await openMine();
    await fireEvent.press(await row("Barbell Curl"));
    // The weight is a weight plate with its number, the same for every exercise (Kd's click-through).
    expect(screen.getByLabelText("Weight, none")).toBeTruthy();
    expect(screen.getByTestId("weight-plate")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Less weight" }).props.accessibilityState).toMatchObject({ disabled: true });
    // + from none is the empty 20 kg bar for a barbell exercise, then 2.5 kg a press.
    await fireEvent.press(screen.getByRole("button", { name: "More weight" }));
    expect(screen.getByLabelText("Weight, 20 kg")).toBeTruthy();
    for (let i = 0; i < 6; i++) await fireEvent.press(screen.getByRole("button", { name: "More weight" }));
    expect(screen.getByLabelText("Weight, 35 kg")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "More weight" })).toHaveLength(1);
    await fireEvent.press(screen.getByRole("button", { name: "More sets" }));
    expect(screen.getByLabelText("Sets, 4")).toBeTruthy();
    // The sets are always listed under the controls, Every set picked; the last set heavier and shorter.
    expect(screen.getByRole("button", { name: "Every set" }).props.accessibilityState).toMatchObject({ selected: true });
    await fireEvent.press(screen.getByRole("button", { name: "Set 4: 10 reps, 35 kg, rest 1:00" }));
    expect(screen.getByText("Set 4 only")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "More weight" }));
    await fireEvent.press(screen.getByRole("button", { name: "More weight" }));
    for (let i = 0; i < 4; i++) await fireEvent.press(screen.getByRole("button", { name: "Fewer reps" }));
    expect(screen.getByRole("button", { name: "Set 4: 6 reps, 40 kg, rest 1:00" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Set 1: 10 reps, 35 kg, rest 1:00" })).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Done" }));
    expect(await screen.findByText("4 sets · 10, 10, 10, 6 reps · 35 to 40 kg · rest 1:00")).toBeTruthy();
    // Opened again: real numbers and the bar, never "--" (Kd's click-through). Every set shows the first set's.
    await fireEvent.press(await row("Barbell Curl"));
    expect(screen.getByLabelText("Reps, 10 reps")).toBeTruthy();
    expect(screen.getByLabelText("Weight, 35 kg")).toBeTruthy();
    expect(screen.getByTestId("weight-plate")).toBeTruthy();
    expect(screen.queryByText(/varies/)).toBeNull();
    // A press on Every set makes every set that number, and each line says so.
    await fireEvent.press(screen.getByRole("button", { name: "More reps" }));
    expect(screen.getByLabelText("Reps, 11 reps")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Set 4: 11 reps, 40 kg, rest 1:00" })).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Done" }));
    expect(await screen.findByText("4 × 11 reps · 35 to 40 kg · rest 1:00")).toBeTruthy();
  });

  it("a weight can be typed: on every set, or on the set picked; a weight that cannot be read is said", async () => {
    await openLibrary(libraryServer().ask);
    await add(/^Plank,/);
    await openMine();
    await fireEvent.press(await row("Plank"));
    await fireEvent.press(screen.getByRole("button", { name: "Type a weight" }));
    await fireEvent.changeText(screen.getByLabelText("Weight in kg"), "fifty");
    await fireEvent.press(screen.getByRole("button", { name: "Set weight" }));
    expect(screen.getByText("Enter a weight such as 47.5.")).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText("Weight in kg"), "5000");
    await fireEvent.press(screen.getByRole("button", { name: "Set weight" }));
    expect(screen.getByText("Enter a weight up to 1,000 kg.")).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText("Weight in kg"), "12,5");
    await fireEvent(screen.getByLabelText("Weight in kg"), "submitEditing");
    expect(screen.getByLabelText("Weight, 12.5 kg")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Set 3: 30 s, 12.5 kg, rest 1:00" })).toBeTruthy();
    // On one set: tap the plate itself to type.
    await fireEvent.press(screen.getByRole("button", { name: "Set 2: 30 s, 12.5 kg, rest 1:00" }));
    await fireEvent.press(screen.getByRole("button", { name: "Weight, 12.5 kg" }));
    await fireEvent.changeText(screen.getByLabelText("Weight in kg"), "20");
    await fireEvent(screen.getByLabelText("Weight in kg"), "submitEditing");
    expect(screen.getByRole("button", { name: "Set 2: 30 s, 20 kg, rest 1:00" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Set 1: 30 s, 12.5 kg, rest 1:00" })).toBeTruthy();
    // Emptied, it is no weight.
    await fireEvent.press(screen.getByRole("button", { name: "Type a weight" }));
    await fireEvent.changeText(screen.getByLabelText("Weight in kg"), "");
    await fireEvent(screen.getByLabelText("Weight in kg"), "submitEditing");
    expect(screen.getByRole("button", { name: "Set 2: 30 s, rest 1:00" })).toBeTruthy();
  });

  it("a typed weight is kept when the person presses Done or ✕ with the keyboard still up (review H1)", async () => {
    await openLibrary(libraryServer().ask);
    await add(/^Plank,/);
    await openMine();
    await fireEvent.press(await row("Plank"));
    await fireEvent.press(screen.getByRole("button", { name: "Type a weight" }));
    await fireEvent.changeText(screen.getByLabelText("Weight in kg"), "50");
    // Neither the keyboard's own key nor Set weight: the box's Done.
    await fireEvent.press(screen.getByRole("button", { name: "Done" }));
    expect(await screen.findByText("3 × 30 s · 50 kg · rest 1:00")).toBeTruthy();
    // And by the ✕.
    await fireEvent.press(await row("Plank"));
    await fireEvent.press(screen.getByRole("button", { name: "Type a weight" }));
    await fireEvent.changeText(screen.getByLabelText("Weight in kg"), "40");
    await fireEvent.press(screen.getByRole("button", { name: "Close" }));
    expect(await screen.findByText("3 × 30 s · 40 kg · rest 1:00")).toBeTruthy();
    // Done with words that cannot be read keeps the box and says so; nothing is lost in silence.
    await fireEvent.press(await row("Plank"));
    await fireEvent.press(screen.getByRole("button", { name: "Type a weight" }));
    await fireEvent.changeText(screen.getByLabelText("Weight in kg"), "fifty");
    await fireEvent.press(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByText("Enter a weight such as 47.5.")).toBeTruthy();
    expect(screen.getByLabelText("Weight in kg")).toBeTruthy();
  });

  it("typing, then picking another set or pressing + or −, keeps the typed weight on the set it was typed for (review L2)", async () => {
    await openLibrary(libraryServer().ask);
    await add(/^Plank,/);
    await openMine();
    await fireEvent.press(await row("Plank"));
    await fireEvent.press(screen.getByRole("button", { name: "Set 1: 30 s, rest 1:00" }));
    await fireEvent.press(screen.getByRole("button", { name: "Type a weight" }));
    await fireEvent.changeText(screen.getByLabelText("Weight in kg"), "10");
    // Another set picked while the keyboard is up: the 10 kg stays on set 1.
    await fireEvent.press(screen.getByRole("button", { name: "Set 2: 30 s, rest 1:00" }));
    expect(screen.getByRole("button", { name: "Set 1: 30 s, 10 kg, rest 1:00" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Set 2: 30 s, rest 1:00" })).toBeTruthy();
    // On set 2, typing then + : the typed weight is kept and the press goes on from it.
    await fireEvent.press(screen.getByRole("button", { name: "Type a weight" }));
    await fireEvent.changeText(screen.getByLabelText("Weight in kg"), "20");
    await fireEvent.press(screen.getByRole("button", { name: "More weight" }));
    expect(screen.getByRole("button", { name: "Set 2: 30 s, 22.5 kg, rest 1:00" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Set 1: 30 s, 10 kg, rest 1:00" })).toBeTruthy();
  });

  it("a timed exercise is set in time; its weight starts at none and can be added (a weighted plank); the rest too", async () => {
    await openLibrary(libraryServer().ask);
    await add(/^Plank,/);
    await openMine();
    await fireEvent.press(await row("Plank"));
    expect(screen.getByLabelText("Time, 00:30")).toBeTruthy();
    expect(screen.queryByLabelText(/^Reps/)).toBeNull();
    expect(screen.getByLabelText("Weight, none")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "More weight" }));
    expect(screen.getByLabelText("Weight, 2.5 kg")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Less weight" }));
    expect(screen.getByLabelText("Weight, none")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "More time" }));
    await fireEvent.press(screen.getByRole("button", { name: "Less rest" }));
    expect(screen.getByLabelText("Time, 00:35")).toBeTruthy();
    expect(screen.getByLabelText("Rest, 00:45")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Close" }));
    expect(await screen.findByText("3 × 35 s · rest 0:45")).toBeTruthy();
  });

  it("the workout's name, about how long and how many calories, Reorder, and Clear asking first", async () => {
    await openLibrary(libraryServer({ weightKg: 82 }).ask);
    await add(/^Barbell Curl,/);
    await add(/^Plank,/);
    await openMine();
    // Curl 3 × (30 s + 60 s) and Plank 3 × (30 s + 60 s), less the last rest: 480 s, 8 minutes, at the person's 82 kg.
    const kcal = Math.round((3.5 * 82 * 90 + 1.8 * 82 * 180 + 2.8 * 82 * 90 + 1.8 * 82 * 120) / 3600);
    expect(await screen.findByText(`2 exercises · about 8 min · about ${String(kcal)} kcal`)).toBeTruthy();
    // Their own weight: no "at 70 kg", no Add your weight.
    expect(screen.queryByRole("button", { name: "Add your weight" })).toBeNull();
    await fireEvent.changeText(screen.getByLabelText("Workout name"), "Arms and core");
    expect(screen.getByLabelText("Workout name").props.value).toBe("Arms and core");
    await fireEvent.press(screen.getByRole("button", { name: "Reorder exercises" }));
    expect(screen.queryByRole("button", { name: "Remove Plank" })).toBeNull();
    expect(screen.getByRole("button", { name: "Move Barbell Curl up" }).props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(screen.getByRole("button", { name: "Move Plank up" }));
    await fireEvent.press(screen.getByRole("button", { name: "Done reordering" }));
    expect(names()).toEqual(["Plank", "Barbell Curl"]);
    // Clear asks first: Keep it keeps everything.
    await fireEvent.press(screen.getByRole("button", { name: "Clear this workout" }));
    expect(await screen.findByText("All 2 exercises will be removed.")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Keep it" }));
    expect(names()).toEqual(["Plank", "Barbell Curl"]);
    await fireEvent.press(screen.getByRole("button", { name: "Clear this workout" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Clear workout" }));
    expect(await screen.findByText("No exercises yet")).toBeTruthy();
    expect(screen.getByLabelText("Workout name").props.value).toBe("Arms and core");
    expect(screen.getByRole("button", { name: "My Workout" })).toBeTruthy();
  });

  it("Add your weight on My Workout, and back: the calories are at the person's own weight (re-check L8)", async () => {
    // The weight is given in Progress: until then the server has none.
    let weighed = false;
    const answers = () => ({ status: 200, body: { answers: { ...ANSWERS, weightKg: weighed ? 82 : null }, plan: null, missing: ["goal"] } });
    await openLibrary(libraryServer({ onboarding: answers }).ask);
    await add(/^Barbell Curl,/);
    await openMine();
    expect(await screen.findByText(/^1 exercise · about 4 min · about \d+ kcal at 70 kg$/)).toBeTruthy();
    const closes = screen.queryAllByRole("button", { name: "Close" });
    await fireEvent.press(screen.getByRole("button", { name: "Add your weight" }));
    expect(await screen.findByRole("button", { name: "Log measurements" })).toBeTruthy();
    weighed = true;
    const progressClose = screen.getAllByRole("button", { name: "Close" }).find((c) => !closes.includes(c));
    if (progressClose === undefined) throw new Error("Progress has no Close");
    await fireEvent.press(progressClose);
    // Curl 3 × 10 at 82 kg: 90 s of work and 120 s of rest.
    const kcal = Math.round((3.5 * 82 * 90 + 1.8 * 82 * 120) / 3600);
    expect(await screen.findByText(`1 exercise · about 4 min · about ${String(kcal)} kcal`)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add your weight" })).toBeNull();
  });

  it("Add exercises goes back to the Library", async () => {
    await openLibrary(libraryServer().ask);
    await add(/^Squat,/);
    await openMine();
    await fireEvent.press(await screen.findByRole("button", { name: "Add exercises" }));
    expect(await screen.findByText("3 Exercises")).toBeTruthy();
  });
});

describe("doing a workout (64a-ii)", () => {
  /** My Workout as the phone keeps it. */
  const keptWorkout = (items: unknown[]) => {
    const file = new File(Paths.document, `my-workout-${RAVI.id}.json`);
    if (file.exists) file.delete();
    file.create();
    file.write(JSON.stringify({ v: 2, name: "Legs", items }));
  };
  /** Squat, one set of 2 reps with no rest after it; Plank, one set of 5 s. */
  const SQUAT = { id: "squat", plan: { measuredIn: "reps", sets: [{ target: 2, weightGrams: null, restSeconds: null }] } };
  const PLANK = { id: "plank", plan: { measuredIn: "time", sets: [{ target: 5, weightGrams: null, restSeconds: null }] } };
  type Save = { key: string | undefined; body: { workoutId: string; sets: { exercise: string; done: number }[] } };
  /** The server with the save route, each workout kept once by its id, as 61a's route does. */
  function withSaves(answer: (workoutId: string) => Reply = (workoutId) => ({ status: 201, body: { workoutId, status: "created" } }), library = libraryServer()) {
    const saves: Save[] = [];
    const ask: Ask = async (url, init) => {
      if (new URL(url).pathname !== "/v1/workouts" || init.method !== "POST") return library.ask(url, init);
      const body = JSON.parse(init.body ?? "{}") as Save["body"];
      const reply = answer(body.workoutId);
      if (reply.status < 300) saves.push({ key: init.headers?.["idempotency-key"], body });
      return { ok: reply.status < 300, status: reply.status, json: () => Promise.resolve(reply.body) };
    };
    return { ask, saves };
  }
  const openMine = async () => {
    await fireEvent.press(await screen.findByRole("button", { name: /^My Workout/ }));
  };

  it("the worst thing: a workout done is saved to the account once, under its own id, and opening the app again sends nothing more", async () => {
    keptWorkout([SQUAT]);
    const server = withSaves();
    await openLibrary(server.ask);
    await openMine();
    await fireEvent.press(await screen.findByRole("button", { name: "Start workout" }));
    expect(await screen.findByText("Exercise 1 of 1 · Set 1 of 1")).toBeTruthy();
    expect(screen.getByText("The last set of this workout")).toBeTruthy();
    // + counts; at its target the set ends by itself, and with it the workout.
    await fireEvent.press(screen.getByRole("button", { name: "One rep more" }));
    expect(screen.getByRole("button", { name: "Set done · 1 rep" })).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "One rep more" }));
    expect(await screen.findByText("Workout complete")).toBeTruthy();
    expect(await screen.findByText("Saved to your account")).toBeTruthy();
    expect(server.saves).toHaveLength(1);
    const save = server.saves[0];
    expect(save?.key).toBe(save?.body.workoutId);
    expect(save?.body.sets.map((s) => [s.exercise, s.done])).toEqual([["squat", 2]]);
    await fireEvent.press(screen.getByRole("button", { name: "Done" }));
    expect(await screen.findByRole("button", { name: "Start workout" })).toBeTruthy();
    await settle(50);
    await screen.unmount();
    forgetStores();
    await openLibrary(server.ask);
    await openMine();
    await settle(100);
    expect(server.saves).toHaveLength(1);
  });

  it("with no answer the workout is kept on the phone, and its screen says so", async () => {
    keptWorkout([SQUAT]);
    const server = withSaves(noInternet);
    await openLibrary(server.ask);
    await openMine();
    await fireEvent.press(await screen.findByRole("button", { name: "Start workout" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Set done · 2 reps" }));
    expect(await screen.findByText("Saved on this phone")).toBeTruthy();
    expect(screen.getByText("It goes to your account as soon as it can.")).toBeTruthy();
    const waiting = new File(Paths.document, `workouts-${RAVI.id}.json`);
    expect((JSON.parse(await waiting.text()) as { waiting: unknown[] }).waiting).toHaveLength(1);
  });

  it("put away mid-workout: a bar over the tabs and Open workout on My Workout open it again where it was", async () => {
    keptWorkout([SQUAT, PLANK]);
    await openLibrary(withSaves().ask);
    await openMine();
    await fireEvent.press(await screen.findByRole("button", { name: "Start workout" }));
    await fireEvent.press(await screen.findByRole("button", { name: "One rep more" }));
    expect(screen.getByText("Plank · 1 × 5 s")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Put workout away" }));
    expect(await screen.findByText(/^In progress · \d\d:\d\d$/)).toBeTruthy();
    expect(screen.getByText("Workout in progress")).toBeTruthy();
    // The bar on another tab too.
    await fireEvent.press(screen.getByRole("tab", { name: "Dashboard" }));
    expect(await screen.findByText("Workout in progress")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Open workout" }));
    expect(await screen.findByRole("button", { name: "Set done · 1 rep" })).toBeTruthy();
  });

  it("a timed set after no rest gets ready first; End asks first and keeps the sets done", async () => {
    keptWorkout([SQUAT, PLANK]);
    const server = withSaves();
    await openLibrary(server.ask);
    await openMine();
    await fireEvent.press(await screen.findByRole("button", { name: "Start workout" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Set done · 2 reps" }));
    expect(await screen.findByText("GET READY")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start now" })).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "End workout" }));
    expect(await screen.findByText("1 of 2 sets done. Those sets will be saved.")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Keep going" }));
    expect(screen.getByRole("button", { name: "Start now" })).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "End workout" }));
    await fireEvent.press(await screen.findByRole("button", { name: "End and save" }));
    expect(await screen.findByText("Saved to your account")).toBeTruthy();
    expect(server.saves.map((s) => s.body.sets.length)).toEqual([1]);
  });

  it("End with nothing done keeps nothing; Pause stops every clock", async () => {
    keptWorkout([SQUAT]);
    const server = withSaves();
    await openLibrary(server.ask);
    await openMine();
    await fireEvent.press(await screen.findByRole("button", { name: "Start workout" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Pause workout" }));
    expect(await screen.findByLabelText("Paused")).toBeTruthy();
    // Every clock stops (round one): the time shown stays where it was while seconds pass.
    const shown = screen.getByText(/^\d\d:\d\d$/).props.children as string;
    await settle(2200);
    expect(screen.getByText(/^\d\d:\d\d$/).props.children).toBe(shown);
    expect(screen.getByRole("button", { name: "Resume" })).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Resume" }));
    expect(screen.queryByLabelText("Paused")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "End workout" }));
    expect(await screen.findByText("No sets done yet. Nothing will be saved.")).toBeTruthy();
    const ends = screen.getAllByRole("button", { name: "End workout" });
    const last = ends[ends.length - 1];
    if (last === undefined) throw new Error("no End workout in the box");
    await fireEvent.press(last);
    expect(await screen.findByRole("button", { name: "Start workout" })).toBeTruthy();
    await settle(50);
    expect(server.saves).toHaveLength(0);
  });

  // ── after it (64a-iii): the workout's last screen.
  const ALLERGY = "Have a food allergy? Always check the label.";
  const LABELS = "Check labels too: some breads and cheeses contain animal ingredients.";
  const yogurt = { canonical: "greek_yogurt_plain_nonfat", name: "Greek yogurt (plain, nonfat)", grams: 175, servings: 175, unit: "g", kcal: 103, proteinG: 17.9, carbsG: 6.4, fatG: 0.7 };
  /** The server's summary of a workout, as 64a-iii's route answers it: 60 XP, a 5-day streak, the squat's most reps. */
  const afterOf = (workoutId: string, over: Record<string, unknown> = {}) => ({
    workoutId,
    kcalPoint: 118,
    weightKg: 82,
    effort: null,
    xp: { earned: 60, forWorkout: 50, forStreak: 10, forBadges: 0, view: { total: 532, level: 3, xpInLevel: 184, xpForNext: 374, progressPct: 49.2, nextLevelAt: 722 } },
    streak: { days: 5, today: true },
    records: [{ exercise: "squat", exerciseName: "Squat", measuredIn: "reps", kind: "most_reps", position: 0, value: 2 }],
    food: { ideas: [{ when: "soon", idea: { kind: "light", items: [yogurt], totals: { kcal: 162, proteinG: 19.2, carbsG: 20.6, fatG: 1.1 } } }], caution: ALLERGY, labelCaution: LABELS },
    ...over,
  });
  type Effort = { path: string; body: { effort: number } };
  /** The server with the save, the summary and the stars' routes. */
  function withAfter(
    summary: (workoutId: string) => Reply = (workoutId) => ({ status: 200, body: afterOf(workoutId) }),
    save: (workoutId: string) => Reply = (workoutId) => ({ status: 201, body: { workoutId, status: "created" } }),
    extra: { hold?: Promise<void>; weightKg?: number } = {},
  ) {
    const efforts: Effort[] = [];
    const saves = withSaves(save, libraryServer(extra.weightKg === undefined ? {} : { weightKg: extra.weightKg }));
    const ask: Ask = async (url, init) => {
      const path = new URL(url).pathname;
      const summaryOf = /^\/v1\/training\/workouts\/([^/]+)\/summary$/.exec(path);
      if (summaryOf?.[1] !== undefined && init.method === "GET") {
        const reply = summary(summaryOf[1]);
        return { ok: reply.status < 300, status: reply.status, json: () => Promise.resolve(reply.body) };
      }
      const effortOf = /^\/v1\/training\/workouts\/([^/]+)\/effort$/.exec(path);
      if (effortOf?.[1] !== undefined && init.method === "PUT") {
        const body = JSON.parse(init.body ?? "{}") as Effort["body"];
        if (extra.hold !== undefined) await extra.hold;
        efforts.push({ path, body });
        return { ok: true, status: 200, json: () => Promise.resolve({ workoutId: effortOf[1], effort: body.effort }) };
      }
      return saves.ask(url, init);
    };
    return { ask, saves: saves.saves, efforts };
  }
  const finishSquat = async (ask: Ask) => {
    keptWorkout([SQUAT]);
    await openLibrary(ask);
    await openMine();
    await fireEvent.press(await screen.findByRole("button", { name: "Start workout" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Set done · 2 reps" }));
    expect(await screen.findByText("Workout complete")).toBeTruthy();
  };

  it("after it, the worst thing: every meal idea shows the allergy warning (and a vegetarian's the label warning)", async () => {
    await finishSquat(withAfter().ask);
    await fireEvent.press(screen.getByRole("button", { name: "Recover" }));
    expect(await screen.findByText("Within 30 minutes")).toBeTruthy();
    expect(screen.getByText(/^Greek yogurt \(plain, nonfat\) +175 g$/)).toBeTruthy();
    expect(screen.getByText("162 kcal · 19 g protein")).toBeTruthy();
    expect(screen.getByText(ALLERGY)).toBeTruthy();
    expect(screen.getByText(LABELS)).toBeTruthy();
  });

  it("after it, the worst thing: no meal idea is drawn without a warning beside it", async () => {
    await finishSquat(withAfter((id) => ({ status: 200, body: afterOf(id, { food: { ideas: afterOf(id).food.ideas, caution: "", labelCaution: null } }) })).ask);
    await fireEvent.press(screen.getByRole("button", { name: "Recover" }));
    // A summary whose warning is empty is never read: the ideas wait as if the server had not answered.
    expect(await screen.findByText("Couldn't load meal ideas.")).toBeTruthy();
    expect(screen.queryByText(/^Greek yogurt/)).toBeNull();
  });

  it("after it: the time, calories and sets; XP, the level and the streak; a new record; every set done", async () => {
    await finishSquat(withAfter().ask);
    expect(await screen.findByText("+60 XP")).toBeTruthy();
    expect(screen.getByText("50 for the workout · 10 for your streak")).toBeTruthy();
    expect(screen.getByText("184/374 XP → Level 4")).toBeTruthy();
    expect(screen.getByText("5-day streak")).toBeTruthy();
    expect(screen.getByText("About 118 kcal for you, at 82 kg")).toBeTruthy();
    expect(screen.getByLabelText("Kcal, about 118 calories")).toBeTruthy();
    expect(screen.getByText("New records · 1")).toBeTruthy();
    expect(screen.getByLabelText("New record, Most reps, Squat · set 1, 2 reps")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Sets" }));
    expect(await screen.findByText("1 exercise · 1 set")).toBeTruthy();
    expect(screen.getByLabelText(/^Set 1, 2 reps .*a new record$/)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Recover" }));
    expect(await screen.findByText("Hip flexor stretch")).toBeTruthy();
    expect(screen.getByText("30 seconds each side")).toBeTruthy();
    expect(screen.getByText("Drink about 500 ml of water in the next 30 minutes.")).toBeTruthy();
  });

  it("after it: the stars are saved to the workout, the last one pressed kept", async () => {
    const server = withAfter();
    await finishSquat(server.ask);
    expect(await screen.findByText("Tap a star")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "4 of 5: Challenging" }));
    await fireEvent.press(screen.getByRole("button", { name: "3 of 5: Just right" }));
    expect(await screen.findByText("Just right · Saved")).toBeTruthy();
    const id = server.saves[0]?.body.workoutId ?? "";
    expect(server.efforts.map((e) => [e.path, e.body.effort])).toEqual([
      [`/v1/training/workouts/${id}/effort`, 4],
      [`/v1/training/workouts/${id}/effort`, 3],
    ]);
  });

  it("after it with no internet: what the phone holds shows, the stars wait on the phone, the rest says when it comes", async () => {
    const server = withAfter(undefined, noInternet);
    await finishSquat(server.ask);
    expect(await screen.findByText("Saved on this phone")).toBeTruthy();
    expect(screen.getByText("Your XP and records show here once this workout reaches your account.")).toBeTruthy();
    expect(screen.getByLabelText("Kcal, not yet known")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "3 of 5: Just right" }));
    expect(await screen.findByText("Just right · Saved on this phone")).toBeTruthy();
    await settle(50);
    const stars = new File(Paths.document, `workout-effort-${RAVI.id}.json`);
    expect((JSON.parse(await stars.text()) as { waiting: { effort: number }[] }).waiting.map((e) => e.effort)).toEqual([3]);
    expect(server.efforts).toHaveLength(0);
    await fireEvent.press(screen.getByRole("button", { name: "Sets" }));
    expect(await screen.findByText("1 exercise · 1 set")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Recover" }));
    expect(await screen.findByText("Meal ideas show here once this workout reaches your account.")).toBeTruthy();
    expect(screen.getByText("Hip flexor stretch")).toBeTruthy();
  });

  it("after it: a summary that cannot be read says so, and Try again reads it", async () => {
    let fails = true;
    await finishSquat(withAfter((id) => (fails ? { status: 500, body: { error: "internal" } } : { status: 200, body: afterOf(id) })).ask);
    expect(await screen.findByText("Couldn't load your XP and records.")).toBeTruthy();
    fails = false;
    await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("+60 XP")).toBeTruthy();
  });

  it("after it, a first workout: no records box and no streak line", async () => {
    await finishSquat(withAfter((id) => ({ status: 200, body: afterOf(id, { records: [], streak: { days: 0, today: false }, xp: { ...afterOf(id).xp, earned: 50, forStreak: 0 } }) })).ask);
    expect(await screen.findByText("+50 XP")).toBeTruthy();
    expect(screen.getByText("50 for the workout")).toBeTruthy();
    expect(screen.queryByText(/^New records/)).toBeNull();
    expect(screen.queryByText(/-day streak$/)).toBeNull();
  });

  it("after it: New workout opens the Library", async () => {
    await finishSquat(withAfter().ask);
    await fireEvent.press(screen.getByRole("button", { name: "New workout" }));
    expect(await screen.findByText("3 Exercises")).toBeTruthy();
  });

  it("after it, round one L2: the stars say Saved only once the server has them", async () => {
    const gate: { open: () => void } = { open: () => undefined };
    const hold = new Promise<void>((resolve) => {
      gate.open = resolve;
    });
    const server = withAfter(undefined, undefined, { hold });
    await finishSquat(server.ask);
    expect(await screen.findByText("Tap a star")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "3 of 5: Just right" }));
    expect(await screen.findByText("Just right")).toBeTruthy();
    await settle(100);
    expect(screen.queryByText("Just right · Saved")).toBeNull();
    expect(server.efforts).toHaveLength(0);
    gate.open();
    expect(await screen.findByText("Just right · Saved")).toBeTruthy();
    expect(server.efforts).toHaveLength(1);
  });

  it("after it, round one L1: a person who has given their weight is told their next workouts use it, never asked again", async () => {
    await finishSquat(withAfter((id) => ({ status: 200, body: afterOf(id, { weightKg: null }) })).ask);
    expect(await screen.findByText("About 118 kcal, at 70 kg")).toBeTruthy();
    expect(screen.queryByText("Your weight is saved. Your next workouts use it.")).toBeNull();
    await screen.unmount();
    forgetStores();
    await finishSquat(withAfter((id) => ({ status: 200, body: afterOf(id, { weightKg: null }) }), undefined, { weightKg: 82 }).ask);
    expect(await screen.findByText("About 118 kcal, at 70 kg")).toBeTruthy();
    expect(await screen.findByText("Your weight is saved. Your next workouts use it.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add your weight" })).toBeNull();
  });

  it("after it, round one L5: a workout the server refused says on Results why it earns nothing", async () => {
    await finishSquat(withAfter(undefined, () => ({ status: 400, body: { error: "validation_error", message: "x" } })).ask);
    expect(await screen.findByText("This workout couldn't be saved.")).toBeTruthy();
    expect(screen.getByText("This workout wasn't saved, so it earns no XP or records.")).toBeTruthy();
    expect(screen.queryByText("How hard was it?")).toBeNull();
  });
});

describe("saved workouts (64a-iv)", () => {
  const SQUAT_SETS = [{ target: 2, weightGrams: null, restSeconds: null }];
  const PUSH = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  /** My Workout as the phone keeps it. */
  const keptWorkout = (name: string, items: unknown[], from: string | null = null) => {
    const file = new File(Paths.document, `my-workout-${RAVI.id}.json`);
    if (file.exists) file.delete();
    file.create();
    file.write(JSON.stringify({ v: 2, name, items, from }));
  };
  type Held = { name: string; editedAt: string; exercises: { exercise: string; measuredIn: string; sets: unknown[] }[] };
  /** The server's saved workouts, as 61c's routes keep them; `state.online` false is no internet. Workouts done are kept too. */
  function withSaved(start: Record<string, Held> = {}, library = libraryServer()) {
    const account = new Map<string, Held>(Object.entries(start));
    const changes: { method: string; id: string; body: unknown }[] = [];
    const workouts: { startedFrom: string }[] = [];
    const state = { online: true };
    const ask: Ask = async (url, init) => {
      const path = new URL(url).pathname;
      if (path === "/v1/workouts" && init.method === "POST") {
        const body = JSON.parse(init.body ?? "{}") as { workoutId: string; startedFrom: string };
        workouts.push(body);
        return { ok: true, status: 201, json: () => Promise.resolve({ workoutId: body.workoutId, status: "created" }) };
      }
      if (!path.startsWith("/v1/training/saved")) return library.ask(url, init);
      if (!state.online) throw new Error("Network request failed");
      const id = path.split("/")[4];
      const answer = (status: number, body: unknown) => ({ ok: status < 300, status, json: () => (status === 204 ? Promise.reject(new Error("no body")) : Promise.resolve(body)) });
      if (id === undefined) {
        const list = [...account.entries()]
          .sort((x, y) => y[1].editedAt.localeCompare(x[1].editedAt))
          .map(([key, w]) => ({ id: key, name: w.name, editedAt: w.editedAt, exercises: [...new Set(w.exercises.map((e) => e.exercise))], setsCount: w.exercises.reduce((n, e) => n + e.sets.length, 0) }));
        return answer(200, { savedWorkouts: list, most: 50 });
      }
      if (init.method === "PUT") {
        const body = JSON.parse(init.body ?? "{}") as Held;
        changes.push({ method: "PUT", id, body });
        const had = account.has(id);
        account.set(id, body);
        return answer(had ? 200 : 201, { id, status: had ? "updated" : "created", editedAt: body.editedAt });
      }
      if (init.method === "DELETE") {
        changes.push({ method: "DELETE", id, body: null });
        account.delete(id);
        return answer(204, null);
      }
      const held = account.get(id);
      return held === undefined ? answer(404, { error: "not_found", message: "saved workout not found" }) : answer(200, { id, ...held });
    };
    return { ask, account, changes, workouts, state };
  }
  const push: Held = { name: "Push day", editedAt: "2026-11-20T10:00:00.000Z", exercises: [{ exercise: "barbell_curl", measuredIn: "reps", sets: [{ target: 8, weightGrams: 25_000, restSeconds: 60 }] }] };
  const openMine = async () => {
    await fireEvent.press(await screen.findByRole("button", { name: /^My Workout/ }));
  };

  it("the worst thing: saved with no signal, it is kept on the phone, and reaches the account once the app opens with signal", async () => {
    keptWorkout("Legs", [{ id: "squat", plan: { measuredIn: "reps", sets: SQUAT_SETS } }]);
    const server = withSaved();
    server.state.online = false;
    await openLibrary(server.ask);
    await openMine();
    await fireEvent.press(await screen.findByRole("button", { name: "Save workout" }));
    expect(await screen.findByText("1 exercise · 1 set")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Saved on this phone.")).toBeTruthy();
    expect(screen.getByText("It goes to your account as soon as it can.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Load Legs/ })).toBeTruthy();
    expect(server.account.size).toBe(0);
    await settle(50);
    await screen.unmount();
    forgetStores();

    server.state.online = true;
    await openLibrary(server.ask);
    await openMine();
    await waitFor(() => {
      expect(server.account.size).toBe(1);
    });
    const [held] = [...server.account.values()];
    expect(held?.name).toBe("Legs");
    expect(held?.exercises).toEqual([{ exercise: "squat", measuredIn: "reps", sets: SQUAT_SETS }]);
    expect(await screen.findByText("Saved")).toBeTruthy();
    expect(screen.queryByText("Saved on this phone.")).toBeNull();
  });

  it("a change to the saved workout reads Save changes; it saves over the same one, or as a new one", async () => {
    keptWorkout("Legs", [{ id: "squat", plan: { measuredIn: "reps", sets: SQUAT_SETS } }]);
    const server = withSaved();
    await openLibrary(server.ask);
    await openMine();
    await fireEvent.press(await screen.findByRole("button", { name: "Save workout" }));
    await fireEvent.press(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(server.account.size).toBe(1);
    });
    expect(await screen.findByText("Saved")).toBeTruthy();
    expect(screen.getByText("In My Workout")).toBeTruthy();
    // Removing the squat's own set-up is a change: here the name, which the saved workout holds too.
    await fireEvent.changeText(screen.getByLabelText("Workout name"), "Legs B");
    await fireEvent.press(await screen.findByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Save changes?")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Save changes to Legs" }));
    await waitFor(() => {
      expect(server.changes.filter((c) => c.method === "PUT")).toHaveLength(2);
    });
    expect([...server.account.values()].map((w) => w.name)).toEqual(["Legs B"]);
    expect(await screen.findByText("Saved")).toBeTruthy();
    // Renamed again and saved as a new one: both kept.
    await fireEvent.changeText(screen.getByLabelText("Workout name"), "Legs C");
    await fireEvent.press(await screen.findByRole("button", { name: "Save changes" }));
    await fireEvent.press(screen.getByRole("button", { name: "Save as a new workout" }));
    await waitFor(() => {
      expect(server.account.size).toBe(2);
    });
    expect([...server.account.values()].map((w) => w.name).sort()).toEqual(["Legs B", "Legs C"]);
  });

  it("loading over a workout that isn't saved asks first; Keep mine keeps it; Load puts it in My Workout, and a workout done from it says so", async () => {
    keptWorkout("Legs", [{ id: "squat", plan: { measuredIn: "reps", sets: SQUAT_SETS } }]);
    const server = withSaved({ [PUSH]: { ...push, exercises: [{ exercise: "squat", measuredIn: "reps", sets: [{ target: 1, weightGrams: null, restSeconds: null }] }] } });
    await openLibrary(server.ask);
    await openMine();
    await fireEvent.press(await screen.findByRole("button", { name: /^Load Push day/ }));
    expect(await screen.findByText("Load Push day?")).toBeTruthy();
    expect(screen.getByText("Legs isn't saved. Push day takes its place in My Workout.")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Keep mine" }));
    expect((screen.getByLabelText("Workout name").props as { value: string }).value).toBe("Legs");
    await fireEvent.press(screen.getByRole("button", { name: /^Load Push day/ }));
    await fireEvent.press(await screen.findByRole("button", { name: "Load Push day" }));
    expect(await screen.findByText("Push day is in My Workout.")).toBeTruthy();
    expect((screen.getByLabelText("Workout name").props as { value: string }).value).toBe("Push day");
    expect(screen.getByText("Saved")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Start workout" }));
    await fireEvent.press(await screen.findByRole("button", { name: "One rep more" }));
    await waitFor(() => {
      expect(server.workouts.map((w) => w.startedFrom)).toEqual(["saved"]);
    });
  });

  it("with nothing to lose it loads with no question; one this phone never held needs the internet, and says so", async () => {
    const server = withSaved({ [PUSH]: push });
    await openLibrary(server.ask);
    await openMine();
    expect(await screen.findByText("No exercises yet")).toBeTruthy();
    expect(await screen.findByText("Saved workouts")).toBeTruthy();
    server.state.online = false;
    await fireEvent.press(await screen.findByRole("button", { name: /^Load Push day/ }));
    expect(await screen.findByText("Couldn't load Push day. Check your internet connection and try again.")).toBeTruthy();
    server.state.online = true;
    await fireEvent.press(screen.getByRole("button", { name: /^Load Push day/ }));
    expect(await screen.findByText("Push day is in My Workout.")).toBeTruthy();
    expect(screen.queryByText("Load Push day?")).toBeNull();
    expect(screen.getByRole("button", { name: /^Barbell Curl/ })).toBeTruthy();
  });

  it("the bin asks first; Keep it keeps it; Delete deletes it, and My Workout keeps the exercises of the one it held", async () => {
    keptWorkout("Push day", [{ id: "barbell_curl", plan: { measuredIn: "reps", sets: push.exercises[0]?.sets } }], PUSH);
    const server = withSaved({ [PUSH]: push });
    await openLibrary(server.ask);
    await openMine();
    await fireEvent.press(await screen.findByRole("button", { name: "Delete Push day" }));
    expect(await screen.findByText("Delete Push day?")).toBeTruthy();
    expect(screen.getByText("It's removed from your saved workouts. My Workout keeps its exercises.")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Keep it" }));
    expect(server.changes).toEqual([]);
    await fireEvent.press(screen.getByRole("button", { name: "Delete Push day" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Delete" }));
    expect(await screen.findByText("Push day was deleted.")).toBeTruthy();
    await waitFor(() => {
      expect(server.changes).toEqual([{ method: "DELETE", id: PUSH, body: null }]);
    });
    expect(screen.queryByRole("button", { name: /^Load Push day/ })).toBeNull();
    expect(screen.getByRole("button", { name: /^Barbell Curl/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save workout" })).toBeTruthy();
  });

  it("the newest three are on the page; See all opens every one", async () => {
    const at = (day: number) => `2026-11-${String(day).padStart(2, "0")}T10:00:00.000Z`;
    const server = withSaved({
      [PUSH]: { ...push, editedAt: at(10) },
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc": { ...push, name: "Core", editedAt: at(11) },
      "dddddddd-dddd-4ddd-8ddd-dddddddddddd": { ...push, name: "Arms", editedAt: at(12) },
      "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee": { ...push, name: "Legs", editedAt: at(13) },
    });
    await openLibrary(server.ask);
    await openMine();
    const loads = () => screen.getAllByRole("button", { name: /^Load / }).map((b) => (b.props as { accessibilityLabel: string }).accessibilityLabel.split(",")[0]);
    await waitFor(() => {
      expect(loads()).toEqual(["Load Legs", "Load Arms", "Load Core"]);
    });
    await fireEvent.press(screen.getByRole("button", { name: "See all 4" }));
    expect(await screen.findByText("4 saved workouts of 50")).toBeTruthy();
    expect(loads()).toEqual(["Load Legs", "Load Arms", "Load Core", "Load Legs", "Load Arms", "Load Core", "Load Push day"]);
  });
});
