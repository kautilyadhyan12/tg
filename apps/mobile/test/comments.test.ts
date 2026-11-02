import { describe, expect, it } from "vitest";
import { GYM_POST_COMMENT_DRAFTS_MOST, gymPostCommentSchema, type GymPostComment } from "@app/shared";
import {
  canSendComment,
  commentButton,
  commentDraftsText,
  commentRemoveBox,
  commentRoom,
  goneWith,
  hasKeptWords,
  merged,
  offersComments,
  readCommentDrafts,
  repliesButton,
  repliesPath,
  withFirstPage,
  withKept,
  type KeptComment,
} from "../src/screens/gym/commentsView";

const id = (n: number, first = "c") => `${first}${String(n).padStart(7, "0")}-1111-4111-8111-111111111111`;
const comment = (n: number, over: Partial<GymPostComment> = {}): GymPostComment =>
  gymPostCommentSchema.parse({
    id: id(n),
    postId: id(1, "a"),
    parentId: null,
    replyingTo: null,
    author: { name: "Asha R.", initials: "AR" },
    body: "Words",
    createdAt: `2026-10-28T10:${String(n).padStart(2, "0")}:00.000Z`,
    reactions: { like: 0, love: 0, strong: 0, fire: 0 },
    mine: null,
    fromMember: true,
    authorId: null,
    own: false,
    wrote: false,
    reported: false,
    hidden: false,
    replyCount: 0,
    ...over,
  });
const kept = (body: string, over: Partial<KeptComment> = {}): KeptComment => ({ commentKey: id(9, "d"), body, replyTo: null, ...over });

describe("the button on a post, and whether there is one", () => {
  it.each([
    [0, false, "Comment", "Comment on this post"],
    [1, false, "1", "1 comment. Read or write a comment"],
    [99, false, "99", "99 comments. Read or write a comment"],

    [100, false, "99+", "More than 99 comments. Read or write a comment"],
    [1200, false, "99+", "More than 99 comments. Read or write a comment"],
    [3, true, "Finish your comment", "Finish your comment"],
  ])("%i comments, kept %s", (count, isKept, label, say) => {
    expect(commentButton(count, isKept)).toEqual({ label, say });
  });

  it.each([
    ["on", 0, false, true],
    ["stopped", 0, false, true],
    ["off", 0, false, false],
    ["off", 2, false, true],
    ["off", 0, true, true],
  ] as const)("commenting %s, %i comments, kept %s", (commenting, count, isKept, shown) => {
    expect(offersComments(commenting, count, isKept)).toBe(shown);
  });
});

describe("words", () => {
  it("room is said only when near, over the limit plainly, counted as the server counts it", () => {
    expect(commentRoom("a".repeat(449))).toEqual({ over: false, text: null });
    expect(commentRoom("a".repeat(450))).toEqual({ over: false, text: "50 characters left" });
    expect(commentRoom("a".repeat(499))).toEqual({ over: false, text: "1 character left" });
    expect(commentRoom("😀".repeat(500))).toEqual({ over: false, text: "0 characters left" });
    expect(commentRoom("a".repeat(501))).toEqual({ over: true, text: "1 character too many" });
    expect(commentRoom(`  ${"a".repeat(500)}  `).over).toBe(false);
  });

  it("Send needs words, within the limit", () => {
    expect(canSendComment("")).toBe(false);
    expect(canSendComment("   ")).toBe(false);
    for (const blank of ["\u200B\uFEFF", "\u3164", "\u2800", "\uFE0F", "\u{E0001}\u{E0020}"]) expect(canSendComment(blank)).toBe(false);
    expect(canSendComment("😀")).toBe(true);
    expect(canSendComment("Hi")).toBe(true);
    expect(canSendComment("a".repeat(501))).toBe(false);
  });

  it("replies, and the box before removing", () => {
    expect(repliesButton(1, false)).toBe("See 1 reply");
    expect(repliesButton(1200, false)).toBe("See 1,200 replies");
    expect(repliesButton(3, true)).toBe("Hide replies");
    expect(commentRemoveBox({ parentId: null, replyCount: 0 }).line).toBe("Your comment will disappear for everyone. This can't be undone.");
    expect(commentRemoveBox({ parentId: null, replyCount: 1 }).line).toBe("Your comment and the reply under it will disappear for everyone. This can't be undone.");
    expect(commentRemoveBox({ parentId: id(1), replyCount: 0 }).title).toBe("Remove your reply?");
    expect(goneWith({ replyCount: 3 })).toBe(4);
  });

  it("the replies' address carries its place in the list", () => {
    expect(repliesPath(id(1, "e"), id(2), "2026-10-28T10:00:00.000Z_x")).toContain("/replies?after=2026-10-28T10%3A00%3A00.000Z_x");
  });
});

