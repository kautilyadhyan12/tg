import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { AppState } from "react-native";
import { heartSums, runSums, saveRunRequestSchema, type SaveRunRequest } from "@app/shared";
import { App } from "../../src/App";
import { heartNative } from "../../src/heart/heartNative";
import { HEART_FRESH_MS, endTry, heartNow, holdHeart, loadMonitor, pullHeart, resetHeart, saveMonitor, takeHeartReadings, tryMonitor } from "../../src/heart/monitor";
import { closedPauses, pauseRun, phoneRunFiles, resetRecorder, runNow, takeLocations } from "../../src/screens/running/recorder";
import type { Ask, AskInit } from "../../src/session/calls";
import { RAVI, fakeServer, kept, memoryStore, profile, tokens, type Reply } from "../kit";

// Heart rate from a strap or a watch (ROADMAP Stage 5 item 37f-i), on the phone.
// THE WORST THING THIS JOB COULD DO TO A REAL PERSON: a heart rate that is not theirs shown as theirs
// mid-run (a stranger's strap at the gym, a strap that slipped off, a number frozen from a while ago), so
// they push harder than is safe. Those come first. The bytes are a real Polar H10's (polar-ble-sdk issue
// 265): flags 16, its beat rate, two beat times and a stray 0. Then the task in the person's own words: "I
// connect my chest strap once, and my runs show my heart rate."

const extra = { copyName: "Feature 2", apiUrl: "http://localhost:3000" };
const PATH = "/v1/geo/runs";
const MINE = "F8:A6:6F:94:AA:27";
const STRANGER = "C0:FF:EE:12:34:56";
const polar = (bpm: number): number[] => [16, bpm, 25, 3, 15, 3, 0];

interface Strap {
  radio: string;
  allowed: boolean;
  missing: boolean;
  near: { id: string; name: string; rssi: number }[];
  watched: string | null;
  watches: string[];
  scans: number;
  send: (id: string, bytes: number[], at?: number) => void;
  reset: () => void;
}
const strap = jest.requireMock<{ strap: Strap }>("../../src/heart/heartNative").strap;
const location = jest.requireMock<{ state: Record<string, unknown> }>("expo-location").state;

beforeEach(async () => {
  jest.spyOn(AppState, "addEventListener").mockImplementation(() => ({ remove: () => undefined }));
  Object.assign(location, { services: true, granted: true, canAskAgain: true, accuracy: "fine", asked: 0, started: [], running: false, acceptsTurnOn: true });
  for (const name of ["run-now.json", "run-now-0.json", "run-now-heart-0.json", "run-settings.json", "run-map.json", `heart-monitor-${RAVI.id}.json`]) phoneRunFiles.remove(name);
  strap.reset();
  resetHeart(heartNative);
  resetRecorder();
  await Promise.resolve();
});

