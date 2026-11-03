// The two rules behind a gym's phone notifications (ROADMAP Stage 5 item 18b-i): which hours they go
// in, and what one says. Every class of case, garbage included.
import { describe, expect, it } from "vitest";
import { bookingTime, tellsPlaceFree } from "../src/classBookings.js";
import { gymMessageNotification, gymPlacePushDataSchema, placeNotification, pushHourOpen, pushTokenRequestSchema } from "../src/phoneNotifications.js";

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
