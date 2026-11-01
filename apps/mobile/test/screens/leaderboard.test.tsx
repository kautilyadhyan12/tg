import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { AppState } from "react-native";
import { leaderboardCountedResponseSchema, leaderboardResponseSchema, type LeaderboardBoard, type LeaderboardPeriod } from "@app/shared";
import { App } from "../../src/App";
import type { Ask } from "../../src/session/calls";
import { fakeServer as kitServer, kept, lost, memoryStore, never, profile, refusal, tokens, type Reply, type Route } from "../kit";

const extra = { copyName: "Feature 1", apiUrl: "http://localhost:3000" };
const noWait = () => Promise.resolve();
const ok = (body: unknown) => (): Reply => ({ status: 200, body });

/** The kit's server, with routes that also name their query: a board's own board and period. */
function fakeServer(routes: Record<string, Route>) {
  const server = kitServer(routes);
  const ask: Ask = async (url, init) => {
    const { pathname, search } = new URL(url);
    const exact = search === "" ? undefined : routes[pathname + search];
    if (search !== "" && exact === undefined) return { ok: false, status: 404, json: () => Promise.resolve(refusal(404, "not_found", "Not found").body) };
    if (exact === undefined) return server.ask(url, init);
    server.asked.push({ method: init.method ?? "GET", path: pathname + search, body: undefined, headers: init.headers ?? {} });
    const reply = await exact(undefined);
    return { ok: reply.status >= 200 && reply.status < 300, status: reply.status, json: () => Promise.resolve(reply.body) };
  };
  return { ...server, ask };
}

type Place = { id: string; name: string };
const IRON: Place = { id: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f", name: "Iron House" };
const LOTUS: Place = { id: "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d", name: "Lotus Yoga" };
const org = (gym: Place) => ({
  ...gym,
  city: null,
  orgType: "gym",
  clockFormat: "12h",
  slug: gym.name.toLowerCase().replace(" ", "-"),
  timezone: "Asia/Kolkata",
  locale: "en",
  currencyDisplay: "INR",
  status: "active",
  staffRole: null,
  isMember: true,
  joinedAt: "2026-10-01T00:00:00.000Z",
});
const mine = (...gyms: Place[]) => ok({ orgs: gyms.map(org), formerOrgs: [] });

const PRIYA = "11111111-1111-4111-8111-111111111111";
const ME = "22222222-2222-4222-8222-222222222222";
const WEEK = ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"];
const FLAMES = ["yes", "no", "yes", "no", "no", "no", "open"];

type Over = Record<string, unknown>;
const row = (userId: string, name: string, place: number, value: number, over: Over = {}) => ({ userId, name, initials: name.charAt(0), place, value, circles: FLAMES, isMe: false, ...over });
const me = (over: Over = {}) => ({ value: 2, place: 2, hidden: null, toNextPlace: 3, nextPlace: 1, circles: FLAMES, ...over });
const boardOf = (place: Place, board: LeaderboardBoard, over: Over = {}) =>
  leaderboardResponseSchema.parse({
    gymId: place.id,
    gymName: place.name,
    timezone: "Asia/Kolkata",
    board,
    period: board === "streak" ? null : "this_week",
    from: board === "streak" ? null : WEEK[0],
    to: WEEK[6],
    circleDays: WEEK,
    status: "shown",
    boardsOff: [],
    ranked: 3,
    rows: [row(PRIYA, "Priya S.", 1, 5), row(ME, "Ravi K.", 2, 2, { isMe: true })],
    me: me(),
    asOf: "2026-11-01T06:00:00.000Z",
    ...over,
  });
const boardPath = (place: Place, board: LeaderboardBoard, period: LeaderboardPeriod = "this_week") => `/v1/orgs/${place.id}/leaderboard?board=${board}&period=${period}`;
const HIDE_ME = "/v1/users/me/leaderboard";
const hideMe = (hidden: boolean, under18 = false) => ({ hidden, hideMe: hidden, under18 });

async function openBoard(ask: Ask, place: Place, justBefore: () => void = () => undefined) {
  await render(<App extra={extra} ask={ask} store={memoryStore(kept(1))} wait={noWait} />);
  const tab = (await screen.findAllByRole("tab"))[3];
  if (tab === undefined) throw new Error("no fourth tab");
  await fireEvent.press(tab);
  const link = await screen.findByLabelText(`Leaderboard at ${place.name}`);
  justBefore();
  await fireEvent.press(link);
}
const page = () => within(screen.getByTestId("leaderboard-page"));
const hideSwitch = async () => page().findByLabelText("Hide me on leaderboards");
const isOn = (one: { props: { value?: unknown } }) => one.props.value === true;
const pressSwitch = async (to: boolean) => {
  const one = await hideSwitch();
  await fireEvent(one, "valueChange", to);
};
const routes = (over: Record<string, Route> = {}): Record<string, Route> => ({
  "/v1/auth/refresh": ok({ tokens: tokens(2) }),
  "/v1/orgs/mine": mine(IRON),
  [boardPath(IRON, "gym_days")]: ok(boardOf(IRON, "gym_days")),
  [HIDE_ME]: ok(hideMe(false)),
  ...over,
});
function listenForComeBack(): () => Promise<void> {
  const listeners: ((state: string) => void)[] = [];
  jest.spyOn(AppState, "addEventListener").mockImplementation((_type, handler) => {
    listeners.push(handler as (state: string) => void);
    return { remove: () => undefined };
  });
  return async () => {
    await act(() => {
      for (const one of listeners) one("active");
    });
  };
}
afterEach(() => {
  jest.restoreAllMocks();
});
const settle = (ms = 30) => act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));
/** A reply held back until the test lets it go. */
function later() {
  let letGo: (reply: Reply) => void = () => undefined;
  const reply = new Promise<Reply>((resolve) => {
    letGo = resolve;
  });
  return {
    reply,
    answer: (body: unknown) =>
      act(async () => {
        letGo({ status: 200, body });
        await new Promise((resolve) => setTimeout(resolve, 30));
      }),
  };
}
const isSave = (body: unknown) => body !== undefined && body !== null;

