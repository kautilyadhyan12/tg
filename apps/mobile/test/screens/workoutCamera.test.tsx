// The camera in a workout (ROADMAP Stage 5 64b-ii; spec Part 2 §11.8 steps 3 to 6; Kd's drawing of 2026-11-28 and his own
// words for its question). The task in the person's words: "I start my leg workout, pick the camera for my squats, stand my
// phone up, and it counts my sets and checks my form; the rest is timed and the next set starts by itself."
//
// THE WORST THING THIS JOB COULD DO TO A REAL PERSON: a form score saved for a set no camera watched, or the camera still on
// while the screen says it is off (a rest, a set counted by hand, the workout put away). Both come first: a set counted
// manually keeps no camera facts and never turns the camera on; in a rest, after Count this set myself, after the camera
// stops and with the workout put away, there is no camera at all; and a real set of squats saves its numbers and nothing of
// the body.
import type { MovementFrame } from "@app/shared";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { File, Paths } from "expo-file-system";
import { decodeBodyPoints } from "../../../../packages/movement/scripts/bodyPoints";
import { App } from "../../src/App";
import type { PoseEvent } from "../../src/camera/poseFrame";
import { CAMERA_OFF } from "../../src/look/cameraWords";
import { forgetStores } from "../../src/library/myWorkout";
import { LIBRARY_PATH } from "../../src/library/store";
import { STOPPED_WORDS } from "../../src/screens/camera/CameraSet";
import { ASK_PRIVACY, RESUMES_WORDS } from "../../src/screens/workout/cameraWords";
import type { Ask } from "../../src/session/calls";
import { fakeServer, kept, memoryStore, RAVI, tokens, type Reply } from "../kit";

const extra = { copyName: "Exercise 2", apiUrl: "http://localhost:3000" };
const FOLDER = `${__dirname}/../../../../packages/shared/library/exercises/`;

interface PoseCameraFake {
  missing: boolean;
  props: { active: boolean } | null;
  actives: boolean[];
  answer: (e: PoseEvent) => void;
  fail: (reason: string) => void;
  reset: () => void;
}
const poseCamera = jest.requireMock<{ poseCamera: PoseCameraFake }>("../../src/camera/poseCameraNative").poseCamera;
const camera = jest.requireMock<{ camera: { permission: unknown; afterAsk: unknown; asked: number } }>("expo-camera").camera;
const sounds = jest.requireMock<{ sounds: { played: string[]; spoken: { id: string; index: number }[]; hushed: number } }>("../../src/sound/soundNative").sounds;

const GRANTED = { granted: true, canAskAgain: true, status: "granted", expires: "never" };
const BLOCKED = { granted: false, canAskAgain: false, status: "denied", expires: "never" };
const EARTH = 9.81;

/** A kept frame as the camera module sends it (modules/pose-camera's onPose). */
function eventOf(f: MovementFrame): PoseEvent {
  const down = f.down ?? [0, 1, 0];
  return {
    t: 5_000_000 + f.t,
    width: 480 * f.aspect,
    height: 480,
    gravity: [down[0] * EARTH, down[1] * EARTH, -down[2] * EARTH],
    turn: 0,
    people: f.people.map((p) => ({ points: p.points.flat(), world: p.world === null ? [] : p.world.flat() })),
  };
}

// A real person's set: the living-room woman's three prisoner squats, facing the phone (spec §12.5, counted by eye 3), her
// first and last pictures held a second each, as the camera screen's own tests play it.
const SQUATS = ((): PoseEvent[] => {
  const file = join(__dirname, "..", "..", "..", "..", "packages", "movement", "test", "movement-points", "prisoner_squat_1.bodypoints");
  const { frames } = decodeBodyPoints(new Uint8Array(readFileSync(file)));
  const first = frames[0];
  const last = frames[frames.length - 1];
  const step = (frames[1]?.t ?? 0) - (first?.t ?? 0);
  if (first === undefined || last === undefined || step <= 0) throw new Error("no video");
  const n = Math.round(1000 / step);
  const lead = Array.from({ length: n }, (_, k) => ({ ...first, t: first.t + k * step }));
  const body = frames.map((f) => ({ ...f, t: f.t + n * step }));
  const tail = Array.from({ length: n }, (_, k) => ({ ...last, t: last.t + (n + k + 1) * step }));
  return [...lead, ...body, ...tail].map(eventOf);
})();

async function play(events: readonly PoseEvent[]) {
  for (const e of events) {
    await act(() => {
      poseCamera.answer(e);
    });
  }
}

/** The Library as the server publishes it: the squat (its camera file judges its form) and the kettlebell goblet squat (the
 *  camera counts it by the squat's movement, with no form rules of its own yet). */
