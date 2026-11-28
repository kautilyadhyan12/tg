import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { AppState, PermissionsAndroid, Platform } from "react-native";
import { saveRunRequestSchema, type SaveRunRequest } from "@app/shared";
import { App } from "../../src/App";
import { loadRun, phoneRunFiles, resetRecorder, runNow, takeSteps, type LiveRun } from "../../src/screens/running/recorder";
import { indoorSumsAt } from "../../src/screens/running/runLive";
import { distance } from "../../src/screens/running/runWords";
import type { Ask, AskInit } from "../../src/session/calls";
import { RAVI, fakeServer, kept, memoryStore, profile, tokens, type Reply } from "../kit";

// An indoor run on the phone (ROADMAP Stage 5 item 37q-ii-a), through the whole app: Indoor picked on the Running page,
// the phone's own step counter (its stand-in hands readings over as Android's TYPE_STEP_COUNTER does: a total since the
// phone was switched on), no GPS and no map, Auto-pause from the steps, and the treadmill's distance typed after Finish.
// The worst thing: the steps the counter held before Start (the person's day) made into the run.

const extra = { copyName: "Feature 2", apiUrl: "http://localhost:3000" };
const PATH = "/v1/geo/runs";

interface Steps {
  can: boolean;
  old: boolean;
  answer: string;
  reading: boolean;
  starts: number;
  stops: number;
}
interface Motion {
  starts: number;
  steps: Steps;
  stepTo: (at: number, total: number) => void;
  reset: () => void;
}
const motion = jest.requireMock<{ motion: Motion }>("../../src/screens/running/runMotionNative").motion;
const location = jest.requireMock<{ state: Record<string, unknown> }>("expo-location").state;

const STEP_FILES = ["run-now-steps-0.json", "run-now-steps-1.json"];

beforeEach(async () => {
  jest.spyOn(AppState, "addEventListener").mockImplementation(() => ({ remove: () => undefined }));
  Object.assign(location, { services: true, granted: true, canAskAgain: true, accuracy: "fine", asked: 0, started: [], running: false, acceptsTurnOn: true });
  for (const name of ["run-now.json", "run-now-0.json", "run-now-heart-0.json", "run-now-motion-0.json", "run-settings.json", "run-map.json", ...STEP_FILES]) phoneRunFiles.remove(name);
  motion.reset();
  resetRecorder();
  await Promise.resolve();
});

afterEach(() => {
  // The run's own look each second stops with the recorder.
  resetRecorder();
});

function runServer() {
  const posts: unknown[] = [];
  const server = fakeServer({
    "/v1/auth/refresh": () => ({ status: 200, body: { tokens: tokens(2) } }),
    "/v1/geo/map": () => ({ status: 503, body: { error: "unavailable" } }),
    "/v1/geo/runs/records": () => ({ status: 503, body: { error: "unavailable" } }),
    "/v1/geo/runs/climb": () => ({ status: 200, body: { climb: { state: "none" } } }),
    "/v1/geo/runs/step-length": () => ({ status: 200, body: { stepLength: { heightCm: 175, heightKnown: true, factor: 1, learnedFrom: 0 } } }),
    "/v1/users/me": () => ({ status: 200, body: profile(true, RAVI) }),
    "/v1/geo/heart-max": () => ({ status: 200, body: { own: null, fromAge: null, max: null } }),
    [PATH]: (body): Reply => {
      if (body === undefined) return { status: 200, body: { items: [], nextCursor: null, months: [], total: { runs: 0, distanceM: 0 } } };
      const run = saveRunRequestSchema.parse(body);
      return {
        status: 201,
        body: {
          status: "created",
          run: {
            id: run.runId, startedAt: run.startedAt, name: run.name, effort: run.effort, note: run.note, distanceM: 0, movingS: 0,
            elapsedS: 0, leftOutM: 0, leftOutS: 0, kcal: 0, splitsKm: [], splitsMi: [],
            polyline: "", trackStarts: [], climbM: null, heartAvg: null, heartMax: null,
          },
        },
      };
    },
  });
  const ask: Ask = async (url: string, init: AskInit) => {
    if (new URL(url).pathname === PATH && init.method === "POST" && init.body !== undefined) posts.push(JSON.parse(init.body));
    return server.ask(url, init);
  };
  const writes: string[] = [];
  const runStore = () => ({
    read: () => Promise.resolve(writes[writes.length - 1] ?? null),
    write: (t: string) => {
      writes.push(t);
      return Promise.resolve();
    },
  });
  return { ask, posts, runStore };
}

