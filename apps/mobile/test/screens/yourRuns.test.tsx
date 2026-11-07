import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { AppState } from "react-native";
import { encodePolyline, routeShape, type RunDetail } from "@app/shared";
import { App } from "../../src/App";
import { dayKey, monthWords } from "../../src/screens/running/RunCalendar";
import { resetMapSource } from "../../src/screens/running/mapSource";
import { phoneRunFiles, resetRecorder } from "../../src/screens/running/recorder";
import type { Ask, AskInit } from "../../src/session/calls";
import { RAVI, fakeServer, kept, memoryStore, tokens } from "../kit";

// Your runs (ROADMAP Stage 5 37c-i), through the whole app. The worst thing on the phone's side: a run
// deleted that the person did not choose, or deleted without being asked; and a run's change sent with
// what the person never changed. Then the Running page's box, the list by month and its next part, a
// run's own page, the small calendar, a run waiting on the phone, and the Dashboard opening a run.

const extra = { copyName: "Feature 2", apiUrl: "http://localhost:3000" };
const RUNS = "/v1/geo/runs";

let handlers: ((state: "active") => void)[] = [];

beforeEach(async () => {
  handlers = [];
  jest.spyOn(AppState, "addEventListener").mockImplementation((_type, handler) => {
    handlers.push(handler);
    return { remove: () => undefined };
  });
  for (const name of ["run-now.json", "run-now-0.json", "run-now-1.json", "run-settings.json", "run-map.json"]) phoneRunFiles.remove(name);
  resetRecorder();
  resetMapSource();
  await Promise.resolve();
});

