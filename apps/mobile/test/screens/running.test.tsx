import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { AppState, Linking } from "react-native";
import type { StyleSpecification } from "@maplibre/maplibre-react-native";
import { GPS_WORST_ACCURACY_M, HEIGHT_MAP_CREDITS, OPENFREEMAP, RUN_MAX_POINTS, geodesicMetres, runSums, saveRunRequestSchema, type MapSource, type RunClimb, type RunPoint, type RunRecords, type SaveRunRequest } from "@app/shared";
import { App } from "../../src/App";
import { resetMapSource } from "../../src/screens/running/mapSource";
import { RUN_BAR_ROOM } from "../../src/screens/running/RunLayer";
import { MAP_CREDIT_PAGE, MAP_WAIT_MS } from "../../src/screens/running/RunMap";
import { unitMarks } from "../../src/screens/running/routeShape";
import { fanPath } from "../../src/screens/running/runMapShapes";
import { chooseAutoPause, finishRun, keepRunUnits, loadRun, pauseRun, phoneRunFiles, resetRecorder, runNow, startRun, takeLocations } from "../../src/screens/running/recorder";
import * as runLiveModule from "../../src/screens/running/runLive";
import { saveRequestOf, sentOf, sumsAt } from "../../src/screens/running/runLive";
import { endRunAtLeaving } from "../../src/screens/running/runLeaving";
import { spokenTime } from "../../src/screens/running/runVoice";
import { readRunFile } from "../../src/screens/running/runQueue";
import { clock, distance, runName } from "../../src/screens/running/runWords";
import type { Ask, AskInit } from "../../src/session/calls";
import { SIGNED_IN_ELSEWHERE } from "@app/shared";
import { RAVI, fakeServer, kept, memoryStore, profile, refusal, tokens, type Reply } from "../kit";
import { realRuns, type RealPoint } from "../realRuns";

// Record a run (ROADMAP Stage 5 37a), through the whole app. The worst thing on the phone's side:
// somebody's run, which starts at their front door, shown to another person on the same phone, or a
// run lost or saved twice. Then the run itself, Start to Save, with no signal at Save, Discard, a
// location the person has not allowed, and Auto-pause.

const extra = { copyName: "Feature 2", apiUrl: "http://localhost:3000" };
const PATH = "/v1/geo/runs";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// The phone's location, as the setup's stand-in holds it.
const location = jest.requireMock<{ state: { services: boolean; granted: boolean; canAskAgain: boolean; accuracy: string; asked: number; started: { task: string; options: { foregroundService?: { notificationTitle: string } } }[]; running: boolean; acceptsTurnOn: boolean; refusesStart: boolean; lastKnown: { coords: { latitude: number; longitude: number } } | null; lastKnownAsked: unknown[] } }>("expo-location").state;

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
/** What Android hands over while its location stops, set by a test (test/screens/setup.js). */
const stopping = jest.requireMock<{ state: { whileStopping: (() => Promise<void>) | null } }>("expo-location").state;
/** The map on screen with this test id, the newest drawn. */
/** How long the route line drawn on a map is, in metres, over all its pieces. */
function trailMetres(map: DrawnMap): number {
  const trail = map.sources["run-trail"];
  const features: unknown = typeof trail === "object" && trail !== null ? Reflect.get(trail, "features") : null;
  if (!Array.isArray(features)) return Infinity;
  let total = 0;
  for (const feature of features) {
    const geometry: unknown = typeof feature === "object" && feature !== null ? Reflect.get(feature, "geometry") : null;
    const coordinates: unknown = typeof geometry === "object" && geometry !== null ? Reflect.get(geometry, "coordinates") : null;
    if (!Array.isArray(coordinates)) continue;
    for (let i = 1; i < coordinates.length; i++) {
      const a: unknown = coordinates[i - 1];
      const b: unknown = coordinates[i];
      if (Array.isArray(a) && Array.isArray(b)) total += geodesicMetres(Number(a[1]), Number(a[0]), Number(b[1]), Number(b[0]));
    }
  }
  return total;
}
const drawnMap = (testID: string): DrawnMap => {
  const map = maplibre.maps.filter((m) => !m.gone && m.props.testID === testID).at(-1);
  if (map === undefined) throw new Error(`no ${testID} on screen`);
  return map;
};

let handlers: ((state: "active" | "background") => void)[] = [];
const comeBack = () => {
  for (const handler of handlers) handler("active");
};

