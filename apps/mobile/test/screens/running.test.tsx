import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { AppState, Linking } from "react-native";
import type { StyleSpecification } from "@maplibre/maplibre-react-native";
import { HEIGHT_MAP_CREDITS, OPENFREEMAP, RUN_MAX_POINTS, runSums, saveRunRequestSchema, type MapSource, type RunClimb, type RunPoint, type SaveRunRequest } from "@app/shared";
import { App } from "../../src/App";
import { resetMapSource } from "../../src/screens/running/mapSource";
import { RUN_BAR_ROOM } from "../../src/screens/running/RunLayer";
import { MAP_CREDIT_PAGE, MAP_WAIT_MS } from "../../src/screens/running/RunMap";
import { unitMarks } from "../../src/screens/running/routeShape";
import { closedPauses, keepRunUnits, phoneRunFiles, resetRecorder, runNow, takeLocations } from "../../src/screens/running/recorder";
import { spokenTime } from "../../src/screens/running/runVoice";
import { readRunFile } from "../../src/screens/running/runQueue";
import { clock, distance, runName } from "../../src/screens/running/runWords";
import type { Ask, AskInit } from "../../src/session/calls";
import { RAVI, fakeServer, kept, memoryStore, profile, tokens, type Reply } from "../kit";
import { realRuns, type RealPoint } from "../realRuns";

// Record a run (ROADMAP Stage 5 37a), through the whole app. The worst thing on the phone's side:
// somebody's run, which starts at their front door, shown to another person on the same phone, or a
// run lost or saved twice. Then the run itself, Start to Save, with no signal at Save, Discard, a
// location the person has not allowed, and Auto-pause.

const extra = { copyName: "Feature 2", apiUrl: "http://localhost:3000" };
const PATH = "/v1/geo/runs";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// The phone's location, as the setup's stand-in holds it.
const location = jest.requireMock<{ state: { services: boolean; granted: boolean; canAskAgain: boolean; accuracy: string; asked: number; started: { task: string; options: { foregroundService?: { notificationTitle: string } } }[]; running: boolean; acceptsTurnOn: boolean } }>("expo-location").state;

// Each map drawn, as the setup's stand-in keeps it (37b-i).
type DrawnMap = {
  props: {
    testID: string;
    mapStyle: StyleSpecification;
    onPress?: () => void;
    onRegionWillChange?: (event: { nativeEvent: { userInteraction: boolean } }) => void;
    onDidFinishLoadingMap?: () => void;
    onDidFailLoadingMap?: () => void;
  } & Record<string, unknown>;
  sources: Record<string, unknown>;
  layers: Record<string, unknown>;
  camera: Record<string, unknown> | null;
  markers: [number, number][];
  gone: boolean;
};
const maplibre = jest.requireMock<{ maps: DrawnMap[] }>("@maplibre/maplibre-react-native");
/** The map on screen with this test id, the newest drawn. */
const drawnMap = (testID: string): DrawnMap => {
  const map = maplibre.maps.filter((m) => !m.gone && m.props.testID === testID).at(-1);
  if (map === undefined) throw new Error(`no ${testID} on screen`);
  return map;
};

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
  Object.assign(location, { services: true, granted: true, canAskAgain: true, accuracy: "fine", asked: 0, started: [], running: false, acceptsTurnOn: true });
  for (const name of ["run-now.json", "run-now-0.json", "run-now-1.json", "run-settings.json", "run-map.json"]) phoneRunFiles.remove(name);
  resetRecorder();
  resetMapSource();
  maplibre.maps.length = 0;
  await Promise.resolve();
});

