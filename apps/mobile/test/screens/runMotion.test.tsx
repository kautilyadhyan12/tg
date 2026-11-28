import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { AppState } from "react-native";
import { runSums, saveRunRequestSchema, type RunPoint, type SaveRunRequest } from "@app/shared";
import { App } from "../../src/App";
import { chooseAutoPause, finishRun, forgetRun, loadRun, movingMsOf, pauseRun, phoneRunFiles, resetRecorder, resumeRun, runNow, setAutoPause, startRun, takeLocations } from "../../src/screens/running/recorder";
import { currentPace, pacing, sentOf, sumsAt } from "../../src/screens/running/runLive";
import type { Ask, AskInit } from "../../src/session/calls";
import { RAVI, fakeServer, kept, memoryStore, profile, tokens, type Reply } from "../kit";

// The phone feels whether it is moving (ROADMAP Stage 5 item 37i): the phone's motion sensor, read during a
// run and kept beside it, one number a second. This job shows nothing and sends nothing; Auto-pause reads it
// in 37j. The limits that number is judged by are measured on real people (feature folder 2's handoff, 37i).
// Here: it is never sent, it is kept with the run in order and once each, it goes with the run at Save or
// Discard, and a phone with no sensor code (an iPhone, a copy built before it) records a run as before.

const extra = { copyName: "Feature 2", apiUrl: "http://localhost:3000" };
const PATH = "/v1/geo/runs";

interface Motion {
  missing: boolean;
  fails: boolean;
  reading: boolean;
  starts: number;
  stops: number;
  send: (at: number, sd: number, n?: number) => void;
  reset: () => void;
}
const motion = jest.requireMock<{ motion: Motion }>("../../src/screens/running/runMotionNative").motion;
const location = jest.requireMock<{ state: Record<string, unknown> }>("expo-location").state;

const MOTION_FILES = ["run-now-motion-0.json", "run-now-motion-1.json", "run-now-motion-2.json"];

beforeEach(async () => {
  jest.spyOn(AppState, "addEventListener").mockImplementation(() => ({ remove: () => undefined }));
  Object.assign(location, { services: true, granted: true, canAskAgain: true, accuracy: "fine", asked: 0, started: [], running: false, acceptsTurnOn: true });
  for (const name of ["run-now.json", "run-now-0.json", "run-now-heart-0.json", "run-settings.json", "run-map.json", ...MOTION_FILES]) phoneRunFiles.remove(name);
  motion.reset();
  resetRecorder();
  await Promise.resolve();
});

/** A walker's second: what a phone in a pocket reads, in m/s². */
const WALK_SD = 2.41;

/** One point a second going north at 3 m/s, and the sensor's second ending with it, handed over together. */
async function feed(fromS: number, seconds: number, sd: ((s: number) => number) | null = () => WALK_SD) {
  const run = runNow();
  if (run === null) throw new Error("no run going");
  for (let i = 0; i < seconds; i++) if (sd !== null) motion.send(run.startedAt + (fromS + i) * 1000, sd(fromS + i));
  const locations = Array.from({ length: seconds }, (_, i) => ({
    timestamp: run.startedAt + (fromS + i) * 1000,
    coords: { latitude: 26.1445 + ((fromS + i) * 3) / 111_132, longitude: 91.7362, accuracy: 5, speed: 3 },
  }));
  await act(() => takeLocations({ locations }));
}

describe("the worst thing for the person's data: their phone's motion sent off it", () => {
  it("a run with its motion kept, saved: the body is today's, key for key, and holds no motion", async () => {
    const s = runServer();
    await openRunning(s);
    await startRunning();
    await feed(1, 120);
    expect(runNow()?.motion.length).toBe(120);
    await fireEvent.press(screen.getByRole("button", { name: "Pause" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Finish" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Save run" }));
    await waitFor(() => {
      expect(s.posts).toHaveLength(1);
    });
    const body = s.posts[0];
    // The server's own schema is strict: a key it does not know is refused.
    expect(saveRunRequestSchema.safeParse(body).success).toBe(true);
    expect(Object.keys(body as object).sort()).toEqual(["effort", "elapsedMs", "name", "note", "pauses", "points", "runId", "startedAt"]);
    expect(JSON.stringify(body)).not.toMatch(/motion|"sd"/);
    // Nor in the run kept waiting to be sent.
    expect(s.outboxWrites.length).toBeGreaterThan(0);
    for (const write of s.outboxWrites) expect(write).not.toMatch(/motion|"sd"/);
  });
});

