import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { AppState, Dimensions, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { Directory, File, Paths } from "expo-file-system";
import { launchImageLibraryAsync } from "expo-image-picker";
import { GYM_POST_PHONE_PHOTO_MAX_BYTES, gymPostsResponseSchema } from "@app/shared";
import { App } from "../../src/App";
import type { Ask } from "../../src/session/calls";
import { RAVI, fakeServer, kept, lost, memoryStore, profile, refusal, tokens, type Reply } from "../kit";

const extra = { copyName: "Feature 1", apiUrl: "http://localhost:3000" };
const noWait = () => Promise.resolve();
const ok = (body: unknown) => (): Reply => ({ status: 200, body });

type Place = { id: string; name: string; city: string | null; orgType: string; clockFormat: "12h" | "24h" };
const IRON: Place = { id: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f", name: "Iron House", city: "Pune", orgType: "gym", clockFormat: "12h" };
const LOTUS: Place = { id: "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d", name: "Lotus Yoga", city: null, orgType: "studio", clockFormat: "24h" };
const org = (gym: Place) => ({
  ...gym,
  slug: gym.name.toLowerCase().replace(" ", "-"),
  timezone: "UTC",
  locale: "en",
  currencyDisplay: "INR",
  status: "active",
  staffRole: null,
  isMember: true,
  joinedAt: "2026-10-01T00:00:00.000Z",
});
const mine = (...gyms: Place[]) => ok({ orgs: gyms.map(org), formerOrgs: [] });

const P1 = "a1111111-1111-4111-8111-111111111111";
const P2 = "a2222222-2222-4222-8222-222222222222";
const P3 = "a3333333-3333-4333-8333-333333333333";
const P4 = "a4444444-4444-4444-8444-444444444444";
const ASHA = "b1111111-1111-4111-8111-111111111111";
const PHOTO = "c1111111-1111-4111-8111-111111111111";

type Row = Record<string, unknown>;
const post = (id: string, over: Row = {}): Row => ({
  id,
  author: { name: "Sam Coach", initials: "SC" },
  body: "Pool closed on Sunday.",
  photos: [],
  pinned: false,
  createdAt: "2026-10-28T09:05:00.000Z",
  reactions: { like: 0, love: 0, strong: 0, fire: 0 },
  mine: null,
  fromMember: false,
  authorId: null,
  own: false,
  wrote: false,
  reported: false,
  hidden: false,
  challengeResult: null,
  ...over,
});
const member = (id: string, over: Row = {}) => post(id, { author: { name: "Asha W.", initials: "AW" }, body: "Leg day done!", fromMember: true, authorId: ASHA, ...over });
// Every answer is read through the server's own shape, so a case the server cannot send is not tested here.
const feed = (place: Place, posts: Row[], over: Row = {}) =>
  gymPostsResponseSchema.parse({
    gymId: place.id,
    gymName: place.name,
    pinned: [],
    posts,
    next: null,
    status: "shown",
    posting: "off",
    blockedCount: 0,
    supportEmail: null,
    ...over,
  });

const postsOf = (place: Place) => `/v1/orgs/${place.id}/posts`;
const postOf = (place: Place, id: string) => `${postsOf(place)}/${id}`;

async function openUpdates(ask: Ask, place: Place) {
  await render(<App extra={extra} ask={ask} store={memoryStore(kept(1))} wait={noWait} />);
  const tab = (await screen.findAllByRole("tab"))[3];
  if (tab === undefined) throw new Error("no fourth tab");
  await fireEvent.press(tab);
  await fireEvent.press(await screen.findByLabelText(`Updates at ${place.name}`));
}
const page = () => within(screen.getByTestId("updates-page"));
const download = jest.mocked(File.downloadFileAsync);
const lands = download.getMockImplementation();
afterEach(() => {
  download.mockClear();
  download.mockImplementation(lands);
});
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 30)));
/** Lets a test bring the app back from the background. */
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

describe("the worst thing: no other place's posts here, a blocked person's posts gone, a removed post gone", () => {
  it("each place's page reads and shows only that place's posts", async () => {
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON, LOTUS),
      [postsOf(IRON)]: ok(feed(IRON, [post(P1, { body: "Iron news" })])),
      [postsOf(LOTUS)]: ok(feed(LOTUS, [post(P2, { body: "Lotus news" })])),
    });
    await openUpdates(server.ask, LOTUS);
    expect(await page().findByText("Lotus news")).toBeTruthy();
    expect(page().queryByText("Iron news")).toBeNull();
    expect(server.paths().filter((path) => path.endsWith("/posts"))).toEqual([postsOf(LOTUS)]);

    await fireEvent.press(page().getByLabelText("Back"));
    await fireEvent.press(await screen.findByLabelText(`Updates at ${IRON.name}`));
    expect(await page().findByText("Iron news")).toBeTruthy();
    expect(page().queryByText("Lotus news")).toBeNull();
  });

  it("an answer about another place is never shown under this one", async () => {
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON, LOTUS),
      // A mixed-up answer: Lotus's posts on Iron's address.
      [postsOf(IRON)]: ok(feed(LOTUS, [post(P2, { body: "Lotus news" })])),
    });
    await openUpdates(server.ask, IRON);
    expect(await page().findByText("Couldn't load the updates.")).toBeTruthy();
    expect(page().queryByText("Lotus news")).toBeNull();
  });

  it("a page closed before its answer came never shows that answer under the next place", async () => {
    let release: (reply: Reply) => void = () => undefined;
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON, LOTUS),
      [postsOf(IRON)]: () =>
        new Promise<Reply>((resolve) => {
          release = resolve;
        }),
      [postsOf(LOTUS)]: ok(feed(LOTUS, [post(P2, { body: "Lotus news" })])),
    });
    await openUpdates(server.ask, IRON);
    await waitFor(() => {
      expect(server.paths()).toContain(postsOf(IRON));
    });
    await fireEvent.press(page().getByLabelText("Back"));
    await fireEvent.press(await screen.findByLabelText(`Updates at ${LOTUS.name}`));
    expect(await page().findByText("Lotus news")).toBeTruthy();
    release({ status: 200, body: feed(IRON, [post(P1, { body: "Iron news" })]) });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(page().queryByText("Iron news")).toBeNull();
  });

  it("Block takes every post that member wrote as a member off at once, keeps their staff post, and reads again", async () => {
    let blocked = false;
    const staffPostByAsha = post(P3, { body: "Asha for the desk", author: { name: "Asha Walk", initials: "AW" } });
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [postsOf(IRON)]: () => ({
        status: 200,
        body: blocked
          ? feed(IRON, [staffPostByAsha], { blockedCount: 1 })
          : feed(IRON, [member(P1, { body: "Leg day done!" }), member(P2, { body: "New PR" }), staffPostByAsha]),
      }),
      [`${postOf(IRON, P1)}/block`]: () => {
        blocked = true;
        return { status: 200, body: { blocked: true } };
      },
    });
    await openUpdates(server.ask, IRON);
    expect(await page().findByText("New PR")).toBeTruthy();
    await fireEvent.press(within(page().getByTestId(`post-${P1}`)).getByLabelText("Block Asha W."));
    expect(await screen.findByText(/You won't see the posts Asha W\. writes as a member/)).toBeTruthy();
    await fireEvent.press(within(screen.getByTestId("ask-box")).getByLabelText("Block Asha W."));
    expect(await screen.findByText("Blocked. You won't see the posts Asha W. writes as a member, or their reactions, any more.")).toBeTruthy();
    expect(server.asked.filter((a) => a.path.endsWith("/block")).map((a) => a.method)).toEqual(["PUT"]);
    await fireEvent.press(screen.getByLabelText("Done"));
    await waitFor(() => {
      expect(page().queryByText("Leg day done!")).toBeNull();
    });
    expect(page().queryByText("New PR")).toBeNull();
    expect(page().getByText("Asha for the desk")).toBeTruthy();
    expect(await page().findByText("People you've blocked (1)")).toBeTruthy();
  });

  it("a blocked member's posts stay off this phone when the read after the block gets no answer", async () => {
    let blocked = false;
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [postsOf(IRON)]: () => {
        if (blocked) throw new TypeError("Network request failed");
        return { status: 200, body: feed(IRON, [member(P1, { body: "Leg day done!" }), member(P2, { body: "New PR" }), post(P3, { body: "Staff news" })]) };
      },
      [`${postOf(IRON, P1)}/block`]: () => {
        blocked = true;
        return { status: 200, body: { blocked: true } };
      },
    });
    await openUpdates(server.ask, IRON);
    await fireEvent.press(within(await page().findByTestId(`post-${P1}`)).getByLabelText("Block Asha W."));
    await fireEvent.press(within(await screen.findByTestId("ask-box")).getByLabelText("Block Asha W."));
    expect(await screen.findByTestId("ask-done")).toBeTruthy();
    await waitFor(() => {
      expect(server.paths().filter((path) => path === postsOf(IRON))).toHaveLength(2);
    });
    expect(page().queryByText("Leg day done!")).toBeNull();
    expect(page().queryByText("New PR")).toBeNull();
    expect(page().getByText("Staff news")).toBeTruthy();
  });

  it("a post staff removed is gone when the app comes back, and one pressed after it was removed says so in its place", async () => {
    let removed = false;
    const comeBack = listenForComeBack();
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [postsOf(IRON)]: () => ({ status: 200, body: feed(IRON, removed ? [post(P2, { body: "Still here" })] : [post(P1, { body: "Cruel words" }), post(P2, { body: "Still here" })]) }),
      [`${postOf(IRON, P1)}/reaction`]: () => refusal(404, "post_not_found", "This post has been removed."),
    });
    await openUpdates(server.ask, IRON);
    expect(await page().findByText("Cruel words")).toBeTruthy();
    await fireEvent.press(within(page().getByTestId(`post-${P1}`)).getByTestId("react-open"));
    await fireEvent.press(within(page().getByTestId(`post-${P1}`)).getByTestId("react-like"));
    expect(await page().findByText("This post has been removed.")).toBeTruthy();
    expect(page().queryByText("Cruel words")).toBeNull();

    removed = true;
    await comeBack();
    await waitFor(() => {
      expect(page().queryByText("This post has been removed.")).toBeNull();
    });
    expect(page().queryByText("Cruel words")).toBeNull();
    expect(page().getByText("Still here")).toBeTruthy();
  });
});