describe("the worst thing: Hide me says only what the server holds", () => {
  it("a press with no answer leaves the switch off and says so; the server's next answer is what it shows", async () => {
    const server = fakeServer(
      routes({
        [HIDE_ME]: (body) => {
          if (body === undefined || body === null) return { status: 200, body: hideMe(false) };
          return lost();
        },
      }),
    );
    await openBoard(server.ask, IRON);
    expect(isOn(await hideSwitch())).toBe(false);
    await pressSwitch(true);
    expect(await page().findByText("Can’t connect. Check your internet and try again.")).toBeTruthy();
    expect(isOn(await hideSwitch())).toBe(false);
  });

  it("while the save is on its way the switch still shows what the server last said, and cannot be pressed again", async () => {
    const server = fakeServer(routes({ [HIDE_ME]: (body) => (body === undefined || body === null ? { status: 200, body: hideMe(false) } : never()) }));
    await openBoard(server.ask, IRON);
    await hideSwitch();
    await pressSwitch(true);
    const one = await hideSwitch();
    expect(isOn(one)).toBe(false);
    expect(one.props.disabled).toBe(true);
  });

  it("the save that reached the server though its answer was lost: the switch reads it back as on", async () => {
    let held = false;
    let saves = 0;
    const server = fakeServer(
      routes({
        [HIDE_ME]: (body) => {
          if (body === undefined || body === null) return { status: 200, body: hideMe(held) };
          saves += 1;
          held = true;
          return lost();
        },
      }),
    );
    await openBoard(server.ask, IRON);
    await hideSwitch();
    await pressSwitch(true);
    await waitFor(async () => {
      expect(isOn(await hideSwitch())).toBe(true);
    });
    expect(saves).toBe(1);
  });

  it("a refusal says the server's words and the switch stays as the server has it", async () => {
    const server = fakeServer(
      routes({
        [HIDE_ME]: (body) => (body === undefined || body === null ? { status: 200, body: hideMe(false) } : refusal(429, "too_many", "Too many changes. Try again later.")),
      }),
    );
    await openBoard(server.ask, IRON);
    await hideSwitch();
    await pressSwitch(true);
    expect(await page().findByText("Too many changes. Try again later.")).toBeTruthy();
    expect(isOn(await hideSwitch())).toBe(false);
  });

  it("not read, there is no switch to read wrongly: it says so, and Try again draws it", async () => {
    let up = false;
    const server = fakeServer(routes({ [HIDE_ME]: () => (up ? { status: 200, body: hideMe(true) } : lost()) }));
    await openBoard(server.ask, IRON);
    expect(await page().findByText("Couldn’t load Hide me.")).toBeTruthy();
    expect(page().queryByLabelText("Hide me on leaderboards")).toBeNull();
    up = true;
    await fireEvent.press(page().getByLabelText("Try Hide me again"));
    expect(isOn(await hideSwitch())).toBe(true);
  });

  it("switched on with the server's yes, the board is read again and says they are hidden", async () => {
    let hidden = false;
    const server = fakeServer(
      routes({
        [boardPath(IRON, "gym_days")]: () => ({
          status: 200,
          body: boardOf(IRON, "gym_days", hidden ? { rows: [row(PRIYA, "Priya S.", 1, 5)], ranked: 2, me: me({ hidden: "hide_me" }) } : {}),
        }),
        [HIDE_ME]: (body) => {
          if (body === undefined || body === null) return { status: 200, body: hideMe(hidden) };
          hidden = true;
          return { status: 200, body: hideMe(true) };
        },
      }),
    );
    await openBoard(server.ask, IRON);
    expect(await page().findByText("Ravi K.")).toBeTruthy();
    await hideSwitch();
    await pressSwitch(true);
    expect(await page().findByText("Hide me is on. Only you see this row.")).toBeTruthy();
    expect(page().queryByText("Ravi K.")).toBeNull();
    expect(isOn(await hideSwitch())).toBe(true);
  });

  it("an under-18 is told why they are hidden, and switching off is sent to the server as their choice", async () => {
    const sent: unknown[] = [];
    const server = fakeServer(
      routes({
        [HIDE_ME]: (body) => {
          if (body === undefined || body === null) return { status: 200, body: hideMe(true, true) };
          sent.push(body);
          return { status: 200, body: hideMe(false, true) };
        },
      }),
    );
    await openBoard(server.ask, IRON);
    expect(await page().findByText("You’re under 18, so you’re hidden until you switch this off.")).toBeTruthy();
    await pressSwitch(false);
    await waitFor(() => {
      expect(sent).toEqual([{ hidden: false }]);
    });
  });
});

