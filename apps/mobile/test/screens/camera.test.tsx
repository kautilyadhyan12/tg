import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import type { MovementFrame } from "@app/shared";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Linking, processColor } from "react-native";
import { decodeBodyPoints } from "../../../../packages/movement/scripts/bodyPoints";
import { App } from "../../src/App";
import type { PoseEvent } from "../../src/camera/poseFrame";
import { FIRST_LINE, FIRST_TITLE } from "../../src/screens/camera/CameraFirst";
import type { BodyDrawing } from "../../src/camera/poseCameraNative";
import { BODY_LINES } from "../../src/camera/skeleton";
import { colours } from "../../src/look/colours";
import { SET_UP_WORDS, STOPPED_WORDS } from "../../src/screens/camera/CameraSet";
import { RAVI, fakeServer, kept, memoryStore, tokens } from "../kit";

// The camera screen (ROADMAP Stage 5 53a), tried from a folder's copy: Me → Try the camera → an exercise → the set, as Kd's
// drawing of 2026-11-26 has it. The task in the person's own words: "I stand my phone up, step back, do my squats, and the
// phone counts them."
//
// THE WORST THING THIS JOB COULD DO TO A REAL PERSON: keep or send their video or their body's points (Kd, 2026-10-18:
// "NOTHING SHOULD BE ONLINE ... EXCEPT THE END RESULT"). That comes first: a whole set of a real person's squats played to
// the screen, and nothing of it reaches the server, the phone's files or its log. (The camera module's own code writes
// nothing and sends nothing: test/poseCamera.test.ts.)

const extra = { copyName: "Exercise 1", apiUrl: "http://localhost:3000" };

interface PoseCameraFake {
  missing: boolean;
  props: { active: boolean; drawing: BodyDrawing } | null;
  actives: boolean[];
  answer: (e: PoseEvent) => void;
  fail: (reason: string) => void;
  reset: () => void;
}
const poseCamera = jest.requireMock<{ poseCamera: PoseCameraFake }>("../../src/camera/poseCameraNative").poseCamera;
const camera = jest.requireMock<{ camera: { permission: unknown; afterAsk: unknown; asked: number } }>("expo-camera").camera;
const sounds = jest.requireMock<{ sounds: { played: string[]; spoken: { id: string; index: number }[] } }>("../../src/sound/soundNative").sounds;
interface FakeFile {
  delete: () => void;
  exists: boolean;
}
const files = jest.requireMock<{
  File: { new (dir: unknown, name: string): FakeFile; prototype: { write: (text: string) => void; create: () => void } };
  Paths: { document: unknown };
}>("expo-file-system");

const GRANTED = { granted: true, canAskAgain: true, status: "granted", expires: "never" };
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
// first and last pictures held a second each, as the proof plays every video (movementCheck.ts `withLeadIn`): a live set
// starts and ends with the person in view.
const squats = (): PoseEvent[] => {
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
};
const SQUATS = squats();

async function play(events: readonly PoseEvent[]) {
  for (const e of events) {
    await act(() => {
      poseCamera.answer(e);
    });
  }
}

const server = () =>
  fakeServer({
    "/v1/auth/refresh": () => ({ status: 200, body: { tokens: tokens(2) } }),
  });

/** Me → Try the camera → the exercise, signed in on a folder's copy; the phone's key store it signed in with. */
async function openTry(name = "Squat", ask = server().ask, copy: { copyName?: string; apiUrl: string } = extra, store = memoryStore(kept(1))) {
  await render(<App extra={copy} store={store} ask={ask} />);
  await fireEvent.press(await screen.findByRole("tab", { name: "Me" }));
  if (copy.copyName === undefined) return;
  await fireEvent.press(await screen.findByRole("button", { name: "Try the camera" }));
  await fireEvent.press(await screen.findByText(name));
}

/** Past the first-time screen to the camera. */
async function turnOn() {
  expect(await screen.findByText(FIRST_TITLE)).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "Turn on the camera" }));
  await screen.findByTestId("pose-camera");
}