function download() {
  const exercises = ["squat.json", "kettlebell_goblet_squat.json"].map((name) => ({ ...(JSON.parse(readFileSync(`${FOLDER}${name}`, "utf8")) as Record<string, unknown>), status: "live", met: 3 }));
  return { fingerprint: "c".repeat(64), version: 1, list: { exercises, camera: [] } };
}

interface Saved {
  sets: { exercise: string; done: number; counted: string; camera?: { done: number; left: string | null; summary: { repScores: number[] } | null } }[];
}

/** The server: the Library, an empty set of records, and the save route, each workout kept once by its id. */
function server() {
  const saves: Saved[] = [];
  const bodies: string[] = [];
  const noRecords = (exercise: string): Reply => ({ status: 200, body: { exercise, reps: { heaviest: null, mostReps: null, bestEstimated1rm: null, mostLifted: null }, time: { longestHold: null, heaviest: null }, recent: [], days: {}, limitedToDays: null } });
  const rest = fakeServer({
    "/v1/auth/refresh": () => ({ status: 200, body: { tokens: tokens(2) } }),
    "/v1/training/exercises/squat/records": () => noRecords("squat"),
    "/v1/training/exercises/kettlebell_goblet_squat/records": () => noRecords("kettlebell_goblet_squat"),
  });
  const ask: Ask = async (url, init) => {
    const path = new URL(url).pathname;
    if (path === LIBRARY_PATH) return { ok: true, status: 200, json: () => Promise.resolve(download()) };
    if (path === "/v1/workouts" && init.method === "POST") {
      const body = init.body ?? "{}";
      bodies.push(body);
      const save = JSON.parse(body) as Saved & { workoutId: string };
      saves.push(save);
      return { ok: true, status: 201, json: () => Promise.resolve({ workoutId: save.workoutId, status: "created" }) };
    }
    return rest.ask(url, init);
  };
  return { ask, saves, bodies };
}

/** My Workout as the phone keeps it: each exercise with `sets` sets of `reps` and the rest after each. */
function keptWorkout(items: { id: string; sets: number; reps: number; rest: number | null }[]) {
  const file = new File(Paths.document, `my-workout-${RAVI.id}.json`);
  if (file.exists) file.delete();
  file.create();
  file.write(
    JSON.stringify({
      v: 2,
      name: "Legs",
      items: items.map((i) => ({ id: i.id, plan: { measuredIn: "reps", sets: Array.from({ length: i.sets }, () => ({ target: i.reps, weightGrams: null, restSeconds: i.rest })) } })),
    }),
  );
}

/** Workout → My Workout → Start workout, signed in on a folder's copy. */
async function start(ask: Ask) {
  await render(<App extra={extra} store={memoryStore(kept(1))} ask={ask} />);
  await fireEvent.press(await screen.findByRole("tab", { name: "Workout" }));
  await fireEvent.press(await screen.findByRole("button", { name: /^My Workout/ }));
  await fireEvent.press(await screen.findByRole("button", { name: "Start workout" }));
}

const settle = (ms: number) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
const cameraOn = () => screen.queryByTestId("pose-camera") !== null;

/** The phone's own Back, as Android hands it to the workout's screen. */
async function back() {
  const shown = screen.container.queryAll((node) => node.props["visible"] === true && typeof node.props["onRequestClose"] === "function").at(-1);
  if (shown === undefined) throw new Error("no screen to go back from");
  await fireEvent(shown, "requestClose");
}

/** The camera's box, from the button at the foot of its screen. */
const openBox = async () => {
  await fireEvent.press(screen.getByRole("button", { name: "Reps, weight, pause" }));
};

/** End and save, from wherever the workout is. */
async function endAndSave() {
  await fireEvent.press(screen.getByRole("button", { name: "End" }));
  await fireEvent.press(await screen.findByRole("button", { name: "End and save" }));
  expect(await screen.findByText("Workout complete")).toBeTruthy();
}

beforeEach(() => {
  for (const one of Paths.document.list()) if (one.name.startsWith("library-") || one.name.startsWith("figure-") || one.name.startsWith("my-workout-") || one.name.startsWith("workout") || one.name.startsWith("saved-")) one.delete();
  forgetStores();
  poseCamera.reset();
  camera.permission = GRANTED;
  camera.afterAsk = GRANTED;
  camera.asked = 0;
  sounds.played.length = 0;
  sounds.spoken.length = 0;
  sounds.hushed = 0;
});

