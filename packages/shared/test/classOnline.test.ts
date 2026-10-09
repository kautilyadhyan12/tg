// Online classes, and staff taking one person off a class (spec Part 3 §13.3, §13.4;
// ROADMAP 17g).
//
// The worst thing this job could do to a real person: somebody who is not booked is
// sent the link and walks into a gym's private video class. The first block is that on
// the rule alone; it runs on the real database in `apps/api/test/classOnline.routes.test.ts`.
//
// The expected answers are written out from the plan's words, case by case, not read
// back from the rule. The links are the shapes the video companies' own share buttons
// give, and things a gym might paste by mistake.
import { describe, expect, it } from "vitest";
import {
  CLASS_BOOKING_STATUSES,
  CLASS_ONLINE_STATES,
  CLASS_ONLINE_WORDS,
  classOnlineLinkSchema,
  classOnlineView,
  classOnlineViewSchema,
  createGymClassScheduleRequestSchema,
  decideStaffRemove,
  setClassOnlineRequestSchema,
  type ClassBookingStatus,
  type ClassOnlineState,
} from "../src/index.js";

const MIN = 60_000;
const START = Date.UTC(2026, 9, 20, 17, 0);
/** A 45-minute class: 17:00 to 17:45. Its link shows from 16:30. */
const MINUTES = 45;
const OPENS = START - 30 * MIN;
const END = START + MINUTES * MIN;
const LINK = "https://us02web.zoom.us/j/81234567890?pwd=abcDEF123";

const view = (over: Partial<Parameters<typeof classOnlineView>[0]>) =>
  classOnlineView({ online: true, link: LINK, status: "booked", cancelled: false, nowMs: OPENS, startsAtMs: START, minutes: MINUTES, ...over });

describe("only somebody who holds a place is sent the link", () => {
  const HOLDS: readonly ClassBookingStatus[] = ["booked", "attended", "no_show"];
  const TIMES: readonly [string, number][] = [
    ["a day before", START - 24 * 60 * MIN],
    ["a millisecond before it shows", OPENS - 1],
    ["the moment it shows", OPENS],
    ["at the start", START],
    ["the last millisecond", END - 1],
    ["the moment it ends", END],
    ["a day after", END + 24 * 60 * MIN],
  ];

  it.each([null, ...CLASS_BOOKING_STATUSES].filter((s) => s === null || !HOLDS.includes(s)).flatMap((status) => TIMES.map(([when, nowMs]) => ({ status, when, nowMs }))))(
    "no link for a booking that is $status, $when",
    ({ status, nowMs }) => {
      const got = view({ status, nowMs });
      expect(got?.link).toBeNull();
      expect(got?.state).not.toBe("open");
    },
  );

  it.each(HOLDS.flatMap((status) => TIMES.map(([when, nowMs]) => ({ status, when, nowMs }))))("a place that is $status, $when", ({ status, nowMs }) => {
    const got = view({ status, nowMs });
    const inside = nowMs >= OPENS && nowMs < END;
    expect(got?.link).toBe(inside ? LINK : null);
    expect(got?.state).toBe(nowMs >= END ? "closed" : inside ? "open" : "early");
  });

  it("a cancelled class sends its link to nobody, whatever their booking", () => {
    for (const status of [null, ...CLASS_BOOKING_STATUSES]) {
      expect(view({ status, cancelled: true, nowMs: START })).toEqual({ state: "closed", opensAtMs: OPENS, link: null });
    }
  });

  it("each state by name", () => {
    const cases: [Partial<Parameters<typeof classOnlineView>[0]>, ClassOnlineState][] = [
      [{ status: null }, "not_booked"],
      [{ status: "cancelled" }, "not_booked"],
      [{ status: "late_cancelled" }, "not_booked"],
      [{ status: "waitlisted" }, "waiting"],
      [{ nowMs: OPENS - 1 }, "early"],
      [{}, "open"],
      [{ link: null }, "no_link"],
      [{ link: null, nowMs: OPENS - 1 }, "early"],
      [{ nowMs: END }, "closed"],
    ];
    for (const [over, state] of cases) expect(view(over)?.state).toBe(state);
  });

  it("a class at the gym has no online answer at all", () => {
    expect(view({ online: false })).toBeNull();
  });

  it("the reply's shape refuses a link in any state but open", () => {
    const opensAt = new Date(OPENS).toISOString();
    for (const state of CLASS_ONLINE_STATES) {
      expect(classOnlineViewSchema.safeParse({ state, opensAt, link: LINK }).success).toBe(state === "open");
      expect(classOnlineViewSchema.safeParse({ state, opensAt, link: null }).success).toBe(state !== "open");
      expect(CLASS_ONLINE_WORDS[state]).toMatch(/^Online class\./);
    }
  });
});

