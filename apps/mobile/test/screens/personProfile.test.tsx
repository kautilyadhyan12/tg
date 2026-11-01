import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { AppState } from "react-native";
import { leaderboardProfileResponseSchema, leaderboardResponseSchema, personGymPostsResponseSchema, gymPostsResponseSchema } from "@app/shared";
import { App } from "../../src/App";
import { placeStats, postsStat } from "../../src/screens/gym/personView";
import type { Ask } from "../../src/session/calls";
import { fakeServer as kitServer, kept, lost, memoryStore, never, refusal, tokens, type Reply, type Route } from "../kit";

const extra = { copyName: "Feature 1", apiUrl: "http://localhost:3000" };
const noWait = () => Promise.resolve();
const ok = (body: unknown) => (): Reply => ({ status: 200, body });

/** The kit's server, with routes that also name their query. */
function fakeServer(routes: Record<string, Route>) {
  const server = kitServer(routes);
  const ask: Ask = async (url, init) => {
    const { pathname, search } = new URL(url);
    const exact = search === "" ? undefined : routes[pathname + search];
    if (exact === undefined) return server.ask(url.replace(search, ""), init);
    server.asked.push({ method: init.method ?? "GET", path: pathname + search, body: undefined, headers: init.headers ?? {} });
    const reply = await exact(undefined);
    return { ok: reply.status >= 200 && reply.status < 300, status: reply.status, json: () => Promise.resolve(reply.body) };
  };
  return { ...server, ask };
}

const IRON = { id: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f", name: "Iron House" };
const myGyms = ok({
  orgs: [{ ...IRON, city: null, orgType: "gym", clockFormat: "12h", slug: "iron-house", timezone: "UTC", locale: "en", currencyDisplay: "INR", status: "active", staffRole: null, isMember: true, joinedAt: "2026-10-01T00:00:00.000Z" }],
  formerOrgs: [],
});

const TOM = "11111111-1111-4111-8111-111111111111";
const PRIYA = "22222222-2222-4222-8222-222222222222";
const P1 = "a1111111-1111-4111-8111-111111111111";
const P2 = "a2222222-2222-4222-8222-222222222222";
const BLOCK = "b1111111-1111-4111-8111-111111111111";
const PHOTO = "c1111111-1111-4111-8111-111111111111";
const STAFF_POST = "a3333333-3333-4333-8333-333333333333";

type Row = Record<string, unknown>;
const post = (id: string, over: Row = {}): Row => ({
  id,
  author: { name: "Tom B.", initials: "TB" },
  body: `Words of ${id}`,
  photos: [],
  pinned: false,
  createdAt: "2026-10-28T09:05:00.000Z",
  reactions: { like: 0, love: 0, strong: 0, fire: 0 },
  mine: null,
  fromMember: true,
  authorId: TOM,
  own: false,
  wrote: false,
  reported: false,
  hidden: false,
  commentCount: 0,
  challengeResult: null,
  ...over,
});
const feed = (posts: Row[]) =>
  gymPostsResponseSchema.parse({ gymId: IRON.id, gymName: IRON.name, pinned: [], posts, next: null, status: "shown", posting: "off", commenting: "on", blockedCount: 0, supportEmail: null });
const theirPosts = (posts: Row[], over: Row = {}) => personGymPostsResponseSchema.parse({ posts, next: null, total: posts.length, blocked: false, commenting: "on", blockedCount: 0, ...over });
const places = (userId = TOM, name = "Tom B.") =>
  leaderboardProfileResponseSchema.parse({
    userId,
    name,
    initials: "TB",
    boards: [
      { board: "gym_days", period: "this_week", place: 3, value: 4 },
      { board: "streak", period: null, place: 5, value: 2 },
    ],
  });
const noPlaces = (): Reply => refusal(404, "org_not_found", "Organisation not found.");

const FEED = `/v1/orgs/${IRON.id}/posts`;
const POSTS_OF = (id = TOM) => `/v1/orgs/${IRON.id}/posts/people/${id}`;
const PLACES_OF = (id = TOM) => `/v1/orgs/${IRON.id}/leaderboard/people/${id}?period=this_week`;
const ROUTES = {
  "/v1/auth/refresh": ok({ tokens: tokens(2) }),
  "/v1/orgs/mine": myGyms,
  [FEED]: ok(feed([post(P1), post(STAFF_POST, { fromMember: false, authorId: null, author: { name: "Sam Coach", initials: "SC" } })])),
};

async function openUpdates(ask: Ask) {
  await render(<App extra={extra} ask={ask} store={memoryStore(kept(1))} wait={noWait} />);
  const tab = (await screen.findAllByRole("tab"))[3];
  if (tab === undefined) throw new Error("no fourth tab");
  await fireEvent.press(tab);
  await fireEvent.press(await screen.findByLabelText(`Updates at ${IRON.name}`));
}
async function openTom(ask: Ask) {
  await openUpdates(ask);
  await fireEvent.press(await screen.findByLabelText("See Tom B.'s profile"));
  return screen.findByTestId("person-profile");
}
const profilePage = () => within(screen.getByTestId("person-profile"));
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 30)));
function listenForComeBack(): () => Promise<void> {
  const listeners: ((state: string) => void)[] = [];
  jest.spyOn(AppState, "addEventListener").mockImplementation((_type, handler) => {
    listeners.push(handler as (state: string) => void);
    return { remove: () => undefined };
  });
  return async () => {
    await act(() => {
      for (const listener of listeners) listener("active");
    });
  };
}
afterEach(() => {
  jest.restoreAllMocks();
});