describe("the worst thing first", () => {
  it("Count manually: the camera never comes on, and no set keeps a camera's facts or a form score", async () => {
    keptWorkout([{ id: "squat", sets: 2, reps: 3, rest: null }]);
    const s = server();
    await start(s.ask);
    expect(await screen.findByText("Live form check")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Count manually" }));
    expect(cameraOn()).toBe(false);
    expect(poseCamera.actives).toEqual([]);
    await fireEvent.press(screen.getByRole("button", { name: "Set done · 3 reps" }));
    // The same exercise's next set is not asked about again.
    expect(screen.queryByText("Live form check")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Set done · 3 reps" }));
    expect(await screen.findByText("Workout complete")).toBeTruthy();
    await settle(50);
    expect(s.saves).toHaveLength(1);
    expect(s.saves[0]?.sets.map((set) => [set.counted, set.done, set.camera])).toEqual([["hand", 3, undefined], ["hand", 3, undefined]]);
  });

  it("a real set of squats: counted by the camera and judged; the save holds its numbers and nothing of the body; the camera is off in the rest and on again after it", async () => {
    keptWorkout([{ id: "squat", sets: 2, reps: 3, rest: 60 }]);
    const s = server();
    await start(s.ask);
    await fireEvent.press(await screen.findByRole("button", { name: "Start with camera" }));
    expect(await screen.findByTestId("pose-camera")).toBeTruthy();
    expect(screen.getByLabelText("00 / 3")).toBeTruthy();
    await play(SQUATS);
    // At its target the set ends by itself: the rest, read from where the person stands, with the camera off.
    expect(await screen.findByTestId("camera-rest")).toBeTruthy();
    expect(cameraOn()).toBe(false);
    expect(screen.getByText("Set 1 complete")).toBeTruthy();
    expect(screen.getByLabelText("Reps 3")).toBeTruthy();
    expect(screen.getByLabelText(/^Form score \d{1,3}$/)).toBeTruthy();
    expect(screen.getByText("Camera off")).toBeTruthy();
    expect(screen.getByText(RESUMES_WORDS)).toBeTruthy();
    expect(screen.getByText("Set 2 of 2 · 3 reps")).toBeTruthy();
    // The coach said the set was complete.
    expect(sounds.spoken.map((c) => c.id)).toContain("set_complete");
    // Skip rest: the next set is the camera's, nothing asked.
    await fireEvent.press(screen.getByRole("button", { name: "Skip rest" }));
    expect(await screen.findByTestId("pose-camera")).toBeTruthy();
    expect(screen.queryByText("Live form check")).toBeNull();
    expect(screen.getByLabelText("00 / 3")).toBeTruthy();
    await openBox();
    await endAndSave();
    await settle(50);
    expect(s.saves).toHaveLength(1);
    const first = s.saves[0]?.sets[0];
    expect(first).toMatchObject({ counted: "camera", done: 3, camera: { done: 3, left: null } });
    expect(first?.camera?.summary?.repScores).toHaveLength(3);
    // Nothing of the body: no points, no pictures, nothing that is not a number or the files' own words.
    expect(s.bodies.join("")).not.toMatch(/points|world|people|picture|calibration|"t":/);
  });
});

describe("the question", () => {
  it("in Kd's words, and never a form check for an exercise the camera only counts", async () => {
    keptWorkout([{ id: "squat", sets: 1, reps: 3, rest: null }, { id: "kettlebell_goblet_squat", sets: 1, reps: 3, rest: null }]);
    await start(server().ask);
    expect(await screen.findByText("SQUAT")).toBeTruthy();
    expect(screen.getByText("Live form check")).toBeTruthy();
    expect(screen.getByText("Use your camera for automatic rep counts and feedback.")).toBeTruthy();
    expect(screen.getByText(ASK_PRIVACY)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Count manually" }));
    await fireEvent.press(screen.getByRole("button", { name: "Set done · 3 reps" }));
    // The next exercise the camera counts is asked about afresh.
    expect(await screen.findByText("KETTLEBELL GOBLET SQUAT")).toBeTruthy();
    expect(screen.getByText("Live rep count")).toBeTruthy();
    expect(screen.getByText("Use your camera for automatic rep counts and feedback.")).toBeTruthy();
    expect(screen.queryByText(/form check/)).toBeNull();
  });

  it("the camera turned off for the app in the phone's settings: the question says so, with the settings and Count manually", async () => {
    camera.permission = BLOCKED;
    camera.afterAsk = BLOCKED;
    keptWorkout([{ id: "squat", sets: 1, reps: 3, rest: null }]);
    await start(server().ask);
    expect(await screen.findByText(CAMERA_OFF.title)).toBeTruthy();
    expect(screen.getByText(CAMERA_OFF.line)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open settings" })).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Count manually" }));
    expect(cameraOn()).toBe(false);
    expect(screen.getByRole("button", { name: "Set done · 3 reps" })).toBeTruthy();
  });

  it("asked by the phone first where the camera was never allowed, then on", async () => {
    camera.permission = { granted: false, canAskAgain: true, status: "undetermined", expires: "never" };
    keptWorkout([{ id: "squat", sets: 1, reps: 3, rest: null }]);
    await start(server().ask);
    await fireEvent.press(await screen.findByRole("button", { name: "Start with camera" }));
    expect(await screen.findByTestId("pose-camera")).toBeTruthy();
    expect(camera.asked).toBe(1);
  });
});

describe("leaving the camera in a set", () => {
  it("Count this set myself: the camera goes off, the set goes on by hand on the workout's own screen, and is kept as the camera's set it was", async () => {
    keptWorkout([{ id: "squat", sets: 1, reps: 5, rest: null }]);
    const s = server();
    await start(s.ask);
    await fireEvent.press(await screen.findByRole("button", { name: "Start with camera" }));
    await play(SQUATS);
    expect(screen.getByLabelText("03 / 5")).toBeTruthy();
    await openBox();
    await fireEvent.press(screen.getByRole("button", { name: "Count this set myself" }));
    expect(cameraOn()).toBe(false);
    // The workout's own screen, the count kept; no way back to the camera for a set already left.
    expect(await screen.findByRole("button", { name: "Set done · 3 reps" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start with camera" })).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "One rep more" }));
    await fireEvent.press(screen.getByRole("button", { name: "One rep more" }));
    expect(await screen.findByText("Workout complete")).toBeTruthy();
    await settle(50);
    expect(s.saves[0]?.sets[0]).toMatchObject({ counted: "camera", done: 5, camera: { done: 3, left: "chosen" } });
  });

  it("the camera stops: the set goes on by hand and the screen says why", async () => {
    keptWorkout([{ id: "squat", sets: 1, reps: 5, rest: null }]);
    await start(server().ask);
    await fireEvent.press(await screen.findByRole("button", { name: "Start with camera" }));
    await screen.findByTestId("pose-camera");
    await act(() => {
      poseCamera.fail("camera");
    });
    expect(cameraOn()).toBe(false);
    expect(await screen.findByText(STOPPED_WORDS)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Set done · 5 reps" })).toBeTruthy();
  });

  it("put away in a set the camera counts: no camera while away; opened again, it counts on from the set's own count", async () => {
    keptWorkout([{ id: "squat", sets: 1, reps: 10, rest: null }]);
    await start(server().ask);
    await fireEvent.press(await screen.findByRole("button", { name: "Start with camera" }));
    await play(SQUATS);
    expect(screen.getByLabelText("03 / 10")).toBeTruthy();
    await back();
    expect(cameraOn()).toBe(false);
    expect(await screen.findByText("Workout in progress")).toBeTruthy();
    // The bar over the tabs (My Workout says Open workout too).
    const open = screen.getAllByRole("button", { name: "Open workout" })[0];
    if (open === undefined) throw new Error("no Open workout");
    await fireEvent.press(open);
    expect(await screen.findByTestId("pose-camera")).toBeTruthy();
    expect(screen.getByLabelText("03 / 10")).toBeTruthy();
  });

  it("Count manually, then Start with camera in the set: the reps counted are kept and the camera counts on from them", async () => {
    keptWorkout([{ id: "squat", sets: 1, reps: 10, rest: null }]);
    await start(server().ask);
    await fireEvent.press(await screen.findByRole("button", { name: "Count manually" }));
    await fireEvent.press(screen.getByRole("button", { name: "One rep more" }));
    await fireEvent.press(screen.getByRole("button", { name: "One rep more" }));
    await fireEvent.press(screen.getByRole("button", { name: "Start with camera" }));
    expect(await screen.findByTestId("pose-camera")).toBeTruthy();
    expect(screen.getByLabelText("02 / 10")).toBeTruthy();
    await play(SQUATS);
    expect(screen.getByLabelText("05 / 10")).toBeTruthy();
  });

  it("Follow along: the camera off, the clip's timer runs the set, and it is kept as the person's own count", async () => {
    keptWorkout([{ id: "squat", sets: 1, reps: 3, rest: null }]);
    const s = server();
    await start(s.ask);
    await fireEvent.press(await screen.findByRole("button", { name: "Start with camera" }));
    await screen.findByTestId("pose-camera");
    await fireEvent.press(screen.getByRole("button", { name: "Follow along" }));
    expect(await screen.findByTestId("follow-screen")).toBeTruthy();
    expect(cameraOn()).toBe(false);
    await fireEvent.press(screen.getByRole("button", { name: "Time, weight, pause" }));
    await fireEvent.press(screen.getByRole("button", { name: /^Set done/ }));
    await fireEvent.press(await screen.findByRole("button", { name: "One rep more" }));
    await fireEvent.press(screen.getByRole("button", { name: /^Done · \d+ reps?$/ }));
    expect(await screen.findByText("Workout complete")).toBeTruthy();
    await settle(50);
    const set = s.saves[0]?.sets[0];
    expect(set?.counted).toBe("hand");
    expect(set?.camera).toBeUndefined();
  });
});