describe("the motion is kept with the run", () => {
  it("each second once, in order, as the points come, while paused too; never one that began before Go", async () => {
    const run = await startRun(RAVI.id, randomUUID(), false, Date.now());
    expect(motion.starts).toBe(1);
    // Handed over before Go, or ending sooner than a second after it: not the run's.
    motion.send(run.startedAt - 2000, 9.9);
    motion.send(run.startedAt + 400, 9.9);
    await feed(1, 3, (s) => s / 100);
    // A second handed over twice, or one older than the last kept, is never kept again.
    motion.send(run.startedAt + 2000, 7.7);
    motion.send(run.startedAt + 3000, 7.7);
    await feed(4, 2, (s) => s / 100);
    await act(() => pauseRun(run.startedAt + 5500));
    // Paused, the motion is still kept: 37j starts the clock again from it.
    await feed(6, 2, (s) => s / 100);
    expect(runNow()?.phase).toBe("paused");
    expect(runNow()?.motion).toEqual([
      [1000, 1],
      [2000, 2],
      [3000, 3],
      [4000, 4],
      [5000, 5],
      [6000, 6],
      [7000, 7],
    ]);
  });

  it("the sd is kept in hundredths of a m/s², rounded", async () => {
    const run = await startRun(RAVI.id, randomUUID(), false, Date.now());
    motion.send(run.startedAt + 1000, 0.004);
    motion.send(run.startedAt + 2000, 0.356);
    motion.send(run.startedAt + 3000, 12.3449);
    await feed(3, 1, null);
    expect(runNow()?.motion).toEqual([
      [1000, 0],
      [2000, 36],
      [3000, 1234],
    ]);
  });

  it("a second past Finish is not kept, and the sensor stops at Finish", async () => {
    const run = await startRun(RAVI.id, randomUUID(), false, Date.now());
    await feed(1, 10);
    // Finished at 10.5 s, with the sensor's seconds up to 12 s not yet taken: the one before Finish is the run's.
    motion.send(run.startedAt + 10_400, 1);
    motion.send(run.startedAt + 11_000, 1);
    motion.send(run.startedAt + 12_000, 1);
    await act(async () => {
      await finishRun(run.startedAt + 10_500);
    });
    expect(motion.reading).toBe(false);
    expect(runNow()?.motion.map(([ms]) => ms)).toEqual([1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10_000, 10_400]);
  });

  it("a run read back after the app was closed has its motion, across files, and the sensor is read again", async () => {
    const run = await startRun(RAVI.id, randomUUID(), false, Date.now());
    // 700 seconds: a second file of 600 a file.
    for (let start = 1; start <= 700; start += 100) await feed(start, 100);
    await act(() => pauseRun(run.startedAt + 700_500));
    const before = runNow()?.motion ?? [];
    expect(before).toHaveLength(700);
    expect(await phoneRunFiles.read("run-now-motion-1.json")).not.toBeNull();
    // The app closed and opened again: nothing in memory, the sensor not reading.
    resetRecorder();
    motion.reset();
    const back = await act(() => loadRun());
    expect(back?.motion).toEqual(before);
    expect(motion.starts).toBe(1);
    await act(() => resumeRun(run.startedAt + 701_000));
    await feed(702, 3);
    expect(runNow()?.motion.slice(-3).map(([ms]) => ms)).toEqual([702_000, 703_000, 704_000]);
  });

  it("a batch from a locked screen that fills two files at once is kept whole, points and motion (round one, L1)", async () => {
    const run = await startRun(RAVI.id, randomUUID(), false, Date.now());
    await feed(1, 500);
    await act(() => pauseRun(run.startedAt + 500_500));
    await act(() => resumeRun(run.startedAt + 500_600));
    // 900 seconds handed over at once: past both 600 and 1200, the most the sensor code keeps.
    await feed(501, 900);
    await act(() => pauseRun(run.startedAt + 1_400_500));
    resetRecorder();
    motion.reset();
    const back = await act(() => loadRun());
    expect(back?.motion).toHaveLength(1400);
    expect(back?.points).toHaveLength(1400);
    expect(back?.motion.map(([ms]) => ms)).toEqual(Array.from({ length: 1400 }, (_, i) => (i + 1) * 1000));
  });

  it("after a motion file that does not read, Discard still removes every motion file (round one, L2)", async () => {
    const run = await startRun(RAVI.id, randomUUID(), false, Date.now());
    for (let start = 1; start <= 700; start += 100) await feed(start, 100);
    await act(() => pauseRun(run.startedAt + 700_500));
    await phoneRunFiles.write("run-now-motion-0.json", "{not json");
    resetRecorder();
    motion.reset();
    const back = await act(() => loadRun());
    expect(back?.motion.map(([ms]) => ms)).toEqual(Array.from({ length: 100 }, (_, i) => (601 + i) * 1000));
    await act(() => resumeRun(run.startedAt + 701_000));
    await feed(702, 5);
    await act(() => pauseRun(run.startedAt + 707_500));
    // Read back again, the seconds are in order and once each.
    resetRecorder();
    const again = await act(() => loadRun());
    expect(again?.motion).toHaveLength(105);
    await act(() => forgetRun());
    for (const name of MOTION_FILES) expect(await phoneRunFiles.read(name)).toBeNull();
  });

  it("a heart rate file that does not read loses the heart rate, never the run", async () => {
    const run = await startRun(RAVI.id, randomUUID(), false, Date.now());
    await feed(1, 30);
    await act(() => pauseRun(run.startedAt + 30_500));
    const state = JSON.parse((await phoneRunFiles.read("run-now.json")) ?? "{}") as Record<string, unknown>;
    await phoneRunFiles.write("run-now.json", JSON.stringify({ ...state, heartFiles: 1 }));
    await phoneRunFiles.write("run-now-heart-0.json", "{not json");
    resetRecorder();
    const back = await act(() => loadRun());
    expect(back?.points).toHaveLength(30);
    expect(back?.heart).toEqual([]);
  });

  it("a motion file that does not read loses the motion, never the run", async () => {
    const run = await startRun(RAVI.id, randomUUID(), false, Date.now());
    await feed(1, 30);
    await act(() => pauseRun(run.startedAt + 30_500));
    await phoneRunFiles.write("run-now-motion-0.json", "{not json");
    resetRecorder();
    const back = await act(() => loadRun());
    expect(back?.points).toHaveLength(30);
    expect(back?.motion).toEqual([]);
  });

  it("a run finished and read back is not read again by the sensor", async () => {
    const run = await startRun(RAVI.id, randomUUID(), false, Date.now());
    await feed(1, 5);
    await act(async () => {
      await finishRun(run.startedAt + 6000);
    });
    resetRecorder();
    motion.reset();
    const back = await act(() => loadRun());
    expect(back?.phase).toBe("finished");
    expect(back?.motion).toHaveLength(5);
    expect(motion.starts).toBe(0);
  });
});