beforeEach(async () => {
  handlers = [];
  jest.spyOn(AppState, "addEventListener").mockImplementation((_type, handler) => {
    handlers.push(handler);
    return { remove: () => undefined };
  });
  Object.assign(location, { services: true, granted: true, canAskAgain: true, accuracy: "fine", asked: 0, started: [], running: false, acceptsTurnOn: true, refusesStart: false, lastKnown: null, lastKnownAsked: [] });
  stopping.whileStopping = null;
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
  // `postHeld`: a save's answer waits for it; `postDown`: the server answers every save with a fault of its own.
  const state: { online: boolean; mapHeld: Promise<void> | null; postHeld: Promise<void> | null; postDown: boolean; climb: RunClimb; records: RunRecords | null } = {
    online: true,
    mapHeld: null,
    postHeld: null,
    postDown: false,
    climb: { state: "done", m: 28, hills: [] },
    records: null,
  };
  const climbAsks: unknown[] = [];
  const server = fakeServer({
    // The run's elevation gain, as the server's height map works it out (37b-ii).
    "/v1/geo/runs/climb": (body) => {
      climbAsks.push(body);
      return { status: 200, body: { climb: state.climb } };
    },
    "/v1/auth/refresh": () => ({ status: 200, body: { tokens: tokens(2) } }),
    "/v1/geo/map": () => ({ status: 200, body: { map } }),
    // The person's records (37c-ii); none read (no signal) until a test gives some.
    "/v1/geo/runs/records": () => (state.records === null ? { status: 503, body: { error: "unavailable" } } : { status: 200, body: state.records }),
    "/v1/users/me": () => ({ status: 200, body: profile(true, user) }),
    [PATH]: (body): Reply => {
      if (body === undefined) {
        const items = saved.map((r) => ({
          id: r.runId, startedAt: r.startedAt, durationS: 600, distanceM: 1800, routeName: null, kcalPoint: 120, source: "mobile",
          name: r.name, day: r.startedAt.slice(0, 10), elapsedS: 600, climbM: null, shape: null,
        }));
        return { status: 200, body: { items: items.slice(-1), nextCursor: null, months: [], total: { runs: items.length, distanceM: 1800 * items.length } } };
      }
      const run = saveRunRequestSchema.parse(body);
      if (!saved.some((r) => r.runId === run.runId)) saved.push(run);
      const sums = runSums(run.points, run.pauses, run.elapsedMs, 60, run.still);
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
      if (state.postHeld !== null) await state.postHeld;
      if (state.postDown) return { ok: false, status: 503, json: () => Promise.resolve({ error: "unavailable", message: "Try again later." }) };
    }
    return server.ask(url, init);
  };
  // Each person's file of waiting runs, as the phone keeps one for each (37o, round one H3).
  const files = new Map<string, string>();
  // `held`: a write of the file waits for it (a test's).
  const writes: { held: Promise<void> | null } = { held: null };
  const runStore = (who: string) => ({
    read: () => Promise.resolve(files.get(who) ?? null),
    write: async (t: string) => {
      if (writes.held !== null) await writes.held;
      files.set(who, t);
    },
  });
  // What the phone's file of waiting runs holds before the app opens.
  const setFile = (text: string) => {
    files.set(user.id, text);
  };
  return { ask, saved, posts, state, runStore, writes, requests, climbAsks, file: (who: string = user.id) => files.get(who) ?? null, setFile };
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

describe("the worst thing (37o): a run left recording somebody's location after they sign out, or lost (the hunt's A7)", () => {
  /** The fifth tab's Settings, then Sign out and the box's own Sign out, reading the box's line first. */
  async function signOutFromSettings(): Promise<string | null> {
    const tab = (await screen.findAllByRole("tab"))[4];
    if (tab === undefined) throw new Error("no fifth tab");
    await fireEvent.press(tab);
    await fireEvent.press(await screen.findByLabelText("Settings"));
    await fireEvent.press(await screen.findByRole("button", { name: "Sign out" }));
    const line: unknown = screen.queryByText(/^Your run will be/)?.props["children"] ?? null;
    const inTheBox = screen.getAllByRole("button", { name: "Sign out" })[1];
    if (inTheBox === undefined) throw new Error("the box's Sign out was expected");
    await fireEvent.press(inTheBox);
    expect(await screen.findByLabelText("Email")).toBeTruthy();
    return typeof line === "string" ? line : null;
  }

  it("Sign out mid-run: the box says the run is finished and saved first; the location and the voice stop; the run waits in the person's saved runs, whole, and is sent when they sign in again", async () => {
    const s = runServer();
    s.state.online = false;
    await openRunning(s);
    await startRunning();
    const points = await feed(0, 61, 3);
    const run = runNow();
    if (run === null) throw new Error("no run going");
    await fireEvent.press(screen.getByRole("button", { name: "Back to the app" }));
    expect(await signOutFromSettings()).toBe("Your run will be finished and saved first.");
    expect(location.running).toBe(false);
    expect(runNow()).toBeNull();
    expect(await phoneRunFiles.read("run-now.json")).toBeNull();
    // Points Android hands over after the sign-out are nobody's run.
    await act(() => takeLocations({ locations: [{ timestamp: run.startedAt + 70_000, coords: { latitude: 26.2, longitude: 91.8, accuracy: 5, speed: 3 } }] }));
    expect(runNow()).toBeNull();
    const waiting = readRunFile(s.file() ?? "").waiting;
    expect(waiting).toHaveLength(1);
    expect(waiting[0]).toMatchObject({ runId: run.runId, name: runName(new Date(run.startedAt)), effort: null, note: null });
    expect(waiting[0]?.points).toHaveLength(points.length);
    expect(s.posts).toHaveLength(0);
  });

  it("a finished run not saved yet is saved at Sign out, and the box says so", async () => {
    const s = runServer();
    s.state.online = false;
    await openRunning(s);
    await startRunning();
    await feed(0, 31, 3);
    await fireEvent.press(screen.getByRole("button", { name: "Pause" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Finish" }));
    const run = runNow();
    if (run === null) throw new Error("no run");
    expect(await screen.findByRole("button", { name: "Save run" })).toBeTruthy();
    // The phone's own back, as Android hands it to the run's screen.
    const runScreen = screen.container.queryAll((node) => node.props["visible"] === true && typeof node.props["onRequestClose"] === "function").at(-1);
    if (runScreen === undefined) throw new Error("no run screen");
    await fireEvent(runScreen, "requestClose");
    expect(await signOutFromSettings()).toBe("Your run will be saved first.");
    expect(runNow()).toBeNull();
    expect(readRunFile(s.file() ?? "").waiting.map((r) => r.runId)).toEqual([run.runId]);
  });

  it("an account deleted mid-run: the run is thrown away, the location stops, nothing is put in its saved runs; another person's run is left alone", async () => {
    const s = runServer();
    await openRunning(s);
    await startRunning();
    await feed(0, 31, 3);
    const added: unknown[] = [];
    const add = (r: SaveRunRequest) => {
      added.push(r);
      return Promise.resolve(true);
    };
    await act(() => endRunAtLeaving("5f0c8a52-6f0e-4d59-9a3c-1f2e3d4c5b6b", "out", add));
    expect(runNow()?.phase).toBe("running");
    await act(() => endRunAtLeaving(RAVI.id, "deleted", add));
    expect(runNow()).toBeNull();
    expect(location.running).toBe(false);
    expect(await phoneRunFiles.read("run-now.json")).toBeNull();
    expect(added).toEqual([]);
  });

  it("the box's Sign out is taken once: it turns busy at the press while the run is finished and saved (round one, L3)", async () => {
    const s = runServer();
    s.state.online = false;
    await openRunning(s);
    await startRunning();
    await feed(0, 31, 3);
    await fireEvent.press(screen.getByRole("button", { name: "Back to the app" }));
    const tab = (await screen.findAllByRole("tab"))[4];
    if (tab === undefined) throw new Error("no fifth tab");
    await fireEvent.press(tab);
    await fireEvent.press(await screen.findByLabelText("Settings"));
    await fireEvent.press(await screen.findByRole("button", { name: "Sign out" }));
    const inTheBox = screen.getAllByRole("button", { name: "Sign out" })[1];
    if (inTheBox === undefined) throw new Error("the box's Sign out was expected");
    let release: () => void = () => undefined;
    s.writes.held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await fireEvent.press(inTheBox);
    expect(screen.getAllByRole("button", { name: "Sign out" })[1]?.props["accessibilityState"]).toMatchObject({ busy: true });
    s.writes.held = null;
    release();
    expect(await screen.findByLabelText("Email")).toBeTruthy();
    expect(readRunFile(s.file() ?? "").waiting).toHaveLength(1);
  });

  it("with no run on the phone, the box has no line about one", async () => {
    const s = runServer();
    await openRunning(s);
    expect(await signOutFromSettings()).toBeNull();
  });

  const OTHER = "5f0c8a52-6f0e-4d59-9a3c-1f2e3d4c5b6b";
  const OTHER_RUN = "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
  /** Another person's run left on this phone, going or finished and not saved. */
  async function othersRun(phase: "running" | "finished") {
    await phoneRunFiles.write("run-now.json", JSON.stringify({ runId: OTHER_RUN, userId: OTHER, startedAt: Date.now() - 600_000, phase, pausedByPerson: false, autoPause: true, pauses: [], finishedMs: phase === "finished" ? 1000 : null, files: 1 }));
    await phoneRunFiles.write("run-now-0.json", JSON.stringify([[0, 26.2, 91.8, 5], [1000, 26.2001, 91.8, 5]]));
  }

  it.each<["running" | "finished"]>([["running"], ["finished"]])("another person's run (%s) found when this one signs in stops, goes to that person's own saved runs whole, is never shown, and this person's Start writes over nothing (round one, H3)", async (phase) => {
    await othersRun(phase);
    location.running = phase === "running";
    const s = runServer();
    await openRunning(s);
    await waitFor(() => {
      expect(readRunFile(s.file(OTHER) ?? "").waiting.map((r) => r.runId)).toEqual([OTHER_RUN]);
    });
    expect(location.running).toBe(false);
    expect(runNow()).toBeNull();
    expect(readRunFile(s.file() ?? "").waiting).toEqual([]);
    expect(screen.queryByRole("button", { name: "Open run" })).toBeNull();
    await startRunning();
    expect(runNow()?.userId).toBe(RAVI.id);
    expect(readRunFile(s.file(OTHER) ?? "").waiting.map((r) => r.points.length)).toEqual([2]);
  });

  it("signed out by the server as the app opens, before any screen of the tabs (round one, H3): the run stops and waits in its person's saved runs", async () => {
    await phoneRunFiles.write("run-now.json", JSON.stringify({ runId: OTHER_RUN, userId: RAVI.id, startedAt: Date.now() - 600_000, phase: "running", pausedByPerson: false, autoPause: true, pauses: [], finishedMs: null, files: 1 }));
    await phoneRunFiles.write("run-now-0.json", JSON.stringify([[0, 26.2, 91.8, 5], [1000, 26.2001, 91.8, 5]]));
    location.running = true;
    const s = runServer();
    const refreshed = fakeServer({ "/v1/auth/refresh": () => refusal(401, SIGNED_IN_ELSEWHERE.error, SIGNED_IN_ELSEWHERE.message) });
    const ask: Ask = (url, init) => (new URL(url).pathname === "/v1/auth/refresh" ? refreshed.ask(url, init) : s.ask(url, init));
    await render(<App extra={extra} store={memoryStore(kept(1, RAVI))} ask={ask} runStore={s.runStore} />);
    expect(await screen.findByLabelText("Email")).toBeTruthy();
    await waitFor(() => {
      expect(readRunFile(s.file() ?? "").waiting.map((r) => r.runId)).toEqual([OTHER_RUN]);
    });
    expect(location.running).toBe(false);
    expect(runNow()).toBeNull();
  });
});

describe("a phone whose clock is wrong (37o, the hunt's A6): the run is recorded from Go all the same", () => {
  const T0 = 1_790_000_000_000;
  /** One delivery a second, as Android hands them over: the point's GPS time `gpsAheadMs` from the phone's, and
   *  handed over 200 ms after it was taken. */
  async function deliver(fromS: number, seconds: number, gpsAheadMs: number) {
    for (let i = fromS; i < fromS + seconds; i++) {
      const phoneAt = T0 + i * 1000;
      await takeLocations({ locations: [{ timestamp: phoneAt + gpsAheadMs, coords: { latitude: 26.1445 + (i * 3) / 111_132, longitude: 91.7362, accuracy: 5, speed: 3 } }] }, phoneAt + 200);
    }
  }
  const run = () => {
    const now = runNow();
    if (now === null) throw new Error("no run going");
    return now;
  };

  it.each<[string, number]>([
    ["the phone's clock 5 minutes fast", -300_000],
    ["the phone's clock 5 minutes slow", 300_000],
    ["the phone's clock 2 hours fast", -7_200_000],
  ])("%s: points from the first seconds, in order, on the run's own clock, and Save sends the GPS's start", async (_name, gpsAheadMs) => {
    await startRun(RAVI.id, "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed", false, T0);
    await deliver(0, 120, gpsAheadMs);
    const points = run().points;
    expect(points.length).toBeGreaterThanOrEqual(119);
    // Within the 200 ms a point takes to be handed over.
    expect(points[0]?.[0]).toBeLessThanOrEqual(1_200);
    expect(points.at(-1)?.[0]).toBeLessThanOrEqual(119_200);
    expect(points.every((p, i) => i === 0 || p[0] > (points[i - 1]?.[0] ?? Infinity))).toBe(true);
    expect(run().clockGapMs).toBeCloseTo(gpsAheadMs, -3);
    expect(sumsAt(run(), 120_000, 60).distanceM).toBeGreaterThan(300);
    const done = await finishRun(T0 + 120_000);
    if (done === null) throw new Error("no run");
    const sent = saveRequestOf(done, sentOf(done), "Morning Run", null, null);
    expect(Math.abs(Date.parse(sent.startedAt) - (T0 + gpsAheadMs))).toBeLessThan(1_000);
    expect(saveRunRequestSchema.safeParse(sent).success).toBe(true);
  });

  it("a right clock, with an old point Android kept from before Go handed over first: no gap, and the old point is not the run's", async () => {
    await startRun(RAVI.id, "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed", false, T0);
    await takeLocations({ locations: [{ timestamp: T0 - 240_000, coords: { latitude: 26.3, longitude: 91.9, accuracy: 5, speed: 0 } }] }, T0 + 300);
    await deliver(1, 60, 0);
    expect(run().clockGapMs).toBe(0);
    expect(run().points[0]).toEqual([1_000, 26.1445 + 3 / 111_132, 91.7362, 5]);
    expect(run().points).toHaveLength(60);
  });

  it("a right clock: no point is moved, from the first", async () => {
    await startRun(RAVI.id, "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed", false, T0);
    await deliver(0, 30, 900);
    expect(run().clockGapMs).toBe(0);
    expect(run().points.map((p) => p[0])).toEqual(Array.from({ length: 30 }, (_, i) => i * 1000 + 900));
  });

  it.each<[string, number]>([
    ["the gap decided before the app was closed", 20],
    // Round one, H1: Android restarting the app during Finding GPS, before the gap was known.
    ["the app closed before the gap was known", 0],
  ])("%s: opened again, the points still land from Go", async (_name, before) => {
    await startRun(RAVI.id, "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed", false, T0);
    await deliver(0, before, -300_000);
    // The app closed and opened again: the recorder starts from its files.
    resetRecorder();
    await loadRun();
    await deliver(before, 60, -300_000);
    const points = run().points;
    // A restart may lose the seconds since the last write (every 10 s), never the run.
    expect(points.length).toBeGreaterThanOrEqual(before + 48);
    expect(points[0]?.[0]).toBeLessThanOrEqual(1_200);
    expect(run().clockGapMs).toBeCloseTo(-300_000, -3);
  });
});

describe("the live numbers on a long run (37o, the hunt's A11; round one's untested two)", () => {
  const wait = (ms: number) => act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  it("paused, with nothing new come, the numbers are not worked out again", async () => {
    const counts = jest.spyOn(runLiveModule, "sumsInSlices");
    const s = runServer();
    await openRunning(s);
    await startRunning();
    await feed(0, 31, 3);
    await fireEvent.press(screen.getByRole("button", { name: "Pause" }));
    expect(await screen.findByText("Paused")).toBeTruthy();
    await wait(3_500);
    const settled = counts.mock.calls.length;
    await wait(5_000);
    expect(counts.mock.calls.length).toBe(settled);
    counts.mockRestore();
  }, 20_000);

  it("one count at a time: a slow one is never joined by another", async () => {
    let going = 0;
    let most = 0;
    const counts = jest.spyOn(runLiveModule, "sumsInSlices").mockImplementation((run, at, kg, done) => {
      going += 1;
      most = Math.max(most, going);
      const timer = setTimeout(() => {
        going -= 1;
        done(runLiveModule.sumsAt(run, at, kg));
      }, 4_500);
      return () => {
        clearTimeout(timer);
        going -= 1;
      };
    });
    const s = runServer();
    await openRunning(s);
    await startRunning();
    for (let k = 0; k < 4; k++) {
      await feed(k * 3, 3, 3);
      await wait(2_000);
    }
    expect(counts.mock.calls.length).toBeGreaterThan(0);
    expect(most).toBe(1);
    counts.mockRestore();
  }, 20_000);
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

  it("on a slow signal, Save says at once the run is on the phone, then that it is saved when the server has it (37m; the hunt's B8)", async () => {
    const s = runServer();
    await openRunning(s);
    await startRunning();
    await feed(0, 61, 3);
    await fireEvent.press(await screen.findByRole("button", { name: "Pause" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Finish" }));
    const name = runName(new Date(runNow()?.startedAt ?? 0));
    const answer: { give: () => void } = { give: () => undefined };
    s.state.postHeld = new Promise<void>((resolve) => {
      answer.give = resolve;
    });
    await fireEvent.press(await screen.findByRole("button", { name: "Save run" }));
    // The server has not answered: the page says where the run is now, not nothing.
    expect(await screen.findByText(`${name} is saved on this phone. It will be sent when you're online.`)).toBeTruthy();
    expect(s.saved).toHaveLength(0);
    await act(async () => {
      answer.give();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(await screen.findByText(`${name} is saved.`)).toBeTruthy();
    expect(screen.queryByText(/is saved on this phone/)).toBeNull();
  });

  it("a run the server keeps failing says so under Your runs, as not sent yet (37m; the hunt's B1)", async () => {
    const s = runServer();
    await openRunning(s);
    // A first run saved, so the Running page has its box of runs.
    await startRunning();
    await feed(0, 61, 3);
    await fireEvent.press(await screen.findByRole("button", { name: "Pause" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Finish" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Save run", }));
    await waitFor(() => {
      expect(s.saved).toHaveLength(1);
    });
    // The second, which the server fails.
    s.state.postDown = true;
    await startRunning();
    await feed(0, 61, 3);
    await fireEvent.press(await screen.findByRole("button", { name: "Pause" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Finish" }));
    const second = runName(new Date(runNow()?.startedAt ?? 0));
    await fireEvent.press(await screen.findByRole("button", { name: "Save run" }));
    // The Running page gives it the same words as Your runs, never "when you're online" (round one, L3).
    expect(await screen.findByText(`${second} is saved on this phone. Not sent yet. Trying again soon.`, {}, { timeout: 4000 })).toBeTruthy();
    await fireEvent.press(await screen.findByRole("button", { name: "See all your runs" }, { timeout: 4000 }));
    expect(await screen.findByText("Not sent yet. Trying again soon.", {}, { timeout: 4000 })).toBeTruthy();
    expect(s.saved).toHaveLength(1);
  });

  it("a run that couldn't be saved has Try again only when the server could take it; one the app cannot read has Remove (round one, L1)", async () => {
    const s = runServer();
    const whole: SaveRunRequest = { runId: "7a1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b", startedAt: "2026-11-20T06:00:00.000Z", elapsedMs: 60_000, name: "Canal loop", effort: null, note: null, points: [[0, 26.1, 91.7, 5], [1000, 26.10003, 91.7, 5]], pauses: [] };
    const unread = { runId: "8a1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b", name: "Hill run", points: "cut short" };
    s.setFile(JSON.stringify({ version: 1, waiting: [], refused: [
      { runId: whole.runId, name: whole.name, message: "This run couldn't be saved.", run: whole },
      { runId: unread.runId, name: unread.name, message: "This run couldn't be saved.", run: unread },
    ] }));
    await openRunning(s);
    expect(await screen.findByText("Canal loop: This run couldn't be saved.")).toBeTruthy();
    expect(screen.getByText("Hill run: This run couldn't be saved.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send Canal loop again" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Send Hill run again" })).toBeNull();
    expect(screen.getByRole("button", { name: "Remove Hill run" })).toBeTruthy();
  });

  it("after Finish, Save run and Discard run are always on screen, under the run's long page, never at its end (Kd, 2026-11-26)", async () => {
    const s = runServer();
    await openRunning(s);
    await startRunning();
    await feed(0, 61, 3);
    await fireEvent.press(await screen.findByRole("button", { name: "Pause" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Finish" }));
    const save = await screen.findByRole("button", { name: "Save run" });
    const discard = screen.getByRole("button", { name: "Discard run" });
    // Neither is inside the page that scrolls, as the run's name at its top is: no scrolling finds them.
    const scrolls = (from: unknown): boolean => {
      let at: unknown = from;
      while (typeof at === "object" && at !== null) {
        if ("type" in at && at.type === "RCTScrollView") return true;
        at = "parent" in at ? at.parent : null;
      }
      return false;
    };
    expect(scrolls(screen.getByRole("button", { name: /^Rename / }))).toBe(true);
    expect(scrolls(save)).toBe(false);
    expect(scrolls(discard)).toBe(false);
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

  it("Android refusing the run after 3, 2, 1 (the phone locked during the count): the page says so, keeps no run, and Start again starts one (running faults, A8)", async () => {
    location.refusesStart = true;
    const s = runServer();
    await openRunning(s);
    await fireEvent.press(screen.getByRole("button", { name: "Start run" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Start now" }));
    expect(await screen.findByText("Your run couldn't start. Try again.")).toBeTruthy();
    expect(runNow()).toBeNull();
    expect(location.running).toBe(false);
    await fireEvent.press(screen.getByRole("button", { name: "Start again" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Start now" }));
    await waitFor(() => {
      expect(runNow()?.phase).toBe("running");
    });
    expect(location.running).toBe(true);
    await fireEvent.press(screen.getByRole("button", { name: "Back to the app" }));
    expect(screen.queryByText("Your run couldn't start. Try again.")).toBeNull();
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
    // The clock stops at the point that decided it, 8 s on, never going back (37k); the seconds back to where the
    // person stopped, the last moving point at 59 s, are standing.
    expect(runNow()?.pauses).toEqual([[67_000, null]]);
    expect(runNow()?.datedBack).toEqual([[59_000, 67_000]]);
    await feed(80, 10, 3, stillAt - (80 * 3) / 111_132);
    await waitFor(() => {
      expect(runNow()?.phase).toBe("running");
    });
    expect(runNow()?.pauses).toEqual([[67_000, 80_000]]);
    expect(screen.queryByText("Auto-paused")).toBeNull();
    expect(clock(0)).toBe("0:00");
  });

  it("the worst thing: a walker who waits at a crossing and walks on slowly keeps every metre", async () => {
    const s = runServer();
    await openRunning(s);
    await startRunning();
    const fed = await feed(0, 120, 1);
    const run = runNow();
    if (run === null) throw new Error("no run");
    // Forty seconds at the crossing, the phone wandering a metre, then on at 0.6 m a second for two minutes.
    const stopLat = 26.1445 + 119 / 111_132;
    const waiting = Array.from({ length: 40 }, (_, i) => ({
      timestamp: run.startedAt + (120 + i) * 1000,
      coords: { latitude: stopLat + Math.sin(i * 0.9) / 111_132, longitude: 91.7362 + Math.cos(i * 1.3) / 99_950, accuracy: 5, speed: 0 },
    }));
    await act(() => takeLocations({ locations: waiting }));
    expect(await screen.findByText("Auto-paused")).toBeTruthy();
    fed.push(...waiting.map((l): RunPoint => [l.timestamp - run.startedAt, l.coords.latitude, l.coords.longitude, 5]));
    fed.push(...(await feed(160, 120, 0.6, stopLat - (160 * 0.6) / 111_132)));
    await waitFor(() => {
      expect(runNow()?.phase).toBe("running");
    });
    const now = runNow();
    if (now === null) throw new Error("no run");
    const end = 279_000;
    const kept = sumsAt(now, end, 0).distanceM;
    const walked = runSums(fed, [], end, 0).distanceM;
    expect(walked).toBeGreaterThan(185);
    // Auto-pause leaves out the wait, never the steps either side of it: the clock starts again from the last
    // point within 3 m of where the person stood, so at most those 3 m and the phone's metre of wander go.
    expect(kept).toBeGreaterThanOrEqual(walked - 4);
  });
});

describe("the worst thing on the screen: the run's clock shows a time that is not the run's (37h; testers: \"the timer gets stuck and keeps doing back and forth\")", () => {
  it("running, then standing with Auto-pause off: Time is the seconds since Go at every point and after the numbers are worked out again, on the run's screen and its bar; Pause holds it", async () => {
    await act(() => chooseAutoPause(false));
    const s = runServer();
    await openRunning(s);
    await startRunning();
    await feed(0, 60, 3);
    expect(screen.getByText("0:59")).toBeTruthy();
    expect(screen.getByText("5:34 /km")).toBeTruthy();
    const run = runNow();
    if (run === null) throw new Error("no run");
    const stillAt = 26.1445 + (59 * 3) / 111_132;
    for (let second = 60; second < 120; second++) {
      await act(() => takeLocations({ locations: [{ timestamp: run.startedAt + second * 1000, coords: { latitude: stillAt, longitude: 91.7362, accuracy: 5, speed: 0 } }] }));
      expect(screen.getByText(clock(second))).toBeTruthy();
    }
    // The numbers are worked out again at most every 2 s: the old clock took the standing off then.
    await act(() => new Promise((resolve) => setTimeout(resolve, 3500)));
    expect(screen.getByText("1:59")).toBeTruthy();
    expect(screen.queryByText("5:34 /km")).toBeNull();
    expect(screen.getByText("--:-- /km")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Back to the app" }));
    expect(await screen.findByText(/^1:59 · \d+\.\d\d km$/)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Open run" }));
    // Pause from the time shown, which the GPS's clock puts ahead of the phone's here: never back.
    await fireEvent.press(await screen.findByRole("button", { name: "Pause" }));
    await screen.findByRole("button", { name: "Resume" });
    expect(screen.getByText("1:59")).toBeTruthy();
    expect(screen.getByText("--:-- /km")).toBeTruthy();
    await act(() => new Promise((resolve) => setTimeout(resolve, 1500)));
    expect(screen.getByText("1:59")).toBeTruthy();
  });

  it("a refused start is said until the Running page is left, never after", async () => {
    location.refusesStart = true;
    const s = runServer();
    await openRunning(s);
    await fireEvent.press(screen.getByRole("button", { name: "Start run" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Start now" }));
    expect(await screen.findByText("Your run couldn't start. Try again.")).toBeTruthy();
    await fireEvent.press(screen.getByRole("tab", { name: "Dashboard" }));
    await fireEvent.press(await screen.findByRole("tab", { name: "Workout" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Running" }));
    expect(await screen.findByRole("button", { name: "Start run" })).toBeTruthy();
    expect(screen.queryByText("Your run couldn't start. Try again.")).toBeNull();
  });
});

describe("the summary's time not moving (Kd, 37h's walk, 2026-11-23)", () => {
  it("a minute standing with Auto-pause off and no pause pressed reads as Stopped, never as Paused", async () => {
    await act(() => chooseAutoPause(false));
    const s = runServer();
    await openRunning(s);
    await startRunning();
    await feed(0, 60, 3);
    const run = runNow();
    if (run === null) throw new Error("no run");
    const stillAt = 26.1445 + (59 * 3) / 111_132;
    await act(() =>
      takeLocations({ locations: Array.from({ length: 60 }, (_, i) => ({ timestamp: run.startedAt + (60 + i) * 1000, coords: { latitude: stillAt, longitude: 91.7362, accuracy: 5, speed: 0 } })) }),
    );
    expect(runNow()?.pauses).toEqual([]);
    await act(() => finishRun());
    expect(await screen.findByText(/^Stopped for \d+:\d\d$/)).toBeTruthy();
    expect(screen.queryByText(/^Paused for/)).toBeNull();
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
  it("Finish stops the phone's location even when the run cannot be written (round one, L1)", async () => {
    let full = false;
    resetRecorder({ read: () => Promise.resolve(null), write: () => (full ? Promise.reject(new Error("no room")) : Promise.resolve()), remove: () => undefined });
    await act(() => startRun(RAVI.id, "5b1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b", true, Date.now()));
    expect(location.running).toBe(true);
    full = true;
    // Nothing is drawn here: Finish is awaited itself.
    await expect(finishRun()).rejects.toThrow("no room");
    expect(location.running).toBe(false);
    expect(runNow()?.phase).toBe("finished");
  });

  it("points taken before Finish that Android hands over after it are the run's, kept quietly (round one, L2)", async () => {
    const t0 = Date.now();
    await act(() => startRun(RAVI.id, "6c1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b", false, t0));
    const at = (s: number) => ({ timestamp: t0 + s * 1000, coords: { latitude: 26.1445 + (s * 3) / 111_132, longitude: 91.7362, accuracy: 5, speed: 3 } });
    await act(() => takeLocations({ locations: Array.from({ length: 58 }, (_, s) => at(s)) }, t0 + 57_000));
    await act(() => pauseRun(t0 + 60_000));
    await act(() => finishRun(t0 + 65_000));
    const before = runNow()?.points.length ?? 0;
    Object.assign(voice, { said: [] });
    // A batch that came late: 58 and 59 s, before the pause; 62 s, inside it; 70 s, after Finish.
    await act(() => takeLocations({ locations: [at(58), at(59), at(62), at(70)] }));
    expect(runNow()?.points.slice(before).map((p) => p[0])).toEqual([58_000, 59_000]);
    expect(runNow()?.phase).toBe("finished");
    expect(runNow()?.pauses).toEqual([[60_000, 65_000]]);
    expect(voice.said).toEqual([]);
  });

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
/** The phone's motion sensor, as the setup's stand-in holds it (37i): `send(at, sd)` hands one second over. */
const motion = jest.requireMock<{ motion: { send: (at: number, sd: number) => void; reset: () => void } }>("../../src/screens/running/runMotionNative").motion;

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
    const final = sumsAt(run, end, 0);
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
    // A whole real run through the app: 5.6 s on the laptop, near 20 s on GitHub's machine.
  }, 60_000);

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

  // Testers on Google Play, 2026-11-20: after Start, with the GPS found, a path drew with nobody moving. With
  // the phone's motion (37j), standing reads as standing on any phone, its place wandering 4 m either way.
  it("Start and stand: Auto-paused, 0.00 and no route, nothing said in the first 15 s; a later stop says Auto-paused. once", async () => {
    motion.reset();
    const s = runServer();
    await openRunning(s);
    await startRunning();
    const run = runNow();
    if (run === null) throw new Error("no run");
    /** `seconds` of points from `fromS`, as Android hands them over, with the motion of each second. */
    const send = async (fromS: number, seconds: number, place: (s: number) => number, sd: number, accuracy: number) => {
      for (let k = 0; k < seconds; k++) motion.send(run.startedAt + (fromS + k) * 1000, sd);
      const locations = Array.from({ length: seconds }, (_, k) => ({
        timestamp: run.startedAt + (fromS + k) * 1000,
        coords: { latitude: 26.1445 + place(fromS + k) / 111_132, longitude: 91.7362, accuracy, speed: 0 },
      }));
      await act(() => takeLocations({ locations }));
    };
    const standing = (s: number) => 4 * Math.sin(s * 0.7);
    for (let from = 1; from < 41; from += 10) await send(from, 10, standing, 0.04, 12);
    expect(await screen.findByText("Auto-paused")).toBeTruthy();
    await waitFor(
      () => {
        expect(screen.getByText("0.00 km")).toBeTruthy();
        expect(trailMetres(drawnMap("live-map-view"))).toBe(0);
      },
      { timeout: 5000 },
    );
    expect(screen.queryByTestId("live-route")).toBeNull();
    expect(voice.said).toEqual([]);
    // Walking off: the clock starts from the first step, and the stop's end is not spoken of either.
    const walking = (s: number) => standing(40) + 1.4 * (s - 40);
    await send(41, 60, walking, 4.5, 12);
    expect(runNow()?.phase).toBe("running");
    expect(runNow()?.pauses).toEqual([[4000, 41_000]]);
    expect(runNow()?.datedBack).toEqual([[1000, 4000]]);
    expect(voice.said).toEqual([]);
    // A stop a minute and a half in is said, once.
    const stopped = () => walking(100);
    await send(101, 20, stopped, 0.04, 12);
    expect(await screen.findByText("Auto-paused")).toBeTruthy();
    expect(voice.said).toEqual(["Auto-paused."]);
  });

  it("a phone in a pram that felt still is paused until it has gone 40 m, then keeps every metre with no pause left", async () => {
    motion.reset();
    const s = runServer();
    await openRunning(s);
    await startRunning();
    const run = runNow();
    if (run === null) throw new Error("no run");
    for (let from = 1; from < 121; from += 10) {
      for (let k = 0; k < 10; k++) motion.send(run.startedAt + (from + k) * 1000, 0.05);
      const locations = Array.from({ length: 10 }, (_, k) => ({
        timestamp: run.startedAt + (from + k) * 1000,
        coords: { latitude: 26.1445 + (3 * (from + k)) / 111_132, longitude: 91.7362, accuracy: 5, speed: 3 },
      }));
      await act(() => takeLocations({ locations }));
    }
    const now = runNow();
    expect(now?.phase).toBe("running");
    // The pause the feel made at the start is undone: none is kept, and every point is the run's.
    expect(now?.pauses).toEqual([]);
    expect(now?.points).toHaveLength(120);
    expect(voice.said).toEqual([]);
  });

  it("says nothing after Finish, though Android hands over the last steps while its location stops (testers on Google Play, 2026-11-17)", async () => {
    const s = runServer();
    await openRunning(s);
    await startRunning();
    await feed(0, 60, 3);
    const run = runNow();
    if (run === null) throw new Error("no run");
    const stillAt = 26.1445 + (59 * 3) / 111_132;
    await act(() =>
      takeLocations({ locations: Array.from({ length: 20 }, (_, i) => ({ timestamp: run.startedAt + (60 + i) * 1000, coords: { latitude: stillAt, longitude: 91.7362, accuracy: 5, speed: 0 } })) }),
    );
    expect(await screen.findByText("Auto-paused")).toBeTruthy();
    const before = voice.said.length;
    const points = runNow()?.points.length ?? 0;
    // The person walks off as they press Finish: those steps reach the app while Android stops, inside
    // the press itself, as Android's own task hands them over.
    const walkingOff = Array.from({ length: 30 }, (_, i) => ({
      timestamp: run.startedAt + (80 + i) * 1000,
      coords: { latitude: stillAt + (i * 3) / 111_132, longitude: 91.7362, accuracy: 5, speed: 3 },
    }));
    stopping.whileStopping = () => takeLocations({ locations: walkingOff });
    await fireEvent.press(await screen.findByRole("button", { name: "Finish" }));
    await waitFor(() => {
      expect(stopping.whileStopping).toBeNull();
    });
    expect(runNow()?.phase).toBe("finished");
    expect(voice.said.slice(before)).toEqual([]);
    expect(runNow()?.points.length).toBe(points);
    // Finished as it stood: the stop is kept from where the person stopped.
    expect(runNow()?.datedBack.map(([from]) => from)).toEqual([59_000]);
  });

  it("Voice off says nothing, stops what it was saying, and stays off for the next run", async () => {
    const s = runServer();
    await openRunning(s);
    const toggle = await screen.findByRole("switch", { name: "Voice" });
    expect(toggle.props.value).toBe(true);
    expect(screen.getByText("Your time and pace each kilometre, and your plan's steps")).toBeTruthy();
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
    const final = sumsAt(done, end, 0);
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
    expect(screen.getByText("Your time and pace each mile, and your plan's steps")).toBeTruthy();
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
    return sumsAt(run, at, 60);
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

  it("before the first point, the map opens where Android last knew the phone was, in the last two minutes; the light says Finding GPS (37o, the hunt's A9)", async () => {
    location.lastKnown = { coords: { latitude: 26.1445, longitude: 91.7362 } };
    const s = runServer();
    await openRunning(s);
    await startRunning();
    const map = await waitFor(() => drawnMap("live-map-view"));
    expect(map.markers.at(-1)).toEqual([91.7362, 26.1445]);
    expect(screen.getByLabelText("Finding GPS")).toBeTruthy();
    expect(location.lastKnownAsked).toEqual([{ maxAge: 120_000, requiredAccuracy: GPS_WORST_ACCURACY_M }]);
    // The first point: the dot is the run's own.
    await feed(0, 1, 0, 26.15);
    await waitFor(() => {
      expect(drawnMap("live-map-view").markers.at(-1)).toEqual([91.7362, 26.15]);
    });
  });

  it("with no place Android kept, nothing is drawn until the first point", async () => {
    const s = runServer();
    await openRunning(s);
    await startRunning();
    await waitFor(() => {
      expect(location.lastKnownAsked).toHaveLength(1);
    });
    expect(maplibre.maps.filter((m) => !m.gone && m.props.testID === "live-map-view")).toHaveLength(0);
  });

  it("standing after Go, the distance stays 0.00 and no route is drawn (testers on Google Play, 2026-11-17)", async () => {
    const s = runServer();
    await openRunning(s);
    await startRunning();
    // A real run's two minutes standing at its start, as the phone recorded them; the runner leaves at 122 s.
    const standing = (realRuns().get("iphone") ?? []).filter(([t]) => t <= 121_000);
    await feedReal(standing);
    const last = standing[standing.length - 1];
    if (last === undefined) throw new Error("no points");
    await waitFor(
      () => {
        expect(screen.getByText("0.00 km")).toBeTruthy();
        // The two minutes' wander drew 13 m of line before; a step of a metre or two at most now.
        expect(trailMetres(drawnMap("live-map-view"))).toBeLessThan(3);
        // The dot is where the phone last said the person is.
        const dot = drawnMap("live-map-view").markers.at(-1);
        expect(dot === undefined ? Infinity : geodesicMetres(last[1], last[2], dot[1], dot[0])).toBeLessThan(0.5);
      },
      { timeout: 5000 },
    );
  });

  it("the dot is where the person is, Auto-paused or not: it walks off with them before the clock starts again (Kd's click-through, 2026-11-17)", async () => {
    const s = runServer();
    await openRunning(s);
    await startRunning();
    await feed(0, 60, 3);
    const run = runNow();
    if (run === null) throw new Error("no run");
    const stillAt = 26.1445 + (59 * 3) / 111_132;
    await act(() =>
      takeLocations({ locations: Array.from({ length: 20 }, (_, i) => ({ timestamp: run.startedAt + (60 + i) * 1000, coords: { latitude: stillAt, longitude: 91.7362, accuracy: 5, speed: 0 } })) }),
    );
    expect(await screen.findByText("Auto-paused")).toBeTruthy();
    const dotFrom = (point: RunPoint | undefined) => {
      const dot = drawnMap("live-map-view").markers.at(-1);
      return point === undefined || dot === undefined ? Infinity : geodesicMetres(point[1], point[2], dot[1], dot[0]);
    };
    // Eight steps away at a walk, 8.4 m: still under the 10 m that starts the clock, and the dot is with them.
    const off = await feed(80, 8, 1.2, stillAt - (80 * 1.2) / 111_132);
    expect(runNow()?.phase).toBe("paused");
    await waitFor(() => {
      expect(dotFrom(off.at(-1))).toBeLessThan(0.5);
    });
    // On: the clock starts again, and the dot is still with them.
    const on = await feed(88, 10, 1.2, stillAt - (80 * 1.2) / 111_132);
    await waitFor(() => {
      expect(runNow()?.phase).toBe("running");
      expect(dotFrom(on.at(-1))).toBeLessThan(0.5);
    });
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

  it("the worst thing: the summary says New record only for a record the run beats, never one it does not", async () => {
    const s = runServer();
    const held = (value: number, before: number | null = null) => ({
      runId: "7d9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed", name: "Old Run", startedAt: "2026-10-01T01:00:00.000Z", day: "2026-10-01", value, before,
    });
    // A fastest kilometre of 3:20 this run cannot beat; a longest run of 500 m it can.
    s.state.records = { k1: held(200), mile: null, k5: null, k10: null, longest: held(500) };
    await openRunning(s);
    await startRunning();
    await runThenFinish(801);
    const box = await screen.findByTestId("new-record-longest");
    const sums = finishedSums();
    expect(within(box).getByText(/Longest run/)).toBeTruthy();
    expect(within(box).getByText(`${distance(sums.distanceM, "metric")} km`)).toBeTruthy();
    expect(within(box).getByText(`${distance(sums.distanceM - 500, "metric")} km longer than your last best.`)).toBeTruthy();
    expect(sums.bests.k1).toBeGreaterThan(200);
    expect(screen.queryByTestId("new-record-k1")).toBeNull();
    expect(screen.queryByTestId("new-record-k5")).toBeNull();
  });

  it("with no records read (no signal), the summary claims no record at all", async () => {
    const s = runServer();
    await openRunning(s);
    await startRunning();
    await runThenFinish(801);
    expect(await screen.findByTestId("summary-map")).toBeTruthy();
    // Only once the records' read has been answered (with a refusal) is "no box" a finding.
    await waitFor(() => {
      expect(s.requests.some((r) => r.path === "/v1/geo/runs/records")).toBe(true);
    });
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(screen.queryByText("NEW RECORD")).toBeNull();
  });

  it("while an earlier run still waits on the phone, the summary claims no record; once it is sent, the records are read again", async () => {
    const s = runServer();
    s.state.records = { k1: null, mile: null, k5: null, k10: null, longest: null };
    await openRunning(s);
    await startRunning();
    await feed(0, 121, 3);
    await fireEvent.press(await screen.findByRole("button", { name: "Pause" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Finish" }));
    s.state.online = false;
    await fireEvent.press(await screen.findByRole("button", { name: "Save run" }));
    expect(await screen.findByText(/is saved on this phone/)).toBeTruthy();
    await startRunning();
    await runThenFinish(801);
    expect(await screen.findByTestId("summary-map")).toBeTruthy();
    await waitFor(() => {
      expect(s.requests.filter((r) => r.path === "/v1/geo/runs/records").length).toBeGreaterThan(0);
    });
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    // The server's records (none) do not hold the run waiting: a box here could claim what it already beat.
    expect(screen.queryByText("NEW RECORD")).toBeNull();
    const readsBefore = s.requests.filter((r) => r.path === "/v1/geo/runs/records").length;
    s.state.online = true;
    await act(async () => {
      comeBack();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    await waitFor(() => {
      expect(s.saved).toHaveLength(1);
    });
    await waitFor(() => {
      expect(s.requests.filter((r) => r.path === "/v1/geo/runs/records").length).toBeGreaterThan(readsBefore);
    });
    expect(await screen.findByTestId("new-record-longest")).toBeTruthy();
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

  it("the summary shows the Pace box from the phone's own points, the hills the server gives behind it (37c-iii)", async () => {
    const s = runServer();
    // 600 m at 3 m/s.
    await openRunning(s);
    await startRunning();
    await feed(0, 201, 3);
    // Standing still until Auto-pause, then Finish: the run's clock has moved on as the points have.
    await feed(201, 15, 0, 26.1445 + (200 * 3) / 111_132);
    expect(await screen.findByText("Auto-paused", {}, { timeout: 5000 })).toBeTruthy();
    // The server's hills at each of the chart's places, as it answers the summary's ask.
    const run = runNow();
    if (run === null) throw new Error("no run");
    const at = (run.points[run.points.length - 1]?.[0] ?? 0) + 1000;
    const places = sumsAt(run, at, 60).paceLine.length;
    expect(places).toBeGreaterThan(50);
    s.state.climb = { state: "done", m: 28, hills: Array.from({ length: places }, (_, i) => 40 + Math.round(i / 6)) };
    await fireEvent.press(await screen.findByRole("button", { name: "Finish" }));
    const card = await screen.findByTestId("pace-card");
    // About 3 m/s, 5:33 a kilometre, the average and the fastest alike.
    expect(within(card).getByText("Avg pace")).toBeTruthy();
    expect(within(card).getByText("Best pace")).toBeTruthy();
    expect(within(card).getAllByText(/^5:3\d$/)).toHaveLength(2);
    expect(await within(card).findByText("Hills")).toBeTruthy();
  });

  it("a summary of a run under 400 m has no Pace box", async () => {
    await toSummary(runServer());
    expect(screen.queryByTestId("pace-card")).toBeNull();
  });

  it("in feet for a person who runs in miles", async () => {
    const s = runServer({ ...RAVI, units: "imperial" });
    s.state.climb = { state: "done", m: 28, hills: [] };
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

// 37p (Kd, 2026-11-27: "whenevr the mobile is pointed the torch like circle also moves in that direction"): the beam
// at the front of the live map turns with the phone, as Strava's and Google Maps' do.
describe("the dot's beam follows the phone (37p)", () => {
  type Compass = { none: boolean; old: boolean; reading: boolean; starts: number; stops: number; places: [number, number][]; listeners: ((said: unknown) => void)[] };
  const compassMotion = jest.requireMock<{ motion: { turn: (deg: number, sure?: number) => void; read: (raw: unknown) => void; reset: () => void; compass: Compass } }>("../../src/screens/running/runMotionNative").motion;
  const beam = () => screen.queryByTestId("front-beam");
  /** The beam's fan and the way it points, read back from what the drawing library hands the screen: its
   *  rotation as a matrix, [cos, sin, -sin, cos, 0, 0]. */
  const beamProps = () => {
    const found = beam();
    if (found === null) throw new Error("no beam");
    const matrix: unknown = found.props.matrix;
    if (!Array.isArray(matrix)) throw new Error(`no matrix: ${Object.keys(found.props).join(", ")}`);
    const deg = (((Math.atan2(Number(matrix[1]), Number(matrix[0])) * 180) / Math.PI) % 360 + 360) % 360;
    return { d: String(found.props.d), transform: `rotate(${(Math.round(deg * 10) / 10 % 360).toFixed(1)})` };
  };
  const turn = async (deg: number, sure?: number) => {
    await act(() => {
      compassMotion.turn(deg, sure);
    });
  };
  const leave = async (state: "active" | "background") => {
    await act(() => {
      for (const handler of handlers) handler(state);
    });
  };

  beforeEach(() => {
    compassMotion.reset();
  });

  it("the worst thing touches nobody: the way the phone points is shown only, never kept with the run or sent", async () => {
    const s = runServer();
    await openRunning(s);
    await startRunning();
    await feed(0, 61, 3);
    await waitFor(() => {
      expect(compassMotion.compass.reading).toBe(true);
    });
    await turn(123.4);
    await fireEvent.press(await screen.findByRole("button", { name: "Pause" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Finish" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Save run" }));
    await waitFor(() => {
      expect(s.saved).toHaveLength(1);
    });
    const sent = JSON.stringify(s.saved);
    expect(sent).not.toMatch(/"deg"|"sure"|"heading"|"declination"|123\.4/);
    expect(s.requests.filter((r) => (r.body ?? "").includes("123.4"))).toEqual([]);
    expect(compassMotion.compass.reading).toBe(false);
  });

  it("the beam turns with the phone, and spreads wider the less sure the compass is", async () => {
    const s = runServer();
    await openRunning(s);
    await startRunning();
    await feed(0, 1, 0, 26.15);
    await waitFor(() => {
      expect(compassMotion.compass.reading).toBe(true);
    });
    // Standing, before any way travelled: the compass alone points it.
    expect(beam()).toBeNull();
    await turn(90, 3);
    expect(beamProps()).toEqual({ d: fanPath(25, 66), transform: "rotate(90.0)" });
    await turn(271.26, 2);
    expect(beamProps()).toEqual({ d: fanPath(35, 66), transform: "rotate(271.3)" });
    await turn(10, 0);
    expect(beamProps()).toEqual({ d: fanPath(60, 66), transform: "rotate(10.0)" });
    // True north at the person's place: the compass is told where they are.
    expect(compassMotion.compass.places.at(-1)).toEqual([26.15, 91.7362]);
    // A reading that is not Android's shape is left out: the first build's own, and a matrix that is not one.
    await act(() => {
      compassMotion.read({ deg: 200, sure: 3 });
      compassMotion.read({ r: [9, 9, 9, 9, 9, 9, 9, 9, 9], rotation: 0, declination: 0, accuracy: -1, status: 3 });
      compassMotion.read({ r: [1, 0, 0, 0, 1, 0, 0, 0, 1], rotation: 4, declination: 0, accuracy: -1, status: 3 });
    });
    expect(beamProps().transform).toBe("rotate(10.0)");
    // Under a degree of tremble, the beam is not drawn again; a degree is.
    await turn(10.6, 0);
    expect(beamProps().transform).toBe("rotate(10.0)");
    await turn(11.2, 0);
    expect(beamProps().transform).toBe("rotate(11.2)");
    expect(compassMotion.compass.starts).toBe(1);
  });

  it("the compass reads only while the map is on screen and the app in front", async () => {
    const s = runServer();
    await openRunning(s);
    await startRunning();
    await feed(0, 1, 0, 26.15);
    await waitFor(() => {
      expect(compassMotion.compass.reading).toBe(true);
    });
    await turn(45);
    await leave("background");
    expect(compassMotion.compass.reading).toBe(false);
    expect(compassMotion.compass.listeners).toHaveLength(0);
    await leave("active");
    await waitFor(() => {
      expect(compassMotion.compass.reading).toBe(true);
    });
    expect(compassMotion.compass.starts).toBe(2);
    // Back in front, the beam waits for a fresh reading, never the one from before.
    expect(beam()).toBeNull();
    await turn(300);
    expect(beamProps().transform).toBe("rotate(300.0)");
    // Numbers in place of the map (round one, T2): no map, no compass.
    await fireEvent.press(await screen.findByRole("button", { name: "Numbers" }));
    expect(screen.queryByTestId("live-map")).toBeNull();
    expect(compassMotion.compass.reading).toBe(false);
    expect(compassMotion.compass.listeners).toHaveLength(0);
    await fireEvent.press(await screen.findByRole("button", { name: "Map" }));
    await waitFor(() => {
      expect(compassMotion.compass.reading).toBe(true);
    });
    // The run's screen put away for the rest of the app, its bar over every tab: no compass until it is opened again.
    await fireEvent.press(await screen.findByRole("button", { name: "Back to the app" }));
    await waitFor(() => {
      expect(compassMotion.compass.reading).toBe(false);
    });
    expect(compassMotion.compass.listeners).toHaveLength(0);
    await fireEvent.press(await screen.findByRole("button", { name: "Open run" }));
    await waitFor(() => {
      expect(compassMotion.compass.reading).toBe(true);
    });
    await fireEvent.press(await screen.findByRole("button", { name: "Pause" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Finish" }));
    await waitFor(() => {
      expect(compassMotion.compass.reading).toBe(false);
    });
    expect(compassMotion.compass.listeners).toHaveLength(0);
  });

  for (const phone of ["none", "old"] as const) {
    it(`${phone === "none" ? "a phone with no compass" : "a copy built before 37p"}: the beam shows the way travelled, as before`, async () => {
      compassMotion.compass[phone] = true;
      const s = runServer();
      await openRunning(s);
      await startRunning();
      await feed(0, 1, 0, 26.15);
      await waitFor(() => {
        expect(drawnMap("live-map-view").markers.length).toBeGreaterThan(0);
      });
      expect(beam()).toBeNull();
      expect(compassMotion.compass.reading).toBe(false);
      // Going north: the beam points north once the person has moved.
      await feed(1, 20, 3, 26.15 + 3 / 111_132);
      await waitFor(
        () => {
          expect(beamProps()).toEqual({ d: fanPath(25, 66), transform: "rotate(0.0)" });
        },
        { timeout: 5000 },
      );
      expect(compassMotion.compass.starts).toBe(phone === "none" ? 1 : 0);
    });
  }
});
