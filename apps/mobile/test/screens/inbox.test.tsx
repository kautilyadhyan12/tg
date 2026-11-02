import { act, fireEvent, render, screen, within } from "@testing-library/react-native";
import { AppState, Linking } from "react-native";
import { App } from "../../src/App";
import type { Ask } from "../../src/session/calls";
import { fakeServer, kept, lost, memoryStore, refusal, tokens, type Reply, type Route } from "../kit";

const extra = { copyName: "Feature 1", apiUrl: "http://localhost:3000" };
const noWait = () => Promise.resolve();
const ok = (body: unknown) => (): Reply => ({ status: 200, body });

type Place = { id: string; name: string; city: string | null; orgType: string; clockFormat: "12h" | "24h" };
const IRON: Place = { id: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f", name: "Iron House", city: "Pune", orgType: "gym", clockFormat: "12h" };
const LOTUS: Place = { id: "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d", name: "Lotus Yoga", city: null, orgType: "studio", clockFormat: "24h" };
const org = (gym: Place, over: Record<string, unknown> = {}) => ({
  ...gym,
  slug: gym.name.toLowerCase().replace(" ", "-"),
  timezone: "Asia/Kolkata",
  locale: "en",
  currencyDisplay: "INR",
  status: "active",
  staffRole: null,
  isMember: true,
  joinedAt: "2026-10-01T00:00:00.000Z",
  ...over,
});

const M1 = "11111111-1111-4111-8111-111111111111";
const M2 = "22222222-2222-4222-8222-222222222222";
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const message = (id: string, body: string, over: Record<string, unknown> = {}) => ({ id, kind: "group", body, sentAt: hoursAgo(3), link: null, read: false, ...over });
const ASOF = "2026-11-02T10:00:00.000Z";
const inboxOf = (place: Place, over: Record<string, unknown> = {}) => ({
  gymId: place.id,
  gymName: place.name,
  status: "shown",
  messages: [],
  unread: 0,
  asOf: ASOF,
  contact: { phone: null, email: null },
  groupMessages: true,
  off: [],
  ...over,
});
const inboxPath = (place: Place) => `/v1/orgs/${place.id}/inbox`;
const routes = (over: Record<string, Route> = {}): Record<string, Route> => ({
  "/v1/auth/refresh": ok({ tokens: tokens(2) }),
  "/v1/orgs/mine": ok({ orgs: [org(IRON)], formerOrgs: [] }),
  [inboxPath(IRON)]: ok(inboxOf(IRON)),
  ...over,
});

async function openGym(ask: Ask) {
  await render(<App extra={extra} ask={ask} store={memoryStore(kept(1))} wait={noWait} />);
  const tab = (await screen.findAllByRole("tab"))[3];
  if (tab === undefined) throw new Error("no fourth tab");
  await fireEvent.press(tab);
}
async function openInbox(ask: Ask, place: Place = IRON) {
  await openGym(ask);
  await fireEvent.press(await screen.findByLabelText(new RegExp(`^Inbox at ${place.name}`)));
}
const page = () => within(screen.getByTestId("inbox-page"));
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 30)));
const isOn = (one: { props: { value?: unknown } }) => one.props.value === true;
async function openSwitches(place: Place = IRON) {
  await fireEvent.press(await page().findByText(`Choose what ${place.name} can send you`));
}
const membershipSwitch = () => screen.findByLabelText("About your membership and bookings");
const newsSwitch = (place: Place = IRON) => screen.findByLabelText(`News and greetings from ${place.name}`);
const putsTo = (server: { asked: { method: string; path: string; body: unknown }[] }) =>
  server.asked.filter((one) => one.method === "PUT" && one.path === `${inboxPath(IRON)}/switches`).map((one) => one.body);

