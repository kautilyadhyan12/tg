import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { gymAttendanceHistoryResponseSchema, type GymAttendanceHistoryResponse } from "@app/shared";
import { App } from "../../src/App";
import { DAYS_COULD_NOT, DAYS_MORE, DaysYouCame, HISTORY_PAGES, type FetchVisits } from "../../src/screens/gym/DaysYouCame";
import { PASS_PATH } from "../../src/screens/gym/Pass";
import { dayIn, monthName, shiftMonth } from "../../src/screens/gym/visitsView";
import type { Answer, Ask } from "../../src/session/calls";
import { fakeServer, kept, memoryStore, tokens, type Reply } from "../kit";

const extra = { copyName: "Feature 1", apiUrl: "http://localhost:3000" };
const noWait = () => Promise.resolve();
const ok = (body: unknown) => (): Reply => ({ status: 200, body });

type Place = { id: string; name: string; city: string | null; orgType: string };
const IRON: Place = { id: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f", name: "Iron House", city: "Pune", orgType: "gym" };
const MEERA: Place = { id: "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d", name: "Meera Fitness", city: null, orgType: "personal_trainer" };
const org = (gym: Place) => ({
  ...gym,
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

// The gym's month now: the tests follow the calendar, so none of them expires.
const thisMonth = (dayIn("Asia/Kolkata", new Date()) ?? "").slice(0, 7);
const lastMonth = shiftMonth(thisMonth, -1);
const nameOf = (key: string) => (monthName(key, null).split(" ")[0] ?? "");

/** A visit on `day` of the month asked for, at `at` UTC (12:32: 6:02 PM in India). */
const visitOn = (month: string, day: number, hoursStatus = "in_session", at = "12:32:00.000Z") => {
  const date = `${month}-${String(day).padStart(2, "0")}`;
  return { day: date, markedAt: `${date}T${at}`, method: "pass", hoursStatus, session: null };
};
const history = (visits: unknown[], nextCursor: string | null = null, timezone = "Asia/Kolkata") => ({
  attendance: { timezone, clockFormat: "12h", visits, nextCursor },
});

/** What a day in this month is called, with "today" on the gym's today. */
const dayName = (month: string, day: number, checkedIn: boolean) => {
  const today = dayIn("Asia/Kolkata", new Date()) === `${month}-${String(day).padStart(2, "0")}`;
  return `${String(day)} ${nameOf(month)}${today ? ", today" : ""}${checkedIn ? ", checked in" : ""}`;
};

/** A server whose history answers are made from the place, the month and the page in the address. */
function withHistory(
  routes: Parameters<typeof fakeServer>[0],
  answer: (gymId: string, month: string, cursor: string | null) => Reply | Promise<Reply>,
) {
  const server = fakeServer(routes);
  const months: { gymId: string; from: string; to: string; cursor: string | null }[] = [];
  const ask: Ask = async (url, init) => {
    const where = new URL(url);
    const m = /^\/v1\/orgs\/([^/]+)\/attendance\/history$/.exec(where.pathname);
    if (m?.[1] === undefined) return server.ask(url, init);
    const from = where.searchParams.get("from") ?? "";
    const cursor = where.searchParams.get("cursor");
    months.push({ gymId: m[1], from, to: where.searchParams.get("to") ?? "", cursor });
    const reply = await answer(m[1], from.slice(0, 7), cursor);
    return { ok: reply.status < 300, status: reply.status, json: () => Promise.resolve(reply.body) };
  };
  return { ask, months };
}

const gymTab = async () => {
  const tab = (await screen.findAllByRole("tab"))[3];
  if (tab === undefined) throw new Error("no fourth tab");
  return tab;
};
const box = (place: Place) => within(screen.getByTestId(`days-${place.id}`));
const cameDays = (place: Place) => box(place).queryAllByLabelText(/, checked in$/).map((day) => String(day.props.accessibilityLabel));

beforeEach(() => {
  jest.clearAllMocks();
});

describe("the worst thing: a place's days are its own, and a failed read never says you didn't come", () => {
  it("each place shows only the days its own answer holds", async () => {
    const { ask, months } = withHistory({ "/v1/auth/refresh": ok({ tokens: tokens(2) }), "/v1/orgs/mine": mine(IRON, MEERA) }, (gymId, month) => ({
      status: 200,
      body: history(gymId === IRON.id ? [visitOn(month, 1)] : [visitOn(month, 2)]),
    }));
    await render(<App extra={extra} ask={ask} store={memoryStore(kept(1))} wait={noWait} />);
    await fireEvent.press(await gymTab());
    await waitFor(() => {
      expect(cameDays(IRON)).toEqual([dayName(thisMonth, 1, true)]);
      expect(cameDays(MEERA)).toEqual([dayName(thisMonth, 2, true)]);
    });
    expect(new Set(months.map((m) => m.gymId))).toEqual(new Set([IRON.id, MEERA.id]));
    expect(months.every((m) => m.from === `${thisMonth}-01` && m.to === `${shiftMonth(thisMonth, 1)}-01`)).toBe(true);
  });

  it("a read that fails says so, draws no month and no 'No check-ins', and Try again reads it", async () => {
    let fail = true;
    const { ask } = withHistory({ "/v1/auth/refresh": ok({ tokens: tokens(2) }), "/v1/orgs/mine": mine(IRON) }, (_, month) =>
      fail ? { status: 500, body: { error: "internal", message: "Something went wrong." } } : { status: 200, body: history([visitOn(month, 1)]) },
    );
    await render(<App extra={extra} ask={ask} store={memoryStore(kept(1))} wait={noWait} />);
    await fireEvent.press(await gymTab());
    expect(await screen.findByText(DAYS_COULD_NOT)).toBeTruthy();
    expect(screen.queryByText(/^No check-ins/)).toBeNull();
    expect(box(IRON).queryByText("Mon")).toBeNull();
    expect(cameDays(IRON)).toEqual([]);

    fail = false;
    await fireEvent.press(box(IRON).getByRole("button", { name: "Try again" }));
    await waitFor(() => {
      expect(cameDays(IRON)).toEqual([dayName(thisMonth, 1, true)]);
    });
    expect(screen.queryByText(DAYS_COULD_NOT)).toBeNull();
  });

  it("a month's answer that lands after another month was stepped to is never drawn under it", async () => {
    const held: (() => void)[] = [];
    const { ask } = withHistory({ "/v1/auth/refresh": ok({ tokens: tokens(2) }), "/v1/orgs/mine": mine(IRON) }, async (_, month) => {
      if (month === thisMonth) {
        await new Promise<void>((resolve) => held.push(resolve));
        return { status: 200, body: history([visitOn(month, 1)]) };
      }
      return { status: 200, body: history([]) };
    });
    await render(<App extra={extra} ask={ask} store={memoryStore(kept(1))} wait={noWait} />);
    await fireEvent.press(await gymTab());
    await waitFor(() => {
      expect(held.length).toBeGreaterThan(0);
    });
    await fireEvent.press(box(IRON).getByRole("button", { name: "Previous month" }));
    expect(await box(IRON).findByText(`No check-ins in ${monthName(lastMonth, null)}.`)).toBeTruthy();
    await act(async () => {
      for (const go of held) go();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(cameDays(IRON)).toEqual([]);
    expect(box(IRON).getByText(`No check-ins in ${monthName(lastMonth, null)}.`)).toBeTruthy();
  });
});

describe("Attendance", () => {
  it("a day they came opens its times, on the gym's clock, and one staff added later says so", async () => {
    const { ask } = withHistory({ "/v1/auth/refresh": ok({ tokens: tokens(2) }), "/v1/orgs/mine": mine(IRON) }, (_, month) => ({
      status: 200,
      body: history([visitOn(month, 1), visitOn(month, 2, "added_later")]),
    }));
    await render(<App extra={extra} ask={ask} store={memoryStore(kept(1))} wait={noWait} />);
    await fireEvent.press(await gymTab());
    await fireEvent.press(await box(IRON).findByLabelText(dayName(thisMonth, 1, true)));
    expect(await screen.findByText("6:02 PM")).toBeTruthy();
    expect(screen.getAllByText("Checked in")[0]).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => {
      expect(screen.queryByText("6:02 PM")).toBeNull();
    });
    await fireEvent.press(box(IRON).getByLabelText(dayName(thisMonth, 2, true)));
    expect(await screen.findByText("Added by staff")).toBeTruthy();
  });

  it("a day nobody came on opens nothing, and the next month is not offered from this one", async () => {
    const { ask } = withHistory({ "/v1/auth/refresh": ok({ tokens: tokens(2) }), "/v1/orgs/mine": mine(IRON) }, () => ({ status: 200, body: history([]) }));
    await render(<App extra={extra} ask={ask} store={memoryStore(kept(1))} wait={noWait} />);
    await fireEvent.press(await gymTab());
    expect(await box(IRON).findByText("No check-ins yet this month.")).toBeTruthy();
    await fireEvent.press(box(IRON).getByLabelText(dayName(thisMonth, 1, false)));
    expect(screen.queryByText("Checked in")).toBeNull();
    expect(box(IRON).getByRole("button", { name: "Next month" })).toBeDisabled();
    await fireEvent.press(box(IRON).getByRole("button", { name: "Previous month" }));
    await waitFor(() => {
      expect(box(IRON).getByRole("button", { name: "Next month" })).toBeEnabled();
    });
  });

  it("the month's name opens every month: one picked is read, and the months to come are not offered", async () => {
    const { ask, months } = withHistory({ "/v1/auth/refresh": ok({ tokens: tokens(2) }), "/v1/orgs/mine": mine(IRON) }, (_, month) => ({
      status: 200,
      body: history(month === thisMonth ? [visitOn(month, 1)] : []),
    }));
    await render(<App extra={extra} ask={ask} store={memoryStore(kept(1))} wait={noWait} />);
    await fireEvent.press(await gymTab());
    await box(IRON).findByLabelText(dayName(thisMonth, 1, true));
    await fireEvent.press(box(IRON).getByRole("button", { name: `${nameOf(thisMonth)}, choose a month` }));
    expect(screen.getByText("Choose a month")).toBeTruthy();
    const year = Number(thisMonth.slice(0, 4));
    expect(screen.getByRole("button", { name: "Next year" })).toBeDisabled();
    const next = shiftMonth(thisMonth, 1);
    if (next.startsWith(String(year))) {
      expect(screen.getByRole("button", { name: `${nameOf(next).slice(0, 3)} ${String(year)}` })).toBeDisabled();
    }

    await fireEvent.press(screen.getByRole("button", { name: "Previous year" }));
    await fireEvent.press(screen.getByRole("button", { name: `Mar ${String(year - 1)}` }));
    expect(await box(IRON).findByText(`No check-ins in March ${String(year - 1)}.`)).toBeTruthy();
    expect(months.at(-1)).toMatchObject({ gymId: IRON.id, from: `${String(year - 1)}-03-01`, to: `${String(year - 1)}-04-01` });
    expect(cameDays(IRON)).toEqual([]);
    expect(screen.queryByText("Choose a month")).toBeNull();
  });

  it("a month with more visits than one answer says some are not shown", async () => {
    const { ask } = withHistory({ "/v1/auth/refresh": ok({ tokens: tokens(2) }), "/v1/orgs/mine": mine(IRON) }, (_, month) => ({
      status: 200,
      body: history([visitOn(month, 1)], "next-page"),
    }));
    await render(<App extra={extra} ask={ask} store={memoryStore(kept(1))} wait={noWait} />);
    await fireEvent.press(await gymTab());
    expect(await box(IRON).findByText("Some check-ins this month aren’t shown.")).toBeTruthy();
  });

  it("closing the pass reads the month again, so a visit the desk just scanned shows", async () => {
    let scanned = false;
    const { ask, months } = withHistory(
      {
        "/v1/auth/refresh": ok({ tokens: tokens(2) }),
        "/v1/orgs/mine": mine(IRON),
        [PASS_PATH]: () => {
          scanned = true;
          return { status: 200, body: { pass: "AHGPLG763ESHTVB2ZAG44DJVO6OZTIBY55AU7C4WIZRMWOB6SNIWULCDANFKYI", refreshAt: new Date(Date.now() + 20_000).toISOString() } };
        },
      },
      (_, month) => ({ status: 200, body: history(scanned ? [visitOn(month, 1)] : []) }),
    );
    await render(<App extra={extra} ask={ask} store={memoryStore(kept(1))} wait={noWait} />);
    await fireEvent.press(await gymTab());
    expect(await box(IRON).findByText("No check-ins yet this month.")).toBeTruthy();
    const before = months.length;
    await fireEvent.press(screen.getByRole("button", { name: "Show my pass" }));
    await waitFor(() => {
      expect(scanned).toBe(true);
    });
    await fireEvent.press(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => {
      expect(cameDays(IRON)).toEqual([dayName(thisMonth, 1, true)]);
    });
    expect(months.length).toBe(before + 1);
  });
});

describe("Attendance on the gym's clock, page by page", () => {
  const PLACE = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
  type Asked = { from: string; cursor: string | null };
  /** The box alone, its answers made from the month and the page asked for. */
  function served(answer: (month: string, cursor: string | null) => Answer<GymAttendanceHistoryResponse>) {
    const asked: Asked[] = [];
    const fetchVisits: FetchVisits = (path) => {
      const where = new URL(`http://x${path}`);
      const from = where.searchParams.get("from") ?? "";
      const cursor = where.searchParams.get("cursor");
      asked.push({ from, cursor });
      return Promise.resolve(answer(from.slice(0, 7), cursor));
    };
    return { fetchVisits, asked };
  }
  const ok = (body: unknown): Answer<GymAttendanceHistoryResponse> => ({ kind: "ok", data: gymAttendanceHistoryResponseSchema.parse(body) });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("the month, today and the next arrow are the gym's, not the phone's", async () => {
    // 12:00 UTC on 31 October: still the 31st in India and in UTC, already 1 November at a gym in Kiritimati.
    jest.useFakeTimers({
      now: Date.parse("2026-10-31T12:00:00.000Z"),
      doNotFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate", "clearImmediate", "nextTick", "queueMicrotask"],
    });
    const { fetchVisits, asked } = served(() => ok(history([], null, "Pacific/Kiritimati")));
    await render(<DaysYouCame gymId={PLACE} read={0} fetchVisits={fetchVisits} />);
    expect(await screen.findByRole("button", { name: "November, choose a month" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Next month" })).toBeDisabled();
    expect(screen.getByLabelText("1 November, today")).toBeTruthy();
    expect(StyleSheet.flatten(screen.getByLabelText("2 November").props.style as StyleProp<ViewStyle>).opacity).toBe(0.35);
    expect(StyleSheet.flatten(screen.getByLabelText("1 November, today").props.style as StyleProp<ViewStyle>).opacity).toBeUndefined();
    expect(asked.at(-1)?.from).toBe("2026-11-01");
  });

  it("a check-in's time is on the gym's clock, not the phone's", async () => {
    // 09:02 UTC is 6:02 PM in Tokyo, 2:32 PM in India and 9:02 AM in UTC.
    const { fetchVisits } = served((month) => ok(history([visitOn(month, 1, "in_session", "09:02:00.000Z")], null, "Asia/Tokyo")));
    await render(<DaysYouCame gymId={PLACE} read={0} fetchVisits={fetchVisits} />);
    await fireEvent.press(await screen.findByLabelText(/^1 \w+(, today)?, checked in$/));
    expect(await screen.findByText("6:02 PM")).toBeTruthy();
  });

  it("a month in more than one answer is read to its end, and only what is still left says so", async () => {
    const { fetchVisits, asked } = served((month, cursor) =>
      ok(cursor === null ? history([visitOn(month, 1)], "page-2") : history([visitOn(month, 2)], null)),
    );
    await render(<DaysYouCame gymId={PLACE} read={0} fetchVisits={fetchVisits} />);
    await waitFor(() => {
      expect(screen.queryAllByLabelText(/, checked in$/)).toHaveLength(2);
    });
    expect(asked.map((one) => one.cursor)).toEqual([null, "page-2"]);
    expect(screen.queryByText(DAYS_MORE)).toBeNull();

    const endless = served((month, cursor) => ok(history([visitOn(month, cursor === null ? 1 : 2)], "again")));
    await render(<DaysYouCame gymId={PLACE} read={0} fetchVisits={endless.fetchVisits} />);
    expect(await screen.findByText(DAYS_MORE)).toBeTruthy();
    expect(endless.asked).toHaveLength(HISTORY_PAGES);
  });

  it("Try again turns while its read is away, and a second press asks nothing more", async () => {
    let fail = true;
    const waiting: (() => void)[] = [];
    const asked: number[] = [];
    const fetchVisits: FetchVisits = async () => {
      asked.push(1);
      if (fail) return { kind: "no_answer" };
      await new Promise<void>((resolve) => waiting.push(resolve));
      return ok(history([]));
    };
    await render(<DaysYouCame gymId={PLACE} read={0} fetchVisits={fetchVisits} />);
    const again = await screen.findByRole("button", { name: "Try again" });
    fail = false;
    await fireEvent.press(again);
    expect(screen.getByRole("button", { name: "Try again" })).toBeDisabled();
    await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
    expect(asked).toHaveLength(2);
    await act(async () => {
      for (const go of waiting) go();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(await screen.findByText("No check-ins yet this month.")).toBeTruthy();
  });
});