describe("the worst thing, with the answers in the worst order", () => {
  it("a read begun during the save never overwrites the save's answer", async () => {
    const comeBack = listenForComeBack();
    const save = later();
    const slowRead = later();
    let reads = 0;
    const server = fakeServer(
      routes({
        [HIDE_ME]: (body) => {
          if (isSave(body)) return save.reply;
          reads += 1;
          return reads === 1 ? { status: 200, body: hideMe(true) } : slowRead.reply;
        },
      }),
    );
    await openBoard(server.ask, IRON);
    expect(isOn(await hideSwitch())).toBe(true);
    await pressSwitch(false);
    await comeBack();
    await save.answer(hideMe(false));
    expect(isOn(await hideSwitch())).toBe(false);
    await slowRead.answer(hideMe(true));
    expect(isOn(await hideSwitch())).toBe(false);
  });

  it("a tab pressed while Hide me saves keeps its own rows when the save answers", async () => {
    const save = later();
    const server = fakeServer(
      routes({
        [boardPath(IRON, "streak")]: ok(boardOf(IRON, "streak", { rows: [row(PRIYA, "Streak S.", 1, 4)] })),
        [HIDE_ME]: (body) => (isSave(body) ? save.reply : { status: 200, body: hideMe(false) }),
      }),
    );
    await openBoard(server.ask, IRON);
    expect(await page().findByText("Priya S.")).toBeTruthy();
    await hideSwitch();
    await pressSwitch(true);
    await fireEvent.press(page().getByLabelText("Streak"));
    expect(await page().findByText("Streak S.")).toBeTruthy();
    await save.answer(hideMe(true));
    expect(page().getByLabelText("Streak").props.accessibilityState).toMatchObject({ selected: true });
    expect(page().getByText("Streak S.")).toBeTruthy();
    expect(page().queryByText("Priya S.")).toBeNull();
  });
});

