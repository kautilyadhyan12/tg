// Workout → Exercises: the Exercise Library on the phone (ROADMAP Stage 5 63a). The worst thing it could do to
// a person is open an exercise without its caution, so that is tested first, on every tab of the page. The
// exercises are the real files, sent as the server publishes them.
import { readdirSync, readFileSync } from "node:fs";
import type { OnboardingAnswers } from "@app/shared";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { Paths } from "expo-file-system";
import { App } from "../../src/App";
import { Gesture, State } from "react-native-gesture-handler";
import { fireGestureHandler, getByGestureTestId } from "react-native-gesture-handler/jest-utils";
import { FIGURES, type FigureName } from "../../src/library/figures";
import { toStage, WHOLE } from "../../src/library/stage";
import { LIBRARY_PATH } from "../../src/library/store";
import type { Ask } from "../../src/session/calls";
import { fakeServer, kept, lost, memoryStore, refusal, tokens, type Reply } from "../kit";

const extra = { copyName: "Exercise 2", apiUrl: "http://localhost:3000" };
const FOLDER = `${__dirname}/../../../../packages/shared/library/exercises/`;
const METS: Record<string, number> = { squat: 3, plank: 2.8, barbell_curl: 3.5 };
const PLANK_CAUTION = "If you feel pain in your lower back, stop at once and see a qualified healthcare professional.";

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
function libraryServer(opts: { library?: () => Reply; gender?: OnboardingAnswers["gender"]; onboarding?: () => Reply | Promise<Reply> } = {}) {
  let library = opts.library ?? ((): Reply => ({ status: 200, body: download() }));
  const server = fakeServer({
    "/v1/auth/refresh": () => ({ status: 200, body: { tokens: tokens(2) } }),
    "/v1/users/me/onboarding": opts.onboarding ?? (() => ({ status: 200, body: { answers: { ...ANSWERS, gender: opts.gender ?? null }, plan: null, missing: ["goal"] } })),
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
  for (const one of Paths.document.list()) if (one.name.startsWith("library-") || one.name.startsWith("figure-")) one.delete();
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
  /** A finger's tap on the stage, inside a muscle's shape on the person's figure. */
  const tapMuscle = (figure: FigureName, muscle: string, id = "muscle-tap") => {
    const part = FIGURES[figure].find((p) => p.m === muscle);
    if (part === undefined) throw new Error(`${figure} has no ${muscle}`);
    const [dx, dy] = insideOf(part.d);
    const at = toStage(WHOLE, dx, dy, STAGE.width, STAGE.height);
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
    expect(screen.getByText("Tap a muscle")).toBeTruthy();
    await tapMuscle("male-front", "biceps");
    expect(await screen.findByRole("button", { name: "Barbell Curl, Primary · Intermediate · 3 × 10 reps" })).toBeTruthy();
    expect(screen.getByText("1 exercise")).toBeTruthy();
    await tapMuscle("male-front", "biceps");
    expect(await screen.findByText("Tap a muscle")).toBeTruthy();
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
    await tapMuscle("male-front", "abs", "muscle-double-tap");
    expect(await screen.findByRole("button", { name: "Fit body" })).toBeTruthy();
    expect(screen.getByText("Tap a muscle")).toBeTruthy();
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
