import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { AppState } from "react-native";
import { RUN_MAX_POINTS, runSums, saveRunRequestSchema, type RunPoint, type SaveRunRequest } from "@app/shared";
import { App } from "../../src/App";
import { phoneRunFiles, resetRecorder, runNow, takeLocations } from "../../src/screens/running/recorder";
import { readRunFile } from "../../src/screens/running/runQueue";
import { clock, distance, runName } from "../../src/screens/running/runWords";
import type { Ask, AskInit } from "../../src/session/calls";
import { RAVI, fakeServer, kept, memoryStore, profile, tokens, type Reply } from "../kit";

// Record a run (ROADMAP Stage 5 37a), through the whole app. The worst thing on the phone's side:
// somebody's run, which starts at their front door, shown to another person on the same phone, or a
// run lost or saved twice. Then the run itself, Start to Save, with no signal at Save, Discard, a
// location the person has not allowed, and Auto-pause.

const extra = { copyName: "Feature 2", apiUrl: "http://localhost:3000" };
const PATH = "/v1/geo/runs";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// The phone's location, as the setup's stand-in holds it.
const location = jest.requireMock<{ state: { services: boolean; granted: boolean; canAskAgain: boolean; accuracy: string; asked: number; started: { task: string; options: { foregroundService?: { notificationTitle: string } } }[]; running: boolean } }>("expo-location").state;

let handlers: ((state: "active") => void)[] = [];
const comeBack = () => {
  for (const handler of handlers) handler("active");
};

beforeEach(async () => {
  handlers = [];
  jest.spyOn(AppState, "addEventListener").mockImplementation((_type, handler) => {
    handlers.push(handler);
    return { remove: () => undefined };
  });
  Object.assign(location, { services: true, granted: true, canAskAgain: true, accuracy: "fine", asked: 0, started: [], running: false });
  for (const name of ["run-now.json", "run-now-0.json", "run-now-1.json", "run-settings.json"]) phoneRunFiles.remove(name);
  resetRecorder();
  await Promise.resolve();
});

/** The server: the person's runs, a POST kept once for its id. `online` false is no signal. */
function runServer() {
  const saved: SaveRunRequest[] = [];
  const posts: { body: unknown; key: string | undefined }[] = [];
  const state = { online: true };
  const server = fakeServer({
    "/v1/auth/refresh": () => ({ status: 200, body: { tokens: tokens(2) } }),
    "/v1/users/me": () => ({ status: 200, body: profile(true) }),
    [PATH]: (body): Reply => {
      if (body === undefined) {
        const items = saved.map((r) => ({ id: r.runId, startedAt: r.startedAt, durationS: 600, distanceM: 1800, routeName: null, kcalPoint: 120, source: "mobile" }));
        return { status: 200, body: { items: items.slice(-1), nextCursor: null } };
      }
      const run = saveRunRequestSchema.parse(body);
      if (!saved.some((r) => r.runId === run.runId)) saved.push(run);
      const sums = runSums(run.points, run.pauses, run.elapsedMs, 60);
      return {
        status: 201,
        body: {
          status: "created",
          run: {
            id: run.runId, startedAt: run.startedAt, name: run.name, effort: run.effort, note: run.note, distanceM: sums.distanceM, movingS: sums.movingS,
            elapsedS: sums.elapsedS, leftOutM: sums.leftOutM, leftOutS: sums.leftOutS, kcal: sums.kcal, splitsKm: sums.splitsKm, splitsMi: sums.splitsMi, polyline: "", trackStarts: sums.trackStarts,
          },
        },
      };
    },
  });
  const ask: Ask = async (url: string, init: AskInit) => {
    const path = new URL(url).pathname;
    if (path === PATH && init.method === "POST") {
      if (!state.online) throw new Error("no signal");
      posts.push({ body: init.body === undefined ? undefined : JSON.parse(init.body), key: init.headers?.["idempotency-key"] });
    }
    return server.ask(url, init);
  };
  let file: string | null = null;
  const runStore = () => ({
    read: () => Promise.resolve(file),
    write: (t: string) => {
      file = t;
      return Promise.resolve();
    },
  });
  return { ask, saved, posts, state, runStore, file: () => file };
}