describe("the gym's own link", () => {
  it.each([
    "https://us02web.zoom.us/j/81234567890?pwd=abcDEF123",
    "https://zoom.us/j/5551112222",
    "https://meet.google.com/abc-defg-hij",
    "https://teams.microsoft.com/l/meetup-join/19%3ameeting_ZGVm%40thread.v2/0?context=%7b%22Tid%22%3a%22x%22%7d",
    "https://www.youtube.com/live/dQw4w9WgXcQ",
    "https://meet.jit.si/IronHouseYoga",
    "https://ironhouse.webex.com/meet/coach",
    "  https://meet.google.com/abc-defg-hij  ",
  ])("takes %s", (link) => {
    expect(classOnlineLinkSchema.parse(link)).toBe(link.trim());
  });

  it.each([
    ["no https", "http://zoom.us/j/5551112222"],
    ["no scheme", "zoom.us/j/5551112222"],
    ["the Zoom app's own scheme", "zoommtg://zoom.us/join?confno=5551112222"],
    ["a script", "javascript:alert(1)"],
    ["a script behind https", "https://javascript:alert(1)"],
    ["a data address", "data:text/html,<script>alert(1)</script>"],
    ["a meeting number alone", "812 3456 7890"],
    ["an invitation pasted whole", "Join Zoom Meeting https://zoom.us/j/5551112222 Meeting ID: 555 111 2222"],
    ["a sign-in written into it", "https://coach:secret@zoom.us/j/5551112222"],
    ["a machine with no site name", "https://localhost/room"],
    ["nothing", ""],
    ["spaces only", "   "],
    ["too long", `https://zoom.us/j/${"1".repeat(500)}`],
  ])("refuses %s", (_what, link) => {
    expect(classOnlineLinkSchema.safeParse(link).success).toBe(false);
  });

  it("a link goes only with online", () => {
    expect(setClassOnlineRequestSchema.safeParse({ online: true, onlineLink: LINK }).success).toBe(true);
    expect(setClassOnlineRequestSchema.safeParse({ online: true, onlineLink: null }).success).toBe(true);
    expect(setClassOnlineRequestSchema.safeParse({ online: false, onlineLink: null }).success).toBe(true);
    expect(setClassOnlineRequestSchema.safeParse({ online: false, onlineLink: LINK }).success).toBe(false);
    expect(setClassOnlineRequestSchema.safeParse({ online: true }).success).toBe(false);
    expect(setClassOnlineRequestSchema.safeParse({ online: true, onlineLink: LINK, extra: 1 }).success).toBe(false);
  });

  it("a new time slot: left out is not online, and a link needs the tick", () => {
    const slot = { weekdays: [1], startMinute: 600, startsOn: "2026-10-20", minutes: 45, places: 10, coachUserId: null };
    expect(createGymClassScheduleRequestSchema.safeParse(slot).success).toBe(true);
    expect(createGymClassScheduleRequestSchema.safeParse({ ...slot, online: true, onlineLink: LINK }).success).toBe(true);
    expect(createGymClassScheduleRequestSchema.safeParse({ ...slot, online: true }).success).toBe(true);
    expect(createGymClassScheduleRequestSchema.safeParse({ ...slot, onlineLink: LINK }).success).toBe(false);
    expect(createGymClassScheduleRequestSchema.safeParse({ ...slot, online: false, onlineLink: LINK }).success).toBe(false);
    expect(createGymClassScheduleRequestSchema.safeParse({ ...slot, online: true, onlineLink: "http://zoom.us/j/1" }).success).toBe(false);
  });
});

describe("staff take one person off a class", () => {
  const remove = (over: Partial<Parameters<typeof decideStaffRemove>[0]>) =>
    decideStaffRemove({ status: "booked", cancelled: false, started: false, packCharged: false, ...over });

  it("a booked place, before the start: removed, the place freed, a pack given its class back", () => {
    expect(remove({})).toEqual({ kind: "remove", refundPack: false, freesPlace: true });
    expect(remove({ packCharged: true })).toEqual({ kind: "remove", refundPack: true, freesPlace: true });
  });

  it("a place a check-in marked came before the start is removed as the booked place it was", () => {
    expect(remove({ status: "attended", packCharged: true })).toEqual({ kind: "remove", refundPack: true, freesPlace: true });
  });

  it("somebody waiting: removed, and no place is freed", () => {
    expect(remove({ status: "waitlisted" })).toEqual({ kind: "remove", refundPack: false, freesPlace: false });
  });

  it("a place already given up: nothing to do, whatever else is true", () => {
    for (const status of ["cancelled", "late_cancelled"] as const) {
      for (const started of [false, true]) {
        for (const cancelled of [false, true]) expect(remove({ status, started, cancelled })).toEqual({ kind: "already" });
      }
    }
  });

  it("once the class has started nobody is removed: staff mark them", () => {
    for (const status of ["booked", "waitlisted", "attended", "no_show"] as const) {
      expect(remove({ status, started: true })).toEqual({ kind: "refuse", reason: "class_started" });
    }
  });

  it("a cancelled class", () => {
    for (const status of ["booked", "waitlisted", "attended", "no_show"] as const) {
      expect(remove({ status, cancelled: true })).toEqual({ kind: "refuse", reason: "class_cancelled" });
    }
  });
});
