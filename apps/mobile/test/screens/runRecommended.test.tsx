import { fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { AppState } from "react-native";
import { OPENFREEMAP, planWeekdayOf, runPlanOf, type PlanDay, type RunPlanAnswers, type RunPlanResponse } from "@app/shared";
import { App } from "../../src/App";
import { phoneRunFiles, resetRecorder, runNow } from "../../src/screens/running/recorder";
import { dayName, nextRun, phoneToday } from "../../src/screens/running/RunPlanBox";
import { SAFE_MODE_WORDS } from "../../src/screens/running/RunRecommended";
import { RAVI, fakeServer, kept, memoryStore, profile, tokens, type Reply } from "../kit";

// Running in Recommended For You on the Dashboard, and Skip step during a planned run (ROADMAP Stage 5
// 37d-iii-a), through the whole app. The worst thing first: a run offered from the Dashboard to
// somebody in Safe mode, and a skip that leaves the voice saying run while the screen says walk.

const extra = { copyName: "Feature 2", apiUrl: "http://localhost:3000" };
const voice = jest.requireMock<{ voice: { said: string[]; quieted: number; canSpeak: string; missing: boolean; ahead: { text: string; inMs: number }[]; warmed: number; handed: string[] } }>("../../src/screens/running/runVoiceNative").voice;
const location = jest.requireMock<{ state: Record<string, unknown> }>("expo-location").state;
const START_TODAY = "Start today’s run, with each step said";
const GO_RUNNING = "Go to Running to start today’s run";

/** Three days a week, a rest day between, from today (`from` 0) or from tomorrow (`from` 1). */
const days = (from: number): number[] => {
  const w = planWeekdayOf(phoneToday()) + from;
  return [w, w + 2, w + 4].map((d) => ((d - 1) % 7) + 1);
};
const BEGINNER = (from = 0): RunPlanAnswers => ({ doesRun: "start", jog: "none", days: days(from), goal: "5k", weeklyM: null, longestM: null, race: null });

function planServer(start: { answers: RunPlanAnswers | null; safe?: boolean }) {
  const state = { answers: start.answers, safe: start.safe === true };
  const reply = (): RunPlanResponse => {
    const today = phoneToday();
    if (state.safe) return { answers: state.answers, plan: { kind: "none", why: "safe_mode" }, today };
    if (state.answers === null) return { answers: null, plan: null, today };
    return { answers: state.answers, plan: runPlanOf({ answers: state.answers, startDay: today, raceDay: today, today, safeMode: false, runs: [] }), today };
  };
  const server = fakeServer({
    "/v1/auth/refresh": () => ({ status: 200, body: { tokens: tokens(2) } }),
    "/v1/users/me": () => ({ status: 200, body: profile(true, RAVI) }),
    "/v1/geo/run-plan": () => ({ status: 200, body: reply() }),
    "/v1/users/me/health-screening": (body): Reply => {
      if (body !== undefined) state.safe = false;
      return {
        status: 200,
        body: { healthScreening: { answered: true, hasCondition: true, checkFirst: state.safe ? "not_yet" : "cleared", safeMode: state.safe, noCalorieCut: true, updatedAt: "2026-11-01T00:00:00.000Z" } },
      };
    },
    "/v1/geo/map": () => ({ status: 200, body: { map: OPENFREEMAP } }),
    "/v1/geo/runs/records": () => ({ status: 503, body: { error: "unavailable" } }),
    "/v1/geo/runs": () => ({ status: 200, body: { items: [], nextCursor: null, months: [], total: { runs: 0, distanceM: 0 } } }),
  });
  return { ask: server.ask, state };
}

beforeEach(async () => {
  jest.spyOn(AppState, "addEventListener").mockImplementation(() => ({ remove: () => undefined }));
  Object.assign(location, { services: true, granted: true, canAskAgain: true, accuracy: "fine", asked: 0, started: [], running: false, acceptsTurnOn: true });
  for (const name of ["run-now.json", "run-now-0.json", "run-now-1.json", "run-settings.json", "run-map.json"]) phoneRunFiles.remove(name);
  resetRecorder();
  Object.assign(voice, { said: [], quieted: 0, canSpeak: "ok", missing: false, ahead: [], warmed: 0, handed: [] });
  await Promise.resolve();
});

/** The Dashboard, its Recommended box on Running. */
async function openRunningBox(s: ReturnType<typeof planServer>) {
  await render(<App extra={extra} store={memoryStore(kept(1, RAVI))} ask={s.ask} />);
  const food = await screen.findByRole("radio", { name: "Food" });
  expect(food.props.accessibilityState).toEqual({ selected: true });
  await fireEvent.press(screen.getByRole("radio", { name: "Running" }));
  await waitFor(() => {
    expect(within(screen.getByTestId("recommended-box")).queryByText("Picked for you") ?? within(screen.getByTestId("recommended-box")).queryByText(/training plan/i)).toBeTruthy();
  });
  return screen.getByTestId("recommended-box");
}

/** Go to Running from the box, then today's run started from the Running page's own plan box. */
async function startFromRunningPage(box: ReturnType<typeof screen.getByTestId>) {
  await fireEvent.press(within(box).getByRole("button", { name: GO_RUNNING }));
  const planBox = await screen.findByTestId("run-plan-box");
  await fireEvent.press(within(planBox).getByRole("button", { name: START_TODAY }));
  await fireEvent.press(await screen.findByRole("button", { name: "Start now" }));
}

describe("the worst thing: a run offered from the Dashboard to somebody in Safe mode", () => {
  it("Safe mode shows no run and no Start, says why, and only a professional's clearance brings today's run", async () => {
    const s = planServer({ answers: BEGINNER(), safe: true });
    const box = await openRunningBox(s);
    expect(within(box).getByText(SAFE_MODE_WORDS)).toBeTruthy();
    expect(within(box).queryByRole("button", { name: GO_RUNNING })).toBeNull();
    expect(within(box).queryByText(/Today’s run|Run 1|Week 1/i)).toBeNull();
    expect(within(box).queryByRole("button", { name: "Create plan" })).toBeNull();

    await fireEvent.press(within(box).getByRole("button", { name: "Change your health answer" }));
    await fireEvent.press(await screen.findByText("A professional has cleared me"));
    expect(await within(screen.getByTestId("recommended-box")).findByRole("button", { name: GO_RUNNING })).toBeTruthy();
    expect(within(screen.getByTestId("recommended-box")).getByText("TODAY’S RUN")).toBeTruthy();
  });
});

describe("the worst thing: a skip that leaves the voice saying run while the screen says walk", () => {
  it("Skip step on the warm-up: the run is said at once, the step card shows it, and every line ahead moves with it", async () => {
    const box = await openRunningBox(planServer({ answers: BEGINNER() }));
    await startFromRunningPage(box);
    await waitFor(() => {
      expect(runNow()?.guide?.title).toMatch(/^Run 1 · 28½\smin$/);
    });
    expect(voice.said).toEqual(["Warm up with a brisk walk for 5 minutes."]);
    expect(Math.round((voice.ahead[0]?.inMs ?? 0) / 1000)).toBe(300);

    const card = await screen.findByTestId("run-guide");
    expect(within(card).getByText("Warm-up walk")).toBeTruthy();
    await fireEvent.press(within(card).getByRole("button", { name: "Skip Warm-up walk" }));
    await waitFor(() => {
      expect(voice.said.at(-1)).toBe("Now run for 1 minute.");
    });
    expect(within(screen.getByTestId("run-guide")).getByText("Run")).toBeTruthy();
    expect(within(screen.getByTestId("run-guide")).getByText("Next: Walk 1½ min")).toBeTruthy();
    // The walk a minute from the press, not at the plan's old 6 minutes; the old run's line is gone.
    expect(Math.round((voice.ahead[0]?.inMs ?? 0) / 1000)).toBe(60);
    expect(voice.ahead[0]?.text).toBe("Now walk for 1 and a half minutes.");
    expect(voice.ahead.filter((l) => l.text === "Now run for 1 minute.").map((l) => Math.round(l.inMs / 1000))).toEqual([150, 300, 450, 600, 750, 900]);
    expect(voice.ahead.filter((l) => l.text === "Last run. Now run for 1 minute.").map((l) => Math.round(l.inMs / 1000))).toEqual([1050]);
    expect(runNow()?.guide?.at.index).toBe(1);
  });

  it("Skip step while paused: said at the press, nothing handed ahead until Resume, which says what is left", async () => {
    const box = await openRunningBox(planServer({ answers: BEGINNER() }));
    await startFromRunningPage(box);
    await screen.findByTestId("run-guide");
    await fireEvent.press(screen.getByRole("button", { name: "Pause" }));
    await waitFor(() => {
      expect(voice.said.at(-1)).toBe("Run paused.");
    });
    await fireEvent.press(within(screen.getByTestId("run-guide")).getByRole("button", { name: "Skip Warm-up walk" }));
    await waitFor(() => {
      expect(voice.said.at(-1)).toBe("Now run for 1 minute.");
    });
    expect(voice.ahead).toEqual([]);
    await fireEvent.press(await screen.findByRole("button", { name: "Resume" }));
    await waitFor(() => {
      expect(voice.said.at(-2)).toBe("Run resumed.");
    });
    expect(voice.said.at(-1)).toMatch(/^Now run\. 1 minute left\.$|^Now run\. 59 seconds left\.$/);
    expect(voice.ahead[0]?.text).toBe("Now walk for 1 and a half minutes.");
  });
});

describe("the next run is never one already done (round one)", () => {
  const easy = { kind: "easy" as const, m: 5000, reps: null };
  const day = (d: string, weekday: number, planned: boolean, done: boolean): PlanDay => ({ day: d, weekday, session: planned ? easy : null, done });
  const cases: [string, PlanDay[], string | null][] = [
    ["today's run still to do", [day("2026-11-11", 3, true, false), day("2026-11-12", 4, true, false)], "2026-11-11"],
    ["today's run done: the next later one", [day("2026-11-11", 3, true, true), day("2026-11-13", 5, true, false)], "2026-11-13"],
    ["a later run ticked by today's run: the one after it", [day("2026-11-11", 3, false, false), day("2026-11-12", 4, true, true), day("2026-11-14", 6, true, false)], "2026-11-14"],
    ["every later run done: none", [day("2026-11-12", 4, true, true), day("2026-11-14", 6, true, true)], null],
    ["a run before today not done is never next", [day("2026-11-10", 2, true, false), day("2026-11-12", 4, true, false)], "2026-11-12"],
  ];
  it.each(cases)("%s", (_name, days, expected) => {
    expect(nextRun(days, "2026-11-11")?.day.day ?? null).toBe(expected);
  });

  it("the runner's plan itself: a 9 km run on a Wednesday with no run ticks Thursday's, and Thursday is not next", () => {
    const answers: RunPlanAnswers = { doesRun: "yes", jog: "30plus", days: [4, 6, 7], goal: "10k", weeklyM: 20_000, longestM: 8_000, race: null };
    const today = "2026-11-11";
    const plan = runPlanOf({ answers, startDay: today, raceDay: null, today, safeMode: false, runs: [{ day: today, distanceM: 9000, longestM: 9000, movingS: 3000, effort: null }] });
    if (plan.kind === "none") throw new Error("no plan");
    const thursday = plan.days.find((d) => d.day === "2026-11-12");
    expect(thursday?.done).toBe(true);
    expect(nextRun(plan.days, today)?.day.day).not.toBe("2026-11-12");
  });
});

describe("Running in Recommended For You", () => {
  it("today's run: the same run the Running page shows, with the plan's week, and See plan opens the plan", async () => {
    const box = await openRunningBox(planServer({ answers: BEGINNER() }));
    expect(within(box).getByText("Picked for you")).toBeTruthy();
    expect(within(box).getByText("Couch to 5K · Week 1 of 9")).toBeTruthy();
    expect(within(box).getByText("TODAY’S RUN")).toBeTruthy();
    const title = within(box).getByText(/^Run 1 · /);
    const titleWords = String(title.props.children);
    await fireEvent.press(within(box).getByRole("button", { name: "See your training plan" }));
    expect(await screen.findByText("Week 1 of 9")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Close" }));

    await fireEvent.press(screen.getByRole("tab", { name: "Workout" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Running" }));
    const onPage = await screen.findByTestId("run-plan-box");
    expect(within(onPage).getByText(titleWords)).toBeTruthy();
  });

  it("a rest day: the next run and its day, See plan, and no Start", async () => {
    const answers = BEGINNER(1);
    const box = await openRunningBox(planServer({ answers }));
    // The very line for the plan the server makes today: the next run's day, or none left this week.
    const today = phoneToday();
    const plan = runPlanOf({ answers, startDay: today, raceDay: today, today, safeMode: false, runs: [] });
    if (plan.kind === "none") throw new Error("no plan");
    const next = nextRun(plan.days, today);
    expect(next?.today ?? false).toBe(false);
    if (next === null) expect(within(box).getByText("No more runs this week.")).toBeTruthy();
    else expect(within(box).getByText(`NEXT RUN · ${dayName(next.day.weekday).toUpperCase()}`)).toBeTruthy();
    expect(within(box).queryByRole("button", { name: GO_RUNNING })).toBeNull();
    expect(within(box).getByRole("button", { name: "See your training plan" })).toBeTruthy();
  });

  it("no plan yet: Create plan opens the running questions over the Dashboard", async () => {
    const box = await openRunningBox(planServer({ answers: null }));
    expect(within(box).getByText("No training plan yet.")).toBeTruthy();
    expect(within(box).getByText("A weekly plan built from your current running.")).toBeTruthy();
    await fireEvent.press(within(box).getByRole("button", { name: "Create plan" }));
    expect(await screen.findByText("New to running")).toBeTruthy();
  });

  it("Go to Running opens the Running page on today's run and starts nothing by itself (Kd, 2026-11-11)", async () => {
    const box = await openRunningBox(planServer({ answers: BEGINNER() }));
    const titleWords = String(within(box).getByText(/^Run 1 · /).props.children);
    await fireEvent.press(within(box).getByRole("button", { name: GO_RUNNING }));
    const planBox = await screen.findByTestId("run-plan-box");
    expect(within(planBox).getByText(titleWords)).toBeTruthy();
    expect(within(planBox).getByRole("button", { name: START_TODAY })).toBeTruthy();
    // No count, no run, no voice, no location asked for.
    expect(screen.queryByText("Get ready")).toBeNull();
    expect(runNow()).toBeNull();
    expect(voice.said).toEqual([]);
    expect(location.asked).toBe(0);
  });

  it("Food and Running across the box's top: Food again shows the meal box", async () => {
    await openRunningBox(planServer({ answers: BEGINNER() }));
    await fireEvent.press(screen.getByRole("radio", { name: "Food" }));
    await waitFor(() => {
      expect(screen.getByRole("radio", { name: "Food" }).props.accessibilityState).toEqual({ selected: true });
    });
    expect(within(screen.getByTestId("recommended-box")).queryByText("TODAY’S RUN")).toBeNull();
  });
});
