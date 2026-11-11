import { fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { AppState } from "react-native";
import { OPENFREEMAP, hasOwnRun, ownPlanOf, planWeekdayOf, runChoiceOf, runPlanOf, type OwnWeek, type RunChoice, type RunPlanAnswers, type RunPlanResponse } from "@app/shared";
import { App } from "../../src/App";
import { phoneRunFiles, resetRecorder } from "../../src/screens/running/recorder";
import { phoneToday, todayGuide } from "../../src/screens/running/RunPlanBox";
import { OVER_CAP_SHORT, distanceRows } from "../../src/screens/running/OwnRunWeek";
import { SAFE_MODE_WORDS } from "../../src/screens/running/RunRecommended";
import { dayName } from "../../src/screens/running/runPlanWords";
import { RAVI, fakeServer, kept, memoryStore, profile, tokens, type Reply } from "../kit";

// Your own run plan (ROADMAP Stage 5 37d-iii-b), through the whole app: Suggested or My plan on the
// Dashboard's Running tab and the Running page, Build my own, a day changed or moved, Save. The worst
// thing first: somebody in Safe mode shown a run from their own plan.

const extra = { copyName: "Feature 2", apiUrl: "http://localhost:3000" };
const location = jest.requireMock<{ state: Record<string, unknown> }>("expo-location").state;
const GO_RUNNING = "Go to Running to start today’s run";
const START_TODAY = "Start today’s run, with each step said";
const REST: OwnWeek = [null, null, null, null, null, null, null];
const todayAt = (): number => planWeekdayOf(phoneToday()) - 1;
/** A week with one run, today. */
const todayRun = (m: number): OwnWeek => REST.map((d, i) => (i === todayAt() ? { kind: "easy", m } : d));
/** Three days a week from today, a rest day between. */
const days = (): number[] => {
  const w = planWeekdayOf(phoneToday());
  return [w, w + 2, w + 4].map((d) => ((d - 1) % 7) + 1);
};
const BEGINNER: RunPlanAnswers = { doesRun: "start", jog: "none", days: days(), goal: "5k", weeklyM: null, longestM: null, race: null };

function planServer(start: { answers?: RunPlanAnswers | null; week?: OwnWeek | null; choice?: RunChoice | null; safe?: boolean; capM?: number | null; failSave?: boolean; failChoice?: boolean }) {
  const state = { answers: start.answers ?? null, week: start.week ?? null, choice: start.choice ?? null, safe: start.safe === true, capM: start.capM ?? null };
  const weekPuts: unknown[] = [];
  const choicePuts: unknown[] = [];
  const reply = (): RunPlanResponse => {
    const today = phoneToday();
    const choice = runChoiceOf(state.choice, state.week);
    if (state.safe) return { answers: state.answers, plan: { kind: "none", why: "safe_mode" }, today, choice, own: null, capM: null };
    const own = hasOwnRun(state.week) ? { week: state.week, days: ownPlanOf({ week: state.week, today, runs: [], after: [] }) } : null;
    const plan = state.answers === null ? null : runPlanOf({ answers: state.answers, startDay: today, raceDay: today, today, safeMode: false, runs: [] });
    return { answers: state.answers, plan, today, choice, own, capM: state.capM };
  };
  const server = fakeServer({
    "/v1/auth/refresh": () => ({ status: 200, body: { tokens: tokens(2) } }),
    "/v1/users/me": () => ({ status: 200, body: profile(true, RAVI) }),
    "/v1/geo/run-plan": () => ({ status: 200, body: reply() }),
    "/v1/geo/run-plan/choice": (body): Reply => {
      choicePuts.push(body);
      if (start.failChoice === true) return { status: 503, body: { error: "unavailable" } };
      state.choice = (body as { choice: RunChoice }).choice;
      return { status: 200, body: reply() };
    },
    "/v1/geo/run-plan/own": (body): Reply => {
      weekPuts.push(body);
      if (start.failSave === true) return { status: 503, body: { error: "unavailable" } };
      state.week = (body as { days: OwnWeek }).days;
      state.choice = "mine";
      return { status: 200, body: reply() };
    },
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
  return { ask: server.ask, state, weekPuts, choicePuts };
}

beforeEach(async () => {
  jest.spyOn(AppState, "addEventListener").mockImplementation(() => ({ remove: () => undefined }));
  Object.assign(location, { services: true, granted: true, canAskAgain: true, accuracy: "fine", asked: 0, started: [], running: false, acceptsTurnOn: true });
  for (const name of ["run-now.json", "run-now-0.json", "run-now-1.json", "run-settings.json", "run-map.json"]) phoneRunFiles.remove(name);
  resetRecorder();
  await Promise.resolve();
});

/** The Dashboard, its Recommended box on Running. */
async function openRunningBox(s: ReturnType<typeof planServer>) {
  await render(<App extra={extra} store={memoryStore(kept(1, RAVI))} ask={s.ask} />);
  await screen.findByRole("radio", { name: "Food" });
  await fireEvent.press(screen.getByRole("radio", { name: "Running" }));
  await waitFor(() => {
    expect(within(screen.getByTestId("recommended-box")).queryByLabelText("Whose run plan") ?? within(screen.getByTestId("recommended-box")).queryByText(SAFE_MODE_WORDS)).toBeTruthy();
  });
  return () => screen.getByTestId("recommended-box");
}

const picked = (box: ReturnType<typeof screen.getByTestId>, name: string): unknown => (within(box).getByRole("radio", { name }).props as { accessibilityState: unknown }).accessibilityState;

describe("the worst thing: a run from one's own plan shown in Safe mode", () => {
  it("Safe mode, with My plan picked and a run today: no run, no switch, no Go to Running, on the Dashboard or the Running page", async () => {
    const s = planServer({ answers: BEGINNER, week: todayRun(5000), choice: "mine", safe: true });
    const box = await openRunningBox(s);
    expect(within(box()).getByText(SAFE_MODE_WORDS)).toBeTruthy();
    expect(within(box()).queryByLabelText("Whose run plan")).toBeNull();
    expect(within(box()).queryByRole("button", { name: GO_RUNNING })).toBeNull();
    expect(within(box()).queryByText(/My plan|Easy run|Today’s run/i)).toBeNull();
    // The Running page, through the Workout tab.
    await fireEvent.press(screen.getByRole("tab", { name: "Workout" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Running" }));
    const planBox = await screen.findByTestId("run-plan-box");
    expect(within(planBox).getByText(/No training plan until a professional has cleared you/)).toBeTruthy();
    expect(within(planBox).queryByLabelText("Whose run plan")).toBeNull();
    expect(within(planBox).queryByRole("button", { name: START_TODAY })).toBeNull();
    expect(within(planBox).queryByText(/Easy run/)).toBeNull();
  });

  it("today's guide comes from no plan at all in Safe mode, whichever is picked", () => {
    const today = phoneToday();
    const data: RunPlanResponse = { answers: null, plan: { kind: "none", why: "safe_mode" }, today, choice: "mine", own: null, capM: null };
    expect(todayGuide({ kind: "ok", data }, "metric")).toBeNull();
    expect(todayGuide({ kind: "ok", data }, "metric", "suggested")).toBeNull();
  });
});

describe("Suggested or My plan", () => {
  it("My plan picked on the Dashboard with none yet: Build my own starts from this week's suggested runs, a day is changed, and Save shows it", async () => {
    const s = planServer({ answers: BEGINNER });
    const box = await openRunningBox(s);
    expect(picked(box(), "Suggested")).toEqual({ selected: true });
    expect(within(box()).getByText("Picked for you")).toBeTruthy();

    await fireEvent.press(within(box()).getByRole("radio", { name: "My plan" }));
    expect(await within(box()).findByText("No plan of your own yet.")).toBeTruthy();
    expect(s.choicePuts).toEqual([{ choice: "mine" }]);
    expect(within(box()).queryByRole("button", { name: GO_RUNNING })).toBeNull();

    await fireEvent.press(within(box()).getByRole("button", { name: "Build my own" }));
    // Today holds the suggested walk and run; the days between are rest days.
    const today = dayName(todayAt() + 1);
    const row = await screen.findByRole("button", { name: new RegExp(`^${today}: Run 1 · 28½\\smin\\. Change$`) });
    await fireEvent.press(row);
    await fireEvent.press(await screen.findByRole("radio", { name: "Easy run" }));
    expect(screen.getByText("Easy, conversational pace")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByRole("button", { name: `${today}: Easy run · 5 km. Change` })).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(s.weekPuts).toHaveLength(1);
    });
    const sent = (s.weekPuts[0] as { days: OwnWeek }).days;
    expect(sent[todayAt()]).toEqual({ kind: "easy", m: 5000 });
    // The rest of the week as suggested.
    const suggested = runPlanOf({ answers: BEGINNER, startDay: phoneToday(), raceDay: phoneToday(), today: phoneToday(), safeMode: false, runs: [] });
    const walkRuns = suggested.kind === "none" ? 0 : suggested.days.filter((d) => d.session?.kind === "walk_run").length;
    expect(sent.filter((d) => d?.kind === "walk_run")).toHaveLength(walkRuns - 1);
    expect(await within(box()).findByText("Easy run · 5 km")).toBeTruthy();
    expect(picked(box(), "My plan")).toEqual({ selected: true });
    expect(within(box()).getByRole("button", { name: GO_RUNNING })).toBeTruthy();
    expect(within(box()).getByRole("button", { name: "Edit your own run plan" })).toBeTruthy();
  });

  it("the Running page shows My plan's run today with Start today's run, and Suggested brings the app's plan back", async () => {
    const s = planServer({ answers: BEGINNER, week: todayRun(6000) });
    const box = await openRunningBox(s);
    expect(picked(box(), "My plan")).toEqual({ selected: true });
    await fireEvent.press(within(box()).getByRole("button", { name: GO_RUNNING }));
    const planBox = await screen.findByTestId("run-plan-box");
    expect(within(planBox).getByText("My plan · 1 run · 6 km")).toBeTruthy();
    expect(within(planBox).getByText("Easy run · 6 km")).toBeTruthy();
    expect(within(planBox).getByRole("button", { name: START_TODAY })).toBeTruthy();

    await fireEvent.press(within(planBox).getByRole("radio", { name: "Suggested" }));
    expect(await within(screen.getByTestId("run-plan-box")).findByText(/^Run 1 · 28½\smin$/)).toBeTruthy();
    expect(s.choicePuts).toEqual([{ choice: "suggested" }]);
    // The week of one's own is kept for when My plan is picked again.
    expect(s.state.week).toEqual(todayRun(6000));
  });

  it("a pick that gets no answer goes back, and says so", async () => {
    const s = planServer({ answers: BEGINNER, failChoice: true });
    const box = await openRunningBox(s);
    await fireEvent.press(within(box()).getByRole("radio", { name: "My plan" }));
    await waitFor(() => {
      expect(picked(box(), "Suggested")).toEqual({ selected: true });
    });
    expect(within(box()).getByText("Picked for you")).toBeTruthy();
  });
});

describe("changing one's own week", () => {
  it("a run moved to a rest day says so under that day, and two runs swap", async () => {
    const s = planServer({ week: todayRun(5000) });
    const box = await openRunningBox(s);
    await fireEvent.press(within(box()).getByRole("button", { name: "Edit your own run plan" }));
    const at = todayAt();
    const to = (at + 3) % 7;
    await fireEvent.press(await screen.findByRole("button", { name: `${dayName(at + 1)}: Easy run · 5 km. Change` }));
    const short = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][to] ?? "";
    await fireEvent.press(await screen.findByRole("radio", { name: short }));
    expect(screen.getByText(`Moved from ${dayName(at + 1)}.`)).toBeTruthy();
    expect(screen.getByRole("button", { name: `${dayName(at + 1)}: Rest day. Change` })).toBeTruthy();
    expect(screen.getByRole("button", { name: `${dayName(to + 1)}: Easy run · 5 km. Change` })).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(s.weekPuts).toHaveLength(1);
    });
    expect((s.weekPuts[0] as { days: OwnWeek }).days).toEqual(REST.map((d, i) => (i === to ? { kind: "easy", m: 5000 } : d)));
  });

  it("closing with a change asks first; Discard sends nothing and the week stays as it was", async () => {
    const s = planServer({ week: todayRun(5000) });
    const box = await openRunningBox(s);
    await fireEvent.press(within(box()).getByRole("button", { name: "Edit your own run plan" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Make every day a rest day" }));
    await fireEvent.press(screen.getAllByRole("button", { name: "Close" })[0] ?? screen.getByRole("button", { name: "Close" }));
    expect(await screen.findByText("Discard changes?")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Discard" }));
    await waitFor(() => {
      expect(screen.queryByText("Pick a run or a rest day for each day.")).toBeNull();
    });
    expect(s.weekPuts).toEqual([]);
    expect(within(box()).getByText("Easy run · 5 km")).toBeTruthy();
  });

  it("a save that fails says so and keeps the page open with the change", async () => {
    const s = planServer({ week: todayRun(5000), failSave: true });
    const box = await openRunningBox(s);
    await fireEvent.press(within(box()).getByRole("button", { name: "Edit your own run plan" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Make every day a rest day" }));
    await fireEvent.press(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Couldn’t save your plan. Check your connection and try again.")).toBeTruthy();
    expect(screen.getByRole("button", { name: `${dayName(todayAt() + 1)}: Rest day. Change` })).toBeTruthy();
  });

  it("a run past the 10 % line is said beside it on the Dashboard and in the week, and kept as written", async () => {
    const s = planServer({ week: todayRun(12_000), capM: 8800 });
    const box = await openRunningBox(s);
    expect(within(box()).getByText(`${dayName(todayAt() + 1)}’s 12 km run is more than 10% longer than your longest run in the last 30 days. Build up slowly.`)).toBeTruthy();
    await fireEvent.press(within(box()).getByRole("button", { name: "Edit your own run plan" }));
    expect(await screen.findByText(OVER_CAP_SHORT)).toBeTruthy();
    expect(screen.getByRole("button", { name: `${dayName(todayAt() + 1)}: Easy run · 12 km. Change` })).toBeTruthy();
  });
});

describe("the distances offered", () => {
  it("every half kilometre and half mile, each a whole 100 m, from the kind's least to 60 km", () => {
    const km = distanceRows("easy", "metric");
    expect(km[0]).toBe(1000);
    expect(km.at(-1)).toBe(60_000);
    expect(km.every((m, i) => m % 100 === 0 && (i === 0 || m - (km[i - 1] ?? 0) === 500))).toBe(true);
    const mi = distanceRows("easy", "imperial");
    expect(mi.every((m) => m % 100 === 0 && m >= 1000 && m <= 60_000)).toBe(true);
    expect(mi.slice(0, 3)).toEqual([1700, 2500, 3300]);
    expect(distanceRows("steady", "metric")[0]).toBe(4000);
    expect(distanceRows("fast", "metric")[0]).toBe(5000);
  });
});