describe("one gym's board is its own, and the answer on screen is the tab on screen", () => {
  it("says when it was read, on the gym's own clock", async () => {
    const server = fakeServer(routes());
    await openBoard(server.ask, IRON);
    expect(await page().findByText(/Updated 11:30 AM/)).toBeTruthy();
  });

  it("a board the gym switched off stays gone while another tab loads", async () => {
    const off = { boardsOff: ["workout_days"] };
    const streak = later();
    const server = fakeServer(
      routes({
        [boardPath(IRON, "gym_days")]: ok(boardOf(IRON, "gym_days", off)),
        [boardPath(IRON, "streak")]: () => streak.reply,
      }),
    );
    await openBoard(server.ask, IRON);
    expect(await page().findByText("Priya S.")).toBeTruthy();
    expect(page().queryByLabelText("Workout days")).toBeNull();
    await fireEvent.press(page().getByLabelText("Streak"));
    await settle();
    expect(page().queryByLabelText("Workout days")).toBeNull();
    await streak.answer(boardOf(IRON, "streak", off));
  });

  it("scrolled, Back has a bar of its own, so it never sits on the rows", async () => {
    const server = fakeServer(routes());
    await openBoard(server.ask, IRON);
    const list = await page().findByTestId("leaderboard-list");
    expect(page().queryByTestId("leaderboard-bar")).toBeNull();
    const scrollTo = (y: number) =>
      fireEvent.scroll(list, { nativeEvent: { contentOffset: { x: 0, y }, contentSize: { width: 400, height: 3000 }, layoutMeasurement: { width: 400, height: 800 } } });
    await scrollTo(2000);
    expect(page().getByTestId("leaderboard-bar")).toBeTruthy();
    await scrollTo(0);
    expect(page().queryByTestId("leaderboard-bar")).toBeNull();
  });

  it("another gym's answer is never drawn under this one", async () => {
    const server = fakeServer(routes({ [boardPath(IRON, "gym_days")]: ok(boardOf(LOTUS, "gym_days", { rows: [row(PRIYA, "Stranger T.", 1, 9)] })) }));
    await openBoard(server.ask, IRON);
    expect(await page().findByText("Couldn’t load the leaderboard.")).toBeTruthy();
    expect(page().queryByText("Stranger T.")).toBeNull();
  });

  it("a slow answer to an earlier tab is dropped when a later tab has answered", async () => {
    let letVisitsGo: (reply: Reply) => void = () => undefined;
    const server = fakeServer(
      routes({
        [boardPath(IRON, "gym_days")]: () =>
          new Promise<Reply>((resolve) => {
            letVisitsGo = resolve;
          }),
        [boardPath(IRON, "streak")]: ok(boardOf(IRON, "streak", { rows: [row(PRIYA, "Streak S.", 1, 4)] })),
      }),
    );
    await openBoard(server.ask, IRON);
    await fireEvent.press(await page().findByLabelText("Streak"));
    expect(await page().findByText("Streak S.")).toBeTruthy();
    await act(async () => {
      letVisitsGo({ status: 200, body: boardOf(IRON, "gym_days", { rows: [row(PRIYA, "Visits V.", 1, 1)] }) });
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(page().getByText("Streak S.")).toBeTruthy();
    expect(page().queryByText("Visits V.")).toBeNull();
  });

  it("no answer on opening says so with Try again; a read made by itself keeps the board", async () => {
    let up = false;
    const comeBack = listenForComeBack();
    const server = fakeServer(routes({ [boardPath(IRON, "gym_days")]: () => (up ? { status: 200, body: boardOf(IRON, "gym_days") } : lost()) }));
    await openBoard(server.ask, IRON);
    expect(await page().findByText("Couldn’t load the leaderboard.")).toBeTruthy();
    up = true;
    await fireEvent.press(page().getByLabelText("Try again"));
    expect(await page().findByText("Priya S.")).toBeTruthy();
    up = false;
    await comeBack();
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 20)));
    expect(page().getByText("Priya S.")).toBeTruthy();
  });

  it("the app coming back reads the board again, and the page sets no timer of its own", async () => {
    let moved = false;
    const comeBack = listenForComeBack();
    const timers = jest.spyOn(global, "setInterval");
    const timersOnOpening = () => {
      timers.mockClear();
    };
    const server = fakeServer(
      routes({
        [boardPath(IRON, "gym_days")]: () => ({ status: 200, body: boardOf(IRON, "gym_days", moved ? { rows: [row(PRIYA, "Later L.", 1, 6)] } : {}) }),
      }),
    );
    await openBoard(server.ask, IRON, timersOnOpening);
    expect(await page().findByText("Priya S.")).toBeTruthy();
    // The test library waits on short timers of its own; a page that read by itself would set a long one.
    expect(timers.mock.calls.filter(([, ms]) => (ms ?? 0) >= 1000)).toEqual([]);
    moved = true;
    await comeBack();
    expect(await page().findByText("Later L.")).toBeTruthy();
  });
});