describe("the posts, as the browser shows them", () => {
  it("pinned ones first, staff marked, the time on the gym's clock, a hidden own post says why, and the help line", async () => {
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [postsOf(IRON)]: ok(
        feed(IRON, [member(P2, { own: true, wrote: true, hidden: true, body: "My post" }), post(P3, { author: { name: null, initials: "" }, body: "From nobody" })], {
          pinned: [post(P1, { pinned: true, body: "Pinned news" })],
          supportEmail: "help@example.org",
        }),
      ),
    });
    await openUpdates(server.ask, IRON);
    expect(await page().findByText("Pinned news")).toBeTruthy();
    const order = page()
      .getAllByTestId(/^post-/)
      .map((card) => card.props.testID as string);
    expect(order).toEqual([`post-${P1}`, `post-${P2}`, `post-${P3}`]);
    expect(within(page().getByTestId(`post-${P1}`)).getByText("Pinned")).toBeTruthy();
    expect(within(page().getByTestId(`post-${P1}`)).getByText(" · Staff")).toBeTruthy();
    expect(within(page().getByTestId(`post-${P2}`)).queryByText(" · Staff")).toBeNull();
    // A staff post whose writer's account is gone reads as the gym's.
    expect(within(page().getByTestId(`post-${P3}`)).getByText("Iron House")).toBeTruthy();
    expect(within(page().getByTestId(`post-${P2}`)).getByText(/Iron House/)).toBeTruthy();
    expect(page().getByText(/hidden/i)).toBeTruthy();
    // On Iron House's 12-hour clock, in this phone's own zone (each zone's words are tested in test/updates.test.ts).
    expect(within(page().getByTestId(`post-${P1}`)).getByText(/^28 Oct, [0-9]{1,2}:[0-9]{2} [ap]m$/)).toBeTruthy();
    expect(page().getByText("help@example.org")).toBeTruthy();
  });

  it("what each post offers: Remove on their own, Report and Block on another member's, Report alone on staff's, Reported once sent", async () => {
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [postsOf(IRON)]: ok(
        feed(IRON, [
          member(P1, { own: true, wrote: true }),
          member(P2),
          post(P3),
          member(P4, { reported: true }),
        ]),
      ),
    });
    await openUpdates(server.ask, IRON);
    const card = async (id: string) => within(await page().findByTestId(`post-${id}`));
    expect((await card(P1)).getByLabelText("Remove your post")).toBeTruthy();
    expect((await card(P1)).queryByText("Report")).toBeNull();
    expect((await card(P1)).queryByText("Block")).toBeNull();
    expect((await card(P2)).getByText("Report")).toBeTruthy();
    expect((await card(P2)).getByText("Block")).toBeTruthy();
    expect((await card(P3)).getByText("Report")).toBeTruthy();
    expect((await card(P3)).queryByText("Block")).toBeNull();
    expect((await card(P4)).getByText("Reported")).toBeTruthy();
    expect((await card(P4)).queryByText("Report")).toBeNull();
  });

  it("a gym that has posted nothing says so, and one whose updates are paused says that", async () => {
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON, LOTUS),
      [postsOf(IRON)]: ok(feed(IRON, [])),
      [postsOf(LOTUS)]: ok(feed(LOTUS, [], { status: "paused" })),
    });
    await openUpdates(server.ask, IRON);
    expect(await page().findByText("Iron House hasn't posted anything yet.")).toBeTruthy();
    await fireEvent.press(page().getByLabelText("Back"));
    await fireEvent.press(await screen.findByLabelText(`Updates at ${LOTUS.name}`));
    expect(await page().findByText("Lotus Yoga's updates aren't showing at the moment.")).toBeTruthy();
  });

  it("Show older posts adds the next page under the first, never a post twice", async () => {
    let reads = 0;
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [postsOf(IRON)]: () => {
        reads += 1;
        return reads === 1
          ? { status: 200, body: feed(IRON, [post(P1, { body: "Newest" })], { next: `2026-10-28T09:05:00.000Z_${P1}` }) }
          : { status: 200, body: feed(IRON, [post(P1, { body: "Newest" }), post(P2, { body: "Older" })]) };
      },
    });
    await openUpdates(server.ask, IRON);
    expect(await page().findByText("Newest")).toBeTruthy();
    await fireEvent.press(page().getByLabelText("Show older posts"));
    expect(await page().findByText("Older")).toBeTruthy();
    expect(page().getAllByText("Newest")).toHaveLength(1);
    expect(page().queryByLabelText("Show older posts")).toBeNull();
  });

  // React Native's own picture sends no headers on Android: the server saw none and refused every photo. Each photo
  // is downloaded signed in, and shown from the phone's copy.
  it("each photo is downloaded from this place's post, signed in as this person, and opens the whole screen", async () => {
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [postsOf(IRON)]: ok(feed(IRON, [post(P1, { photos: [{ id: PHOTO, width: 1600, height: 1200 }] })])),
    });
    await openUpdates(server.ask, IRON);
    const open = await page().findByLabelText("Open photo 1 of 1");
    const photo = await within(page().getByTestId(`post-${P1}`)).findByTestId(`photo-${PHOTO}`);
    expect((photo.props.source as { uri?: string; headers?: unknown }).uri).toBe(`cache/updates/${PHOTO}`);
    expect(download.mock.calls.length).toBeGreaterThan(0);
    for (const [url, , options] of download.mock.calls) {
      expect(url).toBe(`http://localhost:3000${postOf(IRON, P1)}/photos/${PHOTO}`);
      expect(options?.headers?.authorization).toBe("Bearer access-2");
    }
    const asked = download.mock.calls.length;
    await fireEvent.press(open);
    expect(await screen.findByText("Photo 1 of 1")).toBeTruthy();
    // The whole-screen photo is the one already on the phone.
    expect(download.mock.calls.length).toBe(asked);
  });

  it("the photos are slid one to the next, and a screen reader steps them", async () => {
    const PHOTO2 = "c2222222-2222-4222-8222-222222222222";
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [postsOf(IRON)]: ok(feed(IRON, [post(P1, { photos: [{ id: PHOTO, width: 1600, height: 1200 }, { id: PHOTO2, width: 1200, height: 1600 }] })])),
    });
    await openUpdates(server.ask, IRON);
    await fireEvent.press(await page().findByLabelText("Open photo 1 of 2"));
    expect(await screen.findByText("Photo 1 of 2")).toBeTruthy();
    expect(screen.queryByText("Next")).toBeNull();
    const pages = screen.getByTestId("photo-pages");
    await fireEvent(pages, "accessibilityAction", { nativeEvent: { actionName: "increment" } });
    expect(await screen.findByText("Photo 2 of 2")).toBeTruthy();
    // There is no third.
    await fireEvent(pages, "accessibilityAction", { nativeEvent: { actionName: "increment" } });
    expect(screen.getByText("Photo 2 of 2")).toBeTruthy();
    await fireEvent(pages, "accessibilityAction", { nativeEvent: { actionName: "decrement" } });
    expect(await screen.findByText("Photo 1 of 2")).toBeTruthy();
  });

  it("a photo refused for an old sign-in is asked again once, with the renewed one", async () => {
    let renewals = 0;
    const server = fakeServer({
      "/v1/auth/refresh": () => {
        renewals += 1;
        return { status: 200, body: { tokens: tokens(renewals + 1) } };
      },
      "/v1/orgs/mine": mine(IRON),
      [postsOf(IRON)]: ok(feed(IRON, [post(P1, { photos: [{ id: PHOTO, width: 1600, height: 1200 }] })])),
    });
    download.mockImplementationOnce(() => Promise.reject(new Error("response has status: 401")));
    await openUpdates(server.ask, IRON);
    const photo = await within(page().getByTestId(`post-${P1}`)).findByTestId(`photo-${PHOTO}`);
    expect((photo.props.source as { uri?: string }).uri).toBe(`cache/updates/${PHOTO}`);
    const sent = download.mock.calls.map(([, , options]) => options?.headers?.authorization);
    expect(sent.at(-1)).toBe(`Bearer access-${String(renewals + 1)}`);
    expect(sent.at(-1)).not.toBe(sent[0]);
  });

  it("closing Updates deletes the photos it downloaded", async () => {
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [postsOf(IRON)]: ok(feed(IRON, [post(P1, { photos: [{ id: PHOTO, width: 1600, height: 1200 }] })])),
    });
    await openUpdates(server.ask, IRON);
    await within(page().getByTestId(`post-${P1}`)).findByTestId(`photo-${PHOTO}`);
    const folder = new Directory(Paths.cache, "updates");
    expect(new File(folder, PHOTO).exists).toBe(true);
    await fireEvent.press(page().getByLabelText("Back"));
    await waitFor(() => {
      expect(new File(folder, PHOTO).exists).toBe(false);
    });
    expect(folder.exists).toBe(false);
  });
});

