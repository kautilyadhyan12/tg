import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { AppState } from "react-native";
import { gymPostCommentSchema, gymPostsResponseSchema, type GymPostComment } from "@app/shared";
import { App } from "../../src/App";
import type { Ask } from "../../src/session/calls";
import { fakeServer, kept, lost, memoryStore, refusal, tokens, type Reply } from "../kit";

const extra = { copyName: "Feature 1", apiUrl: "http://localhost:3000" };
const noWait = () => Promise.resolve();
const ok = (body: unknown) => (): Reply => ({ status: 200, body });

const IRON = { id: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f", name: "Iron House", city: "Pune", orgType: "gym", clockFormat: "12h" };
const org = {
  ...IRON,
  slug: "iron-house",
  timezone: "UTC",
  locale: "en",
  currencyDisplay: "INR",
  status: "active",
  staffRole: null,
  isMember: true,
  joinedAt: "2026-10-01T00:00:00.000Z",
};
const ASHA = "b1111111-1111-4111-8111-111111111111";
const BEN = "b2222222-2222-4222-8222-222222222222";
const id = (n: number, first = "a") => `${first}${String(n).padStart(7, "0")}-1111-4111-8111-111111111111`;

type Row = Record<string, unknown>;
const post = (n: number, over: Row = {}): Row => ({
  id: id(n),
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
  commentCount: 0,
  challengeResult: null,
  ...over,
});
const feed = (posts: Row[], over: Row = {}) =>
  gymPostsResponseSchema.parse({ gymId: IRON.id, gymName: IRON.name, pinned: [], posts, next: null, status: "shown", posting: "on", commenting: "on", blockedCount: 0, supportEmail: null, ...over });

const comment = (n: number, postN: number, over: Row = {}): GymPostComment =>
  gymPostCommentSchema.parse({
    id: id(n, "c"),
    postId: id(postN),
    parentId: null,
    replyingTo: null,
    author: { name: "Asha R.", initials: "AR" },
    body: `Comment ${String(n)}`,
    createdAt: `2026-10-28T10:${String(n).padStart(2, "0")}:00.000Z`,
    reactions: { like: 0, love: 0, strong: 0, fire: 0 },
    mine: null,
    fromMember: true,
    authorId: ASHA,
    own: false,
    wrote: false,
    reported: false,
    hidden: false,
    replyCount: 0,
    ...over,
  });
const page = (comments: GymPostComment[], over: Row = {}) => ({ comments, next: null, commenting: "on", ...over });

const posts = `/v1/orgs/${IRON.id}/posts`;
const onPost = (n: number) => `${posts}/${id(n)}/comments`;
const one = (cId: string) => `/v1/orgs/${IRON.id}/post-comments/${cId}`;

const serverOf = (routes: Parameters<typeof fakeServer>[0]) =>
  fakeServer({ "/v1/auth/refresh": ok({ tokens: tokens(2) }), "/v1/orgs/mine": ok({ orgs: [org], formerOrgs: [] }), ...routes });

async function openComments(ask: Ask) {
  await render(<App extra={extra} ask={ask} store={memoryStore(kept(1))} wait={noWait} />);
  const tab = (await screen.findAllByRole("tab"))[3];
  if (tab === undefined) throw new Error("no fourth tab");
  await fireEvent.press(tab);
  await fireEvent.press(await screen.findByLabelText(`Updates at ${IRON.name}`));
  await fireEvent.press(await screen.findByTestId("comments-open"));
}
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
const write = async (words: string) => {
  await fireEvent.changeText(await screen.findByLabelText("Your comment"), words);
};
const pressSend = async () => {
  await fireEvent.press(screen.getByRole("button", { name: "Send" }));
};
const sends = (server: ReturnType<typeof fakeServer>, n: number) => server.asked.filter((a) => a.method === "POST" && a.path === onPost(n));

describe("the worst thing: a blocked person's words are gone from the screen, at once and on every read", () => {
  it("Block takes that person's comments and replies off the box and their posts off the page, and leaves the rest", async () => {
    const replyByBarry = comment(3, 1, { parentId: id(2, "c"), author: { name: "Barry B.", initials: "BB" }, authorId: BEN, body: "Barry's reply" });
    const barry = comment(1, 1, { author: { name: "Barry B.", initials: "BB" }, authorId: BEN, body: "Barry's comment" });
    const fine = comment(2, 1, { body: "Asha's comment", replyCount: 1 });
    let blocked = false;
    const server = serverOf({
      [posts]: () => ok(feed(blocked ? [post(1, { commentCount: 1 })] : [post(1, { commentCount: 3 }), post(2, { author: { name: "Barry B.", initials: "BB" }, fromMember: true, authorId: BEN, body: "Barry's post" })]))(),
      [onPost(1)]: () => ok(page(blocked ? [fine] : [barry, fine]))(),
      [`${one(fine.id)}/replies`]: () => ok(page(blocked ? [] : [replyByBarry]))(),
      [`${one(barry.id)}/block`]: () => {
        blocked = true;
        return ok({ blocked: true })();
      },
    });
    await render(<App extra={extra} ask={server.ask} store={memoryStore(kept(1))} wait={noWait} />);
    const tab = (await screen.findAllByRole("tab"))[3];
    if (tab === undefined) throw new Error("no tab");
    await fireEvent.press(tab);
    await fireEvent.press(await screen.findByLabelText(`Updates at ${IRON.name}`));
    await fireEvent.press((await screen.findAllByTestId("comments-open"))[0] as never);
    expect(await screen.findByText("Barry's comment")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "See 1 reply" }));
    expect(await screen.findByText("Barry's reply")).toBeTruthy();

    await fireEvent.press(screen.getAllByLabelText("More about this comment by Barry B.")[0] as never);
    await fireEvent.press(within(await screen.findByTestId("comment-menu")).getByRole("button", { name: "Block Barry B." }));
    expect(screen.getByText(/You won't see the posts and comments Barry B\. writes as a member/)).toBeTruthy();
    await fireEvent.press(within(screen.getByTestId("comment-ask")).getByRole("button", { name: "Block Barry B." }));
    expect(await screen.findByText(/^Blocked\./)).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByText("Barry's comment")).toBeNull();
    });
    expect(screen.queryByText("Barry's reply")).toBeNull();
    expect(screen.queryByText("Barry's post")).toBeNull();
    expect(screen.getByText("Asha's comment")).toBeTruthy();
  });

  it("the server's next read decides: a comment it no longer sends leaves the screen", async () => {
    const comeBack = listenForComeBack();
    let shown = [comment(1, 3, { body: "Going soon" }), comment(2, 3, { body: "Staying" })];
    const server = serverOf({ [posts]: ok(feed([post(3, { commentCount: 2 })])), [onPost(3)]: () => ok(page(shown))() });
    await openComments(server.ask);
    expect(await screen.findByText("Going soon")).toBeTruthy();
    shown = [comment(2, 3, { body: "Staying" })];
    await comeBack();
    await waitFor(() => {
      expect(screen.queryByText("Going soon")).toBeNull();
    });
    expect(screen.getByText("Staying")).toBeTruthy();
  });
});