describe("Save and Discard take the motion with the run", () => {
  it("Save: the motion files are gone and the sensor stopped", async () => {
    const s = runServer();
    await openRunning(s);
    await startRunning();
    await feed(1, 61);
    await fireEvent.press(await screen.findByRole("button", { name: "Pause" }));
    expect(await phoneRunFiles.read("run-now-motion-0.json")).not.toBeNull();
    await fireEvent.press(await screen.findByRole("button", { name: "Finish" }));
    expect(motion.reading).toBe(false);
    await fireEvent.press(await screen.findByRole("button", { name: "Save run" }));
    await waitFor(() => {
      expect(runNow()).toBeNull();
    });
    expect(await phoneRunFiles.read("run-now-motion-0.json")).toBeNull();
  });

  it("Discard: the motion files are gone, across files, and nothing is sent", async () => {
    const s = runServer();
    await openRunning(s);
    await startRunning();
    for (let start = 1; start <= 700; start += 100) await feed(start, 100);
    await fireEvent.press(await screen.findByRole("button", { name: "Pause" }));
    expect(await phoneRunFiles.read("run-now-motion-1.json")).not.toBeNull();
    await fireEvent.press(await screen.findByRole("button", { name: "Finish" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Discard run" }));
    await fireEvent.press(within(await screen.findByTestId("sheet")).getByRole("button", { name: "Discard run" }));
    await waitFor(() => {
      expect(runNow()).toBeNull();
    });
    expect(s.posts).toHaveLength(0);
    for (const name of MOTION_FILES) expect(await phoneRunFiles.read(name)).toBeNull();
    expect(motion.reading).toBe(false);
  });

  it("a run thrown away mid-run stops the sensor", async () => {
    await startRun(RAVI.id, randomUUID(), false, Date.now());
    expect(motion.reading).toBe(true);
    await act(() => forgetRun());
    expect(motion.reading).toBe(false);
  });
});

describe("a phone with no motion sensor code records a run as before", () => {
  it.each([
    [
      "no sensor code (an iPhone, a copy built before it)",
      () => {
        motion.missing = true;
      },
    ],
    [
      "a sensor that fails",
      () => {
        motion.fails = true;
      },
    ],
  ])("%s: the run starts, records and saves, with no motion", async (_, phone) => {
    phone();
    const s = runServer();
    await openRunning(s);
    await startRunning();
    await feed(1, 61);
    expect(runNow()?.points).toHaveLength(61);
    expect(runNow()?.motion).toEqual([]);
    await fireEvent.press(screen.getByRole("button", { name: "Pause" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Finish" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Save run" }));
    await waitFor(() => {
      expect(s.saved).toHaveLength(1);
    });
    expect(s.saved[0]?.points).toHaveLength(61);
  });
});

/** The server: a POST kept once for its id. */
function runServer() {
  const posts: unknown[] = [];
  const saved: SaveRunRequest[] = [];
  const server = fakeServer({
    "/v1/auth/refresh": () => ({ status: 200, body: { tokens: tokens(2) } }),
    "/v1/geo/map": () => ({ status: 503, body: { error: "unavailable" } }),
    "/v1/geo/runs/records": () => ({ status: 503, body: { error: "unavailable" } }),
    "/v1/geo/runs/climb": () => ({ status: 200, body: { climb: { state: "none" } } }),
    "/v1/users/me": () => ({ status: 200, body: profile(true, RAVI) }),
    "/v1/geo/heart-max": () => ({ status: 200, body: { own: null, fromAge: null, max: null } }),
    [PATH]: (body): Reply => {
      if (body === undefined) return { status: 200, body: { items: [], nextCursor: null, months: [], total: { runs: 0, distanceM: 0 } } };
      const run = saveRunRequestSchema.parse(body);
      saved.push(run);
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
  // Every write of the outbox's file, the run kept waiting to be sent among them.
  const writes: string[] = [];
  const runStore = () => ({
    read: () => Promise.resolve(writes[writes.length - 1] ?? null),
    write: (t: string) => {
      writes.push(t);
      return Promise.resolve();
    },
  });
  return { ask, posts, saved, runStore, outboxWrites: writes };
}

async function openRunning(s: ReturnType<typeof runServer>) {
  await render(<App extra={extra} store={memoryStore(kept(1, RAVI))} ask={s.ask} runStore={s.runStore} />);
  await fireEvent.press(await screen.findByRole("tab", { name: "Workout" }));
  await fireEvent.press(await screen.findByRole("button", { name: "Running" }));
  expect(await screen.findByRole("button", { name: "Start run" })).toBeTruthy();
}

async function startRunning() {
  await fireEvent.press(screen.getByRole("button", { name: "Start run" }));
  await fireEvent.press(await screen.findByRole("button", { name: "Start now" }));
  await waitFor(() => {
    expect(runNow()?.phase).toBe("running");
  });
}

// Auto-pause reads the motion (37j): the rule is tested in test/autoPauseMotion.test.ts; here, what the recorder
// hands it across the person's own Pause and Resume and a reopened app (round one's review, H4 and its tests).
describe("Auto-pause with the motion, through the recorder", () => {
  const STILL_SD = 0.05;
  const MOVING_SD = 4.5;
  /** Points one a second from `fromS`, `north(s)` metres north of the start, each with the motion of its second. */
  async function points(fromS: number, seconds: number, north: (s: number) => number, sd: number) {
    const run = runNow();
    if (run === null) throw new Error("no run going");
    for (let i = 0; i < seconds; i++) motion.send(run.startedAt + (fromS + i) * 1000, sd);
    const locations = Array.from({ length: seconds }, (_, i) => ({
      timestamp: run.startedAt + (fromS + i) * 1000,
      coords: { latitude: 26.1445 + north(fromS + i) / 111_132, longitude: 91.7362, accuracy: 5, speed: 0 },
    }));
    await act(() => takeLocations({ locations }));
  }

  it("a pram known to be on wheels stays so through the person's own Pause and Resume", async () => {
    const run = await startRun(RAVI.id, randomUUID(), true, Date.now());
    const pram = (s: number) => 3 * s;
    await points(1, 30, pram, STILL_SD);
    // Paused at its first point, undone once it had gone 40 m: no pause kept.
    expect(runNow()?.phase).toBe("running");
    expect(runNow()?.pauses).toEqual([]);
    await act(() => pauseRun(run.startedAt + 31_000));
    await act(() => resumeRun(run.startedAt + 40_000));
    // On wheels still: four still points do not pause it again.
    await points(41, 8, pram, STILL_SD);
    expect(runNow()?.phase).toBe("running");
    expect(runNow()?.pauses).toEqual([[31_000, 40_000]]);
  });

  it("a ride taken during the person's own pause (a bus, the phone still) does not leave the run on wheels after Resume", async () => {
    const run = await startRun(RAVI.id, randomUUID(), true, Date.now());
    const walk = (s: number) => 1.4 * s;
    await points(1, 20, walk, MOVING_SD);
    await act(() => pauseRun(run.startedAt + 21_000));
    // On the bus, paused: still, and 4 m a second for a minute.
    const bus = (s: number) => walk(21) + 4 * (s - 21);
    await points(22, 60, bus, STILL_SD);
    await act(() => resumeRun(run.startedAt + 82_000));
    // Off the bus, standing: the motion still pauses it within a few seconds (the place alone needs 8 s).
    await points(83, 5, () => bus(81), STILL_SD);
    expect(runNow()?.phase).toBe("paused");
  });

  it("Resume pressed on an Auto-pause keeps a pram on wheels, and a new run never starts on wheels (the second re-check, H6)", async () => {
    const run = await startRun(RAVI.id, randomUUID(), true, Date.now());
    const pram = (s: number) => 3 * s;
    await points(1, 30, pram, STILL_SD);
    expect(runNow()?.pauses).toEqual([]);
    // A real stop, the pram standing: paused by the place (8 s), the person presses Resume.
    await points(31, 12, () => pram(30), STILL_SD);
    expect(runNow()?.phase).toBe("paused");
    await act(() => resumeRun(run.startedAt + 43_000));
    // Pushed on: still on wheels, so four still points do not pause it.
    await points(44, 6, (s) => pram(30) + 3 * (s - 43), STILL_SD);
    expect(runNow()?.phase).toBe("running");
    // The person's own Pause, Finish and Discard; then a new run on foot: standing pauses it by the motion again.
    await act(() => pauseRun(run.startedAt + 50_000));
    await act(() => forgetRun());
    await startRun(RAVI.id, randomUUID(), true, Date.now());
    await points(1, 20, (s) => 1.4 * s, MOVING_SD);
    await points(21, 5, () => 1.4 * 20, STILL_SD);
    expect(runNow()?.phase).toBe("paused");
    const next = runNow();
    if (next === null) throw new Error("no run");
    await act(() => resumeRun(next.startedAt + 27_000));
    await points(28, 5, () => 1.4 * 20, STILL_SD);
    expect(runNow()?.phase).toBe("paused");
  });

  it("a pause read back after the app was closed waits 10 s from its own start before the motion starts the clock", async () => {
    const run = await startRun(RAVI.id, randomUUID(), true, Date.now());
    await points(1, 5, () => 0, STILL_SD);
    // The clock stops at the point that decided it (37k); the seconds back to the stop are standing.
    expect(runNow()?.pauses).toEqual([[4000, null]]);
    expect(runNow()?.datedBack).toEqual([[1000, 4000]]);
    // The app closed and opened again.
    resetRecorder();
    motion.reset();
    await act(() => loadRun());
    const walk = (s: number) => 3 * (s - 5);
    await points(6, 4, walk, MOVING_SD);
    expect(runNow()?.phase).toBe("paused");
    await points(10, 3, walk, MOVING_SD);
    expect(runNow()?.phase).toBe("running");
    expect(runNow()?.pauses).toEqual([[4000, 6000]]);
    expect(runNow()?.datedBack).toEqual([[1000, 4000]]);
    expect(run.runId).toBe(runNow()?.runId);
  });
});

// The line holds still with Auto-pause off (37k): the rule is tested in test/stillStretches.test.ts; here, what the
// recorder keeps and sends, and the clock through an Auto-pause, point by point as a phone hands them over.
describe("still stretches, through the recorder", () => {
  const STILL_SD = 0.05;
  const MOVING_SD = 4.5;
  /** One point a second from `fromS`, `north(s)` metres north of the start, each handed over alone at its own
   *  second, with the motion of its second unless `sd` is null; the screen's clock read after each. */
  async function live(fromS: number, seconds: number, north: (s: number) => number, sd: number | null): Promise<number[]> {
    const run = runNow();
    if (run === null) throw new Error("no run going");
    const clocks: number[] = [];
    for (let i = 0; i < seconds; i++) {
      const at = run.startedAt + (fromS + i) * 1000;
      if (sd !== null) motion.send(at, sd);
      const locations = [{ timestamp: at, coords: { latitude: 26.1445 + north(fromS + i) / 111_132, longitude: 91.7362, accuracy: 5, speed: 0 } }];
      await act(() => takeLocations({ locations }, at));
      const now = runNow();
      if (now !== null) clocks.push(movingMsOf(now, at));
    }
    return clocks;
  }
  const rises = (clocks: readonly number[]): boolean => clocks.every((c, i) => i === 0 || c >= (clocks[i - 1] ?? 0));

  it("the worst thing, through the recorder: a pram with Auto-pause off keeps its metres, the clock running", async () => {
    const run = await startRun(RAVI.id, randomUUID(), false, Date.now());
    const clocks = await live(1, 120, (s) => 3 * s, STILL_SD);
    const now = runNow();
    if (now === null) throw new Error("no run");
    expect(now.phase).toBe("running");
    expect(now.pauses).toEqual([]);
    expect(now.still).toEqual([]);
    expect(rises(clocks)).toBe(true);
    expect(sumsAt(now, 120_000, 70).distanceM).toBeGreaterThanOrEqual(3 * 119 - 6);
    expect(run.runId).toBe(now.runId);
  });

  it("Auto-pause off: walk, stand, walk: the clock runs on, the stand is a still stretch, and it goes with the run", async () => {
    await act(() => chooseAutoPause(false));
    const s = runServer();
    await openRunning(s);
    await startRunning();
    const walk = (t: number) => 3 * Math.min(t, 30) + 3 * Math.max(0, t - 60);
    const clocks = [...(await live(1, 30, walk, MOVING_SD)), ...(await live(31, 30, walk, STILL_SD)), ...(await live(61, 30, walk, MOVING_SD))];
    const run = runNow();
    if (run === null) throw new Error("no run");
    expect(run.phase).toBe("running");
    expect(run.pauses).toEqual([]);
    expect(rises(clocks)).toBe(true);
    expect(run.still).toHaveLength(1);
    const [from, to] = run.still[0] ?? [0, 0];
    expect(from).toBeGreaterThanOrEqual(30_000);
    expect(from).toBeLessThanOrEqual(32_000);
    expect(to).toBeGreaterThanOrEqual(60_000);
    expect(to).toBeLessThanOrEqual(73_000);
    await fireEvent.press(screen.getByRole("button", { name: "Pause" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Finish" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Save run" }));
    await waitFor(() => {
      expect(s.saved).toHaveLength(1);
    });
    const body = saveRunRequestSchema.parse(s.posts[0]);
    expect(body.still).toEqual([[from, to]]);
    // The server works out what the phone showed: the same points, pauses and stretches.
    const done = { ...run, finishedMs: body.elapsedMs };
    expect(runSums(body.points, body.pauses, body.elapsedMs, 70, body.still).distanceM).toBe(sumsAt(done, body.elapsedMs, 70).distanceM);
    expect(Math.abs(runSums(body.points, body.pauses, body.elapsedMs, 70, body.still).distanceM - 180)).toBeLessThanOrEqual(6);
  });

  it("Auto-pause off: the person's Pause, Auto-pause turned on, and Finish each close the open stretch; a reopened app keeps them", async () => {
    const run = await startRun(RAVI.id, randomUUID(), false, Date.now());
    await live(1, 10, (t) => 3 * t, MOVING_SD);
    await live(11, 6, () => 30, STILL_SD);
    expect(runNow()?.still).toEqual([[11_000, null]]);
    await act(() => pauseRun(run.startedAt + 17_000));
    expect(runNow()?.still).toEqual([[11_000, 17_000]]);
    await act(() => resumeRun(run.startedAt + 20_000));
    await live(21, 6, () => 30, STILL_SD);
    expect(runNow()?.still).toEqual([[11_000, 17_000], [21_000, null]]);
    // The app closed and opened again: the open stretch is read back open, and walking on closes it.
    resetRecorder();
    motion.reset();
    await act(() => loadRun());
    expect(runNow()?.still).toEqual([[11_000, 17_000], [21_000, null]]);
    await live(27, 12, (t) => 30 + 3 * (t - 26), MOVING_SD);
    const walkedOn = runNow()?.still[1];
    expect(walkedOn?.[0]).toBe(21_000);
    expect(walkedOn?.[1]).toBeGreaterThanOrEqual(27_000);
    expect(walkedOn?.[1]).toBeLessThanOrEqual(38_000);
    const walked = 30 + 3 * 12;
    await live(39, 6, () => walked, STILL_SD);
    expect(runNow()?.still.at(-1)).toEqual([39_000, null]);
    await act(() => setAutoPause(true, run.startedAt + 46_000));
    expect(runNow()?.still.at(-1)).toEqual([39_000, 46_000]);
    await act(() => setAutoPause(false, run.startedAt + 47_000));
    await live(48, 6, () => walked, STILL_SD);
    expect(runNow()?.still.at(-1)).toEqual([48_000, null]);
    await act(() => finishRun(run.startedAt + 60_000));
    expect(runNow()?.still.at(-1)).toEqual([48_000, 60_000]);
    expect(runNow()?.still).toHaveLength(4);
  });

  it("Auto-pause on, a stop the place dates 8 s back: the screen's clock never goes back, and Moving time is what it was", async () => {
    await startRun(RAVI.id, randomUUID(), true, Date.now());
    // No motion: the place rule, which dates a stop back 8 s.
    const walk = (t: number) => 3 * Math.min(t, 30) + 3 * Math.max(0, t - 60);
    const clocks = [...(await live(1, 30, walk, null)), ...(await live(31, 30, walk, null)), ...(await live(61, 30, walk, null))];
    const run = runNow();
    if (run === null) throw new Error("no run");
    expect(rises(clocks)).toBe(true);
    expect(run.pauses).toHaveLength(1);
    expect(run.datedBack).toHaveLength(1);
    const [stop, clockStop] = run.datedBack[0] ?? [0, 0];
    const [pausedAt, resumedAt] = run.pauses[0] ?? [0, null];
    expect(pausedAt).toBe(clockStop);
    expect(clockStop - stop).toBeGreaterThanOrEqual(7000);
    expect(stop).toBeLessThanOrEqual(32_000);
    // Moving time as the pause dated back to the stop gave it before 37k.
    const before = runSums(run.points, [[stop, resumedAt ?? 90_000]], 90_000, 70);
    const now = sumsAt(run, 90_000, 70);
    expect(Math.abs(now.movingS - before.movingS)).toBeLessThanOrEqual(1);
    // The step onto the stop's own spot, which the pause dated back cut off, now counts: closer to the 180 m walked.
    expect(now.distanceM).toBeGreaterThanOrEqual(before.distanceM);
    expect(Math.abs(now.distanceM - 180)).toBeLessThanOrEqual(Math.abs(before.distanceM - 180));
    expect(Math.abs(now.distanceM - 180)).toBeLessThanOrEqual(6);
  });

  it("Auto-pause on, a stop handed over in one batch 25 s late as the app comes back: the screen's clock never goes back, and the stand is standing (round one, L1)", async () => {
    const run = await startRun(RAVI.id, randomUUID(), true, Date.now());
    await live(1, 30, (t) => 3 * t, null);
    // Standing from 31 s; the phone hands the points over at 85 s, up to 84 s.
    const now = run.startedAt + 85_000;
    const before = runNow();
    if (before === null) throw new Error("no run");
    const shown = movingMsOf(before, now);
    const locations = Array.from({ length: 54 }, (_, i) => ({
      timestamp: run.startedAt + (31 + i) * 1000,
      coords: { latitude: 26.1445 + 90 / 111_132, longitude: 91.7362, accuracy: 5, speed: 0 },
    }));
    await act(() => takeLocations({ locations }, now));
    const after = runNow();
    if (after === null) throw new Error("no run");
    expect(after.phase).toBe("paused");
    expect(movingMsOf(after, now)).toBeGreaterThanOrEqual(shown);
    expect(after.pauses).toEqual([[85_000, null]]);
    // The stand's own points are the run's, so it is standing to its last point, never moving time.
    expect(sumsAt(after, 85_000, 70).movingS).toBeLessThanOrEqual(32);
  });

  it("Auto-pause on, a pram's stop undone: no pause and no dated-back seconds are left", async () => {
    await startRun(RAVI.id, randomUUID(), true, Date.now());
    await live(1, 30, (t) => 3 * t, STILL_SD);
    expect(runNow()?.pauses).toEqual([]);
    expect(runNow()?.datedBack).toEqual([]);
  });

  it("no stop at all: nothing kept", async () => {
    await startRun(RAVI.id, randomUUID(), false, Date.now());
    await live(1, 30, (t) => 3 * t, MOVING_SD);
    expect(runNow()?.still).toEqual([]);
    expect(runNow()?.datedBack).toEqual([]);
  });
});

// Kd's phone lying still indoors, 2026-11-28 (37r): the GPS, just found, went 36 m in 5 s and settled, and the screen
// drew it from 8 s to 25 s with a pace of 2:17 to 50:12 a kilometre. His points and motion, handed over one at a time
// as the phone handed them over, through the recorder and the running screen.
describe("a phone lying still indoors as its GPS settles, through the recorder and the screen (37r)", () => {
  const settle = JSON.parse(readFileSync(join(__dirname, "..", "fixtures", "still-indoors-settle.json"), "utf8")) as { points: RunPoint[]; motion: [number, number][] };

  /** Each point at its own time, the motion of its seconds first; after each, what the screen would show. */
  async function feedSettle(): Promise<{ at: number; metres: number; line: number; pace: string; shown: boolean }[]> {
    const run = runNow();
    if (run === null) throw new Error("no run going");
    const seen: { at: number; metres: number; line: number; pace: string; shown: boolean }[] = [];
    let m = 0;
    for (const [at, lat, lng, accuracy] of settle.points) {
      for (; m < settle.motion.length && (settle.motion[m]?.[0] ?? Infinity) <= at; m++) {
        const [ms, sd] = settle.motion[m] ?? [0, 0];
        motion.send(run.startedAt + ms, sd / 100);
      }
      const locations = [{ timestamp: run.startedAt + at, coords: { latitude: lat, longitude: lng, accuracy, speed: 0 } }];
      await act(() => takeLocations({ locations }, run.startedAt + at));
      const now = runNow();
      if (now === null) throw new Error("no run");
      const sums = sumsAt(now, at, 70);
      seen.push({ at, metres: sums.distanceM, line: sums.track.length, pace: currentPace(now.points, pacing(now), "metric", at), shown: screen.queryByText("--:-- /km") !== null });
    }
    return seen;
  }
  const nothing = (seen: readonly { at: number; metres: number; line: number; pace: string; shown: boolean }[]) =>
    seen.filter((s) => s.metres !== 0 || s.line !== 0 || s.pace !== "--:--" || !s.shown);

  it("Auto-pause off: no metre, no line and no pace after any point, the stretch kept as on Kd's phone, and the saved run counts nothing", async () => {
    await act(() => chooseAutoPause(false));
    await openRunning(runServer());
    await startRunning();
    expect(nothing(await feedSettle())).toEqual([]);
    const run = runNow();
    expect(run?.still).toEqual([[4410, null]]);
    expect(run?.phase).toBe("running");
    const end = settle.points[settle.points.length - 1]?.[0] ?? 0;
    const done = await finishRun((run?.startedAt ?? 0) + end + 1000);
    if (done === null) throw new Error("no run");
    const sent = sentOf(done);
    expect(sent.still).toEqual([[4410, end + 1000]]);
    const saved = runSums(sent.points, sent.pauses, sent.elapsedMs, 70, sent.still);
    expect([saved.distanceM, saved.track.length]).toEqual([0, 0]);
    expect(sumsAt(done, sent.elapsedMs, 70).distanceM).toBe(0);
  });

  it("Auto-pause on: paused at 8.5 s with the seconds back to 4.4 s standing; no metre, no line and no pace after any point", async () => {
    await act(() => chooseAutoPause(true));
    await openRunning(runServer());
    await startRunning();
    expect(nothing(await feedSettle())).toEqual([]);
    const run = runNow();
    expect(run?.phase).toBe("paused");
    expect(run?.datedBack).toEqual([[4410, 8517]]);
    expect(run?.pauses.map(([from]) => from)).toEqual([8517]);
  });
});