describe("a press, once", () => {
  it("a reaction shows at once, is sent once, takes the server's counts, and a second tap on it takes it off", async () => {
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [postsOf(IRON)]: ok(feed(IRON, [post(P1, { reactions: { like: 2, love: 0, strong: 0, fire: 0 } })])),
      [`${postOf(IRON, P1)}/reaction`]: (body) => {
        const reaction = (body as { reaction: string | null }).reaction;
        return { status: 200, body: { reactions: { like: 2, love: 0, strong: 0, fire: reaction === "fire" ? 5 : 4 }, mine: reaction } };
      },
    });
    await openUpdates(server.ask, IRON);
    const card = within(await page().findByTestId(`post-${P1}`));
    await fireEvent.press(card.getByTestId("react-open"));
    await fireEvent.press(card.getByTestId("react-fire"));
    // Picking one closes the four, and the one button says what is given.
    expect(card.queryByTestId("react-fire")).toBeNull();
    expect(await card.findByLabelText("Reactions: Like, 2 people; Fire, 5 people, including you. Choose a reaction")).toBeTruthy();
    await fireEvent.press(card.getByTestId("react-open"));
    await fireEvent.press(card.getByTestId("react-fire"));
    expect(await card.findByLabelText("Reactions: Like, 2 people; Fire, 4 people. Choose a reaction")).toBeTruthy();
    expect(server.asked.filter((a) => a.path.endsWith("/reaction")).map((a) => a.body)).toEqual([{ reaction: "fire" }, { reaction: null }]);
  });

  it("a reaction that does not reach the gym is put back, and says so under its post", async () => {
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [postsOf(IRON)]: ok(feed(IRON, [post(P1)])),
      [`${postOf(IRON, P1)}/reaction`]: lost,
    });
    await openUpdates(server.ask, IRON);
    const card = within(await page().findByTestId(`post-${P1}`));
    await fireEvent.press(card.getByTestId("react-open"));
    await fireEvent.press(card.getByTestId("react-love"));
    expect(await card.findByText("Couldn't save your reaction. Please try again.")).toBeTruthy();
    expect(card.getByLabelText("React to this post")).toBeTruthy();
  });

  it("the reactions are one button until it is tapped, and Close reactions puts it back", async () => {
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [postsOf(IRON)]: ok(feed(IRON, [post(P1), post(P2, { reactions: { like: 1, love: 0, strong: 0, fire: 3 } })])),
    });
    await openUpdates(server.ask, IRON);
    const none = within(await page().findByTestId(`post-${P1}`));
    expect(none.getByLabelText("React to this post")).toBeTruthy();
    expect(none.getByText("React")).toBeTruthy();
    expect(none.queryByTestId("react-like")).toBeNull();
    const some = within(page().getByTestId(`post-${P2}`));
    expect(some.getByText("4")).toBeTruthy();
    await fireEvent.press(some.getByTestId("react-open"));
    expect(some.getByLabelText("Like, 1 person")).toBeTruthy();
    expect(some.getByLabelText("Love, 0 people")).toBeTruthy();
    expect(some.getByLabelText("Strong, 0 people")).toBeTruthy();
    expect(some.getByLabelText("Fire, 3 people")).toBeTruthy();
    await fireEvent.press(some.getByLabelText("Close reactions"));
    expect(some.queryByTestId("react-like")).toBeNull();
    expect(some.getByTestId("react-open")).toBeTruthy();
    expect(server.asked.filter((a) => a.path.endsWith("/reaction"))).toEqual([]);
  });

  it("Report waits for a reason, sends the reason and the words typed, says so, and the post then reads Reported", async () => {
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [postsOf(IRON)]: ok(feed(IRON, [member(P1)])),
      [`${postOf(IRON, P1)}/report`]: ok({ reported: true }),
    });
    await openUpdates(server.ask, IRON);
    await fireEvent.press(within(await page().findByTestId(`post-${P1}`)).getByLabelText("Report this post by Asha W."));
    expect(await screen.findByText("Report this post")).toBeTruthy();
    const send = screen.getByLabelText("Send report");
    expect(send.props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(screen.getByLabelText("Spam or selling"));
    await fireEvent.changeText(screen.getByLabelText("Tell the staff more (you can leave this empty)"), "  Selling pills  ");
    await fireEvent.press(screen.getByLabelText("Send report"));
    expect(await screen.findByText("Reported. The staff at Iron House will look at it.")).toBeTruthy();
    expect(server.asked.filter((a) => a.path.endsWith("/report")).map((a) => a.body)).toEqual([{ reason: "spam", note: "Selling pills" }]);
    await fireEvent.press(screen.getByLabelText("Done"));
    expect(await within(page().getByTestId(`post-${P1}`)).findByText("Reported")).toBeTruthy();
  });

  it("Remove sent again after a lost reply finds the post already gone, and that is a removal", async () => {
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [postsOf(IRON)]: ok(feed(IRON, [member(P1, { own: true, wrote: true, body: "My words" })])),
      [`/v1/orgs/${IRON.id}/posts/mine/${P1}`]: () => refusal(404, "post_not_found", "This post has been removed."),
    });
    await openUpdates(server.ask, IRON);
    await fireEvent.press(within(await page().findByTestId(`post-${P1}`)).getByLabelText("Remove your post"));
    expect(await screen.findByText("Your post will disappear for everyone at Iron House. This can't be undone.")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Remove post"));
    expect(await screen.findByText("Your post has been removed.")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Done"));
    await waitFor(() => {
      expect(page().queryByText("My words")).toBeNull();
    });
  });

  it("People you've blocked lists them; Unblock says so in that row and reads the posts again", async () => {
    let unblocked = false;
    const blockId = "d1111111-1111-4111-8111-111111111111";
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [postsOf(IRON)]: () => ({ status: 200, body: unblocked ? feed(IRON, [member(P1, { body: "Back again" })]) : feed(IRON, [post(P2)], { blockedCount: 1 }) }),
      [`${postsOf(IRON)}/blocked`]: ok({ people: [{ id: blockId, name: "Asha W.", initials: "AW", blockedAt: "2026-10-27T10:00:00.000Z" }] }),
      [`${postsOf(IRON)}/blocked/${blockId}`]: () => {
        unblocked = true;
        return { status: 200, body: { blocked: false } };
      },
    });
    await openUpdates(server.ask, IRON);
    await fireEvent.press(await page().findByText("People you've blocked (1)"));
    await fireEvent.press(await screen.findByLabelText("Unblock Asha W."));
    expect(await screen.findByText("Unblocked. You'll see Asha W.'s posts and reactions again.")).toBeTruthy();
    expect(server.asked.filter((a) => a.path.endsWith(`/blocked/${blockId}`)).map((a) => a.method)).toEqual(["DELETE"]);
    await fireEvent.press(screen.getByLabelText("Close"));
    expect(await page().findByText("Back again")).toBeTruthy();
  });
});

const PHOTO_B = "c2222222-2222-4222-8222-222222222222";
const PHOTO_C = "c3333333-3333-4333-8333-333333333333";
const photo = (id: string) => ({ id, width: 1600, height: 1200 });
const refused = (status: number) => new Error(`response has status: ${String(status)}`);
/** How often each photo was asked for, by the end of its address. */
const asksFor = (id: string) => download.mock.calls.filter(([url]) => url.endsWith(id)).length;
const NOT_LISTED = () => refusal(404, "org_not_found", "Organisation not found.");

describe("nothing of a person's stays on the phone", () => {
  const folder = () => new Directory(Paths.cache, "updates");
  const leftBehind = () => {
    folder().create();
    const file = new File(folder(), "left-by-a-killed-app");
    file.create();
    return file;
  };

  it("photos left by an app killed with Updates open are gone when Updates next opens", async () => {
    const left = leftBehind();
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [postsOf(IRON)]: ok(feed(IRON, [post(P1, { photos: [photo(PHOTO)] })])),
    });
    await openUpdates(server.ask, IRON);
    await within(await page().findByTestId(`post-${P1}`)).findByTestId(`photo-${PHOTO}`);
    expect(left.exists).toBe(false);
  });

  it("they are gone when the app starts with nobody signed in", async () => {
    const left = leftBehind();
    await render(<App extra={extra} ask={fakeServer({}).ask} store={memoryStore()} wait={noWait} />);
    await screen.findByText("Get started.");
    expect(left.exists).toBe(false);
  });

  it("they are gone when the server ends the sign-in", async () => {
    const left = leftBehind();
    const server = fakeServer({ "/v1/auth/refresh": () => refusal(401, "unauthorized", "authentication required") });
    await render(<App extra={extra} ask={server.ask} store={memoryStore(kept(1))} wait={noWait} />);
    await screen.findByText("Get started.");
    expect(left.exists).toBe(false);
  });

  it("a folder that cannot be deleted never takes the app down", async () => {
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [postsOf(IRON)]: ok(feed(IRON, [post(P1, { photos: [photo(PHOTO)] })])),
    });
    await openUpdates(server.ask, IRON);
    await within(await page().findByTestId(`post-${P1}`)).findByTestId(`photo-${PHOTO}`);
    const stuck = jest.spyOn(Directory.prototype, "delete").mockImplementationOnce(() => {
      throw new Error("failed to delete");
    });
    await fireEvent.press(page().getByLabelText("Back"));
    expect(stuck).toHaveBeenCalled();
    stuck.mockRestore();
    expect(await screen.findByLabelText(`Updates at ${IRON.name}`)).toBeTruthy();
    expect(await screen.findAllByRole("tab")).toHaveLength(5);
  });

  it("a download still away when Updates closes is stopped", async () => {
    download.mockImplementation(() => new Promise(() => undefined));
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [postsOf(IRON)]: ok(feed(IRON, [post(P1, { photos: [photo(PHOTO)] })])),
    });
    await openUpdates(server.ask, IRON);
    await waitFor(() => {
      expect(download).toHaveBeenCalled();
    });
    const signal = download.mock.calls[0]?.[2]?.signal;
    expect(signal?.aborted).toBe(false);
    await fireEvent.press(page().getByLabelText("Back"));
    expect(signal?.aborted).toBe(true);
  });
});