async function openRunning(s: ReturnType<typeof runServer>) {
  await render(<App extra={extra} store={memoryStore(kept(1, RAVI))} ask={s.ask} runStore={s.runStore} />);
  await fireEvent.press(await screen.findByRole("tab", { name: "Workout" }));
  await fireEvent.press(await screen.findByRole("button", { name: "Running" }));
  expect(await screen.findByRole("button", { name: "Start run" })).toBeTruthy();
}

async function pickIndoor() {
  await fireEvent.press(await screen.findByRole("radio", { name: "Indoor" }));
}

async function startIndoor() {
  await fireEvent.press(screen.getByRole("button", { name: "Start run" }));
  await fireEvent.press(await screen.findByRole("button", { name: "Start now" }));
  await waitFor(() => {
    expect(runNow()?.indoor).toBeTruthy();
  });
}

function going(): LiveRun {
  const run = runNow();
  if (run === null) throw new Error("no run going");
  return run;
}

/** The counter's first reading in the run, `total` (the person's day before Start), taken at Go. */
async function counterAtStart(total: number) {
  const run = going();
  motion.stepTo(run.startedAt, total);
  await act(() => takeSteps(run.startedAt));
}

/** One reading a second from `fromS` for `seconds`, `perMinute` steps a minute from the counter's `total`, looked at every
 *  `every` seconds as the app does once a second; the counter's total at the end. */
async function walk(fromS: number, seconds: number, perMinute: number, total: number, every = 5): Promise<number> {
  const run = going();
  let now = total;
  for (let i = 1; i <= seconds; i++) {
    const at = run.startedAt + (fromS + i) * 1000;
    now = total + Math.floor((i * perMinute) / 60);
    motion.stepTo(at, now);
    if (i % every === 0 || i === seconds) await act(() => takeSteps(at));
  }
  return now;
}

/** A look `s` seconds into the run with no new reading. */
async function lookAt(s: number) {
  await act(() => takeSteps(going().startedAt + s * 1000));
}

async function finishAndOpenSummary() {
  await fireEvent.press(screen.getByRole("button", { name: "Pause" }));
  await fireEvent.press(await screen.findByRole("button", { name: "Finish" }));
  expect(await screen.findByRole("button", { name: "Save run" })).toBeTruthy();
}

async function saveAndSent(s: ReturnType<typeof runServer>): Promise<SaveRunRequest> {
  await fireEvent.press(screen.getByRole("button", { name: "Save run" }));
  await waitFor(() => {
    expect(s.posts).toHaveLength(1);
  });
  return saveRunRequestSchema.parse(s.posts[0]);
}

describe("the worst thing: the person's day before Start made into the run", () => {
  it("a 10-minute walk started with 8,016 steps on the counter: 1,100 steps, 0.82 km, never 9,116 steps", async () => {
    const s = runServer();
    await openRunning(s);
    await pickIndoor();
    await startIndoor();
    await counterAtStart(8016);
    expect(going().indoor?.steps).toBe(0);
    await walk(0, 600, 110, 8016);
    expect(going().indoor?.steps).toBe(1100);
    expect(await screen.findByText("1,100")).toBeTruthy();
    // 0.43 of 1.75 m a step at a walk, the height the server measures with: 827 m.
    // Distance, and This km with it under the first kilometre.
    expect(await screen.findAllByText(/^0\.82 km$/)).toHaveLength(2);
    await finishAndOpenSummary();
    const body = await saveAndSent(s);
    expect(body.indoor?.counts.at(-1)?.[1]).toBe(1100);
    expect(Math.max(...(body.indoor?.counts ?? []).map(([, steps]) => steps))).toBe(1100);
    expect(body.indoor?.treadmillM).toBeNull();
    // An indoor run sends no route and no still stretches; the server's own schema is strict.
    expect(body.points).toEqual([]);
    expect(body.still).toBeUndefined();
    expect(Object.keys(body).sort()).toEqual(["effort", "elapsedMs", "indoor", "name", "note", "pauses", "points", "runId", "startedAt"]);
  });
});

