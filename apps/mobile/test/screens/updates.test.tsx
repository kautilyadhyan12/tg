import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { AppState } from "react-native";
import { Directory, File, Paths } from "expo-file-system";
import { gymPostsResponseSchema } from "@app/shared";
import { App } from "../../src/App";
import type { Ask } from "../../src/session/calls";
import { fakeServer, kept, lost, memoryStore, refusal, tokens, type Reply } from "../kit";

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
afterEach(() => {
  download.mockClear();
});
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
    expect(await page().findByText("Couldn’t load the updates.")).toBeTruthy();
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
    await fireEvent.press(card.getByTestId("react-fire"));
    expect(await card.findByLabelText("Fire, 5 people, including you")).toBeTruthy();
    await fireEvent.press(card.getByTestId("react-fire"));
    expect(await card.findByLabelText("Fire, 4 people")).toBeTruthy();
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
    await fireEvent.press(card.getByTestId("react-love"));
    expect(await card.findByText("Couldn’t save your reaction. Please try again.")).toBeTruthy();
    expect(card.getByLabelText("Love, 0 people")).toBeTruthy();
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
