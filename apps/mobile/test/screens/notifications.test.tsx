import { act, fireEvent, render, screen, within } from "@testing-library/react-native";
import { App } from "../../src/App";
import { PUSH_TASK, drawPush, startPushTask } from "../../src/notifications/drawn";
import { RAVI, fakeServer, kept, memoryStore, refusal, tokens, type Reply, type Route } from "../kit";

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
  received: ((notification: unknown) => void)[];
  scheduled: { identifier: string; content: unknown; trigger: unknown }[];
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
const POST = "a1111111-1111-4111-8111-111111111111";
const MEERA = { ...RAVI, id: "0e3d7a11-58a4-4f0b-8f1d-6c2b9a7e4d10", email: "meera@example.com", displayName: "Meera" };
/** A message as Firebase hands it to the app's task: the server's words, for `to`. */
const pushed = (data: Record<string, unknown>, heading = "Iron House", text = "Words.", to: string = RAVI.id) => ({
  data: { heading, text, to, body: JSON.stringify(data), dataString: JSON.stringify(data), channelId: "gym-messages", tag: "t" },
});
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

afterEach(() => {
  jest.restoreAllMocks();
});

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
    expect(screen.getByText("Get messages, free places and comments, even when the app is closed.")).toBeTruthy();
    expect(notifications.asked).toBe(0);
    expect(addressesGiven(server)).toEqual([]);
    await fireEvent.press(screen.getByRole("button", { name: "Continue" }));
    await settle();
    expect(notifications.asked).toBe(1);
    expect(addressesGiven(server)).toEqual([{ token: "phone-address-1", platform: "android" }]);
    expect(notifications.channels).toEqual([
      expect.objectContaining({ id: "gym-messages", name: "Messages" }),
      expect.objectContaining({ id: "gym-places", name: "Classes and events" }),
      expect.objectContaining({ id: "gym-comments", name: "Comments" }),
    ]);
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

  it("a tap heard before the tabs are drawn (the app opened by it) is kept and opens its Inbox", async () => {
    notifications.permission = YES;
    for (const tap of notifications.taps) tap(tapFor(IRON.id));
    await open(fakeServer(routes()));
    expect(await within(await screen.findByTestId("inbox-page")).findByText("Class moved to 7 pm.")).toBeTruthy();
  });

  it("a tap while the places cannot be read is kept, and opens its Inbox once they are", async () => {
    notifications.permission = YES;
    let up = false;
    await open(
      fakeServer(
        routes({
          "/v1/orgs/mine": (): Reply => {
            return !up ? { status: 503, body: { error: "unavailable", message: "Try again." } } : { status: 200, body: { orgs: [org(IRON)], formerOrgs: [] } };
          },
        }),
      ),
    );
    await act(async () => {
      for (const tap of notifications.taps) tap(tapFor(IRON.id));
      await Promise.resolve();
    });
    await settle();
    expect(screen.queryByTestId("inbox-page")).toBeNull();
    up = true;
    await fireEvent.press((await screen.findAllByRole("button", { name: "Try again" }))[0] ?? screen.getByText("Try again"));
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
    // Signed out, one that still arrives while the app is open is shown to nobody.
    const shown = await notifications.handler?.handleNotification({ request: { content: { data: { kind: "gym_inbox", gymId: IRON.id } } } });
    expect(shown?.shouldShowBanner).toBe(false);
  });
});

// ── 18b-ii-a: a place in a class or an event ──

