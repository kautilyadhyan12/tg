import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { App } from "../../src/App";
import { DAYS_COULD_NOT } from "../../src/screens/gym/DaysYouCame";
import { PASS_PATH } from "../../src/screens/gym/Pass";
import { dayIn, monthName, shiftMonth } from "../../src/screens/gym/visitsView";
import type { Ask } from "../../src/session/calls";
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

/** A visit on `day` of the month asked for, at 12:32 UTC: 6:02 PM in India. */
const visitOn = (month: string, day: number, hoursStatus = "in_session") => {
  const date = `${month}-${String(day).padStart(2, "0")}`;
  return { day: date, markedAt: `${date}T12:32:00.000Z`, method: "pass", hoursStatus, session: null };
};
const history = (visits: unknown[], nextCursor: string | null = null) => ({
  attendance: { timezone: "Asia/Kolkata", clockFormat: "12h", visits, nextCursor },
});

/** A server whose history answers are made from the place and the month in the address. */
function withHistory(routes: Parameters<typeof fakeServer>[0], answer: (gymId: string, month: string) => Reply | Promise<Reply>) {
  const server = fakeServer(routes);
  const months: { gymId: string; from: string; to: string }[] = [];
  const ask: Ask = async (url, init) => {
    const where = new URL(url);
    const m = /^\/v1\/orgs\/([^/]+)\/attendance\/history$/.exec(where.pathname);
    if (m?.[1] === undefined) return server.ask(url, init);
    const from = where.searchParams.get("from") ?? "";
    months.push({ gymId: m[1], from, to: where.searchParams.get("to") ?? "" });
    const reply = await answer(m[1], from.slice(0, 7));
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
const cameDays = (place: Place) => box(place).queryAllByLabelText(/, you came$/).map((day) => String(day.props.accessibilityLabel));

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
      expect(cameDays(IRON)).toEqual([`1 ${nameOf(thisMonth)}, you came`]);
      expect(cameDays(MEERA)).toEqual([`2 ${nameOf(thisMonth)}, you came`]);
    });
    expect(new Set(months.map((m) => m.gymId))).toEqual(new Set([IRON.id, MEERA.id]));
    expect(months.every((m) => m.from === `${thisMonth}-01` && m.to === `${shiftMonth(thisMonth, 1)}-01`)).toBe(true);
  });

  it("a read that fails says so, draws no month and no 'No visits', and Try again reads it", async () => {
    let fail = true;
    const { ask } = withHistory({ "/v1/auth/refresh": ok({ tokens: tokens(2) }), "/v1/orgs/mine": mine(IRON) }, (_, month) =>
      fail ? { status: 500, body: { error: "internal", message: "Something went wrong." } } : { status: 200, body: history([visitOn(month, 1)]) },
    );
    await render(<App extra={extra} ask={ask} store={memoryStore(kept(1))} wait={noWait} />);
    await fireEvent.press(await gymTab());
    expect(await screen.findByText(DAYS_COULD_NOT)).toBeTruthy();
    expect(screen.queryByText(/^No visits/)).toBeNull();
    expect(box(IRON).queryByText("Mon")).toBeNull();
    expect(cameDays(IRON)).toEqual([]);

    fail = false;
    await fireEvent.press(box(IRON).getByRole("button", { name: "Try again" }));
    await waitFor(() => {
      expect(cameDays(IRON)).toEqual([`1 ${nameOf(thisMonth)}, you came`]);
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
    expect(await box(IRON).findByText(`No visits in ${monthName(lastMonth, null)}.`)).toBeTruthy();
    await act(async () => {
      for (const go of held) go();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(cameDays(IRON)).toEqual([]);
    expect(box(IRON).getByText(`No visits in ${monthName(lastMonth, null)}.`)).toBeTruthy();
  });
});

describe("Days you came", () => {
  it("a day they came opens its times, on the gym's clock, and one staff added later says so", async () => {
    const { ask } = withHistory({ "/v1/auth/refresh": ok({ tokens: tokens(2) }), "/v1/orgs/mine": mine(IRON) }, (_, month) => ({
      status: 200,
      body: history([visitOn(month, 1), visitOn(month, 2, "added_later")]),
    }));
    await render(<App extra={extra} ask={ask} store={memoryStore(kept(1))} wait={noWait} />);
    await fireEvent.press(await gymTab());
    await fireEvent.press(await box(IRON).findByLabelText(`1 ${nameOf(thisMonth)}, you came`));
    expect(await screen.findByText("6:02 PM")).toBeTruthy();
    expect(screen.getByText("You were here")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => {
      expect(screen.queryByText("6:02 PM")).toBeNull();
    });
    await fireEvent.press(box(IRON).getByLabelText(`2 ${nameOf(thisMonth)}, you came`));
    expect(await screen.findByText("Added later by staff")).toBeTruthy();
  });

  it("a day nobody came on opens nothing, and the next month is not offered from this one", async () => {
    const { ask } = withHistory({ "/v1/auth/refresh": ok({ tokens: tokens(2) }), "/v1/orgs/mine": mine(IRON) }, () => ({ status: 200, body: history([]) }));
    await render(<App extra={extra} ask={ask} store={memoryStore(kept(1))} wait={noWait} />);
    await fireEvent.press(await gymTab());
    expect(await box(IRON).findByText("No visits yet this month.")).toBeTruthy();
    await fireEvent.press(box(IRON).getByLabelText(`1 ${nameOf(thisMonth)}`));
    expect(screen.queryByText("You were here")).toBeNull();
    expect(box(IRON).getByRole("button", { name: "Next month" })).toBeDisabled();
    await fireEvent.press(box(IRON).getByRole("button", { name: "Previous month" }));
    await waitFor(() => {
      expect(box(IRON).getByRole("button", { name: "Next month" })).toBeEnabled();
    });
  });

  it("a month with more visits than one answer says some are not shown", async () => {
    const { ask } = withHistory({ "/v1/auth/refresh": ok({ tokens: tokens(2) }), "/v1/orgs/mine": mine(IRON) }, (_, month) => ({
      status: 200,
      body: history([visitOn(month, 1)], "next-page"),
    }));
    await render(<App extra={extra} ask={ask} store={memoryStore(kept(1))} wait={noWait} />);
    await fireEvent.press(await gymTab());
    expect(await box(IRON).findByText("Some visits this month aren’t shown.")).toBeTruthy();
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
    expect(await box(IRON).findByText("No visits yet this month.")).toBeTruthy();
    const before = months.length;
    await fireEvent.press(screen.getByRole("button", { name: "Show my pass" }));
    await waitFor(() => {
      expect(scanned).toBe(true);
    });
    await fireEvent.press(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => {
      expect(cameDays(IRON)).toEqual([`1 ${nameOf(thisMonth)}, you came`]);
    });
    expect(months.length).toBe(before + 1);
  });
});