async function openRunning(s: ReturnType<typeof runServer>, user = RAVI) {
  await render(<App extra={extra} store={memoryStore(kept(1, user))} ask={s.ask} runStore={s.runStore} />);
  await fireEvent.press(await screen.findByRole("tab", { name: "Workout" }));
  await fireEvent.press(await screen.findByRole("button", { name: "Running" }));
  expect(await screen.findByRole("button", { name: "Start run" })).toBeTruthy();
}

/** One point a second going north at `mps`, from the run's start, as Android hands them over. */
async function feed(fromS: number, seconds: number, mps: number, startLat = 26.1445): Promise<RunPoint[]> {
  const run = runNow();
  if (run === null) throw new Error("no run going");
  const locations = Array.from({ length: seconds }, (_, i) => ({
    timestamp: run.startedAt + (fromS + i) * 1000,
    coords: { latitude: startLat + ((fromS + i) * mps) / 111_132, longitude: 91.7362, accuracy: 5, speed: mps },
  }));
  await act(() => takeLocations({ locations }));
  return locations.map((l): RunPoint => [l.timestamp - run.startedAt, l.coords.latitude, l.coords.longitude, 5]);
}

async function startRunning() {
  await fireEvent.press(screen.getByRole("button", { name: "Start run" }));
  expect(await screen.findByText("Get ready")).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "Start now" }));
  await waitFor(() => {
    expect(runNow()?.phase).toBe("running");
  });
}

describe("the worst thing: somebody's run shown to another person on the same phone", () => {
  it("a run kept on this phone by another account is never shown, and Start begins the person's own", async () => {
    // Somebody else's run, left on the phone mid-way, with its points from their door.
    await phoneRunFiles.write("run-now.json", JSON.stringify({ runId: "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed", userId: "5f0c8a52-6f0e-4d59-9a3c-1f2e3d4c5b6b", startedAt: Date.now() - 600_000, phase: "running", pausedByPerson: false, autoPause: true, pauses: [], finishedMs: null, files: 1 }));
    await phoneRunFiles.write("run-now-0.json", JSON.stringify([[0, 26.2, 91.8, 5], [1000, 26.2001, 91.8, 5]]));
    const s = runServer();
    await openRunning(s);
    expect(screen.queryByText("Your run is going.")).toBeNull();
    expect(screen.queryByText("Time")).toBeNull();
    expect(screen.queryByTestId("live-route")).toBeNull();
    expect(screen.queryByRole("button", { name: "Open run" })).toBeNull();
  });
});