describe("the steps keep up (Kd, 37q-ii-a's walk: they lagged)", () => {
  it("each reading shows on the screen at the next look, a quarter of a second, while at most one count a second is kept", async () => {
    const s = runServer();
    await openRunning(s);
    await pickIndoor();
    await startIndoor();
    await counterAtStart(8016);
    const run = going();
    // Two steps a second, each handed over as it is taken; looked at four times a second.
    for (let q = 1; q <= 40; q++) {
      const at = run.startedAt + q * 250;
      if (q % 2 === 0) motion.stepTo(at, 8016 + q / 2);
      await act(() => takeSteps(at));
      if (q % 2 === 0) expect(going().indoor?.steps).toBe(q / 2);
    }
    expect(await screen.findByText("20")).toBeTruthy();
    const counts = going().indoor?.counts ?? [];
    for (let i = 1; i < counts.length; i++) expect((counts[i]?.[0] ?? 0) - (counts[i - 1]?.[0] ?? 0)).toBeGreaterThanOrEqual(1000);
    expect(counts.length).toBeGreaterThanOrEqual(9);
    expect(counts.length).toBeLessThanOrEqual(11);
    // The steps not yet in a count are kept at Finish.
    await finishAndOpenSummary();
    expect(going().indoor?.counts.at(-1)?.[1]).toBe(20);
  });
});

