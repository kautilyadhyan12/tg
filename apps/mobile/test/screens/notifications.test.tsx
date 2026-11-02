import { act, fireEvent, render, screen, within } from "@testing-library/react-native";
import { App } from "../../src/App";
import { fakeServer, kept, memoryStore, tokens, type Reply, type Route } from "../kit";

// A gym's messages as phone notifications (ROADMAP Stage 5 item 18b-i): the reason before Android
// asks, the phone's address given for the person signed in, a tap that opens that gym's Inbox, and
// nothing of anybody left on the phone once they sign out.

type Stand = {
  permission: unknown;
  afterAsk: unknown;
  asked: number;
  token: string;
  presented: { request: { identifier: string; content: { data: unknown } } }[];
  dismissed: string[];
  dismissedAll: number;
  unregistered: number;
  taps: ((response: unknown) => void)[];
  last: unknown;
  handler: { handleNotification: (n: unknown) => Promise<{ shouldShowBanner: boolean }> } | null;
  channels: { id: string; name: string }[];
};
const { notifications, reset } = jest.requireMock<{ notifications: Stand; reset: () => void }>("expo-notifications");
const secureStore = jest.requireMock<{ kept: Map<string, string> }>("expo-secure-store");

const extra = { copyName: "Feature 1", apiUrl: "http://localhost:3000" };
const noWait = () => Promise.resolve();
const ok = (body: unknown) => (): Reply => ({ status: 200, body });
const ASK = { granted: false, canAskAgain: true, status: "undetermined" };
const YES = { granted: true, canAskAgain: true, status: "granted" };
const NO = { granted: false, canAskAgain: false, status: "denied" };

const IRON = { id: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f", name: "Iron House" };
const STRANGER_GYM = "9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a";
const org = (gym: { id: string; name: string }) => ({
  ...gym,
  city: "Pune",
  orgType: "gym",
  clockFormat: "12h",
  slug: "iron-house",
  timezone: "Asia/Kolkata",
  locale: "en",
  currencyDisplay: "INR",
  status: "active",
  staffRole: null,
  isMember: true,
  joinedAt: "2026-10-01T00:00:00.000Z",
});
const inbox = {
  gymId: IRON.id,
  gymName: IRON.name,
  status: "shown",
  messages: [{ id: "11111111-1111-4111-8111-111111111111", kind: "group", body: "Class moved to 7 pm.", sentAt: new Date().toISOString(), link: null, read: false }],
  unread: 1,
  asOf: new Date().toISOString(),
  contact: { phone: null, email: null },
  groupMessages: true,
  off: [],
};
const routes = (over: Record<string, Route> = {}): Record<string, Route> => ({
  "/v1/auth/refresh": ok({ tokens: tokens(2) }),
  "/v1/orgs/mine": ok({ orgs: [org(IRON)], formerOrgs: [] }),
  "/v1/push-tokens": ok({ saved: true }),
  [`/v1/orgs/${IRON.id}/inbox`]: ok(inbox),
  ...over,
});
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 30)));
const addressesGiven = (server: { asked: { method: string; path: string; body: unknown }[] }) =>
  server.asked.filter((one) => one.method === "PUT" && one.path === "/v1/push-tokens").map((one) => one.body);
const tapFor = (gymId: string) => ({ notification: { request: { identifier: `n-${gymId}`, content: { data: { kind: "gym_inbox", gymId } } } } });

async function open(server: ReturnType<typeof fakeServer>) {
  await render(<App extra={extra} ask={server.ask} store={memoryStore(kept(1))} wait={noWait} />);
  await screen.findAllByRole("tab");
  await settle();
}

beforeEach(() => {
  reset();
  secureStore.kept.clear();
});