describe("every reason there is no board", () => {
  const says: [string, Over, LeaderboardBoard, string][] = [
    ["too few on Visits", { status: "too_few", rows: [], ranked: 1 }, "gym_days", "The board shows once 3 people have a visit in this period."],
    ["paused", { status: "paused", rows: [], ranked: 0 }, "gym_days", "The leaderboard isn’t available at Iron House right now."],
    ["all switched off", { status: "switched_off", rows: [], ranked: 0, boardsOff: ["gym_days", "workout_days", "streak"] }, "gym_days", "Iron House has switched its leaderboard off."],
  ];
  it.each(says)("%s", async (_name, over, board, words) => {
    const server = fakeServer(routes({ [boardPath(IRON, board)]: ok(boardOf(IRON, board, over)) }));
    await openBoard(server.ask, IRON);
    expect(await page().findByText(words)).toBeTruthy();
    expect(page().queryByText("Priya S.")).toBeNull();
  });

  it("a board that is not showing has no dates to read, and one the gym switched off has nothing to explain", async () => {
    const server = fakeServer(routes({ [boardPath(IRON, "gym_days")]: ok(boardOf(IRON, "gym_days", { status: "switched_off", rows: [], ranked: 0, boardsOff: ["gym_days", "workout_days", "streak"] })) }));
    await openBoard(server.ask, IRON);
    expect(await page().findByText("Iron House has switched its leaderboard off.")).toBeTruthy();
    expect(page().queryByText(/Updated/)).toBeNull();
    expect(page().queryByLabelText("What this board counts")).toBeNull();
    expect(page().queryByLabelText(/^Period/)).toBeNull();
    expect(isOn(await hideSwitch())).toBe(false);
  });

  it("a gym that checks nobody in opens on Workout days; Visits pressed then stays and says why", async () => {
    const server = fakeServer(
      routes({
        [boardPath(IRON, "gym_days")]: ok(boardOf(IRON, "gym_days", { status: "no_checkins", rows: [], ranked: 0 })),
        [boardPath(IRON, "workout_days")]: ok(boardOf(IRON, "workout_days", { rows: [row(PRIYA, "Work W.", 1, 3)] })),
      }),
    );
    await openBoard(server.ask, IRON);
    expect(await page().findByText("Work W.")).toBeTruthy();
    await fireEvent.press(page().getByLabelText("Visits"));
    expect(await page().findByText("Iron House hasn’t checked anyone in for 30 days, so Visits and Streak aren’t showing.")).toBeTruthy();
  });

  it("a board the gym switched off has no tab, and the first still on opens", async () => {
    const off = { boardsOff: ["gym_days"] };
    const server = fakeServer(
      routes({
        [boardPath(IRON, "gym_days")]: ok(boardOf(IRON, "gym_days", { status: "switched_off", rows: [], ranked: 0, ...off })),
        [boardPath(IRON, "workout_days")]: ok(boardOf(IRON, "workout_days", { rows: [row(PRIYA, "Work W.", 1, 3)], ...off })),
      }),
    );
    await openBoard(server.ask, IRON);
    expect(await page().findByText("Work W.")).toBeTruthy();
    expect(page().queryByLabelText("Visits")).toBeNull();
  });
});

