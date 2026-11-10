import { fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { runPlanAnswersSchema, runPlanOf, type RunDay, type RunPlanAnswers, type RunPlanResponse } from "@app/shared";
import { App } from "../../src/App";
import { phoneToday } from "../../src/screens/running/RunPlanBox";
import { RAVI, fakeServer, kept, memoryStore, profile, tokens, type Reply } from "../kit";

// Your run plan on the Running page (ROADMAP Stage 5 37d-i), through the whole app. The worst thing
// first: somebody in Safe mode handed a run. Then making a plan question by question, Not for me, a
// runner's plan on See plan, and Change my answers.

const extra = { copyName: "Feature 2", apiUrl: "http://localhost:3000" };
const PLAN = "/v1/geo/run-plan";
const HEALTH = "/v1/users/me/health-screening";

const RUNNER: RunPlanAnswers = { doesRun: "yes", jog: "30plus", days: [1, 3, 5, 7], goal: "10k", weeklyM: 20_000, longestM: 8_000, race: { distanceM: 5000, timeS: 1500 } };

/** The server: the answers kept, the plan worked out by the server's own rules from today. */
function planServer(start: { answers: RunPlanAnswers | null; safe?: boolean; runs?: RunDay[] }) {
  const state = { answers: start.answers, safe: start.safe === true };
  const puts: unknown[] = [];
  const healthPuts: unknown[] = [];
  const reply = (): RunPlanResponse => {
    const today = phoneToday();
    if (state.safe) return { answers: state.answers, plan: { kind: "none", why: "safe_mode" }, today };
    if (state.answers === null) return { answers: null, plan: null, today };
    return { answers: state.answers, plan: runPlanOf({ answers: state.answers, startDay: today, raceDay: today, today, safeMode: false, runs: start.runs ?? [] }), today };
  };
  const server = fakeServer({
    "/v1/auth/refresh": () => ({ status: 200, body: { tokens: tokens(2) } }),
    "/v1/users/me": () => ({ status: 200, body: profile(true, RAVI) }),
    [PLAN]: (body): Reply => {
      if (body !== undefined) {
        puts.push(body);
        state.answers = runPlanAnswersSchema.parse(body);
      }
      return { status: 200, body: reply() };
    },
    [HEALTH]: (body): Reply => {
      if (body !== undefined) {
        healthPuts.push(body);
        state.safe = false;
      }
      return {
        status: 200,
        body: { healthScreening: { answered: true, hasCondition: true, checkFirst: state.safe ? "not_yet" : "cleared", safeMode: state.safe, noCalorieCut: true, updatedAt: "2026-11-01T00:00:00.000Z" } },
      };
    },
  });
  return { ask: server.ask, asked: server.asked, puts, healthPuts, state };
}

async function openRunning(s: ReturnType<typeof planServer>) {
  await render(<App extra={extra} store={memoryStore(kept(1, RAVI))} ask={s.ask} />);
  await fireEvent.press(await screen.findByRole("tab", { name: "Workout" }));
  await fireEvent.press(await screen.findByRole("button", { name: "Running" }));
  return screen.findByTestId("run-plan-box");
}

describe("the worst thing: a run handed to somebody in Safe mode", () => {
  it("Safe mode shows no run, says why, and only a professional's clearance brings the plan", async () => {
    const s = planServer({ answers: RUNNER, safe: true });
    const box = await openRunning(s);
    expect(within(box).getByText("No training plan until a professional has cleared you to exercise. You can still record a run.")).toBeTruthy();
    expect(within(box).queryByText(/Easy run|Long run|Tempo run|Interval run|Run 1/)).toBeNull();
    expect(within(box).queryByRole("button", { name: "Create plan" })).toBeNull();
    // Start still records a run.
    expect(screen.getByRole("button", { name: "Start run" })).toBeTruthy();

    await fireEvent.press(within(box).getByRole("button", { name: "Change your health answer" }));
    await fireEvent.press(await screen.findByText("A professional has cleared me"));
    await waitFor(() => {
      expect(s.healthPuts).toEqual([{ hasCondition: true, checkFirst: "cleared" }]);
    });
    expect(await screen.findByRole("button", { name: "View your training plan" })).toBeTruthy();
  });
});

describe("making a plan", () => {
  it("no answers yet: Make my plan asks one question a page and the plan shows as footprints", async () => {
    const s = planServer({ answers: null });
    const box = await openRunning(s);
    expect(within(box).getByText("A weekly plan built from your current running.")).toBeTruthy();
    await fireEvent.press(within(box).getByRole("button", { name: "Create plan" }));

    await fireEvent.press(await screen.findByText("New to running"));
    await fireEvent.press(await screen.findByText("I can’t run yet"));
    expect(await screen.findByText("Pick at least two. Couch to 5K uses three days a week, with a rest day between runs.")).toBeTruthy();
    // The page's own button, over the box's under it.
    const pageMake = () => screen.getAllByRole("button", { name: "Create plan" }).at(-1) ?? screen.getByRole("button", { name: "none" });
    const make = pageMake();
    // Not ready until two days and a goal are picked.
    await fireEvent.press(make);
    expect(s.puts).toEqual([]);
    for (const day of ["Mon", "Wed", "Fri"]) await fireEvent.press(screen.getByText(day));
    await fireEvent.press(screen.getByText("5K"));
    await fireEvent.press(pageMake());
    await waitFor(() => {
      expect(s.puts).toEqual([{ doesRun: "start", jog: "none", days: [1, 3, 5], goal: "5k", weeklyM: null, longestM: null, race: null }]);
    });

    const shown = await screen.findByRole("button", { name: "View your training plan" });
    expect(shown).toBeTruthy();
    expect(screen.getByText("Couch to 5K · Week 1 of 9")).toBeTruthy();
    // Seven footprints, one a day.
    expect(screen.getAllByLabelText(/^[MTWFS]: (run done|run planned|rest)/)).toHaveLength(7);
  });

  it("Not for me makes no plan and says a plan can be made any time", async () => {
    const s = planServer({ answers: null });
    const box = await openRunning(s);
    await fireEvent.press(within(box).getByRole("button", { name: "Create plan" }));
    await fireEvent.press(await screen.findByText("Not interested"));
    await waitFor(() => {
      expect(s.puts).toEqual([{ doesRun: "no", jog: null, days: [], goal: null, weeklyM: null, longestM: null, race: null }]);
    });
    expect(await screen.findByText("No training plan for now. Create one any time.")).toBeTruthy();
  });
});

describe("a run that felt very hard", () => {
  it("Couch to 5K says the next run is the same one again, on Running and on the plan", async () => {
    const beginner: RunPlanAnswers = { doesRun: "start", jog: "none", days: [1, 2, 3, 4, 5, 6, 7], goal: "5k", weeklyM: null, longestM: null, race: null };
    const s = planServer({ answers: beginner, runs: [{ day: phoneToday(), distanceM: 2000, longestM: 2000, movingS: 1000, effort: 9 }] });
    const box = await openRunning(s);
    expect(await within(box).findByText("Your last run felt very hard, so your next run is the same one again.")).toBeTruthy();
  });
});

describe("a runner's plan", () => {
  it("See plan shows each run with its pace, the weeks ahead and where the paces come from; Change my answers opens the questions already answered", async () => {
    const s = planServer({ answers: RUNNER });
    await openRunning(s);
    expect(await screen.findByText(/^10K plan · Week 1 · /)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "View your training plan" }));
    expect(await screen.findByText("Upcoming weeks")).toBeTruthy();
    expect(screen.getByText("Your paces")).toBeTruthy();
    expect(screen.getByText("From your race time, by Jack Daniels’ formula.")).toBeTruthy();
    expect(screen.getAllByText(/^Long run · /).length).toBeGreaterThan(0);

    await fireEvent.press(screen.getByRole("button", { name: "Edit your training plan" }));
    expect(await screen.findByText("What’s your running experience?")).toBeTruthy();
    await fireEvent.press(screen.getByText("I already run"));
    await fireEvent.press(await screen.findByText("30 minutes or more"));
    await fireEvent.press(await screen.findByRole("button", { name: "Next" }));
    expect(await screen.findByText("Your current running")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Create plan" }));
    await waitFor(() => {
      expect(s.puts).toEqual([RUNNER]);
    });
  });
});