describe("a photo that did not come is asked again, and says so meanwhile", () => {
  it("every time the sign-in has run out while Updates stays open, not only the first", async () => {
    const comeBack = listenForComeBack();
    let posts = [post(P1, { photos: [photo(PHOTO)] })];
    let renewals = 0;
    const refuseOnce = new Set([PHOTO_B, PHOTO_C]);
    download.mockImplementation((url, to, options) => {
      const id = [...refuseOnce].find((one) => url.endsWith(one));
      if (id !== undefined) {
        refuseOnce.delete(id);
        return Promise.reject(refused(401));
      }
      return lands?.(url, to, options) ?? Promise.reject(new Error("no default"));
    });
    const server = fakeServer({
      "/v1/auth/refresh": () => {
        renewals += 1;
        return { status: 200, body: { tokens: tokens(renewals + 1) } };
      },
      "/v1/orgs/mine": mine(IRON),
      [postsOf(IRON)]: () => ({ status: 200, body: feed(IRON, posts) }),
    });
    await openUpdates(server.ask, IRON);
    await within(await page().findByTestId(`post-${P1}`)).findByTestId(`photo-${PHOTO}`);
    posts = [post(P2, { photos: [photo(PHOTO_B)] }), ...posts];
    await comeBack();
    await within(await page().findByTestId(`post-${P2}`)).findByTestId(`photo-${PHOTO_B}`);
    posts = [post(P3, { photos: [photo(PHOTO_C)] }), ...posts];
    await comeBack();
    await within(await page().findByTestId(`post-${P3}`)).findByTestId(`photo-${PHOTO_C}`);
    // A photo already on the phone is not fetched again when the sign-in is renewed.
    expect(asksFor(PHOTO)).toBe(1);
  });

  it("one lost with no signal says so, and comes when the app next reads the page", async () => {
    const comeBack = listenForComeBack();
    download.mockImplementationOnce(() => Promise.reject(new Error("Unable to resolve host")));
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [postsOf(IRON)]: ok(feed(IRON, [post(P1, { photos: [photo(PHOTO)] })])),
    });
    await openUpdates(server.ask, IRON);
    const card = within(await page().findByTestId(`post-${P1}`));
    expect(await card.findByText("Couldn't load this photo.")).toBeTruthy();
    await comeBack();
    expect(await card.findByTestId(`photo-${PHOTO}`)).toBeTruthy();
    expect(card.queryByText("Couldn't load this photo.")).toBeNull();
  });

  it("one that came through the whole-screen photo shows on its post too, when that is closed", async () => {
    download.mockImplementationOnce(() => Promise.reject(new Error("Unable to resolve host")));
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [postsOf(IRON)]: ok(feed(IRON, [post(P1, { photos: [photo(PHOTO)] })])),
    });
    await openUpdates(server.ask, IRON);
    const card = within(await page().findByTestId(`post-${P1}`));
    await card.findByText("Couldn't load this photo.");
    await fireEvent.press(card.getByLabelText("Open photo 1 of 1"));
    await fireEvent(await screen.findByTestId("photo-pages"), "layout", { nativeEvent: { layout: { width: 300, height: 600 } } });
    await waitFor(() => {
      expect(asksFor(PHOTO)).toBe(2);
    });
    await settle();
    await fireEvent.press(screen.getByLabelText("Close photo"));
    expect(await card.findByTestId(`photo-${PHOTO}`)).toBeTruthy();
    expect(card.queryByText("Couldn't load this photo.")).toBeNull();
  });

  it("a sign-in refused every time is renewed once and asked once more, never round and round", async () => {
    let renewals = 0;
    download.mockImplementation(() => Promise.reject(refused(401)));
    const server = fakeServer({
      "/v1/auth/refresh": () => {
        renewals += 1;
        return { status: 200, body: { tokens: tokens(renewals + 1) } };
      },
      "/v1/orgs/mine": mine(IRON),
      [postsOf(IRON)]: ok(feed(IRON, [post(P1, { photos: [photo(PHOTO)] })])),
    });
    await openUpdates(server.ask, IRON);
    await settle();
    const before = renewals;
    expect(await within(await page().findByTestId(`post-${P1}`)).findByText("Couldn't load this photo.")).toBeTruthy();
    await settle();
    expect(asksFor(PHOTO)).toBe(2);
    expect(renewals).toBe(before);
  });

  it("a photo that is gone does not renew anybody's sign-in", async () => {
    let renewals = 0;
    download.mockImplementation(() => Promise.reject(refused(404)));
    const server = fakeServer({
      "/v1/auth/refresh": () => {
        renewals += 1;
        return { status: 200, body: { tokens: tokens(renewals + 1) } };
      },
      "/v1/orgs/mine": mine(IRON),
      [postsOf(IRON)]: ok(feed(IRON, [post(P1, { photos: [photo(PHOTO)] })])),
    });
    await openUpdates(server.ask, IRON);
    expect(await within(await page().findByTestId(`post-${P1}`)).findByText("Couldn't load this photo.")).toBeTruthy();
    const after = renewals;
    await settle();
    expect(asksFor(PHOTO)).toBe(1);
    expect(renewals).toBe(after);
  });

  it("only the photos near the screen are fetched, not the whole page's", async () => {
    const many = Array.from({ length: 20 }, (_, i) => {
      const n = String(i).padStart(2, "0");
      return post(`a00000${n}-1111-4111-8111-111111111111`, { photos: [photo(`c00000${n}-1111-4111-8111-111111111111`)] });
    });
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [postsOf(IRON)]: ok(feed(IRON, many)),
    });
    await openUpdates(server.ask, IRON);
    await waitFor(() => {
      expect(download).toHaveBeenCalled();
    });
    await settle();
    expect(download.mock.calls.length).toBeLessThan(many.length);
  });
});

describe("a 404 is believed only for what it names", () => {
  const LISTED_OFF = "Iron House's updates aren't available right now.";
  const server = (extra2: Record<string, () => unknown>) =>
    fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      ...(extra2 as Record<string, never>),
    });

  it("a reaction refused because the gym took them off its list never says the post was removed", async () => {
    let off = false;
    const s = server({
      [postsOf(IRON)]: () => (off ? NOT_LISTED() : { status: 200, body: feed(IRON, [post(P1, { body: "Still up" })]) }),
      [`${postOf(IRON, P1)}/reaction`]: () => {
        off = true;
        return NOT_LISTED();
      },
    });
    await openUpdates(s.ask, IRON);
    const card = within(await page().findByTestId(`post-${P1}`));
    await fireEvent.press(card.getByTestId("react-open"));
    await fireEvent.press(card.getByTestId("react-like"));
    expect(await page().findByText(LISTED_OFF)).toBeTruthy();
    expect(page().queryByText("This post has been removed.")).toBeNull();
  });

  it("Remove refused that way never says their post was removed, and leaves it on the list", async () => {
    const s = server({
      [postsOf(IRON)]: () => ({ status: 200, body: feed(IRON, [member(P1, { body: "My words", own: true, wrote: true })]) }),
      [`${postsOf(IRON)}/mine/${P1}`]: NOT_LISTED,
    });
    await openUpdates(s.ask, IRON);
    await fireEvent.press(within(await page().findByTestId(`post-${P1}`)).getByLabelText("Remove your post"));
    await fireEvent.press(await screen.findByLabelText("Remove post"));
    expect(await screen.findByText(LISTED_OFF)).toBeTruthy();
    expect(screen.queryByText("Your post has been removed.")).toBeNull();
    expect(page().getByText("My words")).toBeTruthy();
  });

  it("Block refused that way does not mark the post removed, and the box says why", async () => {
    const s = server({
      [postsOf(IRON)]: () => ({ status: 200, body: feed(IRON, [member(P1, { body: "Leg day done!" })]) }),
      [`${postOf(IRON, P1)}/block`]: NOT_LISTED,
    });
    await openUpdates(s.ask, IRON);
    await fireEvent.press(within(await page().findByTestId(`post-${P1}`)).getByLabelText("Block Asha W."));
    await fireEvent.press(within(await screen.findByTestId("ask-box")).getByLabelText("Block Asha W."));
    expect(await screen.findByText(LISTED_OFF)).toBeTruthy();
    expect(screen.queryByText("Organisation not found.")).toBeNull();
    expect(page().queryByText("This post has been removed.")).toBeNull();
    expect(page().getByText("Leg day done!")).toBeTruthy();
  });

  it("Report refused because the post is gone still says so in the post's place", async () => {
    const s = server({
      [postsOf(IRON)]: () => ({ status: 200, body: feed(IRON, [member(P1, { body: "Cruel words" })]) }),
      [`${postOf(IRON, P1)}/report`]: () => refusal(404, "post_not_found", "This post has been removed."),
    });
    await openUpdates(s.ask, IRON);
    await fireEvent.press(within(await page().findByTestId(`post-${P1}`)).getByLabelText("Report this post by Asha W."));
    await fireEvent.press(await screen.findByText("Spam or selling"));
    await fireEvent.press(screen.getByLabelText("Send report"));
    expect(await page().findByTestId(`post-gone-${P1}`)).toBeTruthy();
  });

  it("Unblock refused that way never says Unblocked; sent again after a lost reply it does", async () => {
    const blockId = "d1111111-1111-4111-8111-111111111111";
    const secondId = "d2222222-2222-4222-8222-222222222222";
    const s = server({
      [postsOf(IRON)]: () => ({ status: 200, body: feed(IRON, [post(P2)], { blockedCount: 2 }) }),
      [`${postsOf(IRON)}/blocked`]: () => ({
        status: 200,
        body: {
          people: [
            { id: blockId, name: "Asha W.", initials: "AW", blockedAt: "2026-10-27T10:00:00.000Z" },
            { id: secondId, name: "Ravi M.", initials: "RM", blockedAt: "2026-10-26T10:00:00.000Z" },
          ],
        },
      }),
      [`${postsOf(IRON)}/blocked/${blockId}`]: NOT_LISTED,
      [`${postsOf(IRON)}/blocked/${secondId}`]: () => refusal(404, "block_not_found", "That block has gone."),
    });
    await openUpdates(s.ask, IRON);
    await fireEvent.press(await page().findByText("People you've blocked (2)"));
    await fireEvent.press(await screen.findByLabelText("Unblock Asha W."));
    expect(await screen.findByText(LISTED_OFF)).toBeTruthy();
    expect(screen.queryByText("Unblocked. You'll see Asha W.'s posts and reactions again.")).toBeNull();
    await fireEvent.press(screen.getByLabelText("Unblock Ravi M."));
    expect(await screen.findByText("Unblocked. You'll see Ravi M.'s posts and reactions again.")).toBeTruthy();
  });
});

