// The two rules behind a gym's phone notifications (ROADMAP Stage 5 item 18b-i): which hours they go
// in, and what one says. Every class of case, garbage included.
import { describe, expect, it } from "vitest";
import { gymMessageNotification, pushHourOpen, pushTokenRequestSchema } from "../src/phoneNotifications.js";

describe("pushHourOpen: from 08:00 up to 21:00 on the person's clock", () => {
  it.each([
    [0, false],
    [7, false],
    [8, true],
    [12, true],
    [20, true],
    [21, false],
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