describe("the person's own row", () => {
  it("carries their own flames, which are all a hidden person has", async () => {
    const server = fakeServer(routes({ [boardPath(IRON, "gym_days")]: ok(boardOf(IRON, "gym_days", { rows: [row(PRIYA, "Priya S.", 1, 5)], me: me({ hidden: "hide_me" }) })) }));
    await openBoard(server.ask, IRON);
    expect(await page().findByText("Hide me is on. Only you see this row.")).toBeTruthy();
    expect(page().getAllByRole("image", { name: /26 Oct/ })).toHaveLength(2);
  });

  it("What counted says the count beside each day, and a workout that did not count keeps its time", async () => {
    const counted = leaderboardCountedResponseSchema.parse({
      gymName: IRON.name,
      timezone: "Asia/Kolkata",
      board: "workout_days",
      period: "this_week",
      from: WEEK[0],
      to: WEEK[6],
      value: 1,
      days: [],
      notCounted: [],
      workoutDays: [
        {
          day: "2026-10-26",
          workouts: [
            { at: "2026-10-26T04:30:00.000Z", countedBy: "camera" },
            { at: "2026-10-26T12:30:00.000Z", countedBy: "you" },
          ],
        },
      ],
      workoutsNotCounted: [{ day: "2026-10-27", at: "2026-10-27T05:30:00.000Z", why: "no_sets", daysLate: null }],
      weeks: [],
    });
    const server = fakeServer(
      routes({
        [boardPath(IRON, "workout_days")]: ok(boardOf(IRON, "workout_days")),
        [`/v1/orgs/${IRON.id}/leaderboard/mine?board=workout_days&period=this_week`]: ok(counted),
      }),
    );
    await openBoard(server.ask, IRON);
    await fireEvent.press(await page().findByLabelText("Workout days"));
    await fireEvent.press(await page().findByLabelText("You: 2 workout days. See what counted."));
    expect(await screen.findByText(/26 Oct · 2 workouts, 1 day/)).toBeTruthy();
    expect(screen.getByText(/27 Oct · 11:00 AM · No reps or holds saved/)).toBeTruthy();
  });

  it("a name the board still will not show keeps the box open and says what to type", async () => {
    const server = fakeServer(
      routes({
        [boardPath(IRON, "gym_days")]: ok(boardOf(IRON, "gym_days", { rows: [row(PRIYA, "Priya S.", 1, 5)], me: me({ hidden: "no_name" }) })),
        "/v1/users/me": () => ({ status: 200, body: profile(true) }),
      }),
    );
    await openBoard(server.ask, IRON);
    await fireEvent.press(await page().findByLabelText("Add your name"));
    await fireEvent.changeText(await screen.findByLabelText("Your full name"), "ravi");
    await fireEvent.press(screen.getByLabelText("Save"));
    expect(await screen.findByText("Add your first and last name.")).toBeTruthy();
    expect(screen.getByLabelText("Your full name")).toBeTruthy();
  });

  it("says the next place, and opens What counted from the server's answer", async () => {
    const counted = leaderboardCountedResponseSchema.parse({
      gymName: IRON.name,
      timezone: "Asia/Kolkata",
      board: "gym_days",
      period: "this_week",
      from: WEEK[0],
      to: WEEK[6],
      value: 1,
      days: [{ day: "2026-10-26", visits: [{ at: "2026-10-26T04:30:00.000Z", how: "desk", by: "Front desk", addedOn: null }] }],
      notCounted: [{ day: "2026-10-27", at: "2026-10-27T04:30:00.000Z", why: "removed", by: "Sam", removedOn: "2026-10-28" }],
      workoutDays: [],
      workoutsNotCounted: [],
      weeks: [],
    });
    const server = fakeServer(routes({ [`/v1/orgs/${IRON.id}/leaderboard/mine?board=gym_days&period=this_week`]: ok(counted) }));
    await openBoard(server.ask, IRON);
    expect(await page().findByText("3 more visits to reach 1st")).toBeTruthy();
    await fireEvent.press(page().getByLabelText("You: 2 visits. See what counted."));
    expect(await screen.findByText("10:00 AM · scanned at Front desk")).toBeTruthy();
    expect(screen.getByText(/Visit removed by Sam \(staff\) on/)).toBeTruthy();
  });

  it("no name: it asks there, saves it, and reads the board again", async () => {
    let named = false;
    const sent: unknown[] = [];
    const server = fakeServer(
      routes({
        [boardPath(IRON, "gym_days")]: () => ({ status: 200, body: boardOf(IRON, "gym_days", named ? {} : { rows: [row(PRIYA, "Priya S.", 1, 5)], me: me({ hidden: "no_name" }) }) }),
        "/v1/users/me": (body) => {
          if (body === undefined) return { status: 200, body: profile(true) };
          sent.push(body);
          named = true;
          return { status: 200, body: profile(true) };
        },
      }),
    );
    await openBoard(server.ask, IRON);
    expect(await page().findByText("Add your full name to be on the board.")).toBeTruthy();
    await fireEvent.press(page().getByLabelText("Add your name"));
    await fireEvent.changeText(await screen.findByLabelText("Your full name"), "  Ravi Kumar ");
    await fireEvent.press(screen.getByLabelText("Save"));
    expect(await page().findByText("Ravi K.")).toBeTruthy();
    expect(sent).toEqual([{ displayName: "Ravi Kumar" }]);
  });
});