describe("the worst thing: a heart rate that is not the person's, shown as theirs", () => {
  beforeEach(async () => {
    await loadMonitor(RAVI.id);
    await saveMonitor({ id: MINE, name: "Polar H10 9EF6E824" });
  });

  it("a stranger's strap near by is never shown nor kept: only the one picked, by its address", () => {
    const release = holdHeart();
    expect(strap.watched).toBe(MINE);
    const now = Date.now();
    strap.send(STRANGER, polar(162), now - 500);
    strap.send(MINE, polar(88), now - 400);
    strap.send(STRANGER, polar(171), now - 100);
    pullHeart();
    expect(heartNow(now)).toBe(88);
    expect(takeHeartReadings().map((r) => r.bpm)).toEqual([88]);
    // Only the stranger's goes on: the person's heart rate is No signal once theirs is old, never the stranger's.
    strap.send(STRANGER, polar(175), now + 1000);
    pullHeart();
    expect(heartNow(now + HEART_FRESH_MS + 1)).toBeNull();
    release();
    expect(strap.watched).toBeNull();
  });

  it("a strap that feels no skin, or sends 0, is no heart rate: never shown, never kept", () => {
    holdHeart();
    const now = Date.now();
    strap.send(MINE, [0x04, 120], now - 300); // skin contact: supported, not felt
    strap.send(MINE, [22, 0], now - 200);
    strap.send(MINE, [0x16], now - 100);
    pullHeart();
    expect(heartNow(now)).toBeNull();
    expect(takeHeartReadings()).toEqual([]);
  });

  it("a reading older than HEART_FRESH_MS is never the heart rate now", () => {
    holdHeart();
    const now = Date.now();
    strap.send(MINE, polar(95), now - HEART_FRESH_MS - 1);
    pullHeart();
    expect(heartNow(now)).toBeNull();
    strap.send(MINE, polar(96), now - HEART_FRESH_MS + 1000);
    pullHeart();
    expect(heartNow(now)).toBe(96);
  });

  it("a monitor tried in the box is shown while tried, and keeps nothing for a run", () => {
    holdHeart();
    tryMonitor(STRANGER);
    expect(strap.watched).toBe(STRANGER);
    const now = Date.now();
    strap.send(STRANGER, polar(140), now);
    strap.send(MINE, polar(90), now);
    pullHeart();
    expect(heartNow(now)).toBe(140);
    expect(takeHeartReadings()).toEqual([]);
    endTry();
    expect(strap.watched).toBe(MINE);
    expect(heartNow(now)).toBeNull();
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
    [PATH]: (body): Reply => {
      if (body === undefined) return { status: 200, body: { items: [], nextCursor: null, months: [], total: { runs: 0, distanceM: 0 } } };
      const run = saveRunRequestSchema.parse(body);
      saved.push(run);
      const sums = runSums(run.points, run.pauses, run.elapsedMs, 60);
      const heart = heartSums(run.heart ?? [], run.pauses, run.elapsedMs);
      return {
        status: 201,
        body: {
          status: "created",
          run: {
            id: run.runId, startedAt: run.startedAt, name: run.name, effort: run.effort, note: run.note, distanceM: sums.distanceM, movingS: sums.movingS,
            elapsedS: sums.elapsedS, leftOutM: sums.leftOutM, leftOutS: sums.leftOutS, kcal: sums.kcal, splitsKm: sums.splitsKm, splitsMi: sums.splitsMi,
            polyline: "", trackStarts: sums.trackStarts, climbM: null, heartAvg: heart?.avg ?? null, heartMax: heart?.max ?? null,
          },
        },
      };
    },
  });
  const ask: Ask = async (url: string, init: AskInit) => {
    if (new URL(url).pathname === PATH && init.method === "POST" && init.body !== undefined) posts.push(JSON.parse(init.body));
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
  return { ask, posts, saved, runStore };
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

/** One point a second going north at 3 m/s, and the strap's reading of that second, as Android hands
 *  them over together. */
async function feed(fromS: number, seconds: number, bpm: ((s: number) => number) | null) {
  const run = runNow();
  if (run === null) throw new Error("no run going");
  for (let i = 0; i < seconds; i++) if (bpm !== null) strap.send(MINE, polar(bpm(fromS + i)), run.startedAt + (fromS + i) * 1000);
  const locations = Array.from({ length: seconds }, (_, i) => ({
    timestamp: run.startedAt + (fromS + i) * 1000,
    coords: { latitude: 26.1445 + ((fromS + i) * 3) / 111_132, longitude: 91.7362, accuracy: 5, speed: 3 },
  }));
  await act(() => takeLocations({ locations }));
}

describe("I connect my chest strap once, and my runs show my heart rate", () => {
  it("Connect on the Running page: the monitors near by, nearest first; mine tried, its heart rate seen, saved", async () => {
    strap.near = [
      { id: STRANGER, name: "Polar H10 1A2B3C4D", rssi: -84 },
      { id: MINE, name: "Polar H10 9EF6E824", rssi: -48 },
    ];
    const s = runServer();
    await openRunning(s);
    expect(screen.getByText("Chest strap or watch")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Connect a heart rate monitor" }));
    const mine = await screen.findByRole("button", { name: "Connect Polar H10 9EF6E824" });
    const rows = screen.getAllByRole("button", { name: /^Connect Polar/ });
    expect(rows.map((r) => r.props.accessibilityLabel as string)).toEqual(["Connect Polar H10 9EF6E824", "Connect Polar H10 1A2B3C4D"]);
    await fireEvent.press(mine);
    expect(strap.watched).toBe(MINE);
    expect(await screen.findByText("Connecting…")).toBeTruthy();
    // Save waits for the person's own heart rate on the screen.
    expect(screen.getByRole("button", { name: "Save" }).props.accessibilityState).toMatchObject({ disabled: true });
    strap.send(STRANGER, polar(150));
    strap.send(MINE, polar(72));
    expect(await screen.findByText("72 bpm", {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.getByText("Is this your heart rate?")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Saved. It connects when you start a run.")).toBeTruthy();
    expect(await phoneRunFiles.read(`heart-monitor-${RAVI.id}.json`)).toBe(JSON.stringify({ id: MINE, name: "Polar H10 9EF6E824" }));
    // The Running page's row says it, as Settings does: one monitor.
    expect(await screen.findByText(/^Polar H10 9EF6E824 · /)).toBeTruthy();
  });

  it("Not this one goes back to the list, and the stranger's strap tried is never saved", async () => {
    strap.near = [{ id: STRANGER, name: "Polar H10 1A2B3C4D", rssi: -50 }];
    const s = runServer();
    await openRunning(s);
    await fireEvent.press(screen.getByRole("button", { name: "Connect a heart rate monitor" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Connect Polar H10 1A2B3C4D" }));
    strap.send(STRANGER, polar(150));
    expect(await screen.findByText("150 bpm", {}, { timeout: 3000 })).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Not this one" }));
    expect(await screen.findByRole("button", { name: "Connect Polar H10 1A2B3C4D" })).toBeTruthy();
    expect(strap.watched).not.toBe(STRANGER);
    expect(await phoneRunFiles.read(`heart-monitor-${RAVI.id}.json`)).toBeNull();
  });

  it("says what stands in the way: Bluetooth off, Nearby devices not allowed, a phone with none", async () => {
    const s = runServer();
    await openRunning(s);
    strap.radio = "off";
    await fireEvent.press(screen.getByRole("button", { name: "Connect a heart rate monitor" }));
    expect(await screen.findByText("Bluetooth is off.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Turn on Bluetooth" })).toBeTruthy();
    expect(strap.scans).toBe(0);
    strap.radio = "on";
    strap.allowed = false;
    expect(await screen.findByText("Allow Nearby devices to find your monitor.", {}, { timeout: 3000 })).toBeTruthy();
    strap.allowed = true;
    expect(await screen.findByText("Wear your strap, or turn on your watch's heart rate broadcast.", {}, { timeout: 3000 })).toBeTruthy();
    expect(strap.scans).toBe(1);
  });

  it("a run shows the heart rate live, No signal (never 0) with none, and its average and highest after; Save sends the readings", async () => {
    await loadMonitor(RAVI.id);
    await saveMonitor({ id: MINE, name: "Polar H10 9EF6E824" });
    const s = runServer();
    await openRunning(s);
    await startRunning();
    expect(strap.watched).toBe(MINE);
    // Nothing from the strap yet: No signal, never a 0.
    expect(await screen.findByText("No signal")).toBeTruthy();
    expect(screen.queryByText("0 bpm")).toBeNull();
    // Five minutes at 140 and five at 160, as the points come.
    await feed(0, 300, () => 140);
    await feed(300, 300, () => 160);
    // The heart rate now, on the map's top row.
    strap.send(MINE, polar(158));
    expect(await screen.findByText("158 bpm", {}, { timeout: 3000 })).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Numbers" }));
    expect(await screen.findByText("Heart rate")).toBeTruthy();
    // Paused at the end of the ten minutes fed (Pause pressed now would pause before them).
    const going = runNow();
    if (going === null) throw new Error("no run");
    await act(() => pauseRun(going.startedAt + 600_500));
    await fireEvent.press(await screen.findByRole("button", { name: "Finish" }));
    const run = runNow();
    if (run === null) throw new Error("no run");
    const expected = heartSums(run.heart, closedPauses(run, run.finishedMs ?? 0), run.finishedMs ?? 0);
    expect(expected).not.toBeNull();
    expect(await screen.findByText("Avg heart rate")).toBeTruthy();
    expect(screen.getByText(`${String(expected?.avg)} bpm`)).toBeTruthy();
    expect(screen.getByText(`${String(expected?.max)} bpm`)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Save run" }));
    await waitFor(() => {
      expect(s.saved).toHaveLength(1);
    });
    const sent = s.saved[0]?.heart ?? [];
    expect(sent.length).toBeGreaterThanOrEqual(590);
    expect(sent.every(([, bpm]) => bpm === 140 || bpm === 160)).toBe(true);
    // The Running page shows the monitor's heart rate while it is open; another tab lets it go.
    expect(strap.watched).toBe(MINE);
    await fireEvent.press(screen.getByRole("tab", { name: "Food" }));
    await waitFor(() => {
      expect(strap.watched).toBeNull();
    });
  });

  it("a run with no monitor shows no heart rate, live or after, and sends none", async () => {
    const s = runServer();
    await openRunning(s);
    await startRunning();
    await feed(0, 120, null);
    expect(screen.queryByText("No signal")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Pause" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Finish" }));
    expect(await screen.findByText("Moving time")).toBeTruthy();
    expect(screen.queryByText("Avg heart rate")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Save run" }));
    await waitFor(() => {
      expect(s.saved).toHaveLength(1);
    });
    expect(s.saved[0]?.heart).toBeUndefined();
  });

  it("Settings shows the same monitor, and Remove asks first", async () => {
    await loadMonitor(RAVI.id);
    await saveMonitor({ id: MINE, name: "Polar H10 9EF6E824" });
    const s = runServer();
    await render(<App extra={extra} store={memoryStore(kept(1, RAVI))} ask={s.ask} runStore={s.runStore} />);
    const me = (await screen.findAllByRole("tab"))[4];
    if (me === undefined) throw new Error("no fifth tab");
    await fireEvent.press(me);
    await fireEvent.press(await screen.findByLabelText("Settings"));
    // Under its own heading the row does not say "Heart rate monitor" again.
    expect(await screen.findByText("Polar H10 9EF6E824")).toBeTruthy();
    expect(screen.getAllByText("Heart rate monitor")).toHaveLength(1);
    await fireEvent.press(screen.getByRole("button", { name: "Change heart rate monitor" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Remove" }));
    // Asked first, with who it is about; Keep it leaves it.
    expect(await screen.findByText("Polar H10 9EF6E824 won't connect to your runs.")).toBeTruthy();
    expect(await phoneRunFiles.read(`heart-monitor-${RAVI.id}.json`)).not.toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Remove" }));
    await waitFor(async () => {
      expect(await phoneRunFiles.read(`heart-monitor-${RAVI.id}.json`)).toBeNull();
    });
  });
});
