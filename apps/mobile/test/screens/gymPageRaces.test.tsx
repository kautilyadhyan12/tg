// The gym page on a weak signal: what a press, a late read and a lost answer leave on the screen and on the phone.
import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react-native";
import { AppState } from "react-native";
import { gymPostCommentSchema, gymPostsResponseSchema } from "@app/shared";
import { App } from "../../src/App";
import { useKeptComments } from "../../src/screens/gym/Comments";
import { commentDraftsText, dropsAKeptComment, readCommentDrafts, withKept, type KeptComment, type KeptComments } from "../../src/screens/gym/commentsView";
import type { Ask } from "../../src/session/calls";
import { fakeServer, kept, lost, memoryStore, tokens, type Reply } from "../kit";

const extra = { copyName: "Feature 1", apiUrl: "http://localhost:3000" };
const noWait = () => Promise.resolve();
const ok = (body: unknown) => (): Reply => ({ status: 200, body });
const IRON = { id: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f", name: "Iron House", city: "Pune", orgType: "gym", clockFormat: "12h" };
const org = { ...IRON, slug: "iron-house", timezone: "UTC", locale: "en", currencyDisplay: "INR", status: "active", staffRole: null, isMember: true, joinedAt: "2026-10-01T00:00:00.000Z" };
const id = (n: number, first = "a") => `${first}${String(n).padStart(7, "0")}-1111-4111-8111-111111111111`;
type Row = Record<string, unknown>;
const post = (n: number, over: Row = {}): Row => ({
  id: id(n), author: { name: "Sam Coach", initials: "SC" }, body: `Post ${String(n)}`, photos: [], pinned: false, createdAt: "2026-10-28T09:05:00.000Z",
  reactions: { like: 0, love: 0, strong: 0, fire: 0 }, mine: null, fromMember: false, authorId: null, own: false, wrote: false, reported: false, hidden: false, commentCount: 0, challengeResult: null, ...over,
});
const feed = (posts: Row[], over: Row = {}) => gymPostsResponseSchema.parse({ gymId: IRON.id, gymName: IRON.name, pinned: [], posts, next: null, status: "shown", posting: "on", commenting: "on", blockedCount: 0, supportEmail: null, ...over });
const comment = (n: number, postN: number, over: Row = {}) => gymPostCommentSchema.parse({
  id: id(n, "c"), postId: id(postN), parentId: null, replyingTo: null, author: { name: "Asha R.", initials: "AR" }, body: `Comment ${String(n)}`, createdAt: `2026-10-28T10:${String(n).padStart(2, "0")}:00.000Z`,
  reactions: { like: 0, love: 0, strong: 0, fire: 0 }, mine: null, fromMember: true, authorId: "b1111111-1111-4111-8111-111111111111", own: false, wrote: false, reported: false, hidden: false, replyCount: 0, ...over,
});
const page = (comments: unknown[], over: Row = {}) => ({ comments, next: null, commenting: "on", ...over });
const posts = `/v1/orgs/${IRON.id}/posts`;
const onPost = (n: number) => `${posts}/${id(n)}/comments`;
const serverOf = (routes: Parameters<typeof fakeServer>[0]) => fakeServer({ "/v1/auth/refresh": ok({ tokens: tokens(2) }), "/v1/orgs/mine": ok({ orgs: [org], formerOrgs: [] }), ...routes });
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}
function listenForComeBack(): () => Promise<void> {
  const listeners: ((state: string) => void)[] = [];
  jest.spyOn(AppState, "addEventListener").mockImplementation((_type, handler) => {
    listeners.push(handler as (state: string) => void);
    return { remove: () => undefined };
  });
  return async () => { await act(() => { for (const l of listeners) l("active"); }); };
}
async function openUpdates(ask: Ask) {
  await render(<App extra={extra} ask={ask} store={memoryStore(kept(1))} wait={noWait} />);
  const tab = (await screen.findAllByRole("tab"))[3];
  if (tab === undefined) throw new Error("no tab");
  await fireEvent.press(tab);
  await fireEvent.press(await screen.findByLabelText(`Updates at ${IRON.name}`));
}

