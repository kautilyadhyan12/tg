import { describe, expect, it } from "vitest";
import { gymPostsResponseSchema, type GymPost, type GymPostsResponse } from "@app/shared";
import {
  canBlock,
  couldNotRead,
  emptyLine,
  memberPostAction,
  postedText,
  reactionButtons,
  reactionSummary,
  updatesPath,
  withPage,
  withReaction,
  withoutAuthor,
} from "../src/screens/gym/updatesView";

const GYM = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const ASHA = "b1111111-1111-4111-8111-111111111111";
const id = (n: number) => `a${String(n).padStart(7, "0")}-1111-4111-8111-111111111111`;

const post = (n: number, over: Partial<GymPost> = {}): GymPost => ({
  id: id(n),
  author: { name: "Sam Coach", initials: "SC" },
  body: "News",
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
const feed = (posts: GymPost[], over: Partial<GymPostsResponse> = {}): GymPostsResponse =>
  gymPostsResponseSchema.parse({ gymId: GYM, gymName: "Iron House", pinned: [], posts, next: null, status: "shown", posting: "off", blockedCount: 0, supportEmail: null, ...over });

describe("when a post was made, in the phone's own zone, on the gym's clock", () => {
  const now = new Date("2026-10-29T12:00:00.000Z");
  it.each([
    ["UTC", "12h", "2026-10-28T09:05:00.000Z", "28 Oct, 9:05 am"],
    ["UTC", "24h", "2026-10-28T09:05:00.000Z", "28 Oct, 09:05"],
    ["Asia/Kolkata", "12h", "2026-10-28T09:05:00.000Z", "28 Oct, 2:35 pm"],
    ["America/New_York", "12h", "2026-10-28T02:30:00.000Z", "27 Oct, 10:30 pm"],
    ["UTC", "12h", "2026-10-28T00:00:00.000Z", "28 Oct, 12:00 am"],
    ["UTC", "12h", "2026-10-28T12:00:00.000Z", "28 Oct, 12:00 pm"],
    ["UTC", "24h", "2026-10-28T23:59:00.000Z", "28 Oct, 23:59"],
    // Another year says its year.
    ["UTC", "12h", "2025-12-31T18:00:00.000Z", "31 Dec 2025, 6:00 pm"],
  ] as const)("%s %s %s reads %s", (zone, clock, at, words) => {
    expect(postedText(at, now, zone, clock)).toBe(words);
  });

  it("a zone this phone cannot read is not a crash", () => {
    expect(postedText("2026-10-28T09:05:00.000Z", now, "Not/AZone", "12h")).toBe("");
  });
});

describe("reactions", () => {
  it("say the word, how many, and whether one is the reader's", () => {
    const labels = reactionButtons(post(1, { reactions: { like: 1, love: 0, strong: 1200, fire: 3 }, mine: "fire" })).map((r) => r.label);
    expect(labels).toEqual(["Like, 1 person", "Love, 0 people", "Strong, 1,200 people", "Fire, 3 people, including you"]);
  });

  it.each([
    // [was mine, tapped, now mine, counts after]
    [null, "like", "like", { like: 1, love: 0, strong: 0, fire: 0 }],
    ["like", "like", null, { like: 0, love: 0, strong: 0, fire: 0 }],
    ["like", "fire", "fire", { like: 0, love: 0, strong: 0, fire: 1 }],
  ] as const)("mine %s, tapped %s, becomes %s", (was, tapped, now, counts) => {
    const before = post(1, { mine: was, reactions: { like: was === "like" ? 1 : 0, love: 0, strong: 0, fire: 0 } });
    const after = withReaction(before, tapped);
    expect(after.mine).toBe(now);
    expect(after.reactions).toEqual(counts);
  });

  it("the one button says the kinds given, how many in all, and asks for a reaction where there is none", () => {
    const given = reactionSummary(post(1, { reactions: { like: 1, love: 0, strong: 1200, fire: 3 }, mine: "fire" }));
    expect(given.given.map((r) => r.id)).toEqual(["like", "strong", "fire"]);
    expect(given.total).toBe(1204);
    expect(given.label).toBe("Reactions: Like, 1 person; Strong, 1,200 people; Fire, 3 people, including you. Choose a reaction");
    expect(reactionSummary(post(1))).toEqual({ given: [], total: 0, label: "React to this post" });
  });

  it("never counts below nothing", () => {
    expect(withReaction(post(1, { mine: "love" }), "love").reactions.love).toBe(0);
  });
});

describe("what a post offers", () => {
  it.each([
    ["their own member post", { fromMember: true, own: true, wrote: true, authorId: ASHA }, "remove", false],
    ["their own post as staff", { fromMember: false, own: false, wrote: true }, null, false],
    ["another member's", { fromMember: true, authorId: ASHA }, "report", true],
    ["another member's, already reported", { fromMember: true, authorId: ASHA, reported: true }, "reported", true],
    ["staff's", { fromMember: false }, "report", false],
  ] as const)("%s", (_, over, action, block) => {
    const p = post(1, over);
    expect(memberPostAction(p)).toBe(action);
    expect(canBlock(p)).toBe(block);
  });
});

describe("the lists", () => {
  it("a block takes that member's member posts off and leaves their staff posts and everyone else's", () => {
    const list = feed([post(2, { fromMember: true, authorId: ASHA }), post(3, { authorId: null }), post(4, { fromMember: true, authorId: id(9) })], {
      pinned: [post(1, { fromMember: true, authorId: ASHA, pinned: true })],
    });
    const after = withoutAuthor(list, ASHA);
    expect([...after.pinned, ...after.posts].map((p) => p.id)).toEqual([id(3), id(4)]);
  });

  it("the next page never shows a post twice, and carries its own next", () => {
    const first = feed([post(1), post(2)], { next: "x" });
    const after = withPage(first, feed([post(2), post(3)], { next: null }));
    expect(after.posts.map((p) => p.id)).toEqual([id(1), id(2), id(3)]);
    expect(after.next).toBeNull();
  });

  it.each([
    [feed([], { status: "paused" }), true, "Iron House's updates aren't showing at the moment."],
    [feed([], { posting: "off" }), false, "Iron House hasn't posted anything yet."],
    [feed([], { posting: "stopped" }), false, "Iron House hasn't posted anything yet."],
    // With no box to write in, the phone never asks for the first post.
    [feed([], { posting: "on" }), false, "No posts yet."],
    [feed([], { posting: "on" }), true, "No posts yet. Write the first one."],
    [feed([post(1)]), false, null],
  ] as const)("an empty list reads its line (%#)", (list, canWrite, words) => {
    expect(emptyLine(list, canWrite)).toBe(words);
  });

  it("a place that no longer shows its posts says so; no answer says it could not load", () => {
    expect(couldNotRead(404, "Iron House")).toBe("Iron House’s updates aren’t available right now.");
    expect(couldNotRead(null, "Iron House")).toBe("Couldn’t load the updates.");
  });

  it("the next page is asked by the server's own mark, made safe for an address", () => {
    expect(updatesPath(GYM, "2026-10-28T09:05:00.000Z_x")).toBe(`/v1/orgs/${GYM}/posts?before=2026-10-28T09%3A05%3A00.000Z_x`);
  });
});