describe("the worst thing: somebody is shown what they chose to keep, or what is another person's", () => {
  it("a hidden person's profile opens with their posts and no place, number or streak", async () => {
    const { ask } = fakeServer({ ...ROUTES, [POSTS_OF()]: ok(theirPosts([post(P1)])), [PLACES_OF()]: noPlaces });
    await openTom(ask);
    expect(await profilePage().findByText("Words of " + P1)).toBeTruthy();
    expect(profilePage().getAllByText("Tom B.").length).toBeGreaterThan(0);
    expect(within(profilePage().getByTestId("person-stats")).getByText("1")).toBeTruthy();
    expect(profilePage().queryByTestId("stat-gym_days")).toBeNull();
    expect(profilePage().queryByTestId("stat-streak")).toBeNull();
    expect(profilePage().queryByText("Visits")).toBeNull();
    // Nothing on the page says they are hidden: that a person is on no board is theirs to know.
    expect(profilePage().queryByText(/hidden|Hide me/i)).toBeNull();
  });

  it("somebody who turns Hide me on while the page is open: their places leave at the next read", async () => {
    const come = listenForComeBack();
    let hidden = false;
    const { ask } = fakeServer({ ...ROUTES, [POSTS_OF()]: ok(theirPosts([post(P1)])), [PLACES_OF()]: () => (hidden ? noPlaces() : { status: 200, body: places() }) });
    await openTom(ask);
    expect(await profilePage().findByTestId("stat-gym_days")).toBeTruthy();
    hidden = true;
    await come();
    await waitFor(() => {
      expect(profilePage().queryByTestId("stat-gym_days")).toBeNull();
    });
  });

  it("an older slow answer never brings back the places of somebody a newer answer hid", async () => {
    const come = listenForComeBack();
    const replies: ((reply: Reply) => void)[] = [];
    const { ask } = fakeServer({
      ...ROUTES,
      [POSTS_OF()]: ok(theirPosts([post(P1)])),
      [PLACES_OF()]: () =>
        new Promise<Reply>((resolve) => {
          replies.push(resolve);
        }),
    });
    await openTom(ask);
    await waitFor(() => {
      expect(replies).toHaveLength(1);
    });
    await come();
    await waitFor(() => {
      expect(replies).toHaveLength(2);
    });
    await act(async () => {
      replies[1]?.(noPlaces());
      await Promise.resolve();
    });
    await settle();
    await act(async () => {
      replies[0]?.({ status: 200, body: places() });
      await Promise.resolve();
    });
    await settle();
    expect(profilePage().queryByTestId("stat-gym_days")).toBeNull();
  });

  it("an answer naming somebody else is never drawn under this person", async () => {
    const { ask } = fakeServer({ ...ROUTES, [POSTS_OF()]: ok(theirPosts([])), [PLACES_OF()]: ok(places(PRIYA, "Priya S.")) });
    await openTom(ask);
    await settle();
    expect(profilePage().queryByTestId("stat-gym_days")).toBeNull();
    expect(profilePage().queryByText("Priya S.")).toBeNull();
  });

  it("a row of the board opens that person, and Back then another row opens the other", async () => {
    const board = leaderboardResponseSchema.parse({
      gymId: IRON.id,
      gymName: IRON.name,
      timezone: "UTC",
      board: "gym_days",
      period: "this_week",
      from: "2026-10-26",
      to: "2026-11-01",
      circleDays: null,
      status: "shown",
      ranked: 3,
      rows: [
        { userId: TOM, name: "Tom B.", initials: "TB", place: 1, value: 5, circles: null, isMe: false },
        { userId: PRIYA, name: "Priya S.", initials: "PS", place: 2, value: 4, circles: null, isMe: false },
      ],
      me: { value: 1, place: 3, hidden: null, toNextPlace: 3, nextPlace: 2, circles: null },
      boardsOff: [],
      asOf: "2026-11-01T10:00:00.000Z",
    });
    const server = fakeServer({
      ...ROUTES,
      [`/v1/orgs/${IRON.id}/leaderboard?board=gym_days&period=this_week`]: ok(board),
      "/v1/users/me/leaderboard": ok({ hidden: false, hideMe: false, under18: false }),
      [POSTS_OF()]: ok(theirPosts([])),
      [PLACES_OF()]: ok(places()),
      [POSTS_OF(PRIYA)]: ok(theirPosts([])),
      [PLACES_OF(PRIYA)]: noPlaces,
    });
    await render(<App extra={extra} ask={server.ask} store={memoryStore(kept(1))} wait={noWait} />);
    const tab = (await screen.findAllByRole("tab"))[3];
    if (tab === undefined) throw new Error("no fourth tab");
    await fireEvent.press(tab);
    await fireEvent.press(await screen.findByLabelText(`Leaderboard at ${IRON.name}`));
    await fireEvent.press(await screen.findByLabelText("1st, Tom B., see their profile"));
    expect(await profilePage().findByTestId("stat-gym_days")).toBeTruthy();
    await fireEvent.press(profilePage().getByLabelText("Back"));
    await fireEvent.press(await screen.findByLabelText("2nd, Priya S., see their profile"));
    expect(await profilePage().findByText("Priya S. hasn't posted anything.")).toBeTruthy();
    expect(profilePage().queryByTestId("stat-gym_days")).toBeNull();
  });

  it("somebody you blocked: no post of theirs, why, and the list that unblocks them, which brings them back", async () => {
    let unblocked = false;
    const { ask } = fakeServer({
      ...ROUTES,
      [POSTS_OF()]: () => ({ status: 200, body: unblocked ? theirPosts([post(P1)]) : theirPosts([], { blocked: true, blockedCount: 1 }) }),
      [PLACES_OF()]: noPlaces,
      [`${FEED}/blocked`]: ok({ people: [{ id: BLOCK, name: "Tom B.", initials: "TB", blockedAt: "2026-10-30T09:00:00.000Z" }] }),
      [`${FEED}/blocked/${BLOCK}`]: () => {
        unblocked = true;
        return { status: 200, body: { blocked: false } };
      },
    });
    await openTom(ask);
    expect(await profilePage().findByText("You've blocked Tom B., so their posts aren't shown.")).toBeTruthy();
    await fireEvent.press(profilePage().getByText("People you've blocked"));
    await fireEvent.press(await screen.findByLabelText("Unblock Tom B."));
    expect(await profilePage().findByText("Words of " + P1)).toBeTruthy();
  });

  it("blocking takes their posts away and says why before any read answers", async () => {
    let blocked = false;
    let answerRead: (reply: Reply) => void = () => undefined;
    const server = fakeServer({
      ...ROUTES,
      [POSTS_OF()]: () =>
        blocked
          ? new Promise<Reply>((resolve) => {
              answerRead = resolve;
            })
          : { status: 200, body: theirPosts([post(P1)], { next: "2026-10-28T09:05:00.000Z_x", total: 25 }) },
      [PLACES_OF()]: noPlaces,
      [`${FEED}/${P1}/block`]: () => {
        blocked = true;
        return { status: 200, body: { blocked: true } };
      },
    });
    await openTom(server.ask);
    await fireEvent.press(await profilePage().findByLabelText("Post options"));
    await fireEvent.press(await profilePage().findByLabelText("Block Tom B."));
    await fireEvent.press(await screen.findByText("Block Tom B."));
    expect(await profilePage().findByText("You've blocked Tom B., so their posts aren't shown.")).toBeTruthy();
    expect(profilePage().queryByText("Words of " + P1)).toBeNull();
    expect(profilePage().queryByText("Tom B. hasn't posted anything.")).toBeNull();
    expect(profilePage().queryByText("Show older posts")).toBeNull();
    expect(within(profilePage().getByTestId("stat-posts")).getByText("0")).toBeTruthy();
    await act(async () => {
      answerRead({ status: 200, body: theirPosts([], { blocked: true, blockedCount: 1 }) });
      await Promise.resolve();
    });
  });

  const blockTom = (blockAnswer: () => Reply | Promise<Reply>) => {
    let blocked = false;
    return fakeServer({
      ...ROUTES,
      [FEED]: () => ({ status: 200, body: feed(blocked ? [] : [post(P1)]) }),
      [POSTS_OF()]: () => ({ status: 200, body: blocked ? theirPosts([], { blocked: true, blockedCount: 1 }) : theirPosts([post(P1)]) }),
      [PLACES_OF()]: noPlaces,
      [`${FEED}/${P1}/block`]: async () => {
        const reply = await blockAnswer();
        blocked = true;
        return reply;
      },
    });
  };
  const blockedReply = { status: 200, body: { blocked: true } };
  const updatesReads = (server: ReturnType<typeof fakeServer>) => server.asked.filter((a) => a.path === FEED).length;
  const pressBlock = async () => {
    await fireEvent.press(await profilePage().findByLabelText("Post options"));
    await fireEvent.press(await profilePage().findByLabelText("Block Tom B."));
    await fireEvent.press(await screen.findByText("Block Tom B."));
  };

  it("a block, then the on-screen Back: Updates no longer shows them", async () => {
    const server = blockTom(() => blockedReply);
    await openTom(server.ask);
    await pressBlock();
    await fireEvent.press(await screen.findByText("Done"));
    await fireEvent.press(profilePage().getByLabelText("Back"));
    await waitFor(() => {
      expect(screen.queryByLabelText("See Tom B.'s profile")).toBeNull();
    });
  });

  it("a block, then the phone's own Back: Updates no longer shows them", async () => {
    const server = blockTom(() => blockedReply);
    await openTom(server.ask);
    await pressBlock();
    await fireEvent.press(await screen.findByText("Done"));
    await fireEvent(screen.getByTestId("person-profile"), "requestClose");
    await waitFor(() => {
      expect(screen.queryByLabelText("See Tom B.'s profile")).toBeNull();
    });
  });

  it("a block answered after the page has closed: Updates reads again then, and no longer shows them", async () => {
    let answer: (reply: Reply) => void = () => undefined;
    const server = blockTom(
      () =>
        new Promise<Reply>((resolve) => {
          answer = resolve;
        }),
    );
    await openTom(server.ask);
    await pressBlock();
    await fireEvent(screen.getByTestId("person-profile"), "requestClose");
    await settle();
    expect(screen.queryByTestId("person-list")).toBeNull();
    answer(blockedReply);
    await waitFor(() => {
      expect(screen.queryByLabelText("See Tom B.'s profile")).toBeNull();
    });
  });

  it("nothing pressed: leaving reads Updates no more than it did", async () => {
    const server = blockTom(() => blockedReply);
    await openTom(server.ask);
    await profilePage().findByText("Words of " + P1);
    const before = updatesReads(server);
    await fireEvent(screen.getByTestId("person-profile"), "requestClose");
    await settle();
    expect(updatesReads(server)).toBe(before);
  });
});

