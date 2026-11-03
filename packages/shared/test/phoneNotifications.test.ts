// The two rules behind a gym's phone notifications (ROADMAP Stage 5 item 18b-i): which hours they go
// in, and what one says. Every class of case, garbage included.
import { describe, expect, it } from "vitest";
import { bookingTime, tellsPlaceFree } from "../src/classBookings.js";
import { phonePushSchema } from "../src/phoneNotifications.js";
import { COMMENT_NOTIFICATION_LINES, COMMENT_NOTIFICATION_LINE_WORDS, COMMENT_NOTIFICATION_WORDS, commentNotification, gymCommentPushDataSchema, gymMessageNotification, gymPlacePushDataSchema, placeNotification, pushHourOpen, pushTokenRequestSchema } from "../src/phoneNotifications.js";

describe("pushHourOpen: from 04:00 up to 23:00 on the person's clock", () => {
  it.each([
    [0, false],
    [3, false],
    [4, true],
    [7, true],
    [12, true],
    [22, true],
    [23, false],
    // Not an hour of the day: never a send.
    [-1, false],
    [24, false],
    [8.5, false],
    [Number.NaN, false],
    ["9", false],
    [null, false],
    [undefined, false],
  ])("hour %s → %s", (hour, open) => {
    expect(pushHourOpen(hour)).toBe(open);
  });
});

describe("gymMessageNotification: the gym's name, its count once more than one is new", () => {
  it.each([
    [1, "Lotus Yoga"],
    [2, "Lotus Yoga · 2 new messages"],
    [99, "Lotus Yoga · 99 new messages"],
    [140, "Lotus Yoga · 99+ new messages"],
    // A count that is not one: the name alone.
    [0, "Lotus Yoga"],
    [-3, "Lotus Yoga"],
    [2.5, "Lotus Yoga"],
    [Number.NaN, "Lotus Yoga"],
  ])("%s unread → %s", (unread, title) => {
    expect(gymMessageNotification("Lotus Yoga", "Class moved to 7 pm.", unread)).toEqual({ title, body: "Class moved to 7 pm." });
  });
});

describe("pushTokenRequestSchema", () => {
  it("takes Firebase's address shape and refuses anything else", () => {
    const token = `dGVzdA:APA91b${"x".repeat(140)}`;
    expect(pushTokenRequestSchema.safeParse({ token, platform: "android" }).success).toBe(true);
    for (const bad of [
      { token: "short", platform: "android" },
      { token: `${token} more`, platform: "android" },
      { token: "x".repeat(4097), platform: "android" },
      { token, platform: "ios" },
      { token, platform: "android", userId: "someone" },
      { platform: "android" },
    ]) {
      expect(pushTokenRequestSchema.safeParse(bad).success).toBe(false);
    }
  });
});

// ── 18b-ii-a: a place in a class or an event ──

describe("tellsPlaceFree: the people waiting are told only while a place is free to claim", () => {
  const settings = { opensDays: 7, freeCancelMinutes: 120, handoverMinutes: 1440, waitlistMax: 20 };
  const HOUR = 3_600_000;
  const start = Date.UTC(2026, 10, 10, 18);
  const at = (hoursBefore: number) => bookingTime(start - hoursBefore * HOUR, start, settings);
  const base = { cancelled: false, places: 10, booked: 9, waitlisted: 3 };
  it.each([
    ["a place free inside the last day", { time: at(5) }, true],
    ["the last minute before the start", { time: bookingTime(start - 60_000, start, settings) }, true],
    ["more than a day away: the first in line is moved in instead", { time: at(30) }, false],
    ["exactly a day away: no longer handed over by itself", { time: at(24) }, true],
    ["started", { time: at(0) }, false],
    ["after the start", { time: at(-1) }, false],
    ["bookings not open yet", { time: bookingTime(start - 8 * 24 * HOUR, start, settings) }, false],
    ["the class is full", { time: at(5), booked: 10 }, false],
    ["more booked than places (places made smaller)", { time: at(5), booked: 12 }, false],
    ["nobody waiting", { time: at(5), waitlisted: 0 }, false],
    ["staff cancelled the class", { time: at(5), cancelled: true }, false],
    ["no limit on places", { time: at(5), places: null }, false],
  ])("%s", (_case, change, told) => {
    expect(tellsPlaceFree({ ...base, ...change })).toBe(told);
  });
});