describe("reads that cross", () => {
  it("an old read answering after a Block never puts that member's posts back", async () => {
    const comeBack = listenForComeBack();
    let reads = 0;
    let release: (reply: Reply) => void = () => undefined;
    const before = () => ({ status: 200, body: feed(IRON, [member(P1, { body: "Leg day done!" }), post(P2, { body: "Staff news" })]) });
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [postsOf(IRON)]: () => {
        reads += 1;
        if (reads === 1) return before();
        if (reads === 2)
          return new Promise<Reply>((resolve) => {
            release = resolve;
          });
        return { status: 200, body: feed(IRON, [post(P2, { body: "Staff news" })], { blockedCount: 1 }) };
      },
      [`${postOf(IRON, P1)}/block`]: ok({ blocked: true }),
    });
    await openUpdates(server.ask, IRON);
    const card = await page().findByTestId(`post-${P1}`);
    await comeBack();
    await waitFor(() => {
      expect(reads).toBe(2);
    });
    await fireEvent.press(within(card).getByLabelText("Block Asha W."));
    await fireEvent.press(within(await screen.findByTestId("ask-box")).getByLabelText("Block Asha W."));
    await screen.findByTestId("ask-done");
    await waitFor(() => {
      expect(reads).toBe(3);
    });
    await settle();
    expect(page().queryByText("Leg day done!")).toBeNull();
    release(before());
    await settle();
    expect(page().queryByText("Leg day done!")).toBeNull();
    expect(page().getByText("Staff news")).toBeTruthy();
  });

  it("a page of older posts about another place is never shown under this one", async () => {
    let reads = 0;
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON, LOTUS),
      [postsOf(IRON)]: () => {
        reads += 1;
        return reads === 1
          ? { status: 200, body: feed(IRON, [post(P1, { body: "Iron news" })], { next: `2026-10-28T09:05:00.000Z_${P1}` }) }
          : { status: 200, body: feed(LOTUS, [post(P2, { body: "Lotus news" })]) };
      },
    });
    await openUpdates(server.ask, IRON);
    await page().findByText("Iron news");
    await fireEvent.press(page().getByLabelText("Show older posts"));
    expect(await page().findByText("Couldn't load more.")).toBeTruthy();
    expect(page().queryByText("Lotus news")).toBeNull();
  });

  it("Show older posts is not left busy when another read overtakes it and fails", async () => {
    const comeBack = listenForComeBack();
    let reads = 0;
    let release: (reply: Reply) => void = () => undefined;
    const first = () => ({ status: 200, body: feed(IRON, [post(P1, { body: "Newest" })], { next: `2026-10-28T09:05:00.000Z_${P1}` }) });
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [postsOf(IRON)]: () => {
        reads += 1;
        if (reads === 1) return first();
        if (reads === 2)
          return new Promise<Reply>((resolve) => {
            release = resolve;
          });
        throw new TypeError("Network request failed");
      },
    });
    await openUpdates(server.ask, IRON);
    await page().findByText("Newest");
    await fireEvent.press(page().getByLabelText("Show older posts"));
    await waitFor(() => {
      expect(reads).toBe(2);
    });
    await comeBack();
    await waitFor(() => {
      expect(reads).toBe(3);
    });
    await settle();
    release(first());
    await settle();
    expect(page().getByRole("button", { name: "Show older posts" }).props.accessibilityState).toMatchObject({ busy: false, disabled: false });
  });

  it("the blocked list's count of how many more does not count those just unblocked", async () => {
    const blockId = "d1111111-1111-4111-8111-111111111111";
    const secondId = "d2222222-2222-4222-8222-222222222222";
    let count = 3;
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [postsOf(IRON)]: () => ({ status: 200, body: feed(IRON, [post(P2)], { blockedCount: count }) }),
      [`${postsOf(IRON)}/blocked`]: ok({
        people: [
          { id: blockId, name: "Asha W.", initials: "AW", blockedAt: "2026-10-27T10:00:00.000Z" },
          { id: secondId, name: "Ravi M.", initials: "RM", blockedAt: "2026-10-26T10:00:00.000Z" },
        ],
      }),
      [`${postsOf(IRON)}/blocked/${blockId}`]: () => {
        count = 2;
        return { status: 200, body: { blocked: false } };
      },
    });
    await openUpdates(server.ask, IRON);
    await fireEvent.press(await page().findByText("People you've blocked (3)"));
    expect(await screen.findByText("Showing the 2 you blocked most recently. 1 more will show as you unblock these.")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Unblock Asha W."));
    expect(await screen.findByText("Showing the 1 you blocked most recently. 1 more will show as you unblock these.")).toBeTruthy();
  });
});

// Posting (ROADMAP Stage 5 17b).
const { picker } = jest.requireMock<{ picker: { next: unknown; opened: number } }>("expo-image-picker");
const { camera } = jest.requireMock<{ camera: { permission: unknown; afterAsk: unknown; pictures: number } }>("expo-camera");
const GRANTED = { granted: true, canAskAgain: true, status: "granted", expires: "never" };
const REFUSED = { granted: false, canAskAgain: false, status: "denied", expires: "never" };
const { drawing } = jest.requireMock<{ drawing: { base64: string; queue: string[]; saves: { format?: string; compress?: number }[]; sizes: { width: number; height: number }[]; fails: boolean } }>("expo-image-manipulator");
const SHOT = { canceled: false, assets: [{ uri: "file:///p.jpg", width: 4000, height: 3000 }] };
const manyShots = (n: number) => ({ canceled: false, assets: Array.from({ length: n }, (_, i) => ({ uri: `file:///p${String(i)}.jpg`, width: 4000, height: 3000 })) });
const realPhoto = (name: string) => readFileSync(join(__dirname, "..", "..", "..", "api", "test", "fixtures", "photos", name));
const OTHER = { ...RAVI, id: "9d0c8a52-6f0e-4d59-9a3c-1f2e3d4c5b6a", email: "mia@example.com" };
const minePath = (place: Place) => `${postsOf(place)}/mine`;
const SENT = post(P4, { body: "Leg day", fromMember: true, own: true, wrote: true, authorId: RAVI.id, author: { name: "Ravi", initials: "R" } });
const on = (place: Place, posts: Row[] = []) => ok(feed(place, posts, { posting: "on" }));
const foldersUsed = [`post-draft-${RAVI.id}-${IRON.id}`, `post-draft-${RAVI.id}-${LOTUS.id}`, `post-draft-${OTHER.id}-${IRON.id}`];
beforeEach(() => {
  for (const name of foldersUsed) new Directory(Paths.document, name).delete();
  picker.next = { canceled: true, assets: null };
  picker.opened = 0;
  camera.permission = GRANTED;
  camera.afterAsk = GRANTED;
  camera.pictures = 0;
  drawing.fails = false;
  drawing.sizes = [];
  drawing.saves = [];
  drawing.queue = [];
  drawing.base64 = realPhoto("pixel7-meta.jpg").toString("base64");
});
const serverOf = (routes: Record<string, (body: unknown) => Reply | Promise<Reply>>) =>
  fakeServer({ "/v1/auth/refresh": ok({ tokens: tokens(2) }), "/v1/orgs/mine": mine(IRON, LOTUS), [postsOf(LOTUS)]: on(LOTUS), ...routes });