describe("a tapped notification about a place", () => {
  const SESSION = "11111111-1111-4111-8111-111111111111";
  const EVENT = "22222222-2222-4222-8222-222222222222";
  /** A day on the gym's clock (India), this many days from today. */
  const daysOn = (n: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(Date.now() + n * 86_400_000);
  const placeTap = (gymId: string, what: "class" | "event", id: string, day = daysOn(0)) => ({
    notification: { request: { identifier: `p-${id}`, content: { data: { kind: "gym_place", gymId, what, id, day } } } },
  });
  const flow = {
    sessionId: SESSION,
    className: "Morning Flow",
    localDate: "2099-11-16",
    localStartMinute: 18 * 60,
    timezone: "Asia/Kolkata",
    startsAt: "2099-11-16T12:30:00.000Z",
    minutes: 45,
    cancelled: false,
    places: 12,
    booked: 12,
    waitlisted: 0,
    opensAt: "2099-11-09T12:30:00.000Z",
    freeCancelUntil: "2099-11-16T10:30:00.000Z",
    mine: { status: "booked", waitlistPlace: null, packCharged: false },
    can: { book: false, joinWaitlist: false, claim: false, cancel: "free", why: null },
    online: null,
    fees: null,
  };
  const openDay = {
    id: EVENT,
    name: "Saturday Open Day",
    details: "",
    place: "",
    startsOn: "2099-11-02",
    startMinute: 600,
    endsOn: "2099-11-02",
    endMinute: 780,
    startsAt: "2099-11-02T04:30:00.000Z",
    endsAt: "2099-11-02T07:30:00.000Z",
    places: 30,
    cancelled: false,
    poster: null,
    going: { coming: 1, waiting: 0, mine: { status: "coming", waitlistPlace: null }, can: { come: false, joinWaitlist: false, claim: false, cancel: true, why: null } },
  };
  const placeRoutes = () =>
    routes({
      [`/v1/orgs/${IRON.id}/member-classes`]: ok({ week: 2, from: "2099-11-15", to: "2099-11-21", timezone: "Asia/Kolkata", classes: [flow], more: false }),
      [`/v1/orgs/${IRON.id}/events`]: ok({ gymId: IRON.id, gymName: IRON.name, timezone: "Asia/Kolkata", today: "2099-10-31", status: "shown", events: [openDay] }),
    });
  /** The server, with every address the app asked for kept whole, its week included. */
  const watched = () => {
    const server = fakeServer(placeRoutes());
    const urls: string[] = [];
    const ask: typeof server.ask = (url, init) => {
      urls.push(url);
      return server.ask(url, init);
    };
    return { ...server, ask, urls };
  };

  it("a class opens that gym's Classes on the week that holds it now, at the class", async () => {
    notifications.permission = YES;
    const server = watched();
    await open(server);
    await act(async () => {
      for (const tap of notifications.taps) tap(placeTap(IRON.id, "class", SESSION, daysOn(15)));
      await Promise.resolve();
    });
    const page = within(await screen.findByTestId("classes-page"));
    expect(await page.findByText("Morning Flow")).toBeTruthy();
    expect(page.getByTestId("classes-asked")).toBeTruthy();
    expect(server.urls.filter((url) => url.includes("/member-classes"))[0]).toContain("week=2");
  });

  it("a second tap while that gym's Classes is open moves it to the second class's week", async () => {
    notifications.permission = YES;
    const server = watched();
    await open(server);
    await act(async () => {
      for (const tap of notifications.taps) tap(placeTap(IRON.id, "class", SESSION, daysOn(0)));
      await Promise.resolve();
    });
    await screen.findByTestId("classes-page");
    await settle();
    await act(async () => {
      for (const tap of notifications.taps) tap(placeTap(IRON.id, "class", "33333333-3333-4333-8333-333333333333", daysOn(8)));
      await Promise.resolve();
    });
    await settle();
    const weeks = server.urls.filter((url) => url.includes("/member-classes")).map((url) => new URL(url).searchParams.get("week"));
    expect(weeks[0]).toBe("0");
    expect(weeks.at(-1)).toBe("1");
  });

  it("an event opens that gym's Events", async () => {
    notifications.permission = YES;
    await open(watched());
    await act(async () => {
      for (const tap of notifications.taps) tap(placeTap(IRON.id, "event", EVENT));
      await Promise.resolve();
    });
    expect(await within(await screen.findByTestId("events-page")).findByText("Saturday Open Day")).toBeTruthy();
    expect(screen.queryByTestId("inbox-page")).toBeNull();
  });

  it("the one that opened the app opens its class too", async () => {
    notifications.permission = YES;
    notifications.last = placeTap(IRON.id, "class", SESSION);
    await open(watched());
    expect(await within(await screen.findByTestId("classes-page")).findByText("Morning Flow")).toBeTruthy();
  });

  it("a gym that is not one of this person's opens nothing; anything else that is not ours opens nothing", async () => {
    notifications.permission = YES;
    await open(watched());
    await act(async () => {
      for (const tap of notifications.taps) {
        tap(placeTap(STRANGER_GYM, "class", SESSION));
        tap(placeTap(IRON.id, "class", SESSION, "13 Nov"));
        tap({ notification: { request: { identifier: "x", content: { data: { kind: "gym_place", gymId: IRON.id, what: "pt", id: SESSION, day: "2099-11-16" } } } } });
      }
      await Promise.resolve();
    });
    await settle();
    expect(screen.queryByTestId("classes-page")).toBeNull();
    expect(screen.queryByTestId("events-page")).toBeNull();
  });

  it("is shown in the app, and Android names its channel", async () => {
    notifications.permission = YES;
    await open(watched());
    expect(notifications.channels.map((c) => c.name)).toEqual(expect.arrayContaining(["Messages", "Classes and events"]));
    const shown = await notifications.handler?.handleNotification({ request: { content: { data: placeTap(IRON.id, "class", SESSION).notification.request.content.data } } });
    expect(shown?.shouldShowBanner).toBe(true);
  });
});

describe("a tapped notification about a comment", () => {
  const OTHER = "a2222222-2222-4222-8222-222222222222";
  const commentTap = (gymId: string, postId: string) => ({
    notification: { request: { identifier: `c-${postId}`, content: { data: { kind: "gym_comment", gymId, postId } } } },
  });
  const post = (id: string, body: string) => ({
    id,
    author: { name: "Ravi K.", initials: "RK" },
    body,
    photos: [],
    pinned: false,
    createdAt: "2026-10-28T09:05:00.000Z",
    reactions: { like: 0, love: 0, strong: 0, fire: 0 },
    mine: null,
    fromMember: true,
    authorId: "b1111111-1111-4111-8111-111111111111",
    own: true,
    wrote: true,
    reported: false,
    hidden: false,
    commentCount: 1,
    challengeResult: null,
  });
  const comment = {
    id: "c1111111-1111-4111-8111-111111111111",
    postId: POST,
    parentId: null,
    replyingTo: null,
    author: { name: "Asha R.", initials: "AR" },
    body: "Great work this week!",
    createdAt: "2026-10-28T10:00:00.000Z",
    reactions: { like: 0, love: 0, strong: 0, fire: 0 },
    mine: null,
    fromMember: true,
    authorId: "b2222222-2222-4222-8222-222222222222",
    own: false,
    wrote: false,
    reported: false,
    hidden: false,
    replyCount: 0,
  };
  // The tapped post is not on the first page of Updates: only the one-post read finds it.
  const feed = { gymId: IRON.id, gymName: IRON.name, pinned: [], posts: [post(OTHER, "Somebody else's post")], next: "x", status: "shown", posting: "on", commenting: "on", blockedCount: 0, supportEmail: null };
  const commentRoutes = (one: Route = ok({ post: post(POST, "My first deadlift") })) =>
    routes({
      [`/v1/orgs/${IRON.id}/posts`]: ok(feed),
      [`/v1/orgs/${IRON.id}/posts/${POST}`]: one,
      [`/v1/orgs/${IRON.id}/posts/${POST}/comments`]: ok({ comments: [comment], next: null, commenting: "on" }),
    });
  const tap = (data: ReturnType<typeof commentTap>) =>
    act(async () => {
      for (const one of notifications.taps) one(data);
      await Promise.resolve();
    });

  it("opens that gym's Updates with the post's comments open, though the post is far down the list", async () => {
    notifications.permission = YES;
    await open(fakeServer(commentRoutes()));
    await tap(commentTap(IRON.id, POST));
    const updates = within(await screen.findByTestId("updates-page"));
    expect(await updates.findByText("Great work this week!")).toBeTruthy();
    expect(screen.getByTestId("comments-list")).toBeTruthy();
  });

  it("a post since removed says so on Updates, and opens no comments", async () => {
    notifications.permission = YES;
    await open(fakeServer(commentRoutes(() => refusal(404, "post_not_found", "This post is no longer here."))));
    await tap(commentTap(IRON.id, POST));
    const updates = within(await screen.findByTestId("updates-page"));
    expect(await updates.findByText("That post is no longer on Updates.")).toBeTruthy();
    expect(screen.queryByTestId("comments-list")).toBeNull();
  });

  it("a post that cannot be read (no signal, the server's fault) says so, and the list shows as usual", async () => {
    notifications.permission = YES;
    await open(fakeServer(commentRoutes(() => refusal(500, "internal", "Something went wrong."))));
    await tap(commentTap(IRON.id, POST));
    const updates = within(await screen.findByTestId("updates-page"));
    expect(await updates.findByText("Couldn't open that post.")).toBeTruthy();
    expect(await updates.findByText("Somebody else's post")).toBeTruthy();
    expect(screen.queryByTestId("comments-list")).toBeNull();
  });

  it("while that gym's Updates is open, its comments notification is not shown; another gym's is", async () => {
    notifications.permission = YES;
    await open(fakeServer(commentRoutes()));
    await tap(commentTap(IRON.id, POST));
    await screen.findByTestId("updates-page");
    const shown = (gymId: string) => notifications.handler?.handleNotification({ request: { content: { data: { kind: "gym_comment", gymId, postId: POST } } } });
    expect((await shown(IRON.id))?.shouldShowBanner).toBe(false);
    expect((await shown(STRANGER_GYM))?.shouldShowBanner).toBe(true);
  });

  it("opening that gym's Updates takes its comments notification off the phone, and nobody else's", async () => {
    notifications.permission = YES;
    notifications.presented = [
      { request: { identifier: `comments:${IRON.id}`, content: { data: { kind: "gym_comment", gymId: IRON.id, postId: POST } } } },
      { request: { identifier: `comments:${STRANGER_GYM}`, content: { data: { kind: "gym_comment", gymId: STRANGER_GYM, postId: POST } } } },
      { request: { identifier: `inbox:${IRON.id}`, content: { data: { kind: "gym_inbox", gymId: IRON.id } } } },
    ];
    await open(fakeServer(commentRoutes()));
    await tap(commentTap(IRON.id, POST));
    await screen.findByTestId("updates-page");
    await settle();
    expect(notifications.dismissed).toEqual([`comments:${IRON.id}`]);
  });

  it("a gym that is not one of this person's opens nothing", async () => {
    notifications.permission = YES;
    await open(fakeServer(commentRoutes()));
    await tap(commentTap(STRANGER_GYM, POST));
    await tap({ notification: { request: { identifier: "x", content: { data: { kind: "gym_comment", gymId: IRON.id, postId: "not-a-post" } } } } });
    await settle();
    expect(screen.queryByTestId("updates-page")).toBeNull();
  });

  it("arriving, it is drawn once for the gym on the Comments channel", async () => {
    notifications.permission = YES;
    await open(fakeServer(routes()));
    expect(notifications.channels.map((c) => c.name)).toContain("Comments");
    secureStore.kept.set("session", kept(1));
    await act(async () => {
      await drawPush(pushed({ kind: "gym_comment", gymId: IRON.id, postId: POST }, "Iron House · 2 new comments", "Asha R.: Nice"));
    });
    expect(notifications.scheduled).toEqual([
      {
        identifier: `comments:${IRON.id}`,
        content: { title: "Iron House · 2 new comments", body: "Asha R.: Nice", data: { kind: "gym_comment", gymId: IRON.id, postId: POST } },
        trigger: { channelId: "gym-comments" },
      },
    ]);
  });
});

describe("THE WORST THING: a message Firebase hands the phone is drawn only for the person signed in on it", () => {
  const SESSION = "11111111-1111-4111-8111-111111111111";
  const scheduled = () => notifications.scheduled;
  const arrive = (payload: unknown) =>
    act(async () => {
      await drawPush(payload);
    });

  it("drawn for the person signed in, one for each gym's Inbox and each class, on its own channel", async () => {
    secureStore.kept.set("session", kept(1));
    await arrive(pushed({ kind: "gym_inbox", gymId: IRON.id }));
    await arrive(pushed({ kind: "gym_place", gymId: IRON.id, what: "class", id: SESSION, day: "2099-11-16" }));
    expect(scheduled()).toEqual([
      { identifier: `inbox:${IRON.id}`, content: { title: "Iron House", body: "Words.", data: { kind: "gym_inbox", gymId: IRON.id } }, trigger: { channelId: "gym-messages" } },
      {
        identifier: `place:${SESSION}`,
        content: { title: "Iron House", body: "Words.", data: { kind: "gym_place", gymId: IRON.id, what: "class", id: SESSION, day: "2099-11-16" } },
        trigger: { channelId: "gym-places" },
      },
    ]);
  });

  it("signed out (with no signal, so the server still sends), nothing is drawn", async () => {
    secureStore.kept.delete("session");
    await arrive(pushed({ kind: "gym_inbox", gymId: IRON.id }));
    secureStore.kept.set("session", "");
    await arrive(pushed({ kind: "gym_comment", gymId: IRON.id, postId: POST }));
    expect(scheduled()).toEqual([]);
  });

  it("somebody else signed in since, the first person's is not drawn", async () => {
    secureStore.kept.set("session", kept(1, MEERA));
    await arrive(pushed({ kind: "gym_inbox", gymId: IRON.id }));
    await arrive(pushed({ kind: "gym_comment", gymId: IRON.id, postId: POST }));
    expect(scheduled()).toEqual([]);
    await arrive(pushed({ kind: "gym_inbox", gymId: IRON.id }, "Iron House", "Words.", MEERA.id));
    expect(scheduled()).toHaveLength(1);
  });

  it("the app's start defines the task Android runs and registers it, and that task draws for the person signed in", async () => {
    const tasks = jest.requireMock<{ tasks: Map<string, (body: { data: unknown }) => Promise<void>> }>("expo-task-manager").tasks;
    const registered = jest.requireMock<{ notifications: { registeredTasks: string[] } }>("expo-notifications").notifications.registeredTasks;
    tasks.clear();
    registered.length = 0;
    startPushTask();
    expect(registered).toEqual([PUSH_TASK]);
    const task = tasks.get(PUSH_TASK);
    if (task === undefined) throw new Error("no task defined");
    secureStore.kept.set("session", kept(1));
    await act(async () => {
      await task({ data: pushed({ kind: "gym_inbox", gymId: IRON.id }) });
    });
    expect(scheduled()).toHaveLength(1);
  });

  it("anything that is not ours, or names nobody, is not drawn", async () => {
    secureStore.kept.set("session", kept(1));
    const ours = pushed({ kind: "gym_inbox", gymId: IRON.id });
    await arrive({ data: { ...ours.data, to: undefined } });
    await arrive({ data: { title: "Iron House", message: "Words.", body: ours.data.body, channelId: "gym-messages", tag: IRON.id } });
    await arrive(pushed({ kind: "something_else" }));
    await arrive({ data: { ...ours.data, body: "not json" } });
    await arrive(null);
    await arrive({ actionIdentifier: "expo.modules.notifications.actions.DEFAULT", notification: {} });
    expect(scheduled()).toEqual([]);
  });
});
