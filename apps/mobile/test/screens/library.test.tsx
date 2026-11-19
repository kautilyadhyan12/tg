// Workout → Exercises: the Exercise Library on the phone (ROADMAP Stage 5 63a). The worst thing it could do to
// a person is open an exercise without its caution, so that is tested first, on every tab of the page. The
// exercises are the real files, sent as the server publishes them.
import { readdirSync, readFileSync } from "node:fs";
import type { OnboardingAnswers } from "@app/shared";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { Paths } from "expo-file-system";
import { App } from "../../src/App";
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

describe("Find exercises (63b)", () => {
  const listed = () => screen.queryAllByRole("button", { name: /^(Barbell Curl|Plank|Squat),/ }).map((c) => String(c.props.accessibilityLabel).split(",")[0]);
  const openFind = async () => {
    await fireEvent.press(await screen.findByRole("button", { name: /^Find exercises/ }));
    return screen.findByText("Find exercises");
  };

  it("each choice says how many it shows, and Show opens exactly that many: the worst thing is a false count", async () => {
    await openLibrary(libraryServer({ gender: "male" }).ask);
    await openFind();
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
    expect(screen.getByRole("button", { name: "Find exercises, 2 filters on" })).toBeTruthy();
    // Each choice is a tag on the Library; letting one go widens the list again.
    await fireEvent.press(screen.getByRole("button", { name: "Remove No equipment" }));
    await waitFor(() => { expect(listed()).toEqual(["Barbell Curl", "Plank"]); });
    await fireEvent.press(screen.getByRole("button", { name: "Clear all" }));
    await waitFor(() => { expect(listed()).toEqual(["Barbell Curl", "Plank", "Squat"]); });
  });

  it("a muscle tapped on the person's own figure lights, says its count, and finds the exercises that work it", async () => {
    await openLibrary(libraryServer({ gender: "female" }).ask);
    await openFind();
    await waitFor(() => { expect(screen.getAllByTestId("figure-female-front").length).toBeGreaterThan(0); });
    expect(screen.queryAllByTestId("figure-male-front")).toHaveLength(0);
    // A muscle none of the three works cannot be pressed.
    expect(screen.queryAllByTestId("muscle-upper_chest")).toHaveLength(0);
    const [biceps] = screen.getAllByTestId("muscle-biceps");
    if (biceps === undefined) throw new Error("no biceps to tap");
    await fireEvent.press(biceps);
    expect(await screen.findByText("1 exercise")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove Biceps" })).toBeTruthy();
    // The line and name lie over the figure but never take a tap (on the phone a second tap did nothing).
    for (const layer of screen.getAllByTestId("muscle-leader")) expect(layer.props.pointerEvents).toBe("none");
    await fireEvent.press(screen.getAllByTestId("muscle-biceps")[0] ?? biceps);
    expect(await screen.findByRole("button", { name: "Show 3 exercises" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove Biceps" })).toBeNull();
    await fireEvent.press(screen.getAllByTestId("muscle-biceps")[0] ?? biceps);
    await fireEvent.press(screen.getByRole("button", { name: "Show 1 exercise" }));
    await waitFor(() => { expect(listed()).toEqual(["Barbell Curl"]); });
    expect(screen.getByRole("button", { name: "Remove Biceps" })).toBeTruthy();
  });

  it("the ✕ leaves the Library as it was; Clear all empties the choices", async () => {
    await openLibrary(libraryServer({ gender: "male" }).ask);
    await openFind();
    await fireEvent.press(screen.getByRole("checkbox", { name: "Beginner, 1 exercise" }));
    expect(await screen.findByRole("button", { name: "Show 1 exercise" })).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Clear all" }));
    expect(await screen.findByRole("button", { name: "Show 3 exercises" })).toBeTruthy();
    await fireEvent.press(screen.getByRole("checkbox", { name: "Beginner, 1 exercise" }));
    await fireEvent.press(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => { expect(listed()).toEqual(["Barbell Curl", "Plank", "Squat"]); });
    expect(screen.getByRole("button", { name: "Find exercises" })).toBeTruthy();
  });

  it("its numbers count within the search, and the kind chips and its Kind are one choice", async () => {
    await openLibrary(libraryServer({ gender: "male" }).ask);
    await fireEvent.changeText(await screen.findByPlaceholderText("Search exercises"), "plank");
    await openFind();
    expect(screen.getByRole("button", { name: "Show 1 exercise" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Intermediate, 1 exercise" })).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: /^Beginner/ })).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Close" }));
    await fireEvent.changeText(screen.getByPlaceholderText("Search exercises"), "");
    await fireEvent.press(await screen.findByRole("radio", { name: "Strength" }));
    await openFind();
    expect(screen.getByRole("checkbox", { name: "Strength, 3 exercises" }).props.accessibilityState).toMatchObject({ checked: true });
  });

  it("the Find by muscle card opens it, and is not shown while searching", async () => {
    await openLibrary(libraryServer({ gender: "male" }).ask);
    expect(await screen.findByRole("button", { name: "Find by muscle. Tap a muscle on the body." })).toBeTruthy();
    await fireEvent.changeText(screen.getByPlaceholderText("Search exercises"), "squat");
    await waitFor(() => { expect(screen.queryByRole("button", { name: /^Find by muscle/ })).toBeNull(); });
    await fireEvent.changeText(screen.getByPlaceholderText("Search exercises"), "");
    await fireEvent.press(await screen.findByRole("button", { name: "Find by muscle. Tap a muscle on the body." }));
    expect(await screen.findByText("Tap a muscle")).toBeTruthy();
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