afterEach(() => {
  jest.restoreAllMocks();
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

describe("the Gym tab's dot, before the Gym tab is ever opened", () => {
  it("is lit on Home when the places hold new messages", async () => {
    const server = fakeServer(routes({ "/v1/orgs/mine": ok({ orgs: [org(IRON, { newMessages: 2 })], formerOrgs: [] }) }));
    await render(<App extra={extra} ask={server.ask} store={memoryStore(kept(1))} wait={noWait} />);
    expect(await screen.findByTestId("dot-Gym")).toBeTruthy();
    expect(screen.getByLabelText("Gym, 2 new messages")).toBeTruthy();
  });

  it("lights when a message comes while the app was away, and the app comes back on Home", async () => {
    let count = 0;
    const comeBack = listenForComeBack();
    const server = fakeServer(routes({ "/v1/orgs/mine": () => ({ status: 200, body: { orgs: [org(IRON, { newMessages: count })], formerOrgs: [] } }) }));
    const now = jest.spyOn(Date, "now");
    const start = Date.now();
    now.mockReturnValue(start);
    await render(<App extra={extra} ask={server.ask} store={memoryStore(kept(1))} wait={noWait} />);
    await screen.findAllByRole("tab");
    await settle();
    expect(screen.queryByTestId("dot-Gym")).toBeNull();
    count = 2;
    now.mockReturnValue(start + 31_000);
    await comeBack();
    expect(await screen.findByTestId("dot-Gym")).toBeTruthy();
  });

  it("counts only the places the person is a member of", async () => {
    const server = fakeServer(
      routes({ "/v1/orgs/mine": ok({ orgs: [org(IRON, { isMember: false, staffRole: "trainer", newMessages: 3 })], formerOrgs: [] }) }),
    );
    await render(<App extra={extra} ask={server.ask} store={memoryStore(kept(1))} wait={noWait} />);
    await screen.findAllByRole("tab");
    await settle();
    expect(screen.queryByTestId("dot-Gym")).toBeNull();
  });
});

describe("the worst thing: a switch says only what the server saved, so a member never misses a message they think is on", () => {
  it("switched off and saved, it reads Off with the server's words; the server's answer, not the press, sets it", async () => {
    const server = fakeServer(routes({ [`${inboxPath(IRON)}/switches`]: ok({ off: ["trial_ending", "membership_ending", "class_reminder"], groupMessages: true }) }));
    await openInbox(server.ask);
    await openSwitches();
    expect(isOn(await membershipSwitch())).toBe(true);
    await fireEvent(await membershipSwitch(), "valueChange", false);
    await settle();
    expect(putsTo(server)).toEqual([{ group: "membership", on: false }]);
    expect(isOn(await membershipSwitch())).toBe(false);
    expect(screen.getByText("Off. Iron House won't send you these. A message about a payment you owe is still sent.")).toBeTruthy();
  });

  it("switched off but the server still holds it on: it reads On", async () => {
    const server = fakeServer(routes({ [`${inboxPath(IRON)}/switches`]: ok({ off: [], groupMessages: true }) }));
    await openInbox(server.ask);
    await openSwitches();
    await fireEvent(await membershipSwitch(), "valueChange", false);
    await settle();
    expect(isOn(await membershipSwitch())).toBe(true);
  });

  it("switched on but the server still holds news off: it reads Off", async () => {
    const server = fakeServer(
      routes({
        [inboxPath(IRON)]: ok(inboxOf(IRON, { groupMessages: false })),
        [`${inboxPath(IRON)}/switches`]: ok({ off: [], groupMessages: false }),
      }),
    );
    await openInbox(server.ask);
    await openSwitches();
    expect(isOn(await newsSwitch())).toBe(false);
    await fireEvent(await newsSwitch(), "valueChange", true);
    await settle();
    expect(isOn(await newsSwitch())).toBe(false);
  });

  it("with no answer, or a refusal, the switch stays as it was and says it wasn't changed", async () => {
    let answer: () => Reply = lost;
    const server = fakeServer(routes({ [`${inboxPath(IRON)}/switches`]: () => answer() }));
    await openInbox(server.ask);
    await openSwitches();
    await fireEvent(await membershipSwitch(), "valueChange", false);
    expect(await screen.findByText("Can’t connect. Check your internet and try again.")).toBeTruthy();
    expect(isOn(await membershipSwitch())).toBe(true);
    answer = () => refusal(500, "internal", "Something went wrong.");
    await fireEvent(await membershipSwitch(), "valueChange", false);
    expect(await screen.findByText("We couldn’t change that. Please try again.")).toBeTruthy();
    expect(isOn(await membershipSwitch())).toBe(true);
  });

  it("the switches start as the server sent them: part of a group off reads Off and says some are off", async () => {
    const server = fakeServer(routes({ [inboxPath(IRON)]: ok(inboxOf(IRON, { off: ["birthday"] })) }));
    await openInbox(server.ask);
    await openSwitches();
    expect(isOn(await newsSwitch())).toBe(false);
    expect(isOn(await membershipSwitch())).toBe(true);
    expect(screen.getByText("Some of these are off. Press to get them all.")).toBeTruthy();
  });
});

describe("the messages", () => {
  it("shows each message with New, then marks them seen up to what was shown, and the count and the dot go out", async () => {
    const server = fakeServer(
      routes({
        "/v1/orgs/mine": ok({ orgs: [org(IRON, { newMessages: 2 })], formerOrgs: [] }),
        [inboxPath(IRON)]: ok(inboxOf(IRON, { messages: [message(M1, "Closed on Friday for Diwali."), message(M2, "Happy birthday!", { kind: "birthday", read: true, sentAt: hoursAgo(50) })], unread: 1 })),
        [`${inboxPath(IRON)}/read`]: ok({ unread: 0 }),
      }),
    );
    await openGym(server.ask);
    expect(await screen.findByLabelText("Inbox at Iron House, 2 new messages")).toBeTruthy();
    expect(screen.getByText("Inbox (2)")).toBeTruthy();
    expect(screen.getByTestId("dot-Gym")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Inbox at Iron House, 2 new messages"));
    const first = within(await page().findByTestId(`message-${M1}`));
    expect(first.getByText("Closed on Friday for Diwali.")).toBeTruthy();
    expect(first.getByText("New · 3 hours ago")).toBeTruthy();
    const second = within(page().getByTestId(`message-${M2}`));
    expect(second.queryByText("New")).toBeNull();
    expect(second.getByText("2 days ago")).toBeTruthy();
    expect(page().getByText("Messages stay here for 30 days. You can't reply to them here.")).toBeTruthy();
    await settle();
    const seen = server.asked.filter((one) => one.method === "POST" && one.path === `${inboxPath(IRON)}/read`);
    expect(seen.map((one) => one.body)).toEqual([{ upTo: ASOF }]);
    // The New marks stay while it is open; the count and the dot go.
    expect(first.getByText("New · 3 hours ago")).toBeTruthy();
    expect(screen.queryByTestId("dot-Gym")).toBeNull();
    await fireEvent.press(page().getByLabelText("Back"));
    expect(await screen.findByLabelText("Inbox at Iron House")).toBeTruthy();
  });

  it("an inbox with nothing in it says so; one with nothing new marks nothing", async () => {
    const server = fakeServer(routes());
    await openInbox(server.ask);
    expect(await page().findByText("No messages from Iron House yet. When they send you one, it shows up here.")).toBeTruthy();
    await settle();
    expect(server.asked.some((one) => one.path.endsWith("/inbox/read"))).toBe(false);
  });

  it("the gym's pinned note sits on top, for seven days", async () => {
    const server = fakeServer(
      routes({
        "/v1/orgs/mine": ok({ orgs: [org(IRON, { latestCheer: { preset: "on_a_roll", sentAt: hoursAgo(5) } }), org(LOTUS, { latestNudge: { preset: "miss_you", sentAt: hoursAgo(24 * 8) } })], formerOrgs: [] }),
        [inboxPath(LOTUS)]: ok(inboxOf(LOTUS)),
      }),
    );
    await openInbox(server.ask);
    const pinned = within(await page().findByTestId("inbox-pinned"));
    expect(pinned.getByText("You're on a roll.")).toBeTruthy();
    expect(pinned.getByText("Pinned · 5 hours ago")).toBeTruthy();
    expect(page().queryByText(/No messages from/)).toBeNull();
    await fireEvent.press(page().getByLabelText("Back"));
    await fireEvent.press(await screen.findByLabelText("Inbox at Lotus Yoga"));
    expect(await page().findByText("No messages from Lotus Yoga yet. When they send you one, it shows up here.")).toBeTruthy();
    expect(page().queryByTestId("inbox-pinned")).toBeNull();
  });

  it("Ask for a review has a button to the gym's review page; any other link is never a button", async () => {
    const opened = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
    const server = fakeServer(
      routes({
        [inboxPath(IRON)]: ok(
          inboxOf(IRON, {
            messages: [message(M1, "How was your month?", { kind: "review", link: "https://g.page/r/iron-house/review" }), message(M2, "New class on Monday.", { link: "https://g.page/r/iron-house/review" })],
          }),
        ),
      }),
    );
    await openInbox(server.ask);
    await fireEvent.press(await within(await page().findByTestId(`message-${M1}`)).findByText("Leave a review"));
    expect(opened).toHaveBeenCalledWith("https://g.page/r/iron-house/review");
    expect(within(page().getByTestId(`message-${M2}`)).queryByText("Leave a review")).toBeNull();
  });

  it("a paused place shows no messages and says why", async () => {
    const server = fakeServer(routes({ [inboxPath(IRON)]: ok(inboxOf(IRON, { status: "paused", messages: [message(M1, "Hidden")] })) }));
    await openInbox(server.ask);
    expect(await page().findByText("Iron House isn't sending messages in the app right now.")).toBeTruthy();
    expect(page().queryByText("Hidden")).toBeNull();
    expect(page().queryByText("Choose what Iron House can send you")).toBeNull();
  });

  it("another place's answer is never shown as this one's", async () => {
    const server = fakeServer(routes({ [inboxPath(IRON)]: ok(inboxOf(LOTUS, { messages: [message(M1, "Lotus news")] })) }));
    await openInbox(server.ask);
    expect(await page().findByText("Couldn’t load your messages.")).toBeTruthy();
    expect(page().queryByText("Lotus news")).toBeNull();
  });

  it("a failed read says so and Try again reads again", async () => {
    let fail = true;
    const server = fakeServer(routes({ [inboxPath(IRON)]: () => (fail ? refusal(500, "internal", "Something went wrong.") : { status: 200, body: inboxOf(IRON, { messages: [message(M1, "Back again")] }) }) }));
    await openInbox(server.ask);
    expect(await page().findByText("Couldn’t load your messages.")).toBeTruthy();
    fail = false;
    await fireEvent.press(page().getByText("Try again"));
    expect(await page().findByText("Back again")).toBeTruthy();
  });
});

describe("the count after reading", () => {
  it("a read of the places that started before the Inbox marked them read never brings the old count back", async () => {
    const comeBack = listenForComeBack();
    let mineReads = 0;
    let hold = false;
    let held = 0;
    let release: (reply: Reply) => void = () => undefined;
    const server = fakeServer(
      routes({
        "/v1/orgs/mine": () => {
          mineReads += 1;
          // The read the app makes when it comes back answers late, with the count from before.
          if (hold && held === 0) {
            held += 1;
            return new Promise<Reply>((resolve) => { release = resolve; });
          }
          return { status: 200, body: { orgs: [org(IRON, { newMessages: hold ? 0 : 2 })], formerOrgs: [] } };
        },
        [inboxPath(IRON)]: ok(inboxOf(IRON, { messages: [message(M1, "Closed Friday.")], unread: 2 })),
        [`${inboxPath(IRON)}/read`]: ok({ unread: 0 }),
      }),
    );
    const now = jest.spyOn(Date, "now");
    const start = Date.now();
    now.mockReturnValue(start);
    await openGym(server.ask);
    await fireEvent.press(await screen.findByLabelText("Inbox at Iron House, 2 new messages"));
    await page().findByText("Closed Friday.");
    await settle();
    hold = true;
    now.mockReturnValue(start + 31_000);
    await comeBack();
    await settle();
    expect(held).toBe(1);
    expect(mineReads).toBeGreaterThanOrEqual(3);
    await act(() => {
      release({ status: 200, body: { orgs: [org(IRON, { newMessages: 2 })], formerOrgs: [] } });
    });
    await settle();
    await fireEvent.press(page().getByLabelText("Back"));
    expect(await screen.findByLabelText("Inbox at Iron House")).toBeTruthy();
    expect(screen.queryByTestId("dot-Gym")).toBeNull();
  });
});

describe("Contact the gym", () => {
  it("a link no app can open says so where it was pressed", async () => {
    jest.spyOn(Linking, "openURL").mockRejectedValue(new Error("No app"));
    const server = fakeServer(routes({ [inboxPath(IRON)]: ok(inboxOf(IRON, { contact: { phone: null, email: "desk@ironhouse.in" } })) }));
    await openInbox(server.ask);
    await fireEvent.press(await page().findByText("Contact the gym"));
    await fireEvent.press(await screen.findByText("Email desk@ironhouse.in"));
    expect(await page().findByText("No app on this phone can open that.")).toBeTruthy();
  });

  it("opens a box with the gym's phone and email; each press calls or writes", async () => {
    const opened = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
    const server = fakeServer(routes({ [inboxPath(IRON)]: ok(inboxOf(IRON, { contact: { phone: "+44 (0)20 7946 0958", email: "desk@ironhouse.in" } })) }));
    await openInbox(server.ask);
    await fireEvent.press(await page().findByText("Contact the gym"));
    await fireEvent.press(await screen.findByText("Call +44 (0)20 7946 0958"));
    expect(opened).toHaveBeenLastCalledWith("tel:+442079460958");
    await fireEvent.press(await page().findByText("Contact the gym"));
    await fireEvent.press(await screen.findByText("Email desk@ironhouse.in"));
    expect(opened).toHaveBeenLastCalledWith("mailto:desk@ironhouse.in");
  });

  it("a place that added neither has no button and one line", async () => {
    const server = fakeServer(
      routes({
        "/v1/orgs/mine": ok({ orgs: [org(LOTUS)], formerOrgs: [] }),
        [inboxPath(LOTUS)]: ok(inboxOf(LOTUS)),
      }),
    );
    await openInbox(server.ask, LOTUS);
    expect(await page().findByText("Lotus Yoga hasn't added a phone number or email yet.")).toBeTruthy();
    expect(page().queryByText(/^Contact the/)).toBeNull();
  });

  it("a studio's button says studio", async () => {
    const server = fakeServer(
      routes({
        "/v1/orgs/mine": ok({ orgs: [org(LOTUS)], formerOrgs: [] }),
        [inboxPath(LOTUS)]: ok(inboxOf(LOTUS, { contact: { phone: "020 7946 0958", email: null } })),
      }),
    );
    await openInbox(server.ask, LOTUS);
    expect(await page().findByText("Contact the studio")).toBeTruthy();
  });
});