describe("asking for notifications", () => {
  it("says why first; Android asks only after Continue, and the phone's address goes to the server", async () => {
    notifications.permission = ASK;
    notifications.afterAsk = YES;
    const server = fakeServer(routes());
    await open(server);
    expect(await screen.findByText("Turn on notifications?")).toBeTruthy();
    expect(screen.getByText("Get messages and class reminders from your gym, even when the app is closed.")).toBeTruthy();
    expect(notifications.asked).toBe(0);
    expect(addressesGiven(server)).toEqual([]);
    await fireEvent.press(screen.getByRole("button", { name: "Continue" }));
    await settle();
    expect(notifications.asked).toBe(1);
    expect(addressesGiven(server)).toEqual([{ token: "phone-address-1", platform: "android" }]);
    expect(notifications.channels).toEqual([expect.objectContaining({ id: "gym-messages", name: "Gym messages" })]);
  });

  it("Not now asks nothing of Android, gives no address, and is not asked again for two weeks", async () => {
    notifications.permission = ASK;
    const server = fakeServer(routes());
    await open(server);
    await fireEvent.press(await screen.findByRole("button", { name: "Not now" }));
    await settle();
    expect(notifications.asked).toBe(0);
    expect(addressesGiven(server)).toEqual([]);
    expect(screen.queryByText("Turn on notifications?")).toBeNull();
    expect(Number(secureStore.kept.get("notifications-not-now"))).toBeGreaterThan(Date.now() - 60_000);
  });

  it.each([
    ["a day ago", 1, false],
    ["13 days ago", 13, false],
    ["15 days ago", 15, true],
  ])("Not now said %s: asked again only after two weeks", async (_when, days, asked) => {
    notifications.permission = ASK;
    secureStore.kept.set("notifications-not-now", String(Date.now() - days * 24 * 3_600_000));
    await open(fakeServer(routes()));
    expect(screen.queryByText("Turn on notifications?") !== null).toBe(asked);
  });

  it("allowed already: the address goes on opening, with no question", async () => {
    notifications.permission = YES;
    const server = fakeServer(routes());
    await open(server);
    expect(screen.queryByText("Turn on notifications?")).toBeNull();
    expect(addressesGiven(server)).toEqual([{ token: "phone-address-1", platform: "android" }]);
  });

  it("turned off in Android: no question and no address", async () => {
    notifications.permission = NO;
    const server = fakeServer(routes());
    await open(server);
    expect(screen.queryByText("Turn on notifications?")).toBeNull();
    expect(addressesGiven(server)).toEqual([]);
  });

  it("a new address from Firebase is given again", async () => {
    notifications.permission = YES;
    const server = fakeServer(routes());
    await open(server);
    const listener = (jest.requireMock<{ notifications: { tokenListeners: ((t: unknown) => void)[] } }>("expo-notifications")).notifications.tokenListeners[0];
    await act(async () => {
      listener?.({ type: "android", data: "phone-address-2" });
      await Promise.resolve();
    });
    await settle();
    expect(addressesGiven(server).at(-1)).toEqual({ token: "phone-address-2", platform: "android" });
  });
});

describe("a tapped notification", () => {
  it("opens that gym's Inbox on the Gym tab, and its notification comes off the phone", async () => {
    notifications.permission = YES;
    notifications.presented = [
      { request: { identifier: "iron", content: { data: { kind: "gym_inbox", gymId: IRON.id } } } },
      { request: { identifier: "other", content: { data: { kind: "gym_inbox", gymId: STRANGER_GYM } } } },
    ];
    await open(fakeServer(routes()));
    await act(async () => {
      for (const tap of notifications.taps) tap(tapFor(IRON.id));
      await Promise.resolve();
    });
    const page = within(await screen.findByTestId("inbox-page"));
    expect(await page.findByText("Class moved to 7 pm.")).toBeTruthy();
    await settle();
    expect(notifications.dismissed).toEqual(["iron"]);
    // With that Inbox open, the gym's next notification is not shown over it; another gym's is.
    const show = (gymId: string) => notifications.handler?.handleNotification({ request: { content: { data: { kind: "gym_inbox", gymId } } } });
    expect((await show(IRON.id))?.shouldShowBanner).toBe(false);
    expect((await show(STRANGER_GYM))?.shouldShowBanner).toBe(true);
  });

  it("the one that opened the app opens its Inbox too", async () => {
    notifications.permission = YES;
    notifications.last = tapFor(IRON.id);
    await open(fakeServer(routes()));
    expect(await within(await screen.findByTestId("inbox-page")).findByText("Class moved to 7 pm.")).toBeTruthy();
  });

  it("a gym that is not one of this person's opens nothing", async () => {
    notifications.permission = YES;
    await open(fakeServer(routes()));
    await act(async () => {
      for (const tap of notifications.taps) tap(tapFor(STRANGER_GYM));
      await Promise.resolve();
    });
    await settle();
    expect(screen.queryByTestId("inbox-page")).toBeNull();
  });
});

describe("signing out", () => {
  it("takes every notification off the phone and has Firebase forget its address", async () => {
    notifications.permission = YES;
    await open(fakeServer(routes({ "/v1/auth/logout": ok({}) })));
    const tabs = await screen.findAllByRole("tab");
    const me = tabs[4];
    if (me === undefined) throw new Error("no Me tab");
    await fireEvent.press(me);
    await fireEvent.press(await screen.findByRole("button", { name: "Sign out" }));
    const box = await screen.findAllByRole("button", { name: "Sign out" });
    const confirm = box.at(-1);
    if (confirm === undefined) throw new Error("no Sign out in the box");
    await fireEvent.press(confirm);
    await settle();
    expect(notifications.dismissedAll).toBeGreaterThanOrEqual(1);
    expect(notifications.unregistered).toBeGreaterThanOrEqual(1);
  });
});