describe("the numbers, in words", () => {
  it("each board's place and how much, one post and many, and a place not yet earned", () => {
    expect(postsStat(1)).toMatchObject({ number: "1", label: "Post" });
    expect(postsStat(0)).toMatchObject({ number: "0", label: "Posts" });
    expect(postsStat(null)).toMatchObject({ number: "–", label: "Posts" });
    const stats = placeStats(
      [
        { board: "gym_days", period: "last_month", place: 1, value: 9 },
        { board: "workout_days", period: "last_month", place: null, value: 0 },
        { board: "streak", period: null, place: 2, value: 1 },
      ],
      "last_month",
    );
    expect(stats).toEqual([
      { key: "gym_days", number: "1st", label: "Visits", under: "9 visits last month" },
      { key: "workout_days", number: "–", label: "Workout days", under: "0 workout days last month" },
      { key: "streak", number: "2nd", label: "Streak", under: "1 week" },
    ]);
  });
});

describe("the page", () => {
  it("a member's name on Updates opens them; a post the staff wrote opens nobody", async () => {
    const { ask } = fakeServer({ ...ROUTES, [POSTS_OF()]: ok(theirPosts([post(P1)])), [PLACES_OF()]: ok(places()) });
    await openUpdates(ask);
    await screen.findByLabelText("See Tom B.'s profile");
    expect(screen.queryByLabelText("See Sam Coach's profile")).toBeNull();
    expect(screen.queryByTestId(`person-open-${STAFF_POST}`)).toBeNull();
  });

  it("shows the name, the gym and the numbers, as the board has them", async () => {
    const { ask } = fakeServer({ ...ROUTES, [POSTS_OF()]: ok(theirPosts([post(P1), post(P2)])), [PLACES_OF()]: ok(places()) });
    await openTom(ask);
    expect(await profilePage().findByText("Member at Iron House")).toBeTruthy();
    const visits = within(await profilePage().findByTestId("stat-gym_days"));
    expect(visits.getByText("3rd")).toBeTruthy();
    expect(visits.getByText("Visits")).toBeTruthy();
    expect(visits.getByText("4 visits this week")).toBeTruthy();
    const streak = within(profilePage().getByTestId("stat-streak"));
    expect(streak.getByText("5th")).toBeTruthy();
    expect(streak.getByText("2 weeks")).toBeTruthy();
    expect(within(profilePage().getByTestId("stat-posts")).getByText("2")).toBeTruthy();
    expect(within(profilePage().getByTestId("stat-posts")).getByText("Posts")).toBeTruthy();
  });

  it("somebody with no posts says so", async () => {
    const { ask } = fakeServer({ ...ROUTES, [POSTS_OF()]: ok(theirPosts([])), [PLACES_OF()]: noPlaces });
    await openTom(ask);
    expect(await profilePage().findByText("Tom B. hasn't posted anything.")).toBeTruthy();
    expect(within(profilePage().getByTestId("person-stats")).getByText("Posts")).toBeTruthy();
  });

  it("no answer: says so, offers Try again, and neither list invents anything", async () => {
    let up = false;
    const { ask } = fakeServer({
      ...ROUTES,
      [POSTS_OF()]: () => (up ? { status: 200, body: theirPosts([post(P1)]) } : lost()),
      [PLACES_OF()]: () => (up ? { status: 200, body: places() } : lost()),
    });
    await openTom(ask);
    expect(await profilePage().findByText("Couldn't load their posts.")).toBeTruthy();
    expect(await profilePage().findByText("Couldn't load their places on the leaderboard.")).toBeTruthy();
    expect(within(profilePage().getByTestId("stat-posts")).getByText("–")).toBeTruthy();
    up = true;
    await fireEvent.press(profilePage().getByLabelText("Try their places again"));
    expect(await profilePage().findByTestId("stat-gym_days")).toBeTruthy();
    await fireEvent.press(profilePage().getByText("Try again"));
    expect(await profilePage().findByText("Words of " + P1)).toBeTruthy();
  });

  it("coming back with no answer keeps what is on screen; a 404 takes the posts away", async () => {
    const come = listenForComeBack();
    let state: "up" | "lost" | "gone" = "up";
    const { ask } = fakeServer({
      ...ROUTES,
      [POSTS_OF()]: () => (state === "up" ? { status: 200, body: theirPosts([post(P1)]) } : state === "lost" ? lost() : noPlaces()),
      [PLACES_OF()]: ok(places()),
    });
    await openTom(ask);
    await profilePage().findByText("Words of " + P1);
    state = "lost";
    await come();
    await settle();
    expect(profilePage().getByText("Words of " + P1)).toBeTruthy();
    state = "gone";
    await come();
    expect(await profilePage().findByText("Iron House's updates aren't available right now.")).toBeTruthy();
    expect(profilePage().queryByText("Words of " + P1)).toBeNull();
  });

  it("Show older posts adds the next page, never one twice, and says when it fails", async () => {
    const next = "2026-10-28T09:05:00.000Z_x";
    let fails = true;
    const { ask } = fakeServer({
      ...ROUTES,
      [POSTS_OF()]: ok(theirPosts([post(P1)], { next, total: 2 })),
      [`${POSTS_OF()}?before=${encodeURIComponent(next)}`]: () => (fails ? lost() : { status: 200, body: theirPosts([post(P1), post(P2)], { total: 2 }) }),
      [PLACES_OF()]: noPlaces,
    });
    await openTom(ask);
    await fireEvent.press(await profilePage().findByText("Show older posts"));
    expect(await profilePage().findByText("Couldn't load more.")).toBeTruthy();
    fails = false;
    await fireEvent.press(profilePage().getByText("Show older posts"));
    expect(await profilePage().findByText("Words of " + P2)).toBeTruthy();
    expect(profilePage().getAllByText("Words of " + P1)).toHaveLength(1);
    expect(profilePage().queryByText("Show older posts")).toBeNull();
  });

  it("a first read overtaken by one that gets no answer ends in Try again, not Loading", async () => {
    const come = listenForComeBack();
    const { ask } = fakeServer({ ...ROUTES, [POSTS_OF()]: never, [PLACES_OF()]: never });
    let reads = 0;
    const counted: Ask = (url, init) => {
      if (new URL(url).pathname === POSTS_OF() && ++reads === 2) throw new Error("no connection");
      return ask(url, init);
    };
    await openTom(counted);
    await come();
    expect(await profilePage().findByText("Couldn't load their posts.")).toBeTruthy();
    expect(profilePage().queryByText("Loading…")).toBeNull();
  });

  it("each press a post offers works from the profile: react, comment, report and photos", async () => {
    const server = fakeServer({
      ...ROUTES,
      [POSTS_OF()]: ok(theirPosts([post(P1, { photos: [{ id: PHOTO, width: 1600, height: 1200 }] })])),
      [PLACES_OF()]: noPlaces,
      [`${FEED}/${P1}/reaction`]: () => ({ status: 200, body: { reactions: { like: 0, love: 0, strong: 0, fire: 1 }, mine: "fire" } }),
      [`${FEED}/${P1}/report`]: ok({ reported: true }),
      [`${FEED}/${P1}/comments`]: ok({ comments: [], next: null, commenting: "on" }),
    });
    await openTom(server.ask);
    const card = within(await profilePage().findByTestId(`post-${P1}`));
    expect(await card.findByTestId(`photo-${PHOTO}`)).toBeTruthy();
    // No name on a post of a profile: the page already says whose it is.
    expect(card.queryByText("Tom B.")).toBeNull();
    await fireEvent.press(card.getByTestId("react-open"));
    await fireEvent.press(card.getByTestId("react-fire"));
    expect(await card.findByLabelText("Reactions: Fire, 1 person, including you. Choose a reaction")).toBeTruthy();
    await fireEvent.press(card.getByTestId("comments-open"));
    expect(await profilePage().findByText("Comments")).toBeTruthy();
    await fireEvent.press(profilePage().getByLabelText("Close"));
    await fireEvent.press(card.getByLabelText("Post options"));
    await fireEvent.press(await profilePage().findByLabelText("Report this post by Tom B."));
    await fireEvent.press(await screen.findByLabelText("Spam or selling"));
    await fireEvent.press(screen.getByLabelText("Send report"));
    expect(await screen.findByText("Reported. The staff at Iron House will look at it.")).toBeTruthy();
    expect(server.asked.filter((a) => a.path.endsWith("/report")).map((a) => a.body)).toEqual([{ reason: "spam" }]);
  });

  it.each([
    ["on", true],
    ["stopped", true],
    ["off", false],
  ] as const)("comments %s at this place: the button shows is %s", async (commenting, shows) => {
    const { ask } = fakeServer({ ...ROUTES, [POSTS_OF()]: ok(theirPosts([post(P1)], { commenting })), [PLACES_OF()]: noPlaces });
    await openTom(ask);
    const card = within(await profilePage().findByTestId(`post-${P1}`));
    expect(card.queryByTestId("comments-open") !== null).toBe(shows);
  });

  it("removing your own post from your own profile lowers the count", async () => {
    const { ask } = fakeServer({
      ...ROUTES,
      [POSTS_OF()]: ok(theirPosts([post(P1, { own: true, wrote: true }), post(P2, { own: true, wrote: true })])),
      [PLACES_OF()]: ok(places()),
      [`${FEED}/mine/${P1}`]: ok({ removed: true }),
    });
    await openTom(ask);
    await profilePage().findByText("Words of " + P1);
    const card = within(profilePage().getByTestId(`post-${P1}`));
    await fireEvent.press(card.getByLabelText("Post options"));
    await fireEvent.press(await screen.findByLabelText("Remove your post"));
    await fireEvent.press(await screen.findByText("Remove post"));
    await screen.findByText("Your post has been removed.");
    expect(within(profilePage().getByTestId("stat-posts")).getByText("1")).toBeTruthy();
    expect(within(profilePage().getByTestId("stat-posts")).getByText("Post")).toBeTruthy();
  });
});