describe("Indoor on the Running page", () => {
  it("Indoor hides the GPS light, is kept for the next Start, and an indoor run never asks for or starts the location", async () => {
    const s = runServer();
    await openRunning(s);
    expect(await screen.findByText("Finding GPS")).toBeTruthy();
    await pickIndoor();
    await waitFor(() => {
      expect(screen.queryByText("Finding GPS")).toBeNull();
    });
    expect(screen.getByRole("radio", { name: "Indoor" }).props.accessibilityState).toMatchObject({ selected: true });
    const asked = location.asked;
    await startIndoor();
    expect(location.asked).toBe(asked);
    expect(location.started).toEqual([]);
    // The run's screen: Indoor, no GPS and no map, the steps.
    expect(screen.getByLabelText("Indoor run")).toBeTruthy();
    expect(screen.queryByText(/GPS/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Map" })).toBeNull();
    expect(screen.queryByTestId("live-map")).toBeNull();
    expect(screen.getByText("Steps a minute")).toBeTruthy();
    expect(motion.steps.starts).toBe(1);
    expect(motion.starts).toBe(0);
  });

  it("Outdoor picked again starts a run with the GPS, as before", async () => {
    const s = runServer();
    await openRunning(s);
    await pickIndoor();
    await fireEvent.press(screen.getByRole("radio", { name: "Outdoor" }));
    await fireEvent.press(screen.getByRole("button", { name: "Start run" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Start now" }));
    await waitFor(() => {
      expect(runNow()?.phase).toBe("running");
    });
    expect(runNow()?.indoor ?? null).toBeNull();
    expect(motion.steps.starts).toBe(0);
  });
});

describe("Physical activity, asked at an indoor Start on Android", () => {
  let was: typeof Platform.OS;
  beforeEach(() => {
    was = Platform.OS;
    Object.defineProperty(Platform, "OS", { value: "android", configurable: true });
    Object.defineProperty(Platform, "Version", { value: 34, configurable: true });
  });
  afterEach(() => {
    Object.defineProperty(Platform, "OS", { value: was, configurable: true });
    jest.restoreAllMocks();
  });

  it("allowed: the run starts and counts its steps", async () => {
    jest.spyOn(PermissionsAndroid, "check").mockResolvedValue(false);
    const request = jest.spyOn(PermissionsAndroid, "request").mockResolvedValue("granted");
    const s = runServer();
    await openRunning(s);
    await pickIndoor();
    await startIndoor();
    expect(request).toHaveBeenCalledWith("android.permission.ACTIVITY_RECOGNITION");
    expect(going().indoor?.stepsOff).toBe(false);
  });

  it("not allowed: it says so with Allow and Start without steps; without steps the time is recorded and Steps reads Off", async () => {
    jest.spyOn(PermissionsAndroid, "check").mockResolvedValue(false);
    const request = jest.spyOn(PermissionsAndroid, "request").mockResolvedValue("denied");
    const s = runServer();
    await openRunning(s);
    await pickIndoor();
    await fireEvent.press(screen.getByRole("button", { name: "Start run" }));
    expect(await screen.findByText("Allow physical activity to count your steps.")).toBeTruthy();
    expect(runNow()).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Allow physical activity" }));
    await waitFor(() => {
      expect(request).toHaveBeenCalledTimes(2);
    });
    await fireEvent.press(screen.getByRole("button", { name: "Start without steps" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Start now" }));
    await waitFor(() => {
      expect(runNow()?.indoor?.stepsOff).toBe(true);
    });
    expect(request).toHaveBeenCalledTimes(2);
    expect(motion.steps.starts).toBe(0);
    expect(await screen.findByText("Off")).toBeTruthy();
    await finishAndOpenSummary();
    expect(await screen.findByText("Indoor · no steps counted")).toBeTruthy();
    expect(screen.getByText("Treadmill distance")).toBeTruthy();
  });

  it("not allowed and Android will not ask again: Open settings, and Start without steps", async () => {
    jest.spyOn(PermissionsAndroid, "check").mockResolvedValue(false);
    jest.spyOn(PermissionsAndroid, "request").mockResolvedValue("never_ask_again");
    const s = runServer();
    await openRunning(s);
    await pickIndoor();
    await fireEvent.press(screen.getByRole("button", { name: "Start run" }));
    expect(await screen.findByText("Physical activity is off for this app. Turn it on in Settings to count your steps.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open settings" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start without steps" })).toBeTruthy();
  });

  it("a phone with no step counter says so before anything is asked, with Start without steps", async () => {
    const request = jest.spyOn(PermissionsAndroid, "request");
    motion.steps.can = false;
    const s = runServer();
    await openRunning(s);
    await pickIndoor();
    await fireEvent.press(screen.getByRole("button", { name: "Start run" }));
    expect(await screen.findByText("This phone can't count steps. Type the treadmill's distance after Finish.")).toBeTruthy();
    expect(request).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Start without steps" })).toBeTruthy();
  });
});

describe("a copy of the app built before 37q-ii-a, with no step counter code", () => {
  it("records an indoor run's time with no steps", async () => {
    motion.steps.old = true;
    const s = runServer();
    await openRunning(s);
    await pickIndoor();
    await startIndoor();
    expect(going().indoor?.stepsOff).toBe(true);
    expect(await screen.findByText("Off")).toBeTruthy();
  });
});

describe("Auto-pause from the steps", () => {
  it("ten seconds with no step: Auto-paused where the clock stood; the next steps carry on from just before them", async () => {
    const s = runServer();
    await openRunning(s);
    await pickIndoor();
    await startIndoor();
    await counterAtStart(8016);
    const total = await walk(0, 60, 120, 8016);
    await lookAt(69);
    expect(going().phase).toBe("running");
    await lookAt(70);
    expect(going().phase).toBe("paused");
    expect(going().pausedByPerson).toBe(false);
    expect(await screen.findByText("Auto-paused")).toBeTruthy();
    // At 95 s the counter hands four steps over: the clock started again two seconds before them.
    motion.stepTo(going().startedAt + 95_000, total + 4);
    await lookAt(95);
    expect(going().phase).toBe("running");
    expect(going().pauses).toEqual([[70_000, 93_000]]);
    // The steps taken while paused are none of the run's, and those four all are.
    const sums = indoorSumsAt(going(), 95_000, 0, null);
    expect(sums.steps).toBe(124);
  });

  it("a phone that has counted no step since Start (lying on the treadmill) is never paused", async () => {
    const s = runServer();
    await openRunning(s);
    await pickIndoor();
    await startIndoor();
    await counterAtStart(8016);
    for (const at of [10, 60, 600, 1800]) await lookAt(at);
    expect(going().phase).toBe("running");
    expect(going().pauses).toEqual([]);
  });

  it("Resume pressed with the phone put down: Auto-pause waits for steps again", async () => {
    const s = runServer();
    await openRunning(s);
    await pickIndoor();
    await startIndoor();
    await counterAtStart(8016);
    await walk(0, 60, 120, 8016);
    await lookAt(70);
    expect(going().phase).toBe("paused");
    await fireEvent.press(await screen.findByRole("button", { name: "Resume" }));
    await waitFor(() => {
      expect(going().phase).toBe("running");
    });
    for (const at of [600, 1200]) await lookAt(at);
    expect(going().phase).toBe("running");
  });

  it("with Auto-pause off, a stop never pauses the run", async () => {
    const s = runServer();
    await openRunning(s);
    await fireEvent(screen.getByLabelText("Auto-pause"), "valueChange", false);
    await pickIndoor();
    await startIndoor();
    await counterAtStart(8016);
    await walk(0, 60, 120, 8016);
    await lookAt(300);
    expect(going().phase).toBe("running");
  });
});

describe("Treadmill distance, after Finish", () => {
  async function thirtyMinutes(s: ReturnType<typeof runServer>): Promise<string> {
    await openRunning(s);
    await pickIndoor();
    await startIndoor();
    await counterAtStart(120_000);
    await walk(0, 1800, 160, 120_000, 10);
    await finishAndOpenSummary();
    const run = going();
    return distance(indoorSumsAt(run, run.finishedMs ?? 0, 0, null).stepsM, "metric");
  }

  it("the distance typed is the run's: the summary says so, and Save sends it in metres", async () => {
    const s = runServer();
    const steps = await thirtyMinutes(s);
    expect(screen.getByText("Indoor · from your steps")).toBeTruthy();
    expect(screen.getByText("Treadmill distance")).toBeTruthy();
    expect(screen.queryByTestId("summary-map")).toBeNull();
    await fireEvent.changeText(screen.getByLabelText("Treadmill distance in kilometres"), "4.5");
    expect(await screen.findByText(`Your run is 4.50 km, from the treadmill. Your steps said ${steps} km.`)).toBeTruthy();
    expect(screen.getByText("Indoor · from the treadmill")).toBeTruthy();
    expect(screen.getByText(/^4\.50 km$/)).toBeTruthy();
    const body = await saveAndSent(s);
    expect(body.indoor?.treadmillM).toBe(4500);
  });

  it("54 typed for 5.4: the run keeps its steps' distance and says why; the server judges the number again", async () => {
    const s = runServer();
    const steps = await thirtyMinutes(s);
    await fireEvent.changeText(screen.getByLabelText("Treadmill distance in kilometres"), "54");
    expect(await screen.findByText(`That's faster than anyone has run. Your run keeps ${steps} km.`)).toBeTruthy();
    expect(screen.getByText("Indoor · from your steps")).toBeTruthy();
    expect(screen.getByText(`${steps} km`)).toBeTruthy();
    // Far under what the steps measured: a third or less.
    await fireEvent.changeText(screen.getByLabelText("Treadmill distance in kilometres"), "1");
    expect(await screen.findByText(`That's far less than your steps show. Your run keeps ${steps} km.`)).toBeTruthy();
    const body = await saveAndSent(s);
    expect(body.indoor?.treadmillM).toBe(1000);
  });

  it("what is not a distance is not taken", async () => {
    const s = runServer();
    await thirtyMinutes(s);
    for (const typed of ["abc", "0", "-3", "."]) {
      await fireEvent.changeText(screen.getByLabelText("Treadmill distance in kilometres"), typed);
      expect(screen.queryByText(/from the treadmill\./)).toBeNull();
      expect(screen.queryByText(/Your run keeps/)).toBeNull();
    }
    const body = await saveAndSent(s);
    expect(body.indoor?.treadmillM).toBeNull();
  });
});

describe("the app closed during an indoor run", () => {
  it("opened again, the steps go on from the counter: those taken while it was closed are the run's", async () => {
    const s = runServer();
    await openRunning(s);
    await pickIndoor();
    await startIndoor();
    await counterAtStart(8016);
    await walk(0, 300, 120, 8016);
    const kept = going();
    expect(kept.indoor?.steps).toBe(600);
    resetRecorder();
    const back = await loadRun();
    expect(back?.indoor?.steps).toBe(600);
    expect(back?.indoor?.counts).toEqual(kept.indoor?.counts);
    // Listening again, the counter had gone on to 8,916: 300 more steps.
    motion.stepTo(kept.startedAt + 330_000, 8916);
    await act(() => takeSteps(kept.startedAt + 330_000));
    expect(runNow()?.indoor?.steps).toBe(900);
  });

  it("the phone switched off and on: the counter starts again, and the steps since are the run's", async () => {
    const s = runServer();
    await openRunning(s);
    await pickIndoor();
    await startIndoor();
    await counterAtStart(8016);
    await walk(0, 300, 120, 8016);
    const kept = going();
    resetRecorder();
    await loadRun();
    motion.stepTo(kept.startedAt + 400_000, 40);
    await act(() => takeSteps(kept.startedAt + 400_000));
    expect(runNow()?.indoor?.steps).toBe(640);
  });
});