describe("a run, Start to Save", () => {
  it("records through the service with its notice, shows the numbers, pauses, finishes and is saved once with its own key", async () => {
    const s = runServer();
    await openRunning(s);
    await startRunning();
    expect(location.started).toHaveLength(1);
    expect(location.started[0]?.options.foregroundService?.notificationTitle).toBe("Recording your run");

    const points = await feed(0, 301, 3);
    const expected = runSums(points, [], 300_000, 60);
    const shown = distance(expected.distanceM, "metric");
    // Under the first kilometre, Distance and This km read the same.
    expect(await screen.findAllByText(`${shown} km`, {}, { timeout: 5000 })).toHaveLength(2);

    await fireEvent.press(screen.getByRole("button", { name: "Pause" }));
    expect(await screen.findByText("Paused")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Finish" }));
    const run = runNow();
    if (run === null) throw new Error("the run is gone before Save");
    const name = runName(new Date(run.startedAt));
    expect(await screen.findByRole("button", { name: `Rename ${name}` })).toBeTruthy();
    expect(location.running).toBe(false);
    expect(screen.getByText("Moving time")).toBeTruthy();
    expect(screen.getByText("Calories")).toBeTruthy();

    await fireEvent.press(screen.getByRole("button", { name: "4 of 10" }));
    await fireEvent.changeText(screen.getByLabelText("Private note"), "Felt strong on the hill");
    await fireEvent.press(screen.getByRole("button", { name: "Save run" }));

    expect(await screen.findByText(`${name} is saved.`)).toBeTruthy();
    expect(s.posts).toHaveLength(1);
    const sent = saveRunRequestSchema.parse(s.posts[0]?.body);
    expect(sent.runId).toMatch(UUID);
    expect(s.posts[0]?.key).toBe(sent.runId);
    expect(sent).toMatchObject({ name, effort: 4, note: "Felt strong on the hill" });
    expect(sent.points).toHaveLength(301);
    expect(runNow()).toBeNull();
    // Nothing of it is left on the phone but the outbox's own file, now empty.
    expect(await phoneRunFiles.read("run-now.json")).toBeNull();
    expect(JSON.parse(s.file() ?? "{}")).toMatchObject({ waiting: [] });
  });

  it("with no signal at Save, the run waits on the phone, says so, and is sent once when the app is back", async () => {
    const s = runServer();
    await openRunning(s);
    await startRunning();
    await feed(0, 121, 3);
    await fireEvent.press(await screen.findByRole("button", { name: "Pause" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Finish" }));
    const name = runName(new Date(runNow()?.startedAt ?? 0));
    s.state.online = false;
    await fireEvent.press(await screen.findByRole("button", { name: "Save run" }));
    expect(await screen.findByText(`${name} is saved on this phone. It will be sent when you're online.`)).toBeTruthy();
    expect(s.saved).toHaveLength(0);
    expect(readRunFile(s.file() ?? "").waiting).toHaveLength(1);

    s.state.online = true;
    await act(async () => {
      comeBack();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    await waitFor(() => {
      expect(s.saved).toHaveLength(1);
    });
    comeBack();
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(s.posts).toHaveLength(1);
    expect(readRunFile(s.file() ?? "").waiting).toHaveLength(0);
  });

  it("Discard asks first, and then nothing is sent or kept", async () => {
    const s = runServer();
    await openRunning(s);
    await startRunning();
    await feed(0, 61, 3);
    await fireEvent.press(await screen.findByRole("button", { name: "Pause" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Finish" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Discard run" }));
    const box = await screen.findByTestId("sheet");
    expect(within(box).getByText("Discard this run?")).toBeTruthy();
    await fireEvent.press(within(box).getByRole("button", { name: "Keep run" }));
    expect(runNow()?.phase).toBe("finished");
    await fireEvent.press(await screen.findByRole("button", { name: "Discard run" }));
    await fireEvent.press(within(await screen.findByTestId("sheet")).getByRole("button", { name: "Discard run" }));
    await waitFor(() => {
      expect(runNow()).toBeNull();
    });
    expect(s.posts).toHaveLength(0);
    expect(await phoneRunFiles.read("run-now.json")).toBeNull();
  });
});

describe("the location, before a run", () => {
  it.each([
    ["not allowed", { granted: false, canAskAgain: true }, "Allow location to record your run.", "Allow location"],
    ["turned off for the app", { granted: false, canAskAgain: false }, "Location is off for this app. Turn it on in Settings.", "Open settings"],
    ["approximate only", { accuracy: "coarse" }, "Turn on Precise location to measure your run.", "Allow precise location"],
    ["the phone's location off", { services: false }, "Turn on your phone's location to record your run.", null],
  ] as const)("%s: says what to do, with its button, and starts nothing", async (_, answer, words, button) => {
    Object.assign(location, answer);
    const s = runServer();
    await openRunning(s);
    await fireEvent.press(screen.getByRole("button", { name: "Start run" }));
    expect(await screen.findByText(words)).toBeTruthy();
    if (button !== null) expect(screen.getByRole("button", { name: button })).toBeTruthy();
    expect(screen.queryByText("Get ready")).toBeNull();
    expect(location.started).toHaveLength(0);
  });
});

describe("Auto-pause", () => {
  it("stops the clock at a light and starts it again when the person runs on", async () => {
    const s = runServer();
    await openRunning(s);
    await startRunning();
    await feed(0, 60, 3);
    // Standing still for twenty seconds.
    const run = runNow();
    if (run === null) throw new Error("no run");
    const stillAt = 26.1445 + (59 * 3) / 111_132;
    await act(() =>
      takeLocations({ locations: Array.from({ length: 20 }, (_, i) => ({ timestamp: run.startedAt + (60 + i) * 1000, coords: { latitude: stillAt, longitude: 91.7362, accuracy: 5, speed: 0 } })) }),
    );
    expect(await screen.findByText("Auto-paused")).toBeTruthy();
    // From where the person stopped: the last moving point, at 59 s.
    expect(runNow()?.pauses).toEqual([[59_000, null]]);
    await feed(80, 10, 3, stillAt - (80 * 3) / 111_132);
    await waitFor(() => {
      expect(runNow()?.phase).toBe("running");
    });
    expect(runNow()?.pauses).toEqual([[59_000, 80_000]]);
    expect(screen.queryByText("Auto-paused")).toBeNull();
    expect(clock(0)).toBe("0:00");
  });
});

describe("Auto-pause turned off during a run (Kd's click-through, 2026-11-05)", () => {
  /** A run of a minute, then the person standing still long enough for Auto-pause. */
  async function autoPaused() {
    await startRunning();
    await feed(0, 60, 3);
    const run = runNow();
    if (run === null) throw new Error("no run");
    const stillAt = 26.1445 + (59 * 3) / 111_132;
    await act(() =>
      takeLocations({ locations: Array.from({ length: 12 }, (_, i) => ({ timestamp: run.startedAt + (60 + i) * 1000, coords: { latitude: stillAt, longitude: 91.7362, accuracy: 5, speed: 0 } })) }),
    );
    expect(await screen.findByText("Auto-paused")).toBeTruthy();
  }

  it("on the run's own screen: Turn off Auto-pause starts the clock again at once, and it stays off", async () => {
    const s = runServer();
    await openRunning(s);
    await autoPaused();
    await fireEvent.press(screen.getByRole("button", { name: "Turn off Auto-pause" }));
    await waitFor(() => {
      expect(runNow()?.phase).toBe("running");
    });
    expect(runNow()?.autoPause).toBe(false);
    expect(runNow()?.pauses[0]?.[1]).not.toBeNull();
    // Standing still again changes nothing now.
    const run = runNow();
    if (run === null) throw new Error("no run");
    const stillAt = 26.1445 + (59 * 3) / 111_132;
    await act(() =>
      takeLocations({ locations: Array.from({ length: 20 }, (_, i) => ({ timestamp: run.startedAt + (200 + i) * 1000, coords: { latitude: stillAt, longitude: 91.7362, accuracy: 5, speed: 0 } })) }),
    );
    expect(runNow()?.phase).toBe("running");
    expect(screen.queryByText("Auto-paused")).toBeNull();
    // One choice: the Running page's switch reads off too, for this run and the next.
    await fireEvent.press(screen.getByRole("button", { name: "Back to the app" }));
    expect((await screen.findByRole("switch", { name: "Auto-pause" })).props.value).toBe(false);
  });

  it("on the Running page, with the run behind it: the switch changes the run going on", async () => {
    const s = runServer();
    await openRunning(s);
    await autoPaused();
    await fireEvent.press(screen.getByRole("button", { name: "Back to the app" }));
    const toggle = await screen.findByRole("switch", { name: "Auto-pause" });
    expect(toggle.props.value).toBe(true);
    await fireEvent(toggle, "valueChange", false);
    await waitFor(() => {
      expect(runNow()?.phase).toBe("running");
    });
    expect(runNow()?.autoPause).toBe(false);
    expect(screen.getByRole("switch", { name: "Auto-pause" }).props.value).toBe(false);
  });
});

describe("a run stays inside what the server takes (round one of 37a, H1)", () => {
  it("keeps no points while paused, so a run left paused never fills the phone", async () => {
    const s = runServer();
    await openRunning(s);
    await startRunning();
    await feed(0, 61, 3);
    await fireEvent.press(await screen.findByRole("button", { name: "Pause" }));
    expect(await screen.findByText("Paused")).toBeTruthy();
    const before = runNow()?.points.length ?? 0;
    await feed(61, 600, 0);
    expect(runNow()?.points.length).toBe(before);
  });

  it("a run reaching twelve hours of points ends by itself, and is saved whole", async () => {
    const s = runServer();
    await openRunning(s);
    await startRunning();
    // Twelve hours and a minute of points at once, as Android may hand them over after a long sleep.
    await feed(0, RUN_MAX_POINTS + 60, 2.5);
    await waitFor(() => {
      expect(runNow()?.phase).toBe("finished");
    });
    expect(runNow()?.points).toHaveLength(RUN_MAX_POINTS);
    await fireEvent.press(await screen.findByRole("button", { name: "Save run" }, { timeout: 10_000 }));
    await waitFor(() => {
      expect(s.saved).toHaveLength(1);
    });
    expect(s.saved[0]?.points).toHaveLength(RUN_MAX_POINTS);
  });
});