/** The server: the person's runs, a POST kept once for its id. `online` false is no signal. */
function runServer(user = RAVI, map: MapSource = OPENFREEMAP) {
  const saved: SaveRunRequest[] = [];
  const posts: { body: unknown; key: string | undefined }[] = [];
  const state: { online: boolean; mapHeld: Promise<void> | null; climb: RunClimb } = { online: true, mapHeld: null, climb: { state: "done", m: 28 } };
  const climbAsks: unknown[] = [];
  const server = fakeServer({
    // The run's elevation gain, as the server's height map works it out (37b-ii).
    "/v1/geo/runs/climb": (body) => {
      climbAsks.push(body);
      return { status: 200, body: { climb: state.climb } };
    },
    "/v1/auth/refresh": () => ({ status: 200, body: { tokens: tokens(2) } }),
    "/v1/geo/map": () => ({ status: 200, body: { map } }),
    "/v1/users/me": () => ({ status: 200, body: profile(true, user) }),
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
            elapsedS: sums.elapsedS, leftOutM: sums.leftOutM, leftOutS: sums.leftOutS, kcal: sums.kcal, splitsKm: sums.splitsKm, splitsMi: sums.splitsMi, polyline: "", trackStarts: sums.trackStarts, climbM: null,
          },
        },
      };
    },
  });
  const requests: { path: string; method: string; search: string; body: string | undefined }[] = [];
  const ask: Ask = async (url: string, init: AskInit) => {
    const path = new URL(url).pathname;
    requests.push({ path, method: init.method ?? "GET", search: new URL(url).search, body: init.body });
    if (path === "/v1/geo/map" && !state.online) throw new Error("no signal");
    if (path === "/v1/geo/map" && state.mapHeld !== null) await state.mapHeld;
    if (path === "/v1/geo/runs/climb" && !state.online) throw new Error("no signal");
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
  return { ask, saved, posts, state, runStore, requests, climbAsks, file: () => file };
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
    // The run opens on its map, with Time, Distance and Current pace under it (Kd, 37b-i).
    expect(await screen.findAllByText(`${shown} km`, {}, { timeout: 5000 })).toHaveLength(1);
    expect(screen.getByTestId("live-map")).toBeTruthy();
    // Numbers beside Pause: the big numbers, where under the first kilometre Distance and This km read the same.
    await fireEvent.press(screen.getByRole("button", { name: "Numbers" }));
    expect(await screen.findAllByText(`${shown} km`)).toHaveLength(2);
    expect(screen.queryByTestId("live-map")).toBeNull();

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
    ["the phone's location off", { services: false }, "Turn on your phone's location to record your run.", "Turn on location"],
  ] as const)("%s: says what to do, with its button, and starts nothing", async (_, answer, words, button) => {
    Object.assign(location, answer);
    const s = runServer();
    await openRunning(s);
    await fireEvent.press(screen.getByRole("button", { name: "Start run" }));
    expect(await screen.findByText(words)).toBeTruthy();
    expect(screen.getByRole("button", { name: button })).toBeTruthy();
    expect(screen.queryByText("Get ready")).toBeNull();
    expect(location.started).toHaveLength(0);
  });

  it("the phone's location off: Turn on location opens Android's own box, and once it is on the run starts", async () => {
    location.services = false;
    const s = runServer();
    await openRunning(s);
    await fireEvent.press(screen.getByRole("button", { name: "Start run" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Turn on location" }));
    expect(await screen.findByText("Get ready")).toBeTruthy();
    expect(location.services).toBe(true);
  });

  it("the phone's location off and the box declined: Android's Location page opens, and nothing starts", async () => {
    Object.assign(location, { services: false, acceptsTurnOn: false });
    const opened = jest.spyOn(Linking, "sendIntent").mockResolvedValue(undefined);
    const s = runServer();
    await openRunning(s);
    await fireEvent.press(screen.getByRole("button", { name: "Start run" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Turn on location" }));
    await waitFor(() => {
      expect(opened).toHaveBeenCalledWith("android.settings.LOCATION_SOURCE_SETTINGS");
    });
    expect(screen.queryByText("Get ready")).toBeNull();
    expect(screen.getByText("Turn on your phone's location to record your run.")).toBeTruthy();
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

// ── The voice (37a-ii) ────────────────────────────────────────────────────────────────────────
// The worst thing: a runner told a wrong number out loud. The rule itself is proved against three
// real runs in test/runVoice.test.ts; here a real run goes through the whole app, as Android hands
// its points over with the screen locked, in each of the person's units.

const voice = jest.requireMock<{ voice: { said: string[]; quieted: number; canSpeak: string; missing: boolean } }>("../../src/screens/running/runVoiceNative").voice;

/** A real run's points, thirty at a time, as Android hands them over with the screen off. */
async function feedReal(points: readonly RealPoint[]) {
  const run = runNow();
  if (run === null) throw new Error("no run going");
  for (let i = 0; i < points.length; i += 30) {
    const locations = points.slice(i, i + 30).map(([t, latitude, longitude]) => ({ timestamp: run.startedAt + 2000 + t, coords: { latitude, longitude, accuracy: null, speed: null } }));
    await act(() => takeLocations({ locations }));
  }
}

const MARK = { kilometre: /^\d+ kilometres?\./, mile: /^\d+ miles?\./ } as const;

/** The seconds a line says after a label: "Time 11 minutes 20 seconds." is 680. */
function secondsIn(line: string, label: string): number {
  const part = line.split(`${label} `)[1]?.split(".")[0] ?? "";
  const unit = (name: string) => Number(new RegExp(`(\\d+) ${name}s?\\b`).exec(part)?.[1] ?? 0);
  return unit("hour") * 3600 + unit("minute") * 60 + unit("second");
}
const marksSaid = (unit: "kilometre" | "mile") => voice.said.filter((line) => MARK[unit].test(line));

describe("the voice, through the whole app", () => {
  beforeEach(() => {
    Object.assign(voice, { said: [], quieted: 0, canSpeak: "ok", missing: false });
  });

  it.each([
    ["kilometres", RAVI, "kilometre", "mile"],
    ["miles", { ...RAVI, units: "imperial" }, "mile", "kilometre"],
  ] as const)("the worst thing: a real run in %s says each mark once, with the summary's own numbers", async (_name, user, unit, never) => {
    const s = runServer(user);
    await openRunning(s, user);
    await startRunning();
    await feedReal(realRuns().get("iphone") ?? []);
    const run = runNow();
    if (run === null) throw new Error("no run");
    const end = run.points[run.points.length - 1]?.[0] ?? 0;
    const final = runSums(run.points, closedPauses(run, end), end, 0);
    const splits = unit === "mile" ? final.splitsMi : final.splitsKm;
    const whole = Math.floor(final.distanceM / (unit === "mile" ? 1609.344 : 1000));
    const said = marksSaid(unit);
    expect(whole).toBeGreaterThan(4);
    expect(said.length).toBeGreaterThanOrEqual(whole - 1);
    expect(said.length).toBeLessThanOrEqual(whole);
    said.forEach((line, i) => {
      expect(line.startsWith(`${String(i + 1)} ${unit}${i === 0 ? "" : "s"}.`)).toBe(true);
      // Each kilometre or mile's own time, as the summary will show it.
      if (i > 0) expect(line).toContain(`Last ${unit} ${spokenTime(splits[i]?.s ?? -1)}.`);
    });
    for (const line of voice.said) expect(line).not.toContain(never);
  });

  it("says Auto-paused, Run paused and Run resumed; a kilometre passed just before a pause is said at the pause", async () => {
    const s = runServer();
    await openRunning(s);
    await startRunning();
    await feed(0, 340, 3);
    // About 1,017 m, a few seconds past the mark: not yet settled, so not yet said.
    expect(marksSaid("kilometre")).toEqual([]);
    const run = runNow();
    if (run === null) throw new Error("no run");
    const stillAt = 26.1445 + (339 * 3) / 111_132;
    await act(() =>
      takeLocations({ locations: Array.from({ length: 20 }, (_, i) => ({ timestamp: run.startedAt + (340 + i) * 1000, coords: { latitude: stillAt, longitude: 91.7362, accuracy: 5, speed: 0 } })) }),
    );
    expect(await screen.findByText("Auto-paused")).toBeTruthy();
    expect(voice.said).toHaveLength(2);
    expect(voice.said[0]).toMatch(/^1 kilometre\. Time 5 minutes 3\d seconds\./);
    expect(voice.said[1]).toBe("Auto-paused.");
    await feed(360, 10, 3, stillAt - (360 * 3) / 111_132);
    await waitFor(() => {
      expect(voice.said[2]).toBe("Run resumed.");
    });
    await fireEvent.press(screen.getByRole("button", { name: "Pause" }));
    await waitFor(() => {
      expect(voice.said[3]).toBe("Run paused.");
    });
    await fireEvent.press(screen.getByRole("button", { name: "Resume" }));
    await waitFor(() => {
      expect(voice.said[4]).toBe("Run resumed.");
    });
    // The first kilometre is never said again.
    await feed(380, 60, 3, stillAt - (360 * 3) / 111_132);
    expect(marksSaid("kilometre")).toHaveLength(1);
    await fireEvent.press(screen.getByRole("button", { name: "Pause" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Finish" }));
    await waitFor(() => {
      expect(voice.quieted).toBeGreaterThan(0);
    });
  });

  it("Voice off says nothing, stops what it was saying, and stays off for the next run", async () => {
    const s = runServer();
    await openRunning(s);
    const toggle = await screen.findByRole("switch", { name: "Voice" });
    expect(toggle.props.value).toBe(true);
    expect(screen.getByText("Your time and pace each kilometre")).toBeTruthy();
    await fireEvent(toggle, "valueChange", false);
    await waitFor(() => {
      expect(voice.quieted).toBe(1);
    });
    await startRunning();
    await feed(0, 400, 3);
    await fireEvent.press(screen.getByRole("button", { name: "Pause" }));
    expect(voice.said).toEqual([]);
    expect(JSON.parse((await phoneRunFiles.read("run-settings.json")) ?? "{}")).toMatchObject({ voice: false });
  });

  it("Voice turned on mid-run says the next mark, never one already passed", async () => {
    const s = runServer();
    await openRunning(s);
    await fireEvent(await screen.findByRole("switch", { name: "Voice" }), "valueChange", false);
    await startRunning();
    await feed(0, 400, 3);
    await fireEvent.press(screen.getByRole("button", { name: "Back to the app" }));
    const toggle = await screen.findByRole("switch", { name: "Voice" });
    await fireEvent(toggle, "valueChange", true);
    await waitFor(() => {
      expect(screen.getByRole("switch", { name: "Voice" }).props.value).toBe(true);
    });
    await feed(400, 380, 3);
    expect(marksSaid("kilometre").map((line) => line.split(".")[0])).toEqual(["2 kilometres"]);
  });

  it("a phone that cannot speak says so under the switch, with the button to its settings", async () => {
    voice.canSpeak = "off";
    const opened = jest.spyOn(Linking, "sendIntent").mockResolvedValue(undefined);
    const s = runServer();
    await openRunning(s);
    expect(await screen.findByText("Text-to-speech is off on this phone.")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Open text-to-speech settings" }));
    expect(opened).toHaveBeenCalledWith("com.android.settings.TTS_SETTINGS");
    // Turned on in the phone's settings: the line goes when the person comes back.
    voice.canSpeak = "ok";
    await act(() => {
      comeBack();
    });
    await waitFor(() => {
      expect(screen.queryByText("Text-to-speech is off on this phone.")).toBeNull();
    });
  });

  it("a phone with text-to-speech but no English voice is told to add one, not that it is off", async () => {
    voice.canSpeak = "noEnglish";
    const s = runServer();
    await openRunning(s);
    expect(await screen.findByText("Your phone has no English voice for text-to-speech.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open text-to-speech settings" })).toBeTruthy();
    expect(screen.queryByText("Text-to-speech is off on this phone.")).toBeNull();
  });

  it("a phone with no voice code of this app's (an iPhone, until item 21) keeps the row, says Coming soon, and its switch does nothing", async () => {
    voice.missing = true;
    const s = runServer();
    await openRunning(s);
    expect(await screen.findByText("Coming soon")).toBeTruthy();
    const toggle = screen.getByRole("switch", { name: "Voice" });
    expect(toggle.props.value).toBe(false);
    expect(toggle.props.disabled).toBe(true);
  });

  it("a run reopened past 3 km says the next kilometre, never the 3 km already passed", async () => {
    // A run of 3,300 m left on this phone by this person, still recording (Android's service on).
    const startedAt = Date.now() - 1_200_000;
    const points = Array.from({ length: 1100 }, (_, i): RunPoint => [i * 1000, 26.1445 + (i * 3) / 111_132, 91.7362, 5]);
    await phoneRunFiles.write("run-now.json", JSON.stringify({ runId: "2c9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed", userId: RAVI.id, startedAt, phase: "running", pausedByPerson: false, autoPause: true, pauses: [], finishedMs: null, files: 2 }));
    await phoneRunFiles.write("run-now-0.json", JSON.stringify(points.slice(0, 600)));
    await phoneRunFiles.write("run-now-1.json", JSON.stringify(points.slice(600)));
    location.running = true;
    const s = runServer();
    // The run opens over the app as it was left, so the Running page is not looked for.
    await render(<App extra={extra} store={memoryStore(kept(1, RAVI))} ask={s.ask} runStore={s.runStore} />);
    await waitFor(() => {
      expect(runNow()?.points).toHaveLength(1100);
    });
    await feed(1100, 10, 3);
    expect(marksSaid("kilometre")).toEqual([]);
    await feed(1110, 300, 3);
    expect(marksSaid("kilometre").map((line) => line.split(".")[0])).toEqual(["4 kilometres"]);
  });

  it("a pause before a kilometre is left out of the time said at it, as the summary leaves it out", async () => {
    const s = runServer();
    await openRunning(s);
    await startRunning();
    await feed(0, 400, 3);
    const run = runNow();
    if (run === null) throw new Error("no run");
    // Standing ninety seconds: Auto-pause pauses the run, then running on starts it again.
    const stillAt = 26.1445 + (399 * 3) / 111_132;
    await act(() =>
      takeLocations({ locations: Array.from({ length: 90 }, (_, i) => ({ timestamp: run.startedAt + (400 + i) * 1000, coords: { latitude: stillAt, longitude: 91.7362, accuracy: 5, speed: 0 } })) }),
    );
    await feed(490, 330, 3, stillAt - (490 * 3) / 111_132);
    const done = runNow();
    if (done === null) throw new Error("no run");
    expect(done.pauses.length).toBe(1);
    const end = done.points[done.points.length - 1]?.[0] ?? 0;
    const final = runSums(done.points, closedPauses(done, end), end, 0);
    const second = voice.said.find((line) => line.startsWith("2 kilometres."));
    if (second === undefined) throw new Error("the second kilometre was not said");
    const saidS = secondsIn(second, "Time");
    // The clock at the mark, from the summary: its moving time less what came after the mark.
    const atMark = final.movingS - final.splitsKm.slice(2).reduce((t, split) => t + split.s, 0);
    expect(Math.abs(saidS - atMark)).toBeLessThanOrEqual(1);
    expect(secondsIn(second, "Average pace")).toBe(Math.round(saidS / 2));
    // Ninety seconds standing would have made it some 85 s more.
    expect(saidS).toBeLessThan(700);
  });

  it("units changed mid-run say no mile already passed, and the next mile in miles", async () => {
    const s = runServer();
    await openRunning(s);
    await startRunning();
    await feed(0, 400, 3);
    await feed(400, 350, 3);
    await feed(750, 350, 3);
    expect(marksSaid("kilometre").map((line) => line.split(".")[0])).toEqual(["1 kilometre", "2 kilometres", "3 kilometres"]);
    // 3.3 km run: 2 miles (3.22 km) are passed. The account turns to miles.
    await act(() => keepRunUnits("imperial"));
    await feed(1100, 10, 3);
    expect(marksSaid("mile")).toEqual([]);
    await feed(1110, 540, 3);
    expect(marksSaid("mile").map((line) => line.split(".")[0])).toEqual(["3 miles"]);
  });

  it("a batch that starts the run again and passes a kilometre says Run resumed first", async () => {
    const s = runServer();
    await openRunning(s);
    await startRunning();
    await feed(0, 330, 3);
    const run = runNow();
    if (run === null) throw new Error("no run");
    const stillAt = 26.1445 + (329 * 3) / 111_132;
    await act(() =>
      takeLocations({ locations: Array.from({ length: 20 }, (_, i) => ({ timestamp: run.startedAt + (330 + i) * 1000, coords: { latitude: stillAt, longitude: 91.7362, accuracy: 5, speed: 0 } })) }),
    );
    expect(voice.said).toEqual(["Auto-paused."]);
    // One batch, as Android hands them after the screen was off: moving again, and 1 km passed.
    await feed(350, 45, 3, stillAt - (350 * 3) / 111_132);
    expect(voice.said[1]).toBe("Run resumed.");
    expect(voice.said[2]).toMatch(/^1 kilometre./);
  });

  it("keeps the account's units for a run the phone carries on with the app closed", async () => {
    const user = { ...RAVI, units: "imperial" as const };
    const s = runServer(user);
    await openRunning(s, user);
    expect(screen.getByText("Your time and pace each mile")).toBeTruthy();
    await waitFor(async () => {
      expect(JSON.parse((await phoneRunFiles.read("run-settings.json")) ?? "{}")).toMatchObject({ units: "imperial", voice: true, autoPause: true });
    });
  });
});

describe("the map under the run (37b-i)", () => {
  const OWN_COPY: MapSource = {
    maker: "protomaps",
    tiles: "pmtiles://https://maps.example.org/world.pmtiles",
    glyphs: "https://maps.example.org/fonts/{fontstack}/{range}.pbf",
    sprite: null,
    credit: "Protomaps © OpenStreetMap",
  };
  // The only things a map may be given: what it draws and how it moves. A header, a request changed on
  // its way out, or an address of the run's own is none of them.
  const MAP_PROPS = new Set(["testID", "style", "mapStyle", "attribution", "logo", "compass", "scaleBar", "dragPan", "touchZoom", "doubleTapZoom", "doubleTapHoldZoom", "touchRotate", "touchPitch", "onPress", "onRegionWillChange", "onDidFinishLoadingMap", "onDidFailLoadingMap", "children"]);
  /** Every address written anywhere in what a map was given. */
  const addressesIn = (map: DrawnMap): string[] => JSON.stringify({ style: map.props.mapStyle, sources: map.sources }).match(/[a-z]+:\/\/[^"\s]+/gi) ?? [];
  /** Runs `seconds` north at 3 m/s, then stands still until Auto-pause pauses the run where it
   *  stopped, and presses Finish: the run's points all count, as on a real run. */
  async function runThenFinish(seconds: number, meanwhile?: () => Promise<void>): Promise<void> {
    await feed(0, seconds, 3);
    await meanwhile?.();
    await feed(seconds, 15, 0, 26.1445 + ((seconds - 1) * 3) / 111_132);
    expect(await screen.findByText("Auto-paused", {}, { timeout: 5000 })).toBeTruthy();
    await fireEvent.press(await screen.findByRole("button", { name: "Finish" }));
  }
  /** The run's own sums, as its summary works them out. */
  const finishedSums = () => {
    const run = runNow();
    if (run === null) throw new Error("no run");
    const at = run.finishedMs ?? 0;
    return runSums(run.points, closedPauses(run, at), at, 60);
  };

  it("the worst thing: the map asks only the map's own addresses, and nothing of the run is sent to draw it", async () => {
    const s = runServer();
    await openRunning(s);
    await startRunning();
    // The live map's trail, once the run's numbers are worked out, before Auto-pause and Finish.
    await runThenFinish(241, () =>
      waitFor(
        () => {
          expect(JSON.stringify(drawnMap("live-map-view").sources["run-trail"])).toContain("LineString");
        },
        { timeout: 5000 },
      ),
    );
    const points = runNow()?.points ?? [];
    await fireEvent.press(await screen.findByRole("button", { name: "Open the map full size" }));
    for (const testID of ["live-map-view", "summary-map-view", "full-map-view"]) {
      const map = maplibre.maps.filter((m) => m.props.testID === testID).at(-1);
      if (map === undefined) throw new Error(`${testID} was never drawn`);
      expect(Object.keys(map.props).filter((key) => !MAP_PROPS.has(key))).toEqual([]);
      expect(map.props.mapStyle.sources).toEqual({ basemap: { type: "vector", url: OPENFREEMAP.tiles } });
      expect(addressesIn(map).every((at) => [OPENFREEMAP.tiles, OPENFREEMAP.glyphs, OPENFREEMAP.sprite].includes(at))).toBe(true);
      // The run is drawn from shapes the phone holds, never from an address.
      expect(JSON.stringify(map.sources["run-trail"])).toContain('"type":"LineString"');
    }
    // What the app asked our server for the map: which map, and nothing of the run.
    const asked = s.requests.filter((r) => r.path === "/v1/geo/map");
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.every((r) => r.method === "GET" && r.search === "" && r.body === undefined)).toBe(true);
    const lat = (points[100]?.[1] ?? 0).toFixed(5);
    expect(s.requests.filter((r) => r.path !== PATH && (r.body ?? "").includes(lat))).toEqual([]);
  });

  it("follows the front of the run, stops when the person moves the map, and Follow me brings it back", async () => {
    const s = runServer();
    await openRunning(s);
    await startRunning();
    await feed(0, 121, 3);
    const front = () => drawnMap("live-map-view").markers.at(-1);
    await waitFor(
      () => {
        expect(drawnMap("live-map-view").camera).toMatchObject({ center: front(), zoom: 16.2 });
      },
      { timeout: 5000 },
    );
    await act(() => {
      drawnMap("live-map-view").props.onRegionWillChange?.({ nativeEvent: { userInteraction: true } });
    });
    expect(drawnMap("live-map-view").camera?.["center"]).toBeUndefined();
    await fireEvent.press(await screen.findByRole("button", { name: "Follow me" }));
    expect(drawnMap("live-map-view").camera).toMatchObject({ center: front() });
    expect(screen.queryByRole("button", { name: "Follow me" })).toBeNull();
    // The map's own moves, following the run, never stop it following.
    await act(() => {
      drawnMap("live-map-view").props.onRegionWillChange?.({ nativeEvent: { userInteraction: false } });
    });
    expect(drawnMap("live-map-view").camera).toMatchObject({ center: front() });
  });

  it("after Finish, the Route box holds the run's map with a stone at each exact kilometre; tapped, it opens full size, and the cross closes it", async () => {
    const s = runServer();
    await openRunning(s);
    await startRunning();
    await runThenFinish(801);
    expect(await screen.findByTestId("summary-map")).toBeTruthy();
    const box = drawnMap("summary-map-view");
    const sums = finishedSums();
    const marks = unitMarks(sums.track, sums.trackStarts, "metric");
    expect(marks).toHaveLength(2);
    // Each stone at its mark, numbered by the phone itself: the map's own words need letters from the
    // map's company, which a phone with no signal has not got.
    expect(box.markers).toEqual(marks.map(([lat, lng]) => [lng, lat]));
    const stones = within(screen.getByTestId("summary-map")).getAllByTestId("map-stone");
    expect(stones.map((stone, i) => within(stone).getByText(String(i + 1)))).toHaveLength(2);
    expect(Object.keys(box.layers).filter((id) => id.startsWith("stone"))).toEqual([]);
    // Still in the summary, so the page scrolls; it fits the whole run. The map takes no tap of its
    // own: on Kd's phone its tap took the Finish press under it and opened the full size at once.
    expect(box.props).toMatchObject({ dragPan: false, touchZoom: false });
    expect(box.props.onPress).toBeUndefined();
    expect(Array.isArray(box.camera?.["bounds"])).toBe(true);
    expect(screen.getByText(OPENFREEMAP.credit)).toBeTruthy();

    await fireEvent.press(screen.getByRole("button", { name: "Open the map full size" }));
    const full = drawnMap("full-map-view");
    expect(full.props).toMatchObject({ dragPan: true, touchZoom: true, touchRotate: false });
    expect(full.markers).toEqual(box.markers);
    await fireEvent.press(screen.getByRole("button", { name: "Close the map" }));
    await waitFor(() => {
      expect(maplibre.maps.filter((m) => m.props.testID === "full-map-view" && !m.gone)).toHaveLength(0);
    });
    expect(screen.getByRole("button", { name: "Save run" })).toBeTruthy();
  });

  const CANT_LOAD = "The map can't load right now.";

  it("when the map's streets fail to load, with our server up, the Route box says so and the trail is still drawn", async () => {
    const s = runServer();
    await openRunning(s);
    await startRunning();
    await runThenFinish(61);
    expect(await screen.findByTestId("summary-map")).toBeTruthy();
    expect(screen.queryByText(CANT_LOAD)).toBeNull();
    await act(() => {
      drawnMap("summary-map-view").props.onDidFailLoadingMap?.();
    });
    expect(screen.getByText(CANT_LOAD)).toBeTruthy();
    expect(JSON.stringify(drawnMap("summary-map-view").sources["run-trail"])).toContain("LineString");
    // Drawn after all (the signal came back): the line goes.
    await act(() => {
      drawnMap("summary-map-view").props.onDidFinishLoadingMap?.();
    });
    expect(screen.queryByText(CANT_LOAD)).toBeNull();
  });

  it("when the map draws with our server out of reach, nothing says it can't", async () => {
    const s = runServer();
    await openRunning(s);
    await startRunning();
    s.state.online = false;
    await runThenFinish(61);
    expect(await screen.findByTestId("summary-map")).toBeTruthy();
    await act(() => {
      drawnMap("summary-map-view").props.onDidFinishLoadingMap?.();
    });
    expect(screen.queryByText(CANT_LOAD)).toBeNull();
    expect(screen.queryByText(/online/)).toBeNull();
  });

  it("a map that drew says nothing more when our server's answer, the same map, comes after it", async () => {
    const timeouts = jest.spyOn(global, "setTimeout");
    const s = runServer();
    let answer: () => void = () => undefined;
    s.state.mapHeld = new Promise<void>((resolve) => {
      answer = resolve;
    });
    await openRunning(s);
    await startRunning();
    await runThenFinish(61);
    expect(await screen.findByTestId("summary-map")).toBeTruthy();
    await act(() => {
      drawnMap("summary-map-view").props.onDidFinishLoadingMap?.();
    });
    const before = timeouts.mock.calls.length;
    await act(async () => {
      answer();
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    });
    // The person then says how it felt: the summary draws again, the map is the same.
    await fireEvent.press(screen.getByRole("button", { name: "5 of 10" }));
    // Every wait begun since the map drew, run out: none may say the map can't load.
    const waits = timeouts.mock.calls.slice(before).filter((call) => call[1] === MAP_WAIT_MS).map((call) => call[0]);
    await act(() => {
      for (const wait of waits) wait();
    });
    expect(screen.queryByText(CANT_LOAD)).toBeNull();
    timeouts.mockRestore();
  });

  it("when the map says nothing for MAP_WAIT_MS (its squares can't be fetched), the Route box says it can't load", async () => {
    const timeouts = jest.spyOn(global, "setTimeout");
    const s = runServer();
    await openRunning(s);
    await startRunning();
    await runThenFinish(61);
    expect(await screen.findByTestId("summary-map")).toBeTruthy();
    expect(screen.queryByText(CANT_LOAD)).toBeNull();
    const waits = timeouts.mock.calls.filter((call) => call[1] === MAP_WAIT_MS).map((call) => call[0]);
    expect(waits.length).toBeGreaterThan(0);
    await act(() => {
      for (const wait of waits) wait();
    });
    expect(screen.getByText(CANT_LOAD)).toBeTruthy();
    timeouts.mockRestore();
  });

  it("the server switched to our own copy: every map reads it, and the phone keeps it for when it is offline", async () => {
    const s = runServer(RAVI, OWN_COPY);
    await openRunning(s);
    await startRunning();
    await feed(0, 61, 3);
    await waitFor(() => {
      expect(drawnMap("live-map-view").props.mapStyle.sources).toEqual({ basemap: { type: "vector", url: OWN_COPY.tiles } });
    });
    expect(screen.getByText(OWN_COPY.credit)).toBeTruthy();
    expect(JSON.parse((await phoneRunFiles.read("run-map.json")) ?? "{}")).toEqual(OWN_COPY);
  });

  it.each<[string, string, MapSource]>([
    ["the map the phone kept is the one drawn", JSON.stringify(OWN_COPY), OWN_COPY],
    ["a kept map with an address that is not a map's leaves OpenFreeMap's", JSON.stringify({ ...OWN_COPY, tiles: "javascript:alert(1)" }), OPENFREEMAP],
    ["a kept file that does not read leaves OpenFreeMap's", "{not a map", OPENFREEMAP],
  ])("our server out of reach: %s", async (_case, keptFile, drawn) => {
    await phoneRunFiles.write("run-map.json", keptFile);
    const s = runServer();
    s.state.online = false;
    await openRunning(s);
    await startRunning();
    await feed(0, 31, 3);
    await waitFor(() => {
      expect(drawnMap("live-map-view").props.mapStyle.sources).toEqual({ basemap: { type: "vector", url: drawn.tiles } });
    });
    expect(screen.getByText(drawn.credit)).toBeTruthy();
    expect(s.requests.some((r) => r.path === "/v1/geo/map")).toBe(true);
  });

  it("Map colours on the Running page: Dark keeps the map dark whatever the hour, and stays chosen", async () => {
    const s = runServer();
    await openRunning(s);
    expect(screen.getByText("Automatic: light by day, dark at night")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Change map colours" }));
    const sheet = await screen.findByTestId("sheet");
    expect(within(sheet).getByText("Map colours")).toBeTruthy();
    await fireEvent.press(within(sheet).getByRole("button", { name: "Dark" }));
    expect(await screen.findByText("Dark")).toBeTruthy();
    expect(JSON.parse((await phoneRunFiles.read("run-settings.json")) ?? "{}")).toMatchObject({ mapColours: "dark" });
    await startRunning();
    await feed(0, 31, 3);
    await waitFor(() => {
      expect(drawnMap("live-map-view").props.mapStyle.name).toBe("run-map-openmaptiles-dark");
    });
  });
});

/** The room a page keeps at its foot: the last paddingBottom in its style. */
function footRoom(style: unknown): number {
  let room = 0;
  const parts: unknown[] = Array.isArray(style) ? style : [style];
  for (const part of parts) {
    if (typeof part === "object" && part !== null && "paddingBottom" in part && typeof part.paddingBottom === "number") room = part.paddingBottom;
  }
  return room;
}

describe("from Kd's click-through of 37b-i", () => {
  it("a run put away shows its bar on every tab, with its state, and the bar opens it again", async () => {
    const s = runServer();
    await openRunning(s);
    await startRunning();
    await feed(0, 61, 3);
    await fireEvent.press(screen.getByRole("button", { name: "Back to the app" }));
    const bar = await screen.findByRole("button", { name: "Open run" });
    expect(within(bar).getByText("Run in progress")).toBeTruthy();
    // Another tab: the bar is still there.
    await fireEvent.press(screen.getByRole("tab", { name: "Food" }));
    expect(screen.getByRole("button", { name: "Open run" })).toBeTruthy();
    // Every page keeps room for the bar at its foot, so the last of it can be seen and pressed.
    const foot = () => screen.getAllByTestId("page-boxes", { includeHiddenElements: true }).map((page) => footRoom(page.props["style"]));
    expect(foot().length).toBeGreaterThan(1);
    expect(foot().every((room) => room >= 24 + RUN_BAR_ROOM)).toBe(true);
    await fireEvent.press(screen.getByRole("button", { name: "Open run" }));
    expect(await screen.findByTestId("live-map")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open run" })).toBeNull();
    // The bar gone, the pages keep only their own room.
    expect(foot()).toContain(24);
    // Paused and put away: the bar says so.
    await fireEvent.press(screen.getByRole("button", { name: "Pause" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Back to the app" }));
    expect(within(await screen.findByRole("button", { name: "Open run" })).getByText("Run paused")).toBeTruthy();
  });

  it("a finished run put away (the phone's back) says it is not saved yet, and opens to save", async () => {
    const s = runServer();
    await openRunning(s);
    await startRunning();
    await feed(0, 31, 3);
    await fireEvent.press(screen.getByRole("button", { name: "Pause" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Finish" }));
    expect(await screen.findByRole("button", { name: "Save run" })).toBeTruthy();
    // The phone's own back, as Android hands it to the run's screen.
    const runScreen = screen.container.queryAll((node) => node.props["visible"] === true && typeof node.props["onRequestClose"] === "function").at(-1);
    if (runScreen === undefined) throw new Error("no run screen");
    await fireEvent(runScreen, "requestClose");
    const bar = await screen.findByRole("button", { name: "Open run" });
    expect(within(bar).getByText("Run finished")).toBeTruthy();
    expect(within(bar).getByText("Not saved yet · Open to save")).toBeTruthy();
    await fireEvent.press(bar);
    expect(await screen.findByRole("button", { name: "Save run" })).toBeTruthy();
  });

  it("the map's credit folds into (i) at the first touch of the map, and (i) shows it again", async () => {
    const s = runServer();
    await openRunning(s);
    await startRunning();
    await feed(0, 31, 3);
    expect(await screen.findByText(OPENFREEMAP.credit)).toBeTruthy();
    await waitFor(() => {
      expect(drawnMap("live-map-view")).toBeTruthy();
    });
    await act(() => {
      drawnMap("live-map-view").props.onRegionWillChange?.({ nativeEvent: { userInteraction: true } });
    });
    expect(screen.queryByText(OPENFREEMAP.credit)).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Map credits" }));
    expect(screen.getByText(OPENFREEMAP.credit)).toBeTruthy();
    // Pressed, the credit opens OpenStreetMap's copyright page, as its guidelines ask.
    const opened = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
    await fireEvent.press(screen.getByRole("link", { name: OPENFREEMAP.credit }));
    expect(opened).toHaveBeenCalledWith(MAP_CREDIT_PAGE);
    opened.mockRestore();
  });
});

describe("Elevation gain on the summary (37b-ii)", () => {
  /** Two minutes north, then Pause and Finish: the run's summary. */
  async function toSummary(s: ReturnType<typeof runServer>, user = RAVI) {
    await openRunning(s, user);
    await startRunning();
    await feed(0, 121, 3);
    await fireEvent.press(await screen.findByRole("button", { name: "Pause" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Finish" }));
    expect(await screen.findByText("Elevation gain")).toBeTruthy();
  }

  it("the worst thing on the phone: the summary asks with exactly the points Save sends, and nothing else of the run", async () => {
    const s = runServer();
    await toSummary(s);
    expect(await screen.findByText("28 m")).toBeTruthy();
    expect(s.climbAsks).toHaveLength(1);
    const asked = s.climbAsks[0];
    // No name, no note, no effort, no id: the points, the pauses and how long, as Save will send them.
    expect(Object.keys(asked ?? {}).sort()).toEqual(["elapsedMs", "pauses", "points"]);
    await fireEvent.press(screen.getByRole("button", { name: "Save run" }));
    await waitFor(() => {
      expect(s.posts).toHaveLength(1);
    });
    const sent = saveRunRequestSchema.parse(s.posts[0]?.body);
    expect(asked).toEqual({ elapsedMs: sent.elapsedMs, points: sent.points, pauses: sent.pauses });
  });

  it("in feet for a person who runs in miles", async () => {
    const s = runServer({ ...RAVI, units: "imperial" });
    s.state.climb = { state: "done", m: 28 };
    await toSummary(s, { ...RAVI, units: "imperial" });
    // 28 m is 91.86 ft.
    expect(await screen.findByText("92 ft")).toBeTruthy();
  });

  it("with a small (i) beside the number, as the map's, that opens every line the maps' licences ask for", async () => {
    const s = runServer();
    await toSummary(s);
    expect(await screen.findByText("28 m")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Elevation data" }));
    expect(await screen.findByText("Elevation data")).toBeTruthy();
    for (const line of HEIGHT_MAP_CREDITS) expect(screen.getByText(line)).toBeTruthy();
  });

  it.each([
    ["no heights here", { state: "none" } as const],
    ["a piece of the map still coming", { state: "waiting" } as const],
  ])("%s: \"--\", and no credit for a number not shown", async (_why, climb) => {
    const s = runServer();
    s.state.climb = climb;
    await toSummary(s);
    await waitFor(() => {
      expect(s.climbAsks).toHaveLength(1);
    });
    expect(screen.getByText("--")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Elevation data" })).toBeNull();
  });

  it("with no signal at Finish: \"--\", and the run is saved all the same when the signal is back", async () => {
    const s = runServer();
    s.state.online = false;
    await toSummary(s);
    expect(await screen.findByText("--")).toBeTruthy();
    const name = runName(new Date(runNow()?.startedAt ?? 0));
    await fireEvent.press(screen.getByRole("button", { name: "Save run" }));
    expect(await screen.findByText(`${name} is saved on this phone. It will be sent when you're online.`)).toBeTruthy();
    s.state.online = true;
    await act(async () => {
      comeBack();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(s.saved).toHaveLength(1);
    });
  });
});