describe("Your Rank on the Dashboard", () => {
  const openDash = async (over: Record<string, Route>) => {
    const server = fakeServer(routes(over));
    await render(<App extra={extra} ask={server.ask} store={memoryStore(kept(1))} wait={noWait} />);
    return server;
  };

  it("somebody using the app alone keeps Coming soon: no gym board is theirs, and nothing opens", async () => {
    const server = await openDash({ "/v1/orgs/mine": ok({ orgs: [], formerOrgs: [] }) });
    expect(await screen.findByText("Your Rank")).toBeTruthy();
    expect(await screen.findByText("Coming soon")).toBeTruthy();
    expect(screen.queryByLabelText(/^Your Rank at/)).toBeNull();
    expect(server.paths().some((p) => p.includes("/leaderboard"))).toBe(false);
  });

  it("a member sees their place at their first gym, and a press opens that board", async () => {
    await openDash({ "/v1/orgs/mine": mine(IRON, LOTUS) });
    const box = await screen.findByLabelText("Your Rank at Iron House");
    expect(await within(box).findByText("2nd")).toBeTruthy();
    expect(within(box).getByText("of 3")).toBeTruthy();
    expect(within(box).getByText("Visits this week")).toBeTruthy();
    await fireEvent.press(box);
    expect(await page().findByText("Priya S.")).toBeTruthy();
  });

  it("hidden: the box says Hidden and never their would-be place", async () => {
    await openDash({ [boardPath(IRON, "gym_days")]: ok(boardOf(IRON, "gym_days", { me: me({ hidden: "hide_me", place: 2 }) })) });
    const box = await screen.findByLabelText("Your Rank at Iron House");
    expect(await within(box).findByText("Hidden")).toBeTruthy();
    expect(within(box).queryByText("2nd")).toBeNull();
  });

  it("a gym that checks nobody in ranks them on Workout days, as the page opens", async () => {
    await openDash({
      [boardPath(IRON, "gym_days")]: ok(boardOf(IRON, "gym_days", { status: "no_checkins", rows: [], ranked: 0 })),
      [boardPath(IRON, "workout_days")]: ok(boardOf(IRON, "workout_days", { me: me({ place: 1 }) })),
    });
    const box = await screen.findByLabelText("Your Rank at Iron House");
    expect(await within(box).findByText("Workout days this week")).toBeTruthy();
    expect(within(box).getByText("1st")).toBeTruthy();
  });

  it("the board not read is –, never a place; the line at the top says so, and Try again reads it", async () => {
    let up = false;
    await openDash({ [boardPath(IRON, "gym_days")]: () => (up ? { status: 200, body: boardOf(IRON, "gym_days") } : lost()) });
    const box = await screen.findByLabelText("Your Rank at Iron House");
    expect(await screen.findByText("Some of your numbers couldn’t load.")).toBeTruthy();
    expect(within(box).getByText("–")).toBeTruthy();
    up = true;
    await fireEvent.press(screen.getByLabelText("Try again"));
    expect(await within(await screen.findByLabelText("Your Rank at Iron House")).findByText("2nd")).toBeTruthy();
  });

  it("another gym's answer is never their place", async () => {
    const server = await openDash({ [boardPath(IRON, "gym_days")]: ok(boardOf(LOTUS, "gym_days")) });
    const box = await screen.findByLabelText("Your Rank at Iron House");
    await waitFor(() => {
      expect(server.paths()).toContain(boardPath(IRON, "gym_days"));
    });
    await settle();
    expect(within(box).queryByText("2nd")).toBeNull();
    expect(within(box).getByText("–")).toBeTruthy();
  });

  it("a gym that checks nobody in with Workout days switched off: one read, never back and forth", async () => {
    const off = { boardsOff: ["workout_days"], rows: [], ranked: 0 };
    const server = await openDash({
      [boardPath(IRON, "gym_days")]: ok(boardOf(IRON, "gym_days", { status: "no_checkins", ...off })),
      [boardPath(IRON, "workout_days")]: ok(boardOf(IRON, "workout_days", { status: "switched_off", ...off })),
    });
    const box = await screen.findByLabelText("Your Rank at Iron House");
    expect(await within(box).findByText("Not showing")).toBeTruthy();
    await settle(200);
    expect(server.asked.filter((one) => one.path.includes("/leaderboard?")).map((one) => one.path)).toEqual([boardPath(IRON, "gym_days")]);
  });

  it("a member whose gyms are still being read never reads Coming soon", async () => {
    await openDash({ "/v1/orgs/mine": never });
    expect(await screen.findByText("Your Rank")).toBeTruthy();
    await settle();
    expect(screen.queryByText("Coming soon")).toBeNull();
  });

  it("a member whose gyms could not be read never reads Coming soon, and Try again finds their place", async () => {
    let up = false;
    await openDash({ "/v1/orgs/mine": () => (up ? mine(IRON)() : lost()) });
    expect(await screen.findByText("Some of your numbers couldn’t load.")).toBeTruthy();
    expect(screen.queryByText("Coming soon")).toBeNull();
    up = true;
    await fireEvent.press(screen.getByLabelText("Try again"));
    expect(await within(await screen.findByLabelText("Your Rank at Iron House")).findByText("2nd")).toBeTruthy();
  });

  it("a gym that starts checking people in goes back to Visits when the Dashboard is opened again", async () => {
    let quiet = true;
    await openDash({
      [boardPath(IRON, "gym_days")]: () => ({ status: 200, body: boardOf(IRON, "gym_days", quiet ? { status: "no_checkins", rows: [], ranked: 0 } : {}) }),
      [boardPath(IRON, "workout_days")]: ok(boardOf(IRON, "workout_days")),
    });
    expect(await within(await screen.findByLabelText("Your Rank at Iron House")).findByText("Workout days this week")).toBeTruthy();
    quiet = false;
    const [first, , second] = await screen.findAllByRole("tab");
    if (first === undefined || second === undefined) throw new Error("no tabs");
    await fireEvent.press(second);
    await fireEvent.press(first);
    expect(await within(await screen.findByLabelText("Your Rank at Iron House")).findByText("Visits this week")).toBeTruthy();
  });
});
