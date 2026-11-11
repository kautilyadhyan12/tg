import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { AppState } from "react-native";
import { OPENFREEMAP, c25kParts, planWeekdayOf, runPlanOf, type RunPlanAnswers, type RunPlanResponse } from "@app/shared";
import { App } from "../../src/App";
import { chooseVoice, loadRun, movingMsOf, phoneRunFiles, resetRecorder, runNow, startRun, takeLocations } from "../../src/screens/running/recorder";
import { guideOf } from "../../src/screens/running/runGuide";
import { phoneToday } from "../../src/screens/running/RunPlanBox";
import { RAVI, fakeServer, kept, memoryStore, profile, tokens } from "../kit";

// Today's planned run with the voice (ROADMAP Stage 5 37d-ii), through the whole app. The worst thing
// first: a beginner told to keep running when the plan says walk. The lines of the steps the clock
// begins are handed to the phone's voice ahead (the stand-in keeps them in `voice.ahead`); a pause
// takes them back, Resume says what to do now, and the app opened again mid-run says it at once.

const extra = { copyName: "Feature 2", apiUrl: "http://localhost:3000" };
const voice = jest.requireMock<{ voice: { said: string[]; quieted: number; canSpeak: string; missing: boolean; ahead: { text: string; inMs: number }[]; warmed: number; handed: string[] } }>("../../src/screens/running/runVoiceNative").voice;
const location = jest.requireMock<{ state: Record<string, unknown> }>("expo-location").state;

/** Three days a week from today, a rest day between: today is a Couch to 5K day. */
const days = (): number[] => {
  const w = planWeekdayOf(phoneToday());
  return [w, w + 2, w + 4].map((d) => ((d - 1) % 7) + 1);
};
const BEGINNER = (): RunPlanAnswers => ({ doesRun: "start", jog: "none", days: days(), goal: "5k", weeklyM: null, longestM: null, race: null });

function server(answers: RunPlanAnswers) {
  const reply = (): RunPlanResponse => {
    const today = phoneToday();
    return { answers, plan: runPlanOf({ answers, startDay: today, raceDay: today, today, safeMode: false, runs: [] }), today };
  };
  return fakeServer({
    "/v1/auth/refresh": () => ({ status: 200, body: { tokens: tokens(2) } }),
    "/v1/users/me": () => ({ status: 200, body: profile(true, RAVI) }),
    "/v1/geo/run-plan": () => ({ status: 200, body: reply() }),
    "/v1/geo/map": () => ({ status: 200, body: { map: OPENFREEMAP } }),
    "/v1/geo/runs/records": () => ({ status: 503, body: { error: "unavailable" } }),
    "/v1/geo/runs": () => ({ status: 200, body: { items: [], nextCursor: null, months: [], total: { runs: 0, distanceM: 0 } } }),
  });
}

beforeEach(async () => {
  jest.spyOn(AppState, "addEventListener").mockImplementation(() => ({ remove: () => undefined }));
  Object.assign(location, { services: true, granted: true, canAskAgain: true, accuracy: "fine", asked: 0, started: [], running: false, acceptsTurnOn: true });
  for (const name of ["run-now.json", "run-now-0.json", "run-now-1.json", "run-settings.json", "run-map.json"]) phoneRunFiles.remove(name);
  resetRecorder();
  Object.assign(voice, { said: [], quieted: 0, canSpeak: "ok", missing: false, ahead: [], warmed: 0, handed: [] });
  await Promise.resolve();
});

/** Points a second going north at `mps`, from `fromS` into the run, handed over at the last one's time. */
async function feed(fromS: number, seconds: number, mps: number): Promise<void> {
  const run = runNow();
  if (run === null) throw new Error("no run going");
  const locations = Array.from({ length: seconds }, (_, i) => ({
    timestamp: run.startedAt + (fromS + i) * 1000,
    coords: { latitude: 26.1445 + ((fromS + i) * mps) / 111_132, longitude: 91.7362, accuracy: 5, speed: mps },
  }));
  await act(() => takeLocations({ locations }, run.startedAt + (fromS + seconds - 1) * 1000));
}