describe("the lists", () => {
  it("merged: oldest first, none twice, what was read last counts", () => {
    const out = merged([comment(2), comment(1, { body: "old" })], [comment(1, { body: "new" }), comment(3)]);
    expect(out.map((c) => [c.id, c.body])).toEqual([[id(1), "new"], [id(2), "Words"], [id(3), "Words"]]);
  });

  it("the first page read again: one gone since goes, pages further on stay, and the end is the server's", () => {
    const had = { comments: [comment(1), comment(2), comment(3), comment(4)], next: "later" };
    expect(withFirstPage(had, { comments: [comment(2)], next: "p2" })).toEqual({ comments: [comment(2), comment(3), comment(4)], next: "later" });
    expect(withFirstPage({ comments: [comment(1)], next: "first" }, { comments: [comment(1)], next: "p2" }).next).toBe("p2");
    expect(withFirstPage(had, { comments: [comment(2)], next: null })).toEqual({ comments: [comment(2)], next: null });
    expect(withFirstPage(had, { comments: [], next: null })).toEqual({ comments: [], next: null });
    // Their own 21st added with no more to read, and somebody's 22nd since: it can still be reached.
    expect(withFirstPage({ comments: [comment(1), comment(3)], next: null }, { comments: [comment(1)], next: "p2" })).toEqual({ comments: [comment(1), comment(3)], next: "p2" });
  });
});

describe("kept on the phone", () => {
  const POST = id(1, "a");

  it("written and read back whole; anything unreadable is nothing, never a crash", () => {
    const drafts = withKept({}, POST, kept("Words", { replyTo: { id: id(2), name: "Asha R." }, sent: true, changed: true }));
    expect(readCommentDrafts(commentDraftsText(drafts))).toEqual(drafts);
    for (const bad of [null, "", "not json", "{}", '{"version":2,"drafts":{}}', '{"version":1,"drafts":{"not-an-id":{}}}']) expect(readCommentDrafts(bad)).toEqual({});
  });

  it("no words and nobody to answer is not kept; pressing Reply is kept until they stop, and isn't words waiting", () => {
    expect(withKept({}, POST, kept(""))).toEqual({});
    expect(withKept(withKept({}, POST, kept("x")), POST, null)).toEqual({});
    const replying = withKept({}, POST, kept("", { replyTo: { id: id(2), name: "Asha R." } }));
    expect(replying[POST]?.replyTo?.name).toBe("Asha R.");
    expect(hasKeptWords(replying[POST])).toBe(false);
    expect(hasKeptWords(kept("x"))).toBe(true);
    expect(hasKeptWords(undefined)).toBe(false);
  });

  it("the newest stay when there are too many, and the file stays readable", () => {
    let drafts = {};
    for (let i = 0; i < GYM_POST_COMMENT_DRAFTS_MOST + 5; i += 1) drafts = withKept(drafts, id(i, "a"), kept(`w${String(i)}`));
    expect(Object.keys(drafts)).toHaveLength(GYM_POST_COMMENT_DRAFTS_MOST);
    expect(Object.keys(readCommentDrafts(commentDraftsText(drafts)))).toContain(id(GYM_POST_COMMENT_DRAFTS_MOST + 4, "a"));
    expect(Object.keys(drafts)).not.toContain(id(0, "a"));
  });
});
