import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { AppState } from "react-native";
import { heartMaxOf, heartSums, heartZoneSeconds, putHeartMaxRequestSchema, runSums, saveRunRequestSchema, type HeartMaxResponse, type SaveRunRequest } from "@app/shared";
import { App } from "../../src/App";
import { HeartCard } from "../../src/heart/HeartZones";
import { forgetHeartMax } from "../../src/heart/heartMax";
import { heartNative } from "../../src/heart/heartNative";
import { loadMonitor, resetHeart, saveMonitor } from "../../src/heart/monitor";
import { closedPauses, pauseRun, phoneRunFiles, resetRecorder, runNow, takeLocations } from "../../src/screens/running/recorder";
import { clock } from "../../src/screens/running/runWords";
import type { Ask, AskInit } from "../../src/session/calls";
import { RAVI, fakeServer, kept, memoryStore, profile, tokens, type Reply } from "../kit";

// The heart rate chart and the five heart rate zones (ROADMAP Stage 5 item 37f-ii-a), on the phone.
// THE WORST THING THIS JOB COULD DO TO A REAL PERSON: show an easier zone than the one they are in, so
// they push harder than they meant to; or a zone worked from no maximum at all. Those come first. The
// zones are Polar's (polar.com, "Heart rate zones"); 220 less the age where no maximum is typed. Then
// the task in the person's own words: "I set my maximum heart rate once, and my runs show my zones."

const extra = { copyName: "Feature 2", apiUrl: "http://localhost:3000" };
const PATH = "/v1/geo/runs";
const MINE = "F8:A6:6F:94:AA:27";
const polar = (bpm: number): number[] => [16, bpm, 25, 3, 15, 3, 0];

interface Strap {
  watched: string | null;
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
  forgetHeartMax();
  await loadMonitor(RAVI.id);
  await saveMonitor({ id: MINE, name: "Polar H10 9EF6E824" });
});

/** The server: the person's age (null for none) and own maximum, changed by a PUT; a run saved once. */
function server(age: number | null, own: number | null = null) {
  const saved: SaveRunRequest[] = [];
  const puts: unknown[] = [];
  let mine = own;
  const max = (): HeartMaxResponse => ({ own: mine, fromAge: heartMaxOf(null, age), max: heartMaxOf(mine, age) });
  const fake = fakeServer({
    "/v1/auth/refresh": () => ({ status: 200, body: { tokens: tokens(2) } }),
    "/v1/geo/map": () => ({ status: 503, body: { error: "unavailable" } }),
    "/v1/geo/runs/records": () => ({ status: 503, body: { error: "unavailable" } }),
    "/v1/geo/runs/climb": () => ({ status: 200, body: { climb: { state: "none" } } }),
    "/v1/users/me": () => ({ status: 200, body: profile(true, RAVI) }),
    "/v1/geo/heart-max": (body): Reply => {
      if (body !== undefined) {
        puts.push(body);
        mine = putHeartMaxRequestSchema.parse(body).own;
      }
      return { status: 200, body: max() };
    },
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
            polyline: "", trackStarts: sums.trackStarts, climbM: null, heartAvg: heart?.avg ?? null, heartMax: heart?.max ?? null, heartZones: null,
          },
        },
      };
    },
  });
  let file: string | null = null;
  const runStore = () => ({
    read: () => Promise.resolve(file),
    write: (t: string) => {
      file = t;
      return Promise.resolve();
    },
  });
  const ask: Ask = (url: string, init: AskInit) => fake.ask(url, init);
  return { ask, saved, puts, runStore };
}