/** A run going north from Guwahati, `km` long, `minutes` of moving time, `daysAgo` days before now. */
function makeRun(n: number, name: string, km: number, minutes: number, daysAgo: number): RunDetail {
  const at = new Date(Date.now() - daysAgo * 86_400_000);
  at.setHours(7, 12, 0, 0);
  const track: [number, number][] = Array.from({ length: 40 }, (_, i) => [26.1445 + (i * km * 1000) / 39 / 111_132, 91.7362 + (i % 2) * 0.0001]);
  const id = `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  return {
    id,
    startedAt: at.toISOString(),
    durationS: minutes * 60,
    distanceM: Math.round(km * 1000),
    routeName: null,
    kcalPoint: Math.round(km * 65),
    source: "mobile",
    name,
    day: dayKey(at),
    elapsedS: minutes * 60 + 90,
    climbM: 12,
    shape: routeShape(track, [0]),
    polyline: encodePolyline(track),
    trackStarts: [0],
    splitsKm: Array.from({ length: Math.floor(km) }, () => ({ m: 1000, s: Math.round((minutes * 60) / km) })),
    splitsMi: [],
    effort: 6,
    note: "Easy one",
    leftOutM: 0,
    leftOutS: 0,
  };
}

const summaryOf = (r: RunDetail) => ({
  id: r.id, startedAt: r.startedAt, durationS: r.durationS, distanceM: r.distanceM, routeName: r.routeName, kcalPoint: r.kcalPoint,
  source: r.source, name: r.name, day: r.day, elapsedS: r.elapsedS, climbM: r.climbM, shape: r.shape,
});

/** The person's runs on the server, newest first, as its routes answer them. */
function runsServer(runs: RunDetail[]) {
  const held = { runs: [...runs].sort((a, b) => b.startedAt.localeCompare(a.startedAt)) };
  const requests: { method: string; path: string; search: string; body: unknown }[] = [];
  // What the Dashboard's Recent Activity reads beside the runs: no workouts, no meals.
  const base = fakeServer({
    "/v1/auth/refresh": () => ({ status: 200, body: { tokens: tokens(2) } }),
    "/v1/workouts": () => ({ status: 200, body: { items: [], nextCursor: null, limitedToDays: null, hasAnyWorkouts: false } }),
    "/v1/nutrition/meals": () => ({ status: 200, body: { items: [], nextCursor: null } }),
  });
  const reply = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });
  const ask: Ask = async (url: string, init: AskInit) => {
    const u = new URL(url);
    const method = init.method ?? "GET";
    const body = init.body === undefined ? undefined : (JSON.parse(init.body) as unknown);
    requests.push({ method, path: u.pathname, search: u.search, body });
    if (u.pathname === RUNS && method === "GET") {
      const limit = Number(u.searchParams.get("limit") ?? "20");
      const upTo = u.searchParams.get("upTo");
      const cursor = u.searchParams.get("cursor");
      const from = held.runs.filter((r) => upTo === null || r.day <= upTo);
      const start = cursor === null ? 0 : from.findIndex((r) => r.id === cursor) + 1;
      const page = from.slice(start, start + limit);
      const months = [...new Set(page.map((r) => r.day.slice(0, 7)))].map((month) => {
        const all = held.runs.filter((r) => r.day.startsWith(month));
        return { month, runs: all.length, distanceM: all.reduce((s, r) => s + r.distanceM, 0) };
      });
      const next = start + limit < from.length ? (page.at(-1)?.id ?? null) : null;
      return reply(200, {
        items: page.map(summaryOf),
        nextCursor: next,
        months,
        total: { runs: held.runs.length, distanceM: held.runs.reduce((s, r) => s + r.distanceM, 0) },
      });
    }
    if (u.pathname === `${RUNS}/days`) {
      const month = u.searchParams.get("month") ?? "";
      const days = [...new Set(held.runs.filter((r) => r.day.startsWith(month)).map((r) => r.day))].sort().map((day) => {
        const on = held.runs.filter((r) => r.day === day);
        return { day, runs: on.length, distanceM: on.reduce((s, r) => s + r.distanceM, 0) };
      });
      const first = held.runs.map((r) => r.day).sort()[0] ?? null;
      return reply(200, { month, days, first });
    }
    const one = /^\/v1\/geo\/runs\/([0-9a-f-]{36})$/.exec(u.pathname);
    if (one !== null) {
      const at = held.runs.findIndex((r) => r.id === one[1]);
      const run = held.runs[at];
      if (run === undefined) return reply(404, { error: "not_found", message: "This run was deleted." });
      if (method === "GET") return reply(200, { run });
      if (method === "PATCH") {
        const change = body as Partial<RunDetail>;
        const next = { ...run, ...change };
        held.runs[at] = next;
        return reply(200, { run: next });
      }
      if (method === "DELETE") {
        held.runs.splice(at, 1);
        return { ok: true, status: 204, json: () => Promise.reject(new Error("no body")) };
      }
    }
    return base.ask(url, init);
  };
  return { ask, held, requests };
}

async function openRunning(s: ReturnType<typeof runsServer>) {
  await render(<App extra={extra} store={memoryStore(kept(1, RAVI))} ask={s.ask} />);
  await fireEvent.press(await screen.findByRole("tab", { name: "Workout" }));
  await fireEvent.press(await screen.findByRole("button", { name: "Running" }));
  expect(await screen.findByRole("button", { name: "Start run" })).toBeTruthy();
}

async function openList(s: ReturnType<typeof runsServer>) {
  await openRunning(s);
  await fireEvent.press(await screen.findByRole("button", { name: "See all your runs" }));
  // The page's own small calendar button: the list is open.
  expect(await screen.findByRole("button", { name: "Pick a day" }, { timeout: 4000 })).toBeTruthy();
}

/** The newest of several on screen: a page opened over another holds its own. */
function newest<T>(all: T[]): T {
  const one = all.at(-1);
  if (one === undefined) throw new Error("none on screen");
  return one;
}
/** A run's line, the newest on screen: the Running page's own last run stays under the list. */
const rowOf = async (name: string) => newest(await screen.findAllByRole("button", { name: new RegExp(`^${name}, `) }));

describe("the worst thing: a run deleted the person did not choose, or without being asked", () => {
  it("Delete run asks first, deletes that run alone, and the list no longer shows it", async () => {
    const s = runsServer([makeRun(1, "Morning Run", 9.59, 63, 1), makeRun(2, "Hill repeats", 5.2, 31, 2), makeRun(3, "Long run", 12.4, 70, 3)]);
    await openList(s);
    await fireEvent.press(await rowOf("Hill repeats"));
    expect(await screen.findByText("Moving time", {}, { timeout: 4000 })).toBeTruthy();
    await fireEvent.press(await screen.findByRole("button", { name: "Delete run" }));
    // Asked, and nothing sent yet.
    expect(await screen.findByText("Delete this run?")).toBeTruthy();
    expect(screen.getByText(/^Hill repeats, 5\.20 km on .*, will be deleted with its route\. You can't undo this\.$/)).toBeTruthy();
    expect(s.requests.filter((r) => r.method === "DELETE")).toEqual([]);
    // Keep run: still nothing deleted.
    await fireEvent.press(screen.getByRole("button", { name: "Keep run" }));
    expect(s.requests.filter((r) => r.method === "DELETE")).toEqual([]);
    await fireEvent.press(screen.getByRole("button", { name: "Delete run" }));
    const sheet = await screen.findByText("Delete this run?");
    expect(sheet).toBeTruthy();
    const listReads = () => s.requests.filter((r) => r.path === RUNS && r.method === "GET").length;
    const readsBefore = listReads();
    await fireEvent.press(newest(screen.getAllByRole("button", { name: "Delete run" })));
    await waitFor(() => {
      expect(s.requests.filter((r) => r.method === "DELETE").map((r) => r.path)).toEqual([`${RUNS}/00000000-0000-4000-8000-000000000002`]);
    });
    expect(await screen.findByText("Hill repeats was deleted.")).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /^Hill repeats, / })).toBeNull();
    });
    expect(await rowOf("Morning Run")).toBeTruthy();
    expect(await rowOf("Long run")).toBeTruthy();
    expect(s.held.runs.map((r) => r.name)).toEqual(["Morning Run", "Long run"]);
    // Taken out where it stood, never by reading the list again from its top (round one, L5); its total less it.
    expect(listReads()).toBe(readsBefore);
    // The header's total (and the month's too, where all three fell in one month).
    expect(screen.getAllByText("2 runs · 21.99 km").length).toBeGreaterThanOrEqual(1);
  });

  it("Save changes sends only what the person changed, and nothing at all until pressed", async () => {
    const s = runsServer([makeRun(1, "Morning Run", 9.59, 63, 1)]);
    await openList(s);
    await fireEvent.press(await rowOf("Morning Run"));
    await fireEvent.press(await screen.findByRole("button", { name: "8 of 10" }));
    expect(s.requests.filter((r) => r.method === "PATCH")).toEqual([]);
    await fireEvent.press(await screen.findByRole("button", { name: "Save changes" }));
    await waitFor(() => {
      expect(s.requests.filter((r) => r.method === "PATCH").map((r) => r.body)).toEqual([{ effort: 8 }]);
    });
    expect(await screen.findByText("Changes saved.")).toBeTruthy();
    expect(s.held.runs[0]).toMatchObject({ name: "Morning Run", effort: 8, note: "Easy one" });
  });
});

describe("Your runs", () => {
  it("the Running page's box shows the last run and opens it; See all lists every run under its whole month", async () => {
    const s = runsServer([makeRun(1, "Morning Run", 9.59, 63, 0), makeRun(2, "Old run", 6.96, 33, 45)]);
    await openRunning(s);
    const box = await screen.findByTestId("your-runs");
    expect(within(box).getByText("Morning Run")).toBeTruthy();
    expect(within(box).getByText("9.59 km")).toBeTruthy();
    await fireEvent.press(within(box).getByRole("button", { name: /^Morning Run, / }));
    // Its own page: the summary's numbers and boxes, as saved.
    expect(await screen.findByText("1:04:30", {}, { timeout: 4000 })).toBeTruthy();
    expect(screen.getByText("Moving time")).toBeTruthy();
    expect(screen.getByText("Total time")).toBeTruthy();
    expect(screen.getByText("12 m")).toBeTruthy();
    expect(screen.getByText("Higher is faster")).toBeTruthy();
    expect(screen.getByTestId("run-map")).toBeTruthy();
    expect(screen.getByDisplayValue("Easy one")).toBeTruthy();
    await fireEvent.press(newest(screen.getAllByRole("button", { name: "Close" })));

    await fireEvent.press(await screen.findByRole("button", { name: "See all your runs" }));
    expect(await screen.findByText("2 runs · 16.55 km", {}, { timeout: 4000 })).toBeTruthy();
    expect(await rowOf("Morning Run")).toBeTruthy();
    expect(await rowOf("Old run")).toBeTruthy();
    // Each month under its name, with its own runs and distance.
    expect(s.requests.some((r) => r.path === RUNS && r.search === "?limit=20")).toBe(true);
    expect(screen.getByText(monthWords(s.held.runs[0]?.day.slice(0, 7) ?? ""))).toBeTruthy();
    expect(screen.getByText(monthWords(s.held.runs[1]?.day.slice(0, 7) ?? ""))).toBeTruthy();
    expect(screen.getByText("1 run · 9.59 km")).toBeTruthy();
    expect(screen.getByText("1 run · 6.96 km")).toBeTruthy();
  });

  it("a long list reads its next part, and every run of it is there once", async () => {
    const s = runsServer(Array.from({ length: 25 }, (_, i) => makeRun(i + 1, `Run ${String(i + 1)}`, 5, 30, i)));
    await openList(s);
    expect(await rowOf("Run 1")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Run 21, / })).toBeNull();
    await fireEvent.press(await screen.findByRole("button", { name: "More runs" }));
    expect(await rowOf("Run 25")).toBeTruthy();
    const names = screen.getAllByRole("button", { name: /^Run \d+, / }).map((b) => String(b.props.accessibilityLabel).split(",")[0]);
    // Every run once in the list, and the last run once more in the Running page's box under it.
    expect(new Set(names).size).toBe(25);
    expect(names).toHaveLength(26);
    expect(screen.queryByRole("button", { name: "More runs" })).toBeNull();
  });

  it("the small calendar marks the days run, and a day picked opens the list there; Show newest goes back", async () => {
    const s = runsServer([makeRun(1, "Today run", 5, 30, 0), makeRun(2, "Earlier run", 6, 36, 40)]);
    await openList(s);
    await fireEvent.press(screen.getByRole("button", { name: "Pick a day" }));
    expect(await screen.findByText("Pick a day")).toBeTruthy();
    const today = dayKey(new Date());
    const marked = await screen.findByTestId(`ran-${today}`, {}, { timeout: 4000 });
    expect(marked.props.accessibilityLabel).toMatch(/, 1 run, 5\.00 km$/);
    await fireEvent.press(marked);
    await waitFor(() => {
      expect(s.requests.some((r) => r.path === RUNS && r.search === `?limit=20&upTo=${today}`)).toBe(true);
    });
    expect(await screen.findByText(/^Runs on .* and before$/)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Show newest" }));
    await waitFor(() => {
      expect(screen.queryByText(/^Runs on .* and before$/)).toBeNull();
    });
  });

  it("a run deleted from the Running page's box is said there", async () => {
    const s = runsServer([makeRun(1, "Morning Run", 9.59, 63, 0), makeRun(2, "Old run", 6.96, 33, 3)]);
    await openRunning(s);
    await fireEvent.press(await rowOf("Morning Run"));
    await fireEvent.press(await screen.findByRole("button", { name: "Delete run" }, { timeout: 4000 }));
    await fireEvent.press(newest(screen.getAllByRole("button", { name: "Delete run" })));
    expect(await screen.findByText("Morning Run was deleted.")).toBeTruthy();
    const box = await screen.findByTestId("your-runs");
    await waitFor(() => {
      expect(within(box).getByText("Old run")).toBeTruthy();
    });
    // Said once: opening the next run takes it away (round one's re-check, L7).
    await fireEvent.press(within(box).getByRole("button", { name: /^Old run, / }));
    expect(screen.queryByText("Morning Run was deleted.")).toBeNull();
  });

  it("with no runs yet, the Running page holds no empty box", async () => {
    const s = runsServer([]);
    await openRunning(s);
    // No box on the Running page with nothing in it.
    expect(screen.queryByTestId("your-runs")).toBeNull();
  });

  it("a renamed run reads its new name on the Running page and the Dashboard, and leaving unsaved asks first", async () => {
    const s = runsServer([makeRun(1, "Morning Run", 9.59, 63, 0)]);
    await openRunning(s);
    await fireEvent.press(await rowOf("Morning Run"));
    await fireEvent.press(await screen.findByRole("button", { name: "Rename Morning Run" }));
    await fireEvent.changeText(screen.getByLabelText("Run name"), "Canal loop");
    // Leaving with it unsaved asks; Leave without saving changes nothing.
    await fireEvent.press(newest(screen.getAllByRole("button", { name: "Close" })));
    expect(await screen.findByText("Save your changes?")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => {
      expect(s.requests.filter((r) => r.method === "PATCH").map((r) => r.body)).toEqual([{ name: "Canal loop" }]);
    });
    const box = await screen.findByTestId("your-runs");
    await waitFor(() => {
      expect(within(box).getByText("Canal loop")).toBeTruthy();
    });
    await act(async () => {
      await fireEvent.press(screen.getByRole("tab", { name: "Dashboard" }));
    });
    const recent = await screen.findByTestId("recent-activity", {}, { timeout: 4000 });
    await fireEvent.press(await within(recent).findByText("Canal loop", {}, { timeout: 4000 }));
    expect(await screen.findByText("Moving time", {}, { timeout: 4000 })).toBeTruthy();
  });
});