describe("reading", () => {
  it("the post's button says how many; the box says the words, the person and who a reply answers", async () => {
    const server = serverOf({
      [posts]: ok(feed([post(4, { commentCount: 3 })])),
      [onPost(4)]: ok(page([comment(1, 4, { body: "Well done", replyCount: 2 })])),
      [`${one(id(1, "c"))}/replies`]: ok(page([comment(2, 4, { parentId: id(1, "c"), body: "Thanks" }), comment(3, 4, { parentId: id(1, "c"), replyingTo: "Ben S.", body: "Me too" })])),
    });
    await render(<App extra={extra} ask={server.ask} store={memoryStore(kept(1))} wait={noWait} />);
    const tab = (await screen.findAllByRole("tab"))[3];
    if (tab === undefined) throw new Error("no tab");
    await fireEvent.press(tab);
    await fireEvent.press(await screen.findByLabelText(`Updates at ${IRON.name}`));
    await fireEvent.press(await screen.findByRole("button", { name: "3 comments. Read or write a comment" }));
    expect(await screen.findByText("Well done")).toBeTruthy();
    expect(screen.queryByText("Thanks")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "See 2 replies" }));
    expect(await screen.findByText("Thanks")).toBeTruthy();
    expect(screen.getByText("Ben S.", { exact: false })).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Hide replies" }));
    expect(screen.queryByText("Thanks")).toBeNull();
  });

  it("a removed post says so in the box", async () => {
    const server = serverOf({ [posts]: ok(feed([post(5)])), [onPost(5)]: () => refusal(404, "post_not_found", "This post has been removed.") });
    await openComments(server.ask);
    expect((await screen.findAllByText("This post has been removed.")).length).toBeGreaterThan(0);
  });

  it("comments off with none written offers no button; with some, they can be read and the box says why not", async () => {
    const none = serverOf({ [posts]: ok(feed([post(6)], { commenting: "off" })) });
    await render(<App extra={extra} ask={none.ask} store={memoryStore(kept(1))} wait={noWait} />);
    const tab = (await screen.findAllByRole("tab"))[3];
    if (tab === undefined) throw new Error("no tab");
    await fireEvent.press(tab);
    await fireEvent.press(await screen.findByLabelText(`Updates at ${IRON.name}`));
    expect(await screen.findByText("Pool closed on Sunday.")).toBeTruthy();
    expect(screen.queryByTestId("comments-open")).toBeNull();
  });

  it("comments off with some written: they can be read and the box says why no more can be added", async () => {
    const some = serverOf({ [posts]: ok(feed([post(7, { commentCount: 1 })], { commenting: "off" })), [onPost(7)]: ok(page([comment(1, 7)], { commenting: "off" })) });
    await openComments(some.ask);
    expect(await screen.findByText("Comment 1")).toBeTruthy();
    expect(screen.getByTestId("comments-closed")).toBeTruthy();
    expect(screen.getByText("Comments are turned off here.")).toBeTruthy();
    expect(screen.queryByLabelText("Your comment")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Reply to/ })).toBeNull();
  });

  it("somebody stopped is told why, and still reads", async () => {
    const server = serverOf({ [posts]: ok(feed([post(8, { commentCount: 1 })], { commenting: "stopped" })), [onPost(8)]: ok(page([comment(1, 8)], { commenting: "stopped" })) });
    await openComments(server.ask);
    expect(await screen.findByText("Comment 1")).toBeTruthy();
    expect(screen.getByText(/have stopped you commenting here/)).toBeTruthy();
  });
});