describe("placeNotification: the gym's name over one whole sentence", () => {
  it("you have a place", () => {
    expect(placeNotification({ notice: "yours", gymName: "Lotus Yoga", name: "Morning Flow", when: "on Tuesday 11 November at 6:00 PM" })).toEqual({
      title: "Lotus Yoga",
      body: "You have a place in Morning Flow on Tuesday 11 November at 6:00 PM. You were moved off the waitlist.",
    });
  });
  it("a place is free", () => {
    expect(placeNotification({ notice: "free", gymName: "Lotus Yoga", name: "Morning Flow", when: "today at 6:00 PM" })).toEqual({
      title: "Lotus Yoga",
      body: "A place is free in Morning Flow today at 6:00 PM. The first to claim it gets it.",
    });
  });
});

describe("gymPlacePushDataSchema: what a tap opens", () => {
  const gymId = "6f1c1d1e-8a0a-4c55-9a55-1b2a3c4d5e6f";
  const id = "0b9f3c55-2d7e-4f0a-8c1b-9a8b7c6d5e4f";
  it("reads the strings Firebase carries", () => {
    expect(gymPlacePushDataSchema.parse({ kind: "gym_place", gymId, what: "class", id, day: "2026-11-13" })).toEqual({ kind: "gym_place", gymId, what: "class", id, day: "2026-11-13" });
  });
  it.each([
    { kind: "gym_inbox", gymId, what: "class", id, day: "2026-11-13" },
    { kind: "gym_place", gymId: "not-a-gym", what: "class", id, day: "2026-11-13" },
    { kind: "gym_place", gymId, what: "pt", id, day: "2026-11-13" },
    { kind: "gym_place", gymId, what: "event", id, day: "13 Nov" },
    { kind: "gym_place", gymId, what: "event", id, day: "" },
    { kind: "gym_place", gymId, what: "event", id },
  ])("refuses %j", (data) => {
    expect(gymPlacePushDataSchema.safeParse(data).success).toBe(false);
  });
});