const sendsTo = (server: ReturnType<typeof fakeServer>, place: Place) => server.asked.filter((a) => a.method === "POST" && a.path === minePath(place));
const write = async (words: string) => {
  await fireEvent.press(await page().findByRole("button", { name: /^(Write a post|Finish your post)$/ }));
  await fireEvent.changeText(await screen.findByLabelText("Your post"), words);
};
const pressPost = () => fireEvent.press(screen.getByRole("button", { name: "Post" }));

describe("the worst thing for posting: a photo never goes up saying where it was taken, and nobody else's post is sent", () => {
  it("what reaches the server from a real phone photo holds none of its position", async () => {
    const original = realPhoto("pixel7-meta.jpg");
    expect(original.includes("Exif")).toBe(true);
    const server = serverOf({ [postsOf(IRON)]: on(IRON), [minePath(IRON)]: () => ({ status: 201, body: { post: { ...SENT, photos: [{ id: PHOTO, width: 1600, height: 1200 }] } } }) });
    await openUpdates(server.ask, IRON);
    await fireEvent.press(await page().findByRole("button", { name: "Write a post" }));
    picker.next = SHOT;
    await fireEvent.press(await screen.findByRole("button", { name: "Add photos" }));
    await screen.findByTestId("draft-photo-1");
    await pressPost();
    await waitFor(() => {
      expect(sendsTo(server, IRON)).toHaveLength(1);
    });
    const body = sendsTo(server, IRON)[0]?.body as { photos: string[] };
    expect(body.photos).toHaveLength(1);
    const sent = Buffer.from(body.photos[0] ?? "", "base64");
    expect(sent.subarray(0, 2).toString("hex")).toBe("ffd8");
    expect(sent.length).toBeGreaterThan(1000);
    // Everything before the picture's own data, where a camera's tags live.
    const head = sent.subarray(0, sent.indexOf(Buffer.from([0xff, 0xda]))).toString("latin1");
    expect(original.subarray(0, original.indexOf(Buffer.from([0xff, 0xda]))).toString("latin1").length).toBeGreaterThan(head.length);
    for (const tag of ["GPS", "Google", "Pixel", "http://ns.adobe.com/xap"]) expect(head).not.toContain(tag);
    expect(await page().findByTestId("post-done")).toBeTruthy();
  });

  it("a post kept at one place is not under another", async () => {
    const server = serverOf({ [postsOf(IRON)]: on(IRON) });
    await openUpdates(server.ask, IRON);
    await write("For Iron only");
    await fireEvent.press(screen.getByLabelText("Close"));
    expect(await page().findByRole("button", { name: "Finish your post" })).toBeTruthy();
    await fireEvent.press(page().getByLabelText("Back"));

    await fireEvent.press(await screen.findByLabelText(`Updates at ${LOTUS.name}`));
    expect(await page().findByRole("button", { name: "Write a post" })).toBeTruthy();
    expect(page().queryByRole("button", { name: "Finish your post" })).toBeNull();
  });

  it("another person signed in on this phone does not get the first person's post", async () => {
    const first = serverOf({ [postsOf(IRON)]: on(IRON) });
    await openUpdates(first.ask, IRON);
    await write("Ravi's own");
    await settle();
    await screen.unmount();

    const second = serverOf({ [postsOf(IRON)]: on(IRON), "/v1/users/me": () => ({ status: 200, body: profile(true, OTHER) }) });
    await render(<App extra={extra} ask={second.ask} store={memoryStore(kept(1, OTHER))} wait={noWait} />);
    const tab = (await screen.findAllByRole("tab"))[3];
    if (tab === undefined) throw new Error("no fourth tab");
    await fireEvent.press(tab);
    await fireEvent.press(await screen.findByLabelText(`Updates at ${IRON.name}`));
    expect(await page().findByRole("button", { name: "Write a post" })).toBeTruthy();
    expect(page().queryByRole("button", { name: "Finish your post" })).toBeNull();
  });
});