const countSays = (): string | undefined => screen.getByLabelText(/^\d+ \/ \d+$/).props.accessibilityLabel as string | undefined;

beforeEach(() => {
  // Each test is a person not yet told what the camera keeps private.
  for (const name of [`camera-told-${RAVI.id}.json`, `camera-told-${RAVI.id}.json.next`]) {
    const told = new files.File(files.Paths.document, name);
    if (told.exists) told.delete();
  }
  poseCamera.reset();
  camera.permission = GRANTED;
  camera.afterAsk = GRANTED;
  camera.asked = 0;
  sounds.played.length = 0;
  sounds.spoken.length = 0;
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe("the worst thing first: nothing of the person leaves the screen", () => {
  it("a whole set of a real person's squats reaches neither the server, nor the phone's files, nor its log", async () => {
    const fake = server();
    const store = memoryStore(kept(1));
    await openTry("Squat", fake.ask, extra, store);
    await turnOn();
    const asked = fake.asked.length;
    const keyStoreBefore = store.value;
    const keyStore = [jest.spyOn(store, "write"), jest.spyOn(store, "clear")];
    const written: string[] = [];
    const write = jest.spyOn(files.File.prototype, "write").mockImplementation(function (this: { uri: string }, text: string) {
      written.push(`${this.uri}: ${text.slice(0, 80)}`);
    });
    jest.spyOn(files.File.prototype, "create").mockImplementation(function (this: { uri: string }) {
      written.push(this.uri);
    });
    const moved = jest.spyOn(files.File.prototype as unknown as { move: (to: unknown) => void }, "move");
    const logged: unknown[] = [];
    for (const kind of ["log", "info", "warn", "error", "debug"] as const) jest.spyOn(console, kind).mockImplementation((...args: unknown[]) => { logged.push(args); });
    const fetched = jest.fn();
    const before = global.fetch;
    global.fetch = fetched;
    try {
      await play(SQUATS);
      expect(countSays()).toBe("03 / 10");
      await fireEvent.press(screen.getByTestId("camera-tap"));
      await fireEvent.press(screen.getByRole("button", { name: "Set done · 3 reps" }));
      expect(await screen.findByText("Set done")).toBeTruthy();
    } finally {
      global.fetch = before;
    }
    // Not one request since the camera came on, so nothing of the set could ride in one; and none at all by the phone's own
    // fetch.
    expect(fake.asked.slice(asked)).toEqual([]);
    expect(fetched).not.toHaveBeenCalled();
    expect(written).toEqual([]);
    expect(write).not.toHaveBeenCalled();
    expect(moved).not.toHaveBeenCalled();
    // Nor in the phone's key store, the one other place the app keeps anything.
    for (const spy of keyStore) expect(spy).not.toHaveBeenCalled();
    expect(store.value).toBe(keyStoreBefore);
    expect(logged).toEqual([]);
  });

  it("what the person is told before the camera first comes on, and the screen keeps saying it", async () => {
    await openTry();
    expect(await screen.findByText(FIRST_LINE)).toBeTruthy();
    await turnOn();
    await play(SQUATS.slice(0, 5));
    // While setting up, the set-up's words; the line of privacy is the first screen's, and the camera screen's in its box
    // (spec Part 2 §11.8, step 7), never over the person.
    expect(screen.getByText(SET_UP_WORDS)).toBeTruthy();
    expect(screen.queryByText(FIRST_LINE)).toBeNull();
    await fireEvent.press(screen.getByTestId("camera-tap"));
    expect(within(screen.getByTestId("camera-box")).getByText(FIRST_LINE)).toBeTruthy();
  });
});

describe("I stand my phone up, step back, do my squats, and the phone counts them", () => {
  it("set-up words until I stand ready, then each squat counted, green, with a short sound", async () => {
    await openTry();
    await turnOn();
    expect(countSays()).toBe("00 / 10");
    expect(screen.getByText(SET_UP_WORDS)).toBeTruthy();
    // The squat has no picture of its own in the Library yet: the app's own picture of it is the reference in the corner.
    expect(screen.getByTestId("camera-picture-squat")).toBeTruthy();
    await play(SQUATS);
    expect(screen.queryByText(SET_UP_WORDS)).toBeNull();
    expect(countSays()).toBe("03 / 10");
    expect(sounds.played.filter((s) => s === "rep")).toHaveLength(3);
    expect(screen.getByText("Squat · Set 1 of 1")).toBeTruthy();
    expect(screen.getByText("Tap the screen to change reps, weight or pause")).toBeTruthy();
  });

  it("the phone is told how to draw my body on its own picture, and the screen draws no second one behind it", async () => {
    await openTry();
    await turnOn();
    const drawing = poseCamera.props?.drawing;
    expect(drawing?.lines).toEqual(BODY_LINES.flatMap(([a, b]) => [a, b]));
    expect(drawing?.words).toBe("TRACKING YOU");
    expect(drawing?.font).toBe("Inter_700Bold");
    // The look's colours by their names, made the phone's own numbers.
    expect(drawing?.line).toBe(processColor(colours.bodyLine));
    expect(drawing?.glow).toBe(processColor(colours.bodyGlow));
    expect(drawing?.gold).toBe(processColor(colours.gold));
    await play(SQUATS.slice(0, 40));
    // Drawn by the app's script, the lines reached the screen after the picture (Kd at 53a's run).
    expect(screen.queryByTestId("camera-body")).toBeNull();
    expect(screen.queryByText(/Tracking you/i)).toBeNull();
  });

  it("a tap opens everything else; a rep put right by hand, the target and the weight; Set done says what I did", async () => {
    await openTry();
    await turnOn();
    await play(SQUATS);
    await fireEvent.press(screen.getByTestId("camera-tap"));
    const box = screen.getByTestId("camera-box");
    for (const name of ["Pause", "Sound on", "End", "Reset set", "Count this set myself", "Skip exercise"]) expect(within(box).getByRole("button", { name })).toBeTruthy();
    await fireEvent.press(within(box).getByRole("button", { name: "One rep more" }));
    expect(countSays()).toBe("04 / 10");
    await fireEvent.press(within(box).getByRole("button", { name: "Lower the target" }));
    expect(countSays()).toBe("04 / 9");
    expect(within(box).getByText("None")).toBeTruthy();
    await fireEvent.press(within(box).getByRole("button", { name: "More weight" }));
    expect(within(box).queryByText("None")).toBeNull();
    // Closed by a tap above it, the camera's screen is back as it was.
    await fireEvent.press(screen.getByTestId("camera-box-close"));
    expect(screen.queryByTestId("camera-box")).toBeNull();
    await fireEvent.press(screen.getByTestId("camera-tap"));
    await fireEvent.press(screen.getByRole("button", { name: "Set done · 4 reps" }));
    const done = await screen.findByTestId("camera-done");
    expect(within(done).getByText("4 reps")).toBeTruthy();
    // The squat's form is judged on each rep the camera counted (52b-ii): its score is said.
    expect(within(done).getByText(/^Form score \d+$/)).toBeTruthy();
    await fireEvent.press(within(done).getByRole("button", { name: "Done" }));
    await waitFor(() => { expect(screen.queryByTestId("camera-done")).toBeNull(); });
    expect(screen.getByRole("button", { name: "Try the camera" })).toBeTruthy();
  });

  it("the coach says the count as I near my target, and \"Set complete.\" when I end the set (53b-i)", async () => {
    await openTry();
    await turnOn();
    // Her three squats against a target of 4: "Two more." after the second, "Last one." after the third.
    await fireEvent.press(screen.getByTestId("camera-tap"));
    for (let n = 0; n < 6; n++) await fireEvent.press(screen.getByRole("button", { name: "Lower the target" }));
    await fireEvent.press(screen.getByTestId("camera-box-close"));
    await play(SQUATS);
    expect(countSays()).toBe("03 / 4");
    expect(sounds.spoken).toEqual([
      { id: "two_more", index: 0 },
      { id: "last_one", index: 0 },
    ]);
    // Proper squats: nothing to correct, and the line at the foot says nothing of the coach's.
    expect(screen.queryByTestId("camera-line")).toBeNull();
    await fireEvent.press(screen.getByTestId("camera-tap"));
    await fireEvent.press(screen.getByRole("button", { name: "Set done · 3 reps" }));
    await screen.findByTestId("camera-done");
    expect(sounds.spoken[sounds.spoken.length - 1]).toEqual({ id: "set_complete", index: 0 });
  });

  it("with Sound off the coach says nothing, and no rep sounds", async () => {
    await openTry();
    await turnOn();
    await fireEvent.press(screen.getByTestId("camera-tap"));
    for (let n = 0; n < 6; n++) await fireEvent.press(screen.getByRole("button", { name: "Lower the target" }));
    await fireEvent.press(screen.getByRole("button", { name: "Sound on" }));
    await fireEvent.press(screen.getByTestId("camera-box-close"));
    await play(SQUATS);
    expect(countSays()).toBe("03 / 4");
    await fireEvent.press(screen.getByTestId("camera-tap"));
    await fireEvent.press(screen.getByRole("button", { name: "Set done · 3 reps" }));
    await screen.findByTestId("camera-done");
    expect(sounds.spoken).toEqual([]);
    expect(sounds.played).toEqual([]);
  });

  it("the set ends by itself at its target", async () => {
    await openTry();
    await turnOn();
    await play(SQUATS);
    await fireEvent.press(screen.getByTestId("camera-tap"));
    // From 10 to 4 the camera's 3 do not reach it; at 3 they do.
    for (let n = 0; n < 6; n++) await fireEvent.press(screen.getByRole("button", { name: "Lower the target" }));
    expect(screen.queryByTestId("camera-done")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Lower the target" }));
    expect(within(await screen.findByTestId("camera-done")).getByText("3 reps")).toBeTruthy();
  });

  it("paused, the camera rests and counts nothing; resumed, it counts again", async () => {
    await openTry();
    await turnOn();
    await fireEvent.press(screen.getByTestId("camera-tap"));
    await fireEvent.press(screen.getByRole("button", { name: "Pause" }));
    expect(poseCamera.actives[poseCamera.actives.length - 1]).toBe(false);
    await play(SQUATS);
    expect(countSays()).toBe("00 / 10");
    await fireEvent.press(screen.getByRole("button", { name: "Resume" }));
    expect(poseCamera.actives[poseCamera.actives.length - 1]).toBe(true);
    // The same three squats a minute later: counted now.
    await play(SQUATS.map((e) => ({ ...e, t: e.t + 60_000 })));
    expect(countSays()).toBe("03 / 10");
  });

  it("Reset set starts the set again: its count, and its form score only from the reps after it", async () => {
    await openTry();
    await turnOn();
    await play(SQUATS);
    expect(countSays()).toBe("03 / 10");
    await fireEvent.press(screen.getByTestId("camera-tap"));
    await fireEvent.press(within(screen.getByTestId("camera-box")).getByRole("button", { name: "Reset set" }));
    expect(countSays()).toBe("00 / 10");
    await fireEvent.press(screen.getByRole("button", { name: "Set done · 0 reps" }));
    const done = await screen.findByTestId("camera-done");
    expect(within(done).getByText("0 reps")).toBeTruthy();
    // The three reset reps judged no form of this set.
    expect(within(done).queryByText(/^Form score/)).toBeNull();
  });
});

describe("when the camera cannot count the set", () => {
  it("the camera stops: said in one line, the set goes on by hand with what it had counted", async () => {
    await openTry();
    await turnOn();
    await play(SQUATS);
    await act(() => {
      poseCamera.fail("model");
    });
    expect(screen.getByText(STOPPED_WORDS)).toBeTruthy();
    expect(screen.queryByTestId("pose-camera")).toBeNull();
    const box = screen.getByTestId("camera-box");
    expect(within(box).queryByRole("button", { name: "Count this set myself" })).toBeNull();
    // The box stays: nothing above it closes it.
    expect(screen.queryByTestId("camera-box-close")).toBeNull();
    await fireEvent.press(within(box).getByRole("button", { name: "One rep more" }));
    expect(countSays()).toBe("04 / 10");
  });

  it("Count this set myself: the camera goes, the count and the box stay", async () => {
    await openTry();
    await turnOn();
    await play(SQUATS);
    await fireEvent.press(screen.getByTestId("camera-tap"));
    await fireEvent.press(screen.getByRole("button", { name: "Count this set myself" }));
    expect(screen.queryByTestId("pose-camera")).toBeNull();
    expect(screen.queryByText(STOPPED_WORDS)).toBeNull();
    expect(screen.getByTestId("camera-box")).toBeTruthy();
    expect(countSays()).toBe("03 / 10");
  });

  it("the camera turned off for the app in the phone's settings is said so, with the button that opens them", async () => {
    camera.permission = { granted: false, canAskAgain: false, status: "denied", expires: "never" };
    camera.afterAsk = camera.permission;
    const settings = jest.spyOn(Linking, "openSettings").mockResolvedValue(undefined);
    await openTry();
    expect(await screen.findByText("Camera access is off")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Open settings" }));
    expect(settings).toHaveBeenCalled();
    expect(screen.queryByTestId("pose-camera")).toBeNull();
  });

  it("Count myself on the first screen goes back, the camera never asked for", async () => {
    camera.permission = { granted: false, canAskAgain: true, status: "undetermined", expires: "never" };
    await openTry();
    await fireEvent.press(await screen.findByRole("button", { name: "Count myself" }));
    expect(camera.asked).toBe(0);
    expect(screen.queryByText(FIRST_TITLE)).toBeNull();
  });
});

describe("who is offered it", () => {
  it("the first screen is shown the first time only", async () => {
    await openTry();
    await turnOn();
    await fireEvent.press(screen.getByTestId("camera-tap"));
    await fireEvent.press(screen.getByRole("button", { name: "End" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Try the camera" }));
    await fireEvent.press(await screen.findByText("Lunge"));
    expect(await screen.findByTestId("pose-camera")).toBeTruthy();
    expect(screen.queryByText(FIRST_TITLE)).toBeNull();
    expect(screen.getByText(SET_UP_WORDS)).toBeTruthy();
  });

  it("every exercise the camera counts today is offered, with its target", async () => {
    await render(<App extra={extra} store={memoryStore(kept(1))} ask={server().ask} />);
    await fireEvent.press(await screen.findByRole("tab", { name: "Me" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Try the camera" }));
    for (const [name, target] of [
      ["Squat", "10 reps"],
      ["Kettlebell Goblet Squat", "10 reps"],
      ["Squat Jump", "10 reps"],
      ["Lunge", "10 reps"],
      ["Sit-up", "10 reps"],
      ["Hip Thrust", "10 reps"],
      ["L-sit", "20 s"],
    ]) {
      expect(await screen.findByRole("button", { name: `${name ?? ""}, ${target ?? ""}` })).toBeTruthy();
    }
  });

  it("never the store's app, nor a copy built before the camera", async () => {
    await openTry("Squat", server().ask, { apiUrl: "https://api.kwazo.app" });
    expect(screen.queryByRole("button", { name: "Try the camera" })).toBeNull();
    await screen.unmount();
    poseCamera.missing = true;
    await render(<App extra={extra} store={memoryStore(kept(1, RAVI))} ask={server().ask} />);
    await fireEvent.press(await screen.findByRole("tab", { name: "Me" }));
    await screen.findByText(/Exercise 1 test copy/);
    expect(screen.queryByRole("button", { name: "Try the camera" })).toBeNull();
  });
});