describe("writing", () => {
  it("sends a comment under one key; it joins the list and the post's count", async () => {
    const sent = comment(5, 10, { body: "Nice one", own: true, wrote: true });
    const server = serverOf({ [posts]: ok(feed([post(10)])), [onPost(10)]: (body) => (body === undefined ? ok(page([]))() : { status: 201, body: { comment: sent, firstKept: true } }) });
    await openComments(server.ask);
    expect(await screen.findByText("No comments yet. Write the first one.")).toBeTruthy();
    await write("Nice one");
    await pressSend();
    expect(await screen.findByText("Nice one")).toBeTruthy();
    expect(sends(server, 10)[0]?.body).toEqual({ commentKey: expect.stringMatching(/^[0-9a-f-]{36}$/) as string, body: "Nice one" });
    expect(screen.getByRole("button", { name: "1 comment. Read or write a comment" })).toBeTruthy();
    expect((screen.getByLabelText("Your comment").props as { value: string }).value).toBe("");
  });

  it("no signal: the words stay, closing and opening brings them back, nothing goes by itself, and it goes under the same key", async () => {
    let answer: () => Reply = lost;
    const sent = comment(5, 11, { body: "Kept words", own: true, wrote: true });
    const server = serverOf({ [posts]: ok(feed([post(11)])), [onPost(11)]: (body) => (body === undefined ? ok(page([]))() : answer()) });
    await openComments(server.ask);
    await write("Kept words");
    await pressSend();
    expect(await screen.findByText("No connection. Your comment is kept. Try again.")).toBeTruthy();
    expect(sends(server, 11)).toHaveLength(1);

    // Closed and opened: read back from the file, not from anything on the screen.
    await fireEvent.press(screen.getByLabelText("Close"));
    await fireEvent.press(await screen.findByRole("button", { name: "Finish your comment" }));
    expect(((await screen.findByLabelText("Your comment")).props as { value: string }).value).toBe("Kept words");
    expect(sends(server, 11)).toHaveLength(1);

    answer = () => ({ status: 201, body: { comment: sent, firstKept: false } });
    await pressSend();
    expect(await screen.findByText("Kept words")).toBeTruthy();
    const keys = sends(server, 11).map((a) => (a.body as { commentKey: string }).commentKey);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    // A comment already kept is not counted twice.
    expect(screen.getByRole("button", { name: "Comment on this post" })).toBeTruthy();
  });

  it("the post says Finish your comment while one is kept", async () => {
    const server = serverOf({ [posts]: ok(feed([post(12)])), [onPost(12)]: (body) => (body === undefined ? ok(page([]))() : lost()) });
    await openComments(server.ask);
    await write("Half written");
    await fireEvent.press(screen.getByLabelText("Close"));
    expect(await screen.findByRole("button", { name: "Finish your comment" })).toBeTruthy();
  });

  it("Reply answers that person and opens the replies; a reply's reply names them; Stop replying goes back", async () => {
    const parent = comment(1, 13, { body: "Parent", replyCount: 1 });
    const earlier = comment(2, 13, { parentId: parent.id, body: "Earlier", author: { name: "Ben S.", initials: "BS" }, authorId: BEN });
    const mine = comment(3, 13, { parentId: parent.id, replyingTo: "Ben S.", body: "To Ben", own: true, wrote: true });
    const server = serverOf({
      [posts]: ok(feed([post(13, { commentCount: 2 })])),
      [onPost(13)]: (body) => (body === undefined ? ok(page([parent]))() : { status: 201, body: { comment: mine, firstKept: true } }),
      [`${one(parent.id)}/replies`]: ok(page([earlier])),
    });
    await openComments(server.ask);
    await fireEvent.press(await screen.findByRole("button", { name: "Reply to Asha R." }));
    expect(screen.getByText("Replying to Asha R.")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Stop replying to Asha R." }));
    expect(screen.queryByText("Replying to Asha R.")).toBeNull();

    await fireEvent.press(screen.getByRole("button", { name: "See 1 reply" }));
    await screen.findByText("Earlier");
    await fireEvent.press(screen.getByRole("button", { name: "Reply to Ben S." }));
    await write("To Ben");
    await pressSend();
    expect(await screen.findByText(/To Ben/)).toBeTruthy();
    expect(sends(server, 13)[0]?.body).toMatchObject({ body: "To Ben", replyTo: earlier.id });
    expect(screen.getByRole("button", { name: "Hide replies" })).toBeTruthy();
    expect(screen.queryByText("Replying to Ben S.")).toBeNull();
  });

  it("what a reply answered has gone: the words stay and go as a new comment, under a new key", async () => {
    const parent = comment(1, 14, { body: "Parent" });
    let answer: () => Reply = () => refusal(404, "comment_not_found", "This comment has been removed.");
    const sent = comment(2, 14, { body: "Still mine", own: true, wrote: true });
    const server = serverOf({ [posts]: ok(feed([post(14, { commentCount: 1 })])), [onPost(14)]: (body) => (body === undefined ? ok(page([parent]))() : answer()) });
    await openComments(server.ask);
    await fireEvent.press(await screen.findByRole("button", { name: "Reply to Asha R." }));
    await write("Still mine");
    await pressSend();
    expect(await screen.findByText(/The comment you were replying to has been removed/)).toBeTruthy();
    expect((screen.getByLabelText("Your comment").props as { value: string }).value).toBe("Still mine");
    answer = () => ({ status: 201, body: { comment: sent, firstKept: true } });
    await pressSend();
    await waitFor(() => {
      expect(sends(server, 14)).toHaveLength(2);
    });
    const [first, second] = sends(server, 14).map((a) => a.body as { commentKey: string; replyTo?: string });
    expect(first?.replyTo).toBe(parent.id);
    expect(second?.replyTo).toBeUndefined();
    expect(second?.commentKey).not.toBe(first?.commentKey);
  });

  it("the server's refusal is said: a word not allowed, a full day; the words stay", async () => {
    const server = serverOf({
      [posts]: ok(feed([post(15)])),
      [onPost(15)]: (body) => (body === undefined ? ok(page([]))() : refusal(400, "comment_bad_words", "Your comment wasn't posted because it has a word that isn't allowed here: bastard. Take it out and send it again.")),
    });
    await openComments(server.ask);
    await write("you bastard");
    await pressSend();
    expect(await screen.findByText(/it has a word that isn't allowed here: bastard/)).toBeTruthy();
    expect((screen.getByLabelText("Your comment").props as { value: string }).value).toBe("you bastard");
  });

  it("over 500 characters is said and Send can't be pressed; the words are not cut", async () => {
    const server = serverOf({ [posts]: ok(feed([post(16)])), [onPost(16)]: ok(page([])) });
    await openComments(server.ask);
    await write("a".repeat(502));
    expect(screen.getByText("2 characters too many")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Send" }).props as { accessibilityState?: { disabled?: boolean } }).accessibilityState?.disabled).toBe(true);
    await pressSend();
    expect(sends(server, 16)).toHaveLength(0);
  });
});

describe("on a comment", () => {
  it("reacts with the same one button, sent and put right by the server's answer", async () => {
    const c = comment(1, 20);
    const server = serverOf({
      [posts]: ok(feed([post(20, { commentCount: 1 })])),
      [onPost(20)]: ok(page([c])),
      [`${one(c.id)}/reaction`]: ok({ reactions: { like: 0, love: 0, strong: 2, fire: 0 }, mine: "strong" }),
    });
    await openComments(server.ask);
    await fireEvent.press(await screen.findByRole("button", { name: "React to this comment" }));
    await fireEvent.press(screen.getAllByTestId("react-strong")[0] as never);
    expect(await screen.findByText("2")).toBeTruthy();
    expect(server.asked.find((a) => a.path === `${one(c.id)}/reaction`)?.body).toEqual({ reaction: "strong" });
  });

  it("removes your own after asking, says so, and the replies under it go from the count", async () => {
    const c = comment(1, 21, { own: true, wrote: true, replyCount: 2, body: "Mine" });
    const server = serverOf({ [posts]: ok(feed([post(21, { commentCount: 3 })])), [onPost(21)]: ok(page([c])), [one(c.id)]: ok({ removed: true }) });
    await openComments(server.ask);
    await fireEvent.press(await screen.findByLabelText("More about this comment by Asha R."));
    await fireEvent.press(await screen.findByRole("button", { name: "Remove comment" }));
    expect(screen.getByText("Your comment and the 2 replies under it will disappear for everyone. This can't be undone.")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Remove comment" }));
    expect(await screen.findByText("Your comment has been removed.")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByText("Mine")).toBeNull();
    expect(screen.getByRole("button", { name: "Comment on this post" })).toBeTruthy();
  });

  it("reports with a reason, offering none about a photo, and then reads Reported", async () => {
    const c = comment(1, 22);
    const server = serverOf({ [posts]: ok(feed([post(22, { commentCount: 1 })])), [onPost(22)]: ok(page([c])), [`${one(c.id)}/report`]: ok({ reported: true }) });
    await openComments(server.ask);
    await fireEvent.press(await screen.findByLabelText("More about this comment by Asha R."));
    await fireEvent.press(await screen.findByRole("button", { name: "Report" }));
    expect(screen.queryByText("A photo of someone who didn't agree to it")).toBeNull();
    await fireEvent.press(screen.getByText("Spam or selling"));
    await fireEvent.press(screen.getByRole("button", { name: "Send report" }));
    expect(await screen.findByText(/^Reported\./)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Done" }));
    expect(server.asked.find((a) => a.path === `${one(c.id)}/report`)?.body).toEqual({ reason: "spam" });
    await fireEvent.press(screen.getByLabelText("More about this comment by Asha R."));
    expect(await screen.findByText("Reported")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Report" })).toBeNull();
  });

  it("a press on a comment removed since says so and takes it off", async () => {
    const c = comment(1, 23, { body: "Gone by now" });
    const server = serverOf({
      [posts]: ok(feed([post(23, { commentCount: 1 })])),
      [onPost(23)]: ok(page([c])),
      [`${one(c.id)}/reaction`]: () => refusal(404, "comment_not_found", "This comment has been removed."),
    });
    await openComments(server.ask);
    await fireEvent.press(await screen.findByRole("button", { name: "React to this comment" }));
    await fireEvent.press(screen.getAllByTestId("react-like")[0] as never);
    expect(await screen.findByText("This comment has been removed.")).toBeTruthy();
    expect(screen.queryByText("Gone by now")).toBeNull();
    await act(() => Promise.resolve());
  });
});