async function openRunning(answers: RunPlanAnswers) {
  const s = server(answers);
  await render(<App extra={extra} store={memoryStore(kept(1, RAVI))} ask={s.ask} />);
  await fireEvent.press(await screen.findByRole("tab", { name: "Workout" }));
  await fireEvent.press(await screen.findByRole("button", { name: "Running" }));
  return screen.findByTestId("run-plan-box");
}

describe("the worst thing: a beginner told to keep running when the plan says walk", () => {
  it("Start today's run: the warm-up is said at Go, every walk and run is handed to the phone's voice at the plan's second, and a pause takes them back", async () => {
    const box = await openRunning(BEGINNER());
    expect(within(box).getByText("Today’s run")).toBeTruthy();
    await fireEvent.press(within(box).getByRole("button", { name: "Start today’s run, with each step said" }));
    expect(await screen.findByText("Get ready")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Start now" }));
    await waitFor(() => {
      expect(runNow()?.guide?.title).toBe("Run 1 · 28½ min");
    });
    expect(voice.said).toEqual(["Warm up with a brisk walk for 5 minutes."]);
    // Each line at its second from Go, within the few ms the press took.
    const at = voice.ahead.map((l) => [Math.round(l.inMs / 1000), l.text]);
    expect(at.slice(0, 3)).toEqual([
      [300, "Now run for 1 minute."],
      [360, "Now walk for 1 and a half minutes."],
      [450, "Now run for 1 minute."],
    ]);
    expect(at.filter(([, t]) => t === "Now walk for 1 and a half minutes.")).toHaveLength(7);
    expect(at.at(-1)).toEqual([1710, "Today's run is complete. Well done. To save it, pause, then press Finish."]);
    const card = await screen.findByTestId("run-guide");
    expect(within(card).getByText("Warm-up walk")).toBeTruthy();
    expect(within(card).getByText("Next: Run 1 min")).toBeTruthy();

    // Five minutes and a half in: the screen is on the first run, and no kilometre is said in Couch to 5K.
    await feed(0, 330, 3.5);
    await waitFor(() => {
      expect(within(screen.getByTestId("run-guide")).getByText("Run")).toBeTruthy();
    });
    expect(within(screen.getByTestId("run-guide")).getByText("Next: Walk 1½ min")).toBeTruthy();
    expect(voice.said.filter((l) => l.includes("kilometre"))).toEqual([]);

    await fireEvent.press(screen.getByRole("button", { name: "Pause" }));
    await waitFor(() => {
      expect(voice.said.at(-1)).toBe("Run paused.");
    });
    expect(voice.ahead).toEqual([]);
    await fireEvent.press(await screen.findByRole("button", { name: "Resume" }));
    await waitFor(() => {
      expect(voice.said.at(-2)).toBe("Run resumed.");
    });
    expect(voice.said.at(-1)).toMatch(/^Now run\. \d+ seconds left\.$/);
    expect(voice.ahead[0]?.text).toBe("Now walk for 1 and a half minutes.");
  });

  it("START alone records a run of one's own, with the footprints; today's run is started from the plan box only (Kd, 2026-11-11)", async () => {
    await openRunning(BEGINNER());
    // One Start today's run, in the plan box; nothing beside START.
    expect(screen.getAllByRole("button", { name: "Start today’s run, with each step said" })).toHaveLength(1);
    expect(within(screen.getByTestId("run-plan-box")).getAllByRole("button", { name: "Start today’s run, with each step said" })).toHaveLength(1);
    // "Today's run" only as the plan box's own label, never a button beside START.
    expect(screen.getAllByText("Today’s run")).toHaveLength(within(screen.getByTestId("run-plan-box")).getAllByText("Today’s run").length);
    await fireEvent.press(screen.getByRole("button", { name: "Start run" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Start now" }));
    await waitFor(() => {
      expect(runNow()?.phase).toBe("running");
    });
    expect(runNow()?.guide).toBeNull();
  });

  it("location off: the plan box's button says so under the box, START above START, never both", async () => {
    Object.assign(location, { services: false });
    await openRunning(BEGINNER());
    await fireEvent.press(within(screen.getByTestId("run-plan-box")).getByRole("button", { name: "Start today’s run, with each step said" }));
    const under = await screen.findByTestId("problem-under-plan");
    expect(within(under).getByText("Turn on your phone's location to record your run.")).toBeTruthy();
    expect(screen.getAllByText("Turn on your phone's location to record your run.")).toHaveLength(1);
    await fireEvent.press(screen.getByRole("button", { name: "Start run" }));
    await waitFor(() => {
      expect(screen.queryByTestId("problem-under-plan")).toBeNull();
    });
    expect(screen.getAllByText("Turn on your phone's location to record your run.")).toHaveLength(1);
  });

  it("Auto-pause at a crossing: nothing is said ahead while stopped, and moving again says what is left", async () => {
    await startRun(RAVI.id, "4a1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b", true, Date.now(), guideOf({ kind: "walk_run", week: 1, run: 1, parts: c25kParts(0) }, "Run 1 · 28½ min"));
    await feed(0, 200, 1.6);
    expect(voice.ahead[0]?.text).toBe("Now run for 1 minute.");
    await feed(200, 30, 0);
    expect(runNow()?.phase).toBe("paused");
    expect(voice.said.at(-1)).toBe("Auto-paused.");
    expect(voice.ahead).toEqual([]);
    await feed(230, 10, 1.6);
    expect(runNow()?.phase).toBe("running");
    expect(voice.said).toContain("Run resumed.");
    expect(voice.said.at(-1)).toMatch(/^Now walk\. \d+ seconds left\.$|^Now walk\. 1 minute( \d+ seconds)? left\.$/);
    expect(voice.ahead[0]?.text).toBe("Now run for 1 minute.");
  });

  it("stopped just as a run began: the Auto-pause starts before it, so the run begins again after the pause", async () => {
    await startRun(RAVI.id, "3a1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b", true, Date.now(), guideOf({ kind: "walk_run", week: 1, run: 1, parts: c25kParts(0) }, "Run 1 · 28½ min"));
    await feed(0, 297, 1.6);
    // Still from 297 s: the clock begins the first run at 300 s, then the Auto-pause is dated 297 s.
    await feed(297, 30, 0);
    expect(runNow()?.phase).toBe("paused");
    expect(runNow()?.guide?.at.index).toBe(0);
    // Moving again: the run is handed over to begin at 300 s of the run's own time, not before.
    let s = 327;
    while (runNow()?.phase !== "running" && s < 360) {
      await feed(s, 1, 1.6);
      s += 1;
    }
    const run = runNow();
    if (run === null) throw new Error("no run going");
    const first = voice.ahead.find((l) => l.text === "Now run for 1 minute.");
    if (first === undefined) throw new Error("the run was not handed over");
    expect(Math.abs(movingMsOf(run, run.startedAt + (s - 1) * 1000) + first.inMs - 300_000)).toBeLessThan(1500);
  });

  it("the voice switched off mid-run: nothing is left to be said ahead", async () => {
    await startRun(RAVI.id, "2a1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b", false, Date.now(), guideOf({ kind: "walk_run", week: 1, run: 1, parts: c25kParts(0) }, "Run 1 · 28½ min"));
    expect(voice.handed.length).toBeGreaterThan(0);
    await act(() => chooseVoice(false));
    expect(voice.handed).toEqual([]);
  });

  it("the app opened again mid-run, after a walk began: it says walk now with what is left, and hands over the rest", async () => {
    // Go was 400 s ago; the first run ended at 360 s, and nobody said the walk.
    await startRun(RAVI.id, "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b", true, Date.now() - 400_000, guideOf({ kind: "walk_run", week: 1, run: 1, parts: c25kParts(0) }, "Run 1 · 28½ min"));
    resetRecorder();
    Object.assign(voice, { said: [], ahead: [] });
    const back = await loadRun();
    expect(back?.guide?.at.index).toBe(2);
    expect(voice.said).toHaveLength(1);
    expect(voice.said[0]).toMatch(/^Now walk\. (49|50) seconds left\.$/);
    expect(voice.ahead[0]?.text).toBe("Now run for 1 minute.");
    expect(Math.round((voice.ahead[0]?.inMs ?? 0) / 1000)).toBeGreaterThanOrEqual(49);
    expect(Math.round((voice.ahead[0]?.inMs ?? 0) / 1000)).toBeLessThanOrEqual(50);
  });
});

describe("the phone's voice made ready, so Run paused is said at once (Kd: late on a run of one's own)", () => {
  it("at Go of a run with no plan, and again each minute it goes on", async () => {
    await startRun(RAVI.id, "5a1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b", false, Date.now());
    expect(voice.said).toEqual([]);
    expect(voice.warmed).toBe(1);
    await feed(0, 50, 3);
    expect(voice.warmed).toBe(1);
    await feed(50, 20, 3);
    expect(voice.warmed).toBe(2);
  });
});

describe("a run kept on the phone before this app version", () => {
  it("has no guide saved with it: it is read back as a run that is not the plan's, and says nothing new", async () => {
    await phoneRunFiles.write(
      "run-now.json",
      JSON.stringify({ runId: "9a1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b", userId: RAVI.id, startedAt: Date.now() - 60_000, phase: "running", pausedByPerson: false, autoPause: true, pauses: [], finishedMs: null, files: 0 }),
    );
    const back = await loadRun();
    expect(back?.runId).toBe("9a1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b");
    expect(back?.guide).toBeNull();
    expect(voice.said).toEqual([]);
    expect(voice.ahead).toEqual([]);
  });
});

describe("a runner's planned run", () => {
  it("an easy run says its distance at Go, and when the points reach it says the run is complete", async () => {
    await startRun(RAVI.id, "7a1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b", false, Date.now(), guideOf({ kind: "easy", m: 1000, reps: null }, "Easy run · 1 km"));
    expect(voice.said).toEqual(["Today's run: 1 kilometre at an easy pace."]);
    // An easy run has nothing by the clock: nothing handed over.
    expect(voice.ahead).toEqual([]);
    await feed(0, 200, 3);
    expect(voice.said.filter((l) => l.includes("complete"))).toEqual([]);
    await feed(200, 200, 3);
    // The kilometre voice says the kilometre; the guide says it is complete, once, and no distance again.
    expect(voice.said.filter((l) => l.includes("complete"))).toEqual(["Today's run is complete. Well done. To save it, pause, then press Finish."]);
    expect(voice.said.filter((l) => /^1 kilometre/.test(l))).toHaveLength(1);
    expect(runNow()?.guide?.at.index).toBe(1);
  });

  it("a tempo run: the repeat said when its warm-up distance is reached, and the jog after it handed over by the clock", async () => {
    await startRun(RAVI.id, "8a1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b", false, Date.now(), guideOf({ kind: "steady", m: 6000, reps: { count: 2, m: 1000, restS: 60 } }, "Tempo run · 6 km"));
    expect(voice.said).toEqual(["Warm up with easy running for 1.5 kilometres."]);
    await feed(0, 520, 3);
    expect(voice.said).toContain("Repeat 1 of 2. Run 1 kilometre at tempo pace.");
    await feed(520, 340, 3);
    expect(voice.said).toContain("Jog easy for 1 minute to recover.");
    expect(voice.ahead.map((l) => l.text)).toEqual(["Repeat 2 of 2. Run 1 kilometre at tempo pace."]);
  });
});