describe("posting", () => {
  it("a stopped member reads why, with no button", async () => {
    const server = serverOf({ [postsOf(IRON)]: ok(feed(IRON, [post(P1)], { posting: "stopped" })) });
    await openUpdates(server.ask, IRON);
    expect(await page().findByText("The staff at Iron House have stopped you posting here. Speak to them at the front desk.")).toBeTruthy();
    expect(page().queryByRole("button", { name: "Write a post" })).toBeNull();
  });

  it("offers no button where only staff post", async () => {
    const server = serverOf({ [postsOf(IRON)]: ok(feed(IRON, [post(P1)], { posting: "off" })) });
    await openUpdates(server.ask, IRON);
    expect(await page().findByText("Pool closed on Sunday.")).toBeTruthy();
    expect(page().queryByRole("button", { name: "Write a post" })).toBeNull();
  });

  it("an empty page where members post invites the first one", async () => {
    const server = serverOf({ [postsOf(IRON)]: on(IRON) });
    await openUpdates(server.ask, IRON);
    expect(await page().findByText("No posts yet. Write the first one.")).toBeTruthy();
  });

  it("posts the words, under one key, and puts the post on the page", async () => {
    const server = serverOf({ [postsOf(IRON)]: on(IRON, [post(P1)]), [minePath(IRON)]: () => ({ status: 201, body: { post: SENT } }) });
    await openUpdates(server.ask, IRON);
    await write("Leg day");
    await pressPost();
    expect(await page().findByText("Your post is up.")).toBeTruthy();
    expect(page().getByText("Leg day")).toBeTruthy();
    expect(sendsTo(server, IRON)[0]?.body).toEqual({ postKey: expect.stringMatching(/^[0-9a-f-]{36}$/) as string, body: "Leg day", photos: [] });
    expect(page().getByRole("button", { name: "Write a post" })).toBeTruthy();
  });

  it("a lost reply keeps the post; pressed again it goes under the same key", async () => {
    let answer: () => Reply = lost;
    const server = serverOf({ [postsOf(IRON)]: on(IRON), [minePath(IRON)]: () => answer() });
    await openUpdates(server.ask, IRON);
    await write("Leg day");
    await pressPost();
    expect(await screen.findByText("No connection. Your post is kept. Try again.")).toBeTruthy();
    answer = () => ({ status: 201, body: { post: SENT } });
    await pressPost();
    expect(await page().findByText("Your post is up.")).toBeTruthy();
    const keys = sendsTo(server, IRON).map((a) => (a.body as { postKey: string }).postKey);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it("says so when the server kept the post as it first was", async () => {
    let answer: () => Reply = lost;
    const server = serverOf({ [postsOf(IRON)]: on(IRON), [minePath(IRON)]: () => answer() });
    await openUpdates(server.ask, IRON);
    await write("Leg day");
    await pressPost();
    await screen.findByText("No connection. Your post is kept. Try again.");
    await fireEvent.changeText(screen.getByLabelText("Your post"), "Leg day, and more");
    answer = () => ({ status: 201, body: { post: SENT } });
    await pressPost();
    expect(await page().findByText("Your post went up as you first wrote it. Your later changes weren't added.")).toBeTruthy();
  });

  it("a press while one is away sends nothing more, and closing waits for its answer", async () => {
    let release: (reply: Reply) => void = () => undefined;
    const server = serverOf({
      [postsOf(IRON)]: on(IRON),
      [minePath(IRON)]: () =>
        new Promise<Reply>((resolve) => {
          release = resolve;
        }),
    });
    await openUpdates(server.ask, IRON);
    await write("Leg day");
    await pressPost();
    await waitFor(() => {
      expect(sendsTo(server, IRON)).toHaveLength(1);
    });
    await fireEvent.press(screen.getByLabelText("Close"));
    expect(screen.getByTestId("post-box")).toBeTruthy();
    await act(() => {
      release({ status: 201, body: { post: SENT } });
    });
    expect(await page().findByText("Your post is up.")).toBeTruthy();
    expect(sendsTo(server, IRON)).toHaveLength(1);
  });

  it("survives the app being closed: words and photos come back under the same key, and nothing goes by itself", async () => {
    let firstKey = "";
    const first = serverOf({
      [postsOf(IRON)]: on(IRON),
      [minePath(IRON)]: (body) => {
        firstKey = (body as { postKey: string }).postKey;
        return lost();
      },
    });
    await openUpdates(first.ask, IRON);
    await write("Leg day");
    picker.next = SHOT;
    await fireEvent.press(screen.getByRole("button", { name: "Add photos" }));
    await screen.findByTestId("draft-photo-1");
    await pressPost();
    await screen.findByText("No connection. Your post is kept. Try again.");
    await settle();
    await screen.unmount();

    const second = serverOf({ [postsOf(IRON)]: on(IRON), [minePath(IRON)]: () => ({ status: 201, body: { post: SENT } }) });
    await openUpdates(second.ask, IRON);
    await fireEvent.press(await page().findByRole("button", { name: "Finish your post" }));
    expect(screen.getByDisplayValue("Leg day")).toBeTruthy();
    expect(screen.getByTestId("draft-photo-1")).toBeTruthy();
    await settle();
    expect(sendsTo(second, IRON)).toHaveLength(0);
    await pressPost();
    await waitFor(() => {
      expect(sendsTo(second, IRON)).toHaveLength(1);
    });
    const body = sendsTo(second, IRON)[0]?.body as { postKey: string; photos: string[] };
    expect(body.postKey).toBe(firstKey);
    expect(body.photos).toHaveLength(1);
  });

  it("once it is posted, or discarded, it is gone from the phone", async () => {
    const server = serverOf({ [postsOf(IRON)]: on(IRON), [minePath(IRON)]: () => ({ status: 201, body: { post: SENT } }) });
    await openUpdates(server.ask, IRON);
    await write("Leg day");
    await pressPost();
    await page().findByText("Your post is up.");
    await settle();
    expect(new Directory(Paths.document, foldersUsed[0] ?? "").exists).toBe(false);

    await write("Second");
    await fireEvent.press(screen.getByRole("button", { name: "Discard" }));
    await fireEvent.press(screen.getByRole("button", { name: "Keep it" }));
    expect(screen.getByDisplayValue("Second")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Discard" }));
    await fireEvent.press(screen.getByRole("button", { name: "Discard post" }));
    await settle();
    expect(page().getByRole("button", { name: "Write a post" })).toBeTruthy();
    expect(new Directory(Paths.document, foldersUsed[0] ?? "").exists).toBe(false);
  });

  it.each([
    [400, "post_bad_words", "Your post wasn't posted because it has a word that isn't allowed here: x. Take it out and post again."],
    [429, "posts_day_full", "You've posted 10 times in the last 24 hours, which is the most allowed. You can post again in about 2 hours."],
    [403, "posting_off", "Members can't post here at the moment."],
  ])("a refusal (%i %s) is said in the box, and the post is kept", async (status, code, words) => {
    const server = serverOf({ [postsOf(IRON)]: on(IRON), [minePath(IRON)]: () => refusal(status, code, words) });
    await openUpdates(server.ask, IRON);
    await write("Leg day");
    await pressPost();
    expect(await screen.findByText(words)).toBeTruthy();
    expect(screen.getByDisplayValue("Leg day")).toBeTruthy();
  });

  it("somebody taken off the gym's list reads that, and keeps what they wrote", async () => {
    const server = serverOf({ [postsOf(IRON)]: on(IRON), [minePath(IRON)]: () => refusal(404, "not_a_member", "Not found") });
    await openUpdates(server.ask, IRON);
    await write("Leg day");
    await pressPost();
    expect(await screen.findByText("Iron House's updates aren't available right now.")).toBeTruthy();
    expect(screen.getByDisplayValue("Leg day")).toBeTruthy();
  });

  it("a post kept where the gym has since stopped posts can be read and thrown away, never sent", async () => {
    const before = serverOf({ [postsOf(IRON)]: on(IRON) });
    await openUpdates(before.ask, IRON);
    await write("Leg day");
    await settle();
    await screen.unmount();

    const after = serverOf({ [postsOf(IRON)]: ok(feed(IRON, [], { posting: "off" })) });
    await openUpdates(after.ask, IRON);
    await fireEvent.press(await page().findByRole("button", { name: "See your unsent post" }));
    expect(screen.getByDisplayValue("Leg day")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Post" })).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Discard" }));
    await fireEvent.press(screen.getByRole("button", { name: "Discard post" }));
    await waitFor(() => {
      expect(page().queryByRole("button", { name: "See your unsent post" })).toBeNull();
    });
  });

  it("holds at four photos, says what was left out, and a photo taken off leaves room", async () => {
    const server = serverOf({ [postsOf(IRON)]: on(IRON) });
    await openUpdates(server.ask, IRON);
    await fireEvent.press(await page().findByRole("button", { name: "Write a post" }));
    picker.next = manyShots(6);
    await fireEvent.press(await screen.findByRole("button", { name: "Add photos" }));
    expect(await screen.findByText("A post holds up to 4 photos, so 2 photos were not added.")).toBeTruthy();
    expect(screen.getByTestId("draft-photo-4")).toBeTruthy();
    expect(screen.queryByTestId("draft-photo-5")).toBeNull();
    expect(screen.getByRole("button", { name: "Add photos" })).toBeDisabled();
    await fireEvent.press(screen.getByLabelText("Take photo 2 off this post"));
    expect(screen.queryByTestId("draft-photo-4")).toBeNull();
    expect(screen.getByRole("button", { name: "Add photos" })).toBeEnabled();
  });

  it("draws a photo no longer than 1,080 px, and says when one cannot be opened", async () => {
    const server = serverOf({ [postsOf(IRON)]: on(IRON) });
    await openUpdates(server.ask, IRON);
    await fireEvent.press(await page().findByRole("button", { name: "Write a post" }));
    picker.next = SHOT;
    await fireEvent.press(await screen.findByRole("button", { name: "Add photos" }));
    await screen.findByTestId("draft-photo-1");
    expect(drawing.sizes.at(-1)).toEqual({ width: 810, height: 1080 });
    drawing.fails = true;
    await fireEvent.press(screen.getByRole("button", { name: "Add photos" }));
    expect(await screen.findByText("1 photo couldn't be opened. Choose another one.")).toBeTruthy();
    expect(screen.queryByTestId("draft-photo-2")).toBeNull();
  });

  it("the camera refused for good offers settings; allowed, a photo taken in the app goes on the post", async () => {
    const server = serverOf({ [postsOf(IRON)]: on(IRON) });
    await openUpdates(server.ask, IRON);
    await fireEvent.press(await page().findByRole("button", { name: "Write a post" }));
    camera.permission = REFUSED;
    await fireEvent.press(await screen.findByRole("button", { name: "Take a photo" }));
    expect(await screen.findByRole("button", { name: "Open settings" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Take photo" })).toBeDisabled();
    await fireEvent.press(screen.getByLabelText("Close camera"));
    expect(screen.queryByTestId("post-camera")).toBeNull();

    camera.permission = GRANTED;
    await fireEvent.press(screen.getByRole("button", { name: "Take a photo" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Take photo" }));
    expect(await screen.findByTestId("draft-photo-1")).toBeTruthy();
    expect(camera.pictures).toBe(1);
    expect(screen.queryByTestId("post-camera")).toBeNull();
  });

  it("Post waits for something to post, and for words within the limit", async () => {
    const server = serverOf({ [postsOf(IRON)]: on(IRON) });
    await openUpdates(server.ask, IRON);
    await fireEvent.press(await page().findByRole("button", { name: "Write a post" }));
    expect(await screen.findByRole("button", { name: "Post" })).toBeDisabled();
    await fireEvent.changeText(screen.getByLabelText("Your post"), "a".repeat(2001));
    expect(screen.getByText("1 character too many")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Post" })).toBeDisabled();
    await fireEvent.changeText(screen.getByLabelText("Your post"), "a");
    expect(screen.getByRole("button", { name: "Post" })).toBeEnabled();
  });
});

describe("the phone's display size changes", () => {
  const resized = async (body: () => Promise<void>) => {
    const was = Dimensions.get("window");
    await act(() => {
      Dimensions.set({ window: { ...was, width: was.width + 100 }, screen: Dimensions.get("screen") });
    });
    try {
      await body();
    } finally {
      await act(() => {
        Dimensions.set({ window: was, screen: Dimensions.get("screen") });
      });
    }
  };

  it("a post on its way is not lost: the box stays, and the answer is said", async () => {
    let release: (reply: Reply) => void = () => undefined;
    const server = serverOf({
      [postsOf(IRON)]: on(IRON),
      [minePath(IRON)]: () =>
        new Promise<Reply>((resolve) => {
          release = resolve;
        }),
    });
    await openUpdates(server.ask, IRON);
    await write("Leg day");
    await pressPost();
    await waitFor(() => {
      expect(sendsTo(server, IRON)).toHaveLength(1);
    });
    await resized(async () => {
      expect(screen.getByTestId("post-box")).toBeTruthy();
      expect(screen.getByDisplayValue("Leg day")).toBeTruthy();
      await act(() => {
        release({ status: 201, body: { post: SENT } });
      });
      expect(await page().findByText("Your post is up.")).toBeTruthy();
      expect(page().getByText("Leg day")).toBeTruthy();
      expect(page().getByRole("button", { name: "Write a post" })).toBeTruthy();
    });
    expect(sendsTo(server, IRON)).toHaveLength(1);
    expect(new Directory(Paths.document, foldersUsed[0] ?? "").exists).toBe(false);
  });

  it("the page is not read again, and words in a box stay", async () => {
    const server = serverOf({ [postsOf(IRON)]: on(IRON, [member(P1)]) });
    await openUpdates(server.ask, IRON);
    await fireEvent.press(await page().findByRole("button", { name: /^Report this post/ }));
    await fireEvent.changeText(await screen.findByLabelText("Tell the staff more (you can leave this empty)"), "Rude words");
    const reads = server.paths().filter((path) => path === postsOf(IRON)).length;
    await resized(async () => {
      await settle();
      expect(screen.getByDisplayValue("Rude words")).toBeTruthy();
      expect(server.paths().filter((path) => path === postsOf(IRON))).toHaveLength(reads);
    });
  });
});

describe("how a photo is drawn", () => {
  it("as WebP, at the next quality while it is too large, and the camera's own file goes", async () => {
    const small = drawing.base64;
    drawing.queue = [Buffer.alloc(GYM_POST_PHONE_PHOTO_MAX_BYTES + 1, 7).toString("base64"), small];
    drawing.saves = [];
    const server = serverOf({ [postsOf(IRON)]: on(IRON) });
    await openUpdates(server.ask, IRON);
    await fireEvent.press(await page().findByRole("button", { name: "Write a post" }));
    const taken = new File(new Directory(Paths.cache, "ImagePicker"), "taken.jpg");
    taken.create();
    picker.next = { canceled: false, assets: [{ uri: taken.uri, width: 4000, height: 3000 }] };
    await fireEvent.press(await screen.findByRole("button", { name: "Add photos" }));
    await screen.findByTestId("draft-photo-1");
    expect(drawing.saves).toEqual([
      { format: "webp", compress: 0.75 },
      { format: "webp", compress: 0.6 },
    ]);
    expect(taken.exists).toBe(false);
  });

  it("a photo that is not the app's own copy is never deleted", async () => {
    const server = serverOf({ [postsOf(IRON)]: on(IRON) });
    await openUpdates(server.ask, IRON);
    await fireEvent.press(await page().findByRole("button", { name: "Write a post" }));
    const theirs = new File(new Directory(Paths.document, "gallery"), "theirs.jpg");
    theirs.create();
    picker.next = { canceled: false, assets: [{ uri: theirs.uri, width: 4000, height: 3000 }] };
    await fireEvent.press(await screen.findByRole("button", { name: "Add photos" }));
    await screen.findByTestId("draft-photo-1");
    expect(theirs.exists).toBe(true);
  });
});

describe("a post removed after a lost reply", () => {
  it("says so, and goes again under a new key with its words", async () => {
    let answer: () => Reply = lost;
    const server = serverOf({ [postsOf(IRON)]: on(IRON), [minePath(IRON)]: () => answer() });
    await openUpdates(server.ask, IRON);
    await write("Leg day");
    await pressPost();
    await screen.findByText("No connection. Your post is kept. Try again.");
    answer = () => refusal(404, "post_not_found", "This post has been removed.");
    await pressPost();
    expect(await screen.findByText("This post has been removed. Press Post to post it again.")).toBeTruthy();
    expect(screen.getByDisplayValue("Leg day")).toBeTruthy();
    answer = () => ({ status: 201, body: { post: SENT } });
    await pressPost();
    expect(await page().findByText("Your post is up.")).toBeTruthy();
    const keys = sendsTo(server, IRON).map((one) => (one.body as { postKey: string }).postKey);
    expect(keys).toHaveLength(3);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[1]);
  });

  it("a photo swapped after a lost reply is told it did not go, though the count is the same", async () => {
    let answer: () => Reply = lost;
    const server = serverOf({ [postsOf(IRON)]: on(IRON), [minePath(IRON)]: () => answer() });
    await openUpdates(server.ask, IRON);
    await write("Leg day");
    picker.next = SHOT;
    await fireEvent.press(screen.getByRole("button", { name: "Add photos" }));
    await screen.findByTestId("draft-photo-1");
    await pressPost();
    await screen.findByText("No connection. Your post is kept. Try again.");
    await fireEvent.press(screen.getByLabelText("Take photo 1 off this post"));
    await fireEvent.press(screen.getByRole("button", { name: "Add photos" }));
    await screen.findByTestId("draft-photo-1");
    answer = () => ({ status: 201, body: { post: { ...SENT, photos: [{ id: PHOTO, width: 100, height: 100 }] } } });
    await pressPost();
    expect(await page().findByText("Your post went up as you first wrote it. Your later changes weren't added.")).toBeTruthy();
  });
});

describe("before a post goes up", () => {
  it("the pen is at hand whatever the page holds, and a kept post says so on it", async () => {
    const server = serverOf({ [postsOf(IRON)]: on(IRON, [post(P1)]) });
    await openUpdates(server.ask, IRON);
    expect(await page().findByRole("button", { name: "Write a post" })).toBeTruthy();
    await write("Leg day");
    await fireEvent.press(screen.getByLabelText("Close"));
    expect(within(page().getByTestId("write-post")).getByText("Finish your post")).toBeTruthy();
  });

  it("a photo on the post opens whole when pressed, on that photo, and the post is still there after", async () => {
    const server = serverOf({ [postsOf(IRON)]: on(IRON) });
    await openUpdates(server.ask, IRON);
    await fireEvent.press(await page().findByRole("button", { name: "Write a post" }));
    picker.next = manyShots(2);
    await fireEvent.press(await screen.findByRole("button", { name: "Add photos" }));
    await screen.findByTestId("draft-photo-2");
    await fireEvent.press(screen.getByLabelText("Look at photo 2 of 2"));
    expect(await screen.findByText("Photo 2 of 2")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Close photo"));
    expect(screen.queryByText("Photo 2 of 2")).toBeNull();
    expect(screen.getByTestId("draft-photo-2")).toBeTruthy();
  });

  it("a picker that will not open says what to do, and the post is kept", async () => {
    const server = serverOf({ [postsOf(IRON)]: on(IRON) });
    await openUpdates(server.ask, IRON);
    await write("Leg day");
    jest.mocked(launchImageLibraryAsync).mockRejectedValueOnce(new Error("unregistered"));
    await fireEvent.press(screen.getByRole("button", { name: "Add photos" }));
    expect(await screen.findByText("Couldn't open your photos. Close the app, open it again, and try once more. Your post is kept.")).toBeTruthy();
    expect(screen.getByDisplayValue("Leg day")).toBeTruthy();
  });
});

describe("going along the list", () => {
  const moved = (y: number) => ({ nativeEvent: { contentOffset: { x: 0, y }, layoutMeasurement: { width: 300, height: 700 }, contentSize: { width: 300, height: 3000 } } });
  it("at the top offers the bottom, in the middle both, at the end of what is read the top and Show older posts", async () => {
    const server = serverOf({ [postsOf(IRON)]: on(IRON, [post(P1)]) });
    await openUpdates(server.ask, IRON);
    const list = await page().findByTestId("updates-list");
    expect(page().queryByLabelText("Go to the top")).toBeNull();
    expect(page().queryByLabelText("Go to the bottom")).toBeNull();
    await fireEvent.scroll(list, moved(0));
    expect(page().queryByLabelText("Go to the top")).toBeNull();
    expect(page().getByLabelText("Go to the bottom")).toBeTruthy();
    await fireEvent.scroll(list, moved(1200));
    expect(page().getByLabelText("Go to the top")).toBeTruthy();
    expect(page().getByLabelText("Go to the bottom")).toBeTruthy();
    await fireEvent.scroll(list, moved(2300));
    expect(page().getByLabelText("Go to the top")).toBeTruthy();
    expect(page().queryByLabelText("Go to the bottom")).toBeNull();
  });
});

describe("a post's photos", () => {
  const photo = (n: number) => ({ id: PHOTO.replace("c1", `c${String(n)}`), width: 1600, height: 1200 });
  it("slide one at a time with dots, the dot follows, and pressing one opens that one", async () => {
    const server = serverOf({ [postsOf(IRON)]: ok(feed(IRON, [post(P1, { photos: [photo(1), photo(2), photo(3)] })])) });
    await openUpdates(server.ask, IRON);
    const slides = await page().findByTestId(`photos-${P1}`);
    expect(slides.props.horizontal).toBe(true);
    expect(slides.props.pagingEnabled).toBe(true);
    expect(within(page().getByTestId(`photo-dots-${P1}`)).getAllByTestId("photo-dot-on")).toHaveLength(1);
    await fireEvent(slides, "momentumScrollEnd", { nativeEvent: { contentOffset: { x: 600 }, layoutMeasurement: { width: 300 } } });
    const dots = page().getByTestId(`photo-dots-${P1}`);
    expect(dots.children[2]).toBe(within(dots).getByTestId("photo-dot-on"));
    await fireEvent.press(page().getByLabelText("Open photo 2 of 3"));
    expect(await screen.findByText("Photo 2 of 3")).toBeTruthy();
  });

  it.each([
    ["a tall photo at the height limit", { width: 486, height: 1080 }, 900, 420],
    ["a tall photo below it", { width: 486, height: 1080 }, 300, 400],
    ["a very wide photo", { width: 3000, height: 1000 }, 382, 200],
  ])("%s fills the card's width: the box keeps its full width whatever its height", async (_, shape, wide, tall) => {
    const server = serverOf({ [postsOf(IRON)]: ok(feed(IRON, [post(P1, { photos: [{ ...photo(1), ...shape }] })])) });
    await openUpdates(server.ask, IRON);
    const box = await page().findByTestId(`photos-box-${P1}`);
    await fireEvent(box, "layout", { nativeEvent: { layout: { x: 0, y: 0, width: wide, height: 100 } } });
    const style = StyleSheet.flatten(page().getByTestId(`photos-box-${P1}`).props.style as StyleProp<ViewStyle>);
    expect(style.width).toBe("100%");
    expect(style.aspectRatio).toBeUndefined();
    expect(style.maxHeight).toBeUndefined();
    expect(Math.round(Number(style.height))).toBe(tall);
  });

  it("one photo has no dots", async () => {
    const server = serverOf({ [postsOf(IRON)]: ok(feed(IRON, [post(P1, { photos: [photo(1)] })])) });
    await openUpdates(server.ask, IRON);
    await page().findByTestId(`photos-${P1}`);
    expect(page().queryByTestId(`photo-dots-${P1}`)).toBeNull();
  });
});