describe("commentNotification: one a gym; several listed, newest on top", () => {
  const c = (name: string, words: string, notice: "on_post" | "reply" = "on_post") => ({ name, words, notice });
  it("none is no notification", () => {
    expect(commentNotification({ gymName: "Lotus Yoga", comments: [] })).toBeNull();
  });
  it("a long comment is cut by whole characters, never inside an emoji", () => {
    const body = commentNotification({ gymName: "Lotus Yoga", comments: [c("Ravi S.", "😀".repeat(120))] })?.body ?? "";
    // 120 emoji are 240 UTF-16 units and 120 characters: under the 200 a comment shows, so not cut.
    expect(body).toBe(`Ravi S. commented on your post: ${"😀".repeat(120)}`);
    const cut = commentNotification({ gymName: "Lotus Yoga", comments: [c("Ravi S.", "😀".repeat(250))] })?.body ?? "";
    expect(cut).toBe(`Ravi S. commented on your post: ${"😀".repeat(COMMENT_NOTIFICATION_WORDS - 1)}…`);
    expect(/[�-�](?![�-�])/.test(body)).toBe(false);
    const several = commentNotification({ gymName: "Lotus Yoga", comments: [c("Ravi S.", "🏋️".repeat(80)), c("Asha K.", "Hi")] })?.body ?? "";
    expect(/[�-�](?![�-�])|(?<![�-�])[�-�]/.test(several)).toBe(false);
  });
  it("one comment on the person's post, and one reply to their comment", () => {
    expect(commentNotification({ gymName: "Lotus Yoga", comments: [c("Ravi S.", "Great work!")] })).toEqual({
      title: "Lotus Yoga",
      body: "Ravi S. commented on your post: Great work!",
    });
    expect(commentNotification({ gymName: "Lotus Yoga", comments: [c("Ravi S.", "Thanks", "reply")] })?.body).toBe("Ravi S. replied to your comment: Thanks");
  });
  it("several: the count in the title, one a line, newest on top", () => {
    expect(commentNotification({ gymName: "Lotus Yoga", comments: [c("Kavya S.", "I will join you on Saturday."), c("Kavya S.", "Which route did you take?"), c("Asha K.", "See you there", "reply")] })).toEqual({
      title: "Lotus Yoga · 3 new comments",
      body: "Kavya S.: I will join you on Saturday.\nKavya S.: Which route did you take?\nAsha K.: See you there",
    });
  });
  it("past five, the rest are counted in a last line", () => {
    const seven = Array.from({ length: 7 }, (_, i) => c("A", String(7 - i)));
    const shown = commentNotification({ gymName: "G", comments: seven });
    expect(shown?.title).toBe("G · 7 new comments");
    expect(shown?.body.split("\n")).toEqual(["A: 7", "A: 6", "A: 5", "A: 4", "A: 3", "and 2 more"]);
    expect(COMMENT_NOTIFICATION_LINES).toBe(5);
  });
  it("long words are cut with an ellipsis, and a comment's own lines run together", () => {
    const long = `line one

line two ${"x".repeat(400)}`;
    const one = commentNotification({ gymName: "G", comments: [c("A", long)] })?.body.slice("A commented on your post: ".length) ?? "";
    expect(one.startsWith("line one line two x")).toBe(true);
    expect(one.length).toBe(COMMENT_NOTIFICATION_WORDS);
    expect(one.endsWith("…")).toBe(true);
    const lines = commentNotification({ gymName: "G", comments: [c("A", long), c("B", "short")] })?.body.split("\n") ?? [];
    expect(lines).toHaveLength(2);
    expect(lines[0]?.slice("A: ".length)).toHaveLength(COMMENT_NOTIFICATION_LINE_WORDS);
    expect(lines[0]?.startsWith("A: line one line two x")).toBe(true);
  });
});

describe("gymCommentPushDataSchema: what a tap opens", () => {
  it("takes the gym and the post, and nothing else", () => {
    const gymId = "8f0e7a3c-1d2b-4c5e-9f60-7a8b9c0d1e2f";
    const postId = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
    expect(gymCommentPushDataSchema.parse({ kind: "gym_comment", gymId, postId, extra: 1 })).toEqual({ kind: "gym_comment", gymId, postId });
    expect(gymCommentPushDataSchema.safeParse({ kind: "gym_comment", gymId, postId: "nope" }).success).toBe(false);
    expect(gymCommentPushDataSchema.safeParse({ kind: "gym_inbox", gymId, postId }).success).toBe(false);
  });
});

describe("phonePushSchema: what the app draws itself", () => {
  const push = { heading: "Lotus Yoga", text: "Class moved to 7 pm.", to: "11111111-1111-4111-8111-111111111111", body: '{"kind":"gym_inbox"}', channelId: "gym-messages", tag: "gym-1" };
  it("reads the server's message, and nothing that names no person", () => {
    expect(phonePushSchema.parse({ ...push, dataString: push.body })).toEqual(push);
    expect(phonePushSchema.safeParse({ ...push, to: undefined }).success).toBe(false);
    expect(phonePushSchema.safeParse({ ...push, to: "asha" }).success).toBe(false);
    // The shape the notifications package draws by itself is not ours.
    expect(phonePushSchema.safeParse({ title: "Lotus Yoga", message: "Hi", body: push.body, channelId: "gym-messages", tag: "gym-1" }).success).toBe(false);
  });
});