const stateOf = (element: unknown) => (element as { props: { accessibilityState: { selected?: boolean; disabled?: boolean } } }).props.accessibilityState;

afterEach(() => { jest.restoreAllMocks(); });

describe("a read begun before a press, landing after it", () => {
  it("T1 a new post stays on the list", async () => {
    const back = listenForComeBack();
    const slow = deferred<Reply>();
    let reads = 0;
    const mine = post(50, { body: "My new post", fromMember: true, own: true, wrote: true, authorId: "b1111111-1111-4111-8111-111111111111" });
    const server = serverOf({
      [posts]: () => { reads += 1; return reads === 1 ? ok(feed([post(1)]))() : slow.promise; },
      [`${posts}/mine`]: () => ({ status: 201, body: { post: mine, firstKept: true } }),
    });
    await openUpdates(server.ask);
    await screen.findByText("Post 1");
    await fireEvent.press(screen.getByTestId("write-post"));
    await fireEvent.changeText(await screen.findByLabelText("Your post"), "My new post");
    await back();
    await fireEvent.press(screen.getByRole("button", { name: "Post" }));
    await screen.findByTestId("post-done");
    await screen.findByText("My new post");
    await act(async () => { slow.resolve(ok(feed([post(1)]))()); await slow.promise; });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(screen.queryByText("My new post")).toBeTruthy();
  });

  it("T2 a reaction stays as the server holds it", async () => {
    const back = listenForComeBack();
    const slow = deferred<Reply>();
    let reads = 0;
    const server = serverOf({
      [posts]: () => { reads += 1; return reads === 1 ? ok(feed([post(1)]))() : slow.promise; },
      [`${posts}/${id(1)}/reaction`]: ok({ reactions: { like: 1, love: 0, strong: 0, fire: 0 }, mine: "like" }),
    });
    await openUpdates(server.ask);
    await screen.findByText("Post 1");
    await back();
    await fireEvent.press(screen.getByTestId("react-open"));
    await fireEvent.press(await screen.findByTestId("react-like"));
    await waitFor(() => { expect(stateOf(screen.getByTestId("react-open")).selected).toBe(true); });
    await act(async () => { slow.resolve(ok(feed([post(1)]))()); await slow.promise; });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(stateOf(screen.getByTestId("react-open")).selected).toBe(true);
  });

  it("T3 a comment just sent stays in the box", async () => {
    const back = listenForComeBack();
    const slow = deferred<Reply>();
    let reads = 0;
    const server = serverOf({
      [posts]: ok(feed([post(1)])),
      [onPost(1)]: (body) => {
        if (body !== undefined) return { status: 201, body: { comment: comment(9, 1, { body: "My new comment", own: true, wrote: true }), firstKept: true } };
        reads += 1;
        return reads === 1 ? ok(page([comment(1, 1)]))() : slow.promise;
      },
    });
    await openUpdates(server.ask);
    await fireEvent.press(await screen.findByTestId("comments-open"));
    await screen.findByText("Comment 1");
    await fireEvent.changeText(await screen.findByLabelText("Your comment"), "My new comment");
    // Both the page and the box read again as the app comes back; only the box's is held.
    await back();
    await fireEvent.press(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("My new comment");
    await act(async () => { slow.resolve(ok(page([comment(1, 1)]))()); await slow.promise; });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(screen.queryByText("My new comment")).toBeTruthy();
  });
});

describe("a kept key and a later, deliberate press", () => {
  it("T4 changed words on a post whose first send landed are not lost", async () => {
    const held: { key?: string; body?: string } = {};
    let first = true;
    const server = serverOf({
      [posts]: ok(feed([post(1)])),
      [`${posts}/mine`]: (b) => {
        const body = b as { postKey: string; body: string };
        if (first) { first = false; held.key = body.postKey; held.body = body.body; return lost(); }
        const again = body.postKey === held.key;
        return { status: 201, body: { post: post(60, { body: again ? held.body : body.body, fromMember: true, own: true, wrote: true, authorId: "b1111111-1111-4111-8111-111111111111" }), firstKept: !again } };
      },
    });
    await openUpdates(server.ask);
    await screen.findByText("Post 1");
    await fireEvent.press(screen.getByTestId("write-post"));
    await fireEvent.changeText(await screen.findByLabelText("Your post"), "Yoga is on Sunday");
    await fireEvent.press(screen.getByRole("button", { name: "Post" }));
    await screen.findByText("No connection. Your post is kept. Try again.");
    await fireEvent.changeText(await screen.findByLabelText("Your post"), "A DIFFERENT THING: the pool is closed");
    await fireEvent.press(screen.getByRole("button", { name: "Post" }));
    await screen.findByText("Your first version is up. Press Post to post this one as well, or Discard it.");
    // The first version is on the list; what they wrote since is still in the box, under a key of its own.
    expect(screen.getByLabelText("Your post").props.value).toBe("A DIFFERENT THING: the pool is closed");
    await fireEvent.press(screen.getByRole("button", { name: "Post" }));
    await screen.findByText("Your post is up.");
    const keys = server.asked.filter((a) => a.method === "POST" && a.path === `${posts}/mine`).map((a) => (a.body as { postKey: string }).postKey);
    expect(keys).toHaveLength(3);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[1]);
  });

  it("T5 a reply written after a comment's first send landed is not answered as that comment", async () => {
    const theReply = comment(10, 1, { body: "A REPLY: what time is it on?", parentId: id(1, "c"), own: true, wrote: true });
    const held: { key?: string; body?: string } = {};
    let first = true;
    const server = serverOf({
      [posts]: ok(feed([post(1, { commentCount: 1 })])),
      [onPost(1)]: (b) => {
        if (b === undefined) return ok(page([comment(1, 1, { body: "Ben's comment" })]))();
        const body = b as { commentKey: string; body: string; replyTo?: string };
        if (first) { first = false; held.key = body.commentKey; held.body = body.body; return lost(); }
        const again = body.commentKey === held.key;
        return { status: 201, body: { comment: again ? comment(9, 1, { body: held.body, own: true, wrote: true }) : theReply, firstKept: !again } };
      },
      [`/v1/orgs/${IRON.id}/post-comments/${id(1, "c")}/replies`]: ok(page([theReply])),
    });
    await openUpdates(server.ask);
    await fireEvent.press(await screen.findByTestId("comments-open"));
    await screen.findByText("Ben's comment");
    await fireEvent.changeText(await screen.findByLabelText("Your comment"), "Nice one");
    await fireEvent.press(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("No connection. Your comment is kept. Try again.");
    // They see the box, decide to answer Ben instead, and write something else.
    await fireEvent.press(screen.getByRole("button", { name: "Reply to Asha R." }));
    await fireEvent.changeText(await screen.findByLabelText("Your comment"), "A REPLY: what time is it on?");
    await fireEvent.press(screen.getByRole("button", { name: "Send" }));
    await screen.findByTestId("comments-said");
    expect(screen.getByTestId("comments-said")).toBeTruthy();
    await screen.findByText("Your first version is up. Press Send to post this one as well.");
    // The words are still in the box, still replying, under a key of their own.
    expect(screen.getByLabelText("Your comment").props.value).toBe("A REPLY: what time is it on?");
    await fireEvent.press(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("A REPLY: what time is it on?");
    const sent = server.asked.filter((a) => a.method === "POST" && a.path === onPost(1)).map((a) => a.body as { commentKey: string; replyTo?: string });
    expect(sent).toHaveLength(3);
    expect(sent[1]?.commentKey).toBe(sent[0]?.commentKey);
    expect(sent[2]?.commentKey).not.toBe(sent[1]?.commentKey);
    expect(sent[2]?.replyTo).toBe(id(1, "c"));
  });
});

describe("reactions", () => {
  it("T6 a lost answer on taking a reaction off: the screen asks the server rather than guess", async () => {
    const server = serverOf({
      [posts]: ok(feed([post(1, { mine: "like", reactions: { like: 1, love: 0, strong: 0, fire: 0 } })])),
      [`${posts}/${id(1)}/reaction`]: () => lost(),
    });
    await openUpdates(server.ask);
    await screen.findByText("Post 1");
    const reads = () => server.asked.filter((a) => a.method === "GET" && a.path === posts).length;
    const before = reads();
    await fireEvent.press(screen.getByTestId("react-open"));
    await fireEvent.press(await screen.findByTestId("react-like"));
    await screen.findByText("Couldn't save your reaction. Please try again.");
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(reads()).toBeGreaterThan(before);
  });

  it("T7 two posts pressed in one second: the second stays busy until its own answer, one send at a time", async () => {
    const a = deferred<Reply>();
    const b1 = deferred<Reply>();
    const b2 = deferred<Reply>();
    let bCalls = 0;
    const server = serverOf({
      [posts]: ok(feed([post(1), post(2)])),
      [`${posts}/${id(1)}/reaction`]: () => a.promise,
      [`${posts}/${id(2)}/reaction`]: () => { bCalls += 1; return bCalls === 1 ? b1.promise : b2.promise; },
    });
    await openUpdates(server.ask);
    await screen.findByText("Post 2");
    const opens = () => screen.getAllByTestId("react-open");
    await fireEvent.press(opens()[0] as never);
    await fireEvent.press((await screen.findAllByTestId("react-like"))[0] as never);
    await fireEvent.press(opens()[1] as never);
    await fireEvent.press((await screen.findAllByTestId("react-like"))[0] as never);
    await act(async () => { a.resolve(ok({ reactions: { like: 1, love: 0, strong: 0, fire: 0 }, mine: "like" })()); await a.promise; });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    // The second post's first send is still on its way.
    const second = opens()[1];
    stateOf(expect(second).disabled).toBe(true);
  });
});

describe("comments kept on the phone", () => {
  it("T8 two lists open at once (Updates, then a profile from a challenge) lose nobody's words", async () => {
    const me = "b1111111-1111-4111-8111-111111111111";
    const gym = IRON.id;
    const updates = await renderHook(() => useKeptComments(me, gym));
    await waitFor(() => { expect(updates.result.current.drafts).toBeDefined(); });
    await act(async () => { updates.result.current.put(id(1), { commentKey: id(101, "d"), body: "words on post one", replyTo: null }); await new Promise((r) => setTimeout(r, 10)); });
    const profile = await renderHook(() => useKeptComments(me, gym));
    await waitFor(() => { expect(profile.result.current.drafts).toBeDefined(); });
    await act(async () => { profile.result.current.put(id(2), { commentKey: id(102, "d"), body: "words on post two", replyTo: null }); await new Promise((r) => setTimeout(r, 10)); });
    await act(async () => { updates.result.current.put(id(3), { commentKey: id(103, "d"), body: "words on post three", replyTo: null }); await new Promise((r) => setTimeout(r, 10)); });
    const next = await renderHook(() => useKeptComments(me, gym));
    await waitFor(() => { expect(next.result.current.drafts).toBeDefined(); });
    expect(next.result.current.drafts?.[id(2)]?.body).toBe("words on post two");
  });
});

describe("more", () => {
  it("T7b another post's answer does not open this one's button: one send at a time, and the screen ends on its own answer", async () => {
    const a = deferred<Reply>();
    const b1 = deferred<Reply>();
    let bCalls = 0;
    const server = serverOf({
      [posts]: ok(feed([post(1), post(2)])),
      [`${posts}/${id(1)}/reaction`]: () => a.promise,
      [`${posts}/${id(2)}/reaction`]: () => { bCalls += 1; return b1.promise; },
    });
    await openUpdates(server.ask);
    await screen.findByText("Post 2");
    const opens = () => screen.getAllByTestId("react-open");
    await fireEvent.press(opens()[0] as never);
    await fireEvent.press((await screen.findAllByTestId("react-like"))[0] as never);
    await fireEvent.press(opens()[1] as never);
    await fireEvent.press((await screen.findAllByTestId("react-like"))[0] as never);
    await act(async () => { a.resolve(ok({ reactions: { like: 1, love: 0, strong: 0, fire: 0 }, mine: "like" })()); await a.promise; });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    await fireEvent.press(opens()[1] as never);
    expect(screen.queryAllByTestId("react-love")).toHaveLength(0);
    expect(bCalls).toBe(1);
    await act(async () => { b1.resolve(ok({ reactions: { like: 1, love: 0, strong: 0, fire: 0 }, mine: "like" })()); await b1.promise; });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(opens()[1]?.props.accessibilityLabel).toContain("Like");
    stateOf(expect(opens()[1]).disabled).toBe(false);
  });

  it("T9 a 51st kept comment: words on a post that has gone leave first, and only otherwise is the oldest dropped, and that is said", () => {
    const words = (i: number, over: Partial<KeptComment> = {}): KeptComment => ({ commentKey: id(i, "d"), body: `words ${String(i)}`, replyTo: null, ...over });
    let all: KeptComments = {};
    for (let i = 1; i <= 50; i++) all = withKept(all, id(i), words(i));
    expect(dropsAKeptComment(all, id(51))).toBe(true);
    expect(dropsAKeptComment(all, id(50))).toBe(false);
    const oldestGoes = withKept(all, id(51), words(51));
    expect(Object.keys(oldestGoes)).toHaveLength(50);
    expect(oldestGoes[id(1)]).toBeUndefined();
    const withGone = withKept(all, id(7), words(7, { postGone: true }));
    expect(dropsAKeptComment(withGone, id(51))).toBe(false);
    const goneGoes = withKept(withGone, id(51), words(51));
    expect(Object.keys(goneGoes)).toHaveLength(50);
    expect(goneGoes[id(7)]).toBeUndefined();
    expect(goneGoes[id(1)]).toBeDefined();
    expect(readCommentDrafts(commentDraftsText(withGone))[id(7)]?.postGone).toBe(true);
  });

  it("H7 a post sent again after posting was switched off: it may already be up, and the first send is not forgotten", async () => {
    let answer: () => Reply = lost;
    const server = serverOf({ [posts]: ok(feed([post(1)])), [`${posts}/mine`]: () => answer() });
    await openUpdates(server.ask);
    await screen.findByText("Post 1");
    await fireEvent.press(screen.getByTestId("write-post"));
    await fireEvent.changeText(await screen.findByLabelText("Your post"), "Yoga is on Sunday");
    await fireEvent.press(screen.getByRole("button", { name: "Post" }));
    await screen.findByText("No connection. Your post is kept. Try again.");
    await fireEvent.changeText(await screen.findByLabelText("Your post"), "Yoga is on Sunday at nine");
    answer = () => ({ status: 403, body: { error: "posting_stopped", message: "The staff have stopped you posting here." } });
    await fireEvent.press(screen.getByRole("button", { name: "Post" }));
    await screen.findByText("This post may already be up. Check Updates. You can discard this copy.");
    // Pressed again once allowed, under the same key: the server's answer still decides, and the change is not forgotten.
    answer = () => ({ status: 201, body: { post: post(60, { fromMember: true, own: true, wrote: true, authorId: "b1111111-1111-4111-8111-111111111111" }), firstKept: false } });
    await fireEvent.press(screen.getByRole("button", { name: "Post" }));
    await screen.findByText("Your first version is up. Press Post to post this one as well, or Discard it.");
    expect(screen.getByLabelText("Your post").props.value).toBe("Yoga is on Sunday at nine");
    const keys = server.asked.filter((a) => a.method === "POST" && a.path === `${posts}/mine`).map((a) => (a.body as { postKey: string }).postKey);
    expect(new Set(keys).size).toBe(1);
  });

  it("H7 refused on a first send: nothing was kept, so it is not said to be up", async () => {
    const server = serverOf({ [posts]: ok(feed([post(1)])), [`${posts}/mine`]: () => ({ status: 403, body: { error: "posting_stopped", message: "The staff have stopped you posting here." } }) });
    await openUpdates(server.ask);
    await screen.findByText("Post 1");
    await fireEvent.press(screen.getByTestId("write-post"));
    await fireEvent.changeText(await screen.findByLabelText("Your post"), "Yoga is on Sunday");
    await fireEvent.press(screen.getByRole("button", { name: "Post" }));
    await screen.findByText("The staff have stopped you posting here.", { exact: false });
    expect(screen.queryByText("This post may already be up. Check Updates. You can discard this copy.")).toBeNull();
  });

  it("H3 a comment's reaction with its answer lost: the screen asks the server", async () => {
    let reads = 0;
    const server = serverOf({
      [posts]: ok(feed([post(1, { commentCount: 1 })])),
      [onPost(1)]: () => { reads += 1; return ok(page([comment(1, 1, { mine: "like", reactions: { like: 1, love: 0, strong: 0, fire: 0 } })]))(); },
      [`/v1/orgs/${IRON.id}/post-comments/${id(1, "c")}/reaction`]: () => lost(),
    });
    await openUpdates(server.ask);
    await fireEvent.press(await screen.findByTestId("comments-open"));
    await screen.findByText("Comment 1");
    const before = reads;
    const open = within(screen.getByTestId(`comment-${id(1, "c")}`)).getByTestId("react-open");
    await fireEvent.press(open);
    await fireEvent.press(await screen.findByTestId("react-like"));
    await screen.findByText("Couldn't save your reaction. Please try again.");
    await waitFor(() => { expect(reads).toBeGreaterThan(before); });
  });

  it("H2 a person's profile: a read begun before a reaction, landing after it, does not undo it", async () => {
    const back = listenForComeBack();
    const slow = deferred<Reply>();
    const person = "b1111111-1111-4111-8111-111111111111";
    const theirs = post(1, { fromMember: true, authorId: person });
    const profile = `${posts}/people/${person}`;
    const personal = (rows: Row[]) => ({ posts: rows, next: null, total: rows.length, blocked: false, commenting: "on", blockedCount: 0 });
    let reads = 0;
    const server = serverOf({
      [posts]: ok(feed([theirs])),
      [profile]: () => { reads += 1; return reads === 1 ? ok(personal([theirs]))() : slow.promise; },
      [`${posts}/${id(1)}/reaction`]: ok({ reactions: { like: 1, love: 0, strong: 0, fire: 0 }, mine: "like" }),
    });
    await openUpdates(server.ask);
    await fireEvent.press(await screen.findByLabelText("See Sam Coach's profile"));
    const inPerson = within(await screen.findByTestId("person-profile"));
    await inPerson.findByText("Post 1");
    await back();
    await fireEvent.press(inPerson.getByTestId("react-open"));
    await fireEvent.press(await inPerson.findByTestId("react-like"));
    await waitFor(() => { expect(stateOf(inPerson.getByTestId("react-open")).selected).toBe(true); });
    await act(async () => { slow.resolve(ok(personal([theirs]))()); await slow.promise; });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(stateOf(inPerson.getByTestId("react-open")).selected).toBe(true);
  });
});