async function openRunning(s: ReturnType<typeof server>) {
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

/** One point a second going north at 3 m/s, and the strap's reading of that second. */
async function feed(fromS: number, seconds: number, bpm: (s: number) => number) {
  const run = runNow();
  if (run === null) throw new Error("no run going");
  for (let i = 0; i < seconds; i++) strap.send(MINE, polar(bpm(fromS + i)), run.startedAt + (fromS + i) * 1000);
  const locations = Array.from({ length: seconds }, (_, i) => ({
    timestamp: run.startedAt + (fromS + i) * 1000,
    coords: { latitude: 26.1445 + ((fromS + i) * 3) / 111_132, longitude: 91.7362, accuracy: 5, speed: 3 },
  }));
  await act(() => takeLocations({ locations }));
}

/** The time in each zone the summary should show, from the run's own readings by the shared rule, as words. */
function zoneTimes(max: number): string[] {
  const run = runNow();
  if (run === null) throw new Error("no run");
  const finished = run.finishedMs ?? 0;
  const seconds = heartZoneSeconds(run.heart, closedPauses(run, finished), finished, max);
  if (seconds === null) throw new Error("no zones");
  return seconds.map((s) => clock(s));
}

/** Five minutes at 120, five at 175, then Finish. */
async function runTenMinutes() {
  await feed(0, 300, () => 120);
  await feed(300, 300, () => 175);
  const going = runNow();
  if (going === null) throw new Error("no run");
  await act(() => pauseRun(going.startedAt + 600_500));
  await fireEvent.press(await screen.findByRole("button", { name: "Finish" }));
}

describe("the worst thing: an easier zone than the person is in, or a zone from no maximum", () => {
  it("at the person's maximum the heart rate on the run says Zone 5, and the summary counts it as Maximum", async () => {
    // 30 years old: a maximum of 190, Maximum from 171.
    const s = server(30);
    await openRunning(s);
    await startRunning();
    strap.send(MINE, polar(185));
    expect(await screen.findByText("185 bpm · Zone 5", {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.getByLabelText("Heart rate 185 beats a minute, zone 5")).toBeTruthy();
    await runTenMinutes();
    const zones = await screen.findByTestId("heart-zones");
    const times = zoneTimes(190);
    // Half the run at 175 is Maximum, half at 120 is Light; nothing is put in an easier zone.
    expect(times[4]).toMatch(/^(4:59|5:00)$/);
    expect(within(zones).getByLabelText(`Zone 5, Maximum, 171+ bpm: ${times[4] ?? ""}, 50 percent`)).toBeTruthy();
    expect(within(zones).getByLabelText(`Zone 2, Light, 114–132 bpm: ${times[1] ?? ""}, 50 percent`)).toBeTruthy();
    expect(within(zones).getByLabelText("Zone 4, Hard, 152–170 bpm: 0:00, 0 percent")).toBeTruthy();
    expect(within(zones).getByLabelText("Zone 1, Very light, Under 114 bpm: 0:00, 0 percent")).toBeTruthy();
    expect(screen.getByText("From a maximum heart rate of 190 bpm.")).toBeTruthy();
  });

  it("with no age and no maximum, no zone is shown anywhere: never Zone 1", async () => {
    const s = server(null);
    await openRunning(s);
    await startRunning();
    strap.send(MINE, polar(185));
    expect(await screen.findByText("185 bpm", {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.queryByText(/Zone \d/)).toBeNull();
    await runTenMinutes();
    expect(await screen.findByTestId("heart-card")).toBeTruthy();
    expect(screen.queryByTestId("heart-zones")).toBeNull();
    expect(screen.getByText("Add your maximum heart rate to see your zones.")).toBeTruthy();
  });

  it("a saved run shows the zones it was saved with, not today's maximum", async () => {
    await render(
      <HeartCard heartAvg={150} heartMax={175} line={[120, 150, 175]} zones={{ max: 200, seconds: [0, 300, 0, 300, 0] }} maxNow={190} distanceM={1800} units="metric" when="saved" onSetMax={() => undefined} />,
    );
    expect(screen.getByText("From a maximum heart rate of 200 bpm.")).toBeTruthy();
    expect(screen.getByLabelText("Zone 4, Hard, 160–179 bpm: 5:00, 50 percent")).toBeTruthy();
  });
});

describe("I set my maximum heart rate once, and my runs show my zones", () => {
  it("from the summary: Set maximum heart rate, typed, saved, and this run's zones appear before Save", async () => {
    const s = server(null);
    await openRunning(s);
    await startRunning();
    await runTenMinutes();
    await fireEvent.press(await screen.findByRole("button", { name: "Set maximum heart rate" }));
    const field = await screen.findByLabelText("Your maximum heart rate (bpm)");
    await fireEvent.changeText(field, "99");
    expect(screen.getByText("Enter a number from 100 to 230.")).toBeTruthy();
    await fireEvent.changeText(field, "200");
    await fireEvent.press(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(s.puts).toEqual([{ own: 200 }]);
    });
    // At 200: 120 is Light, 175 is Hard.
    const times = zoneTimes(200);
    expect(await screen.findByLabelText(`Zone 4, Hard, 160–179 bpm: ${times[3] ?? ""}, 50 percent`)).toBeTruthy();
    expect(screen.getByLabelText("Zone 5, Maximum, 180+ bpm: 0:00, 0 percent")).toBeTruthy();
    expect(screen.getByText("From a maximum heart rate of 200 bpm.")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Save run" }));
    await waitFor(() => {
      expect(s.saved).toHaveLength(1);
    });
  });

  it("in Settings: the maximum from the age, the person's own typed, then back to the age's", async () => {
    const s = server(40);
    await render(<App extra={extra} store={memoryStore(kept(1, RAVI))} ask={s.ask} runStore={s.runStore} />);
    const me = (await screen.findAllByRole("tab"))[4];
    if (me === undefined) throw new Error("no fifth tab");
    await fireEvent.press(me);
    await fireEvent.press(await screen.findByLabelText("Settings"));
    expect(await screen.findByText("180 bpm · from your age")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("heart-max-row"));
    expect(await screen.findByText("From your age: 180 bpm (220 less your age).")).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText("Your maximum heart rate (bpm)"), "193");
    await fireEvent.press(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("193 bpm · your own")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("heart-max-row"));
    await fireEvent.press(await screen.findByRole("button", { name: "Use my age instead" }));
    expect(await screen.findByText("180 bpm · from your age")).toBeTruthy();
    expect(s.puts).toEqual([{ own: 193 }, { own: null }]);
  });
});
