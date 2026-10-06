// "I'm coming" on a gym's event (spec Part 3 §15.4; ROADMAP 19c-ii).
//
// The worst thing this job could do to a real person: two people are both told they have
// the last place. The first block is that, on the rule alone; it is raced on the real
// database in `apps/api/test/events.coming.routes.test.ts`.
//
// The table's expected answers are written out from the spec's words, case by case, not
// read back from the rule.
import { describe, expect, it } from "vitest";
import {
  GYM_EVENT_COMING_WORDS,
  decideComing,
  decideNotComing,
  eventBookingSettings,
  eventGoing,
  eventHandsOverNow,
  type EventPlaceInput,
  type GymEventGoing,
} from "../src/index.js";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const START = Date.UTC(2026, 9, 17, 9, 0);
/** The gym's starting values: a place is handed over until a day before, the waitlist holds 20. */
const S = eventBookingSettings({ handoverMinutes: 24 * 60, waitlistMax: 20 });

const FAR = START - 10 * DAY;
const LAST_DAY = START - 6 * HOUR;
const STARTED = START + HOUR;

const at = (over: Partial<EventPlaceInput>): EventPlaceInput => ({
  nowMs: FAR,
  startsAtMs: START,
  cancelled: false,
  places: 10,
  coming: 0,
  waitlisted: 0,
  settings: S,
  mine: null,
  ...over,
});

describe("the last place", () => {
  it("is given once: the tap that finds it free takes it, the next finds the event full", () => {
    const last = at({ places: 3, coming: 2 });
    expect(decideComing({ ...last, joinWaitlist: false })).toEqual({ kind: "book", membershipId: null, chargePack: false, fromWaitlist: false });
    // The same tap a moment later, counted again with that place taken.
    expect(decideComing({ ...last, coming: 3, joinWaitlist: false })).toEqual({ kind: "refuse", reason: "class_full" });
    expect(decideComing({ ...last, coming: 3, joinWaitlist: true })).toEqual({ kind: "waitlist" });
    // Somebody already coming who taps again is not counted twice.
    expect(decideComing({ ...last, coming: 3, mine: "coming", joinWaitlist: false })).toEqual({ kind: "already", status: "booked" });
  });

  it("is never over-given, whatever the number coming says", () => {
    for (const coming of [3, 4, 50]) {
      expect(decideComing({ ...at({ places: 3, coming }), joinWaitlist: false }).kind, String(coming)).toBe("refuse");
    }
  });
});

describe("an event's own times", () => {
  it("can be said yes to from the day it is posted, two years out, and nothing is ever charged", () => {
    const decision = decideComing({ ...at({ nowMs: START - 730 * DAY }), joinWaitlist: false });
    expect(decision).toEqual({ kind: "book", membershipId: null, chargePack: false, fromWaitlist: false });
  });

  it("\"Can't come\" is free until the minute it starts, and not after", () => {
    expect(decideNotComing(at({ nowMs: START - 60_000, mine: "coming" }))).toEqual({ kind: "cancel", status: "cancelled", refundPack: false, freesPlace: true });
    expect(decideNotComing(at({ nowMs: START, mine: "coming" }))).toEqual({ kind: "refuse", reason: "class_started" });
    expect(decideNotComing(at({ mine: null }))).toEqual({ kind: "refuse", reason: "no_booking" });
    // Leaving the line frees no place; nor does giving up a place at a cancelled event.
    expect(decideNotComing(at({ mine: "waitlisted" }))).toMatchObject({ kind: "cancel", freesPlace: false });
    expect(decideNotComing(at({ mine: "coming", cancelled: true }))).toMatchObject({ kind: "cancel", freesPlace: false });
  });

  it("a free place goes to the line by itself only while the event is more than the gym's time away", () => {
    const freed = { ...at({ places: 3, coming: 2, waitlisted: 2 }) };
    expect(eventHandsOverNow(freed)).toBe(true);
    expect(eventHandsOverNow({ ...freed, nowMs: START - DAY })).toBe(false);
    expect(eventHandsOverNow({ ...freed, nowMs: LAST_DAY })).toBe(false);
    expect(eventHandsOverNow({ ...freed, nowMs: STARTED })).toBe(false);
    expect(eventHandsOverNow({ ...freed, cancelled: true })).toBe(false);
    expect(eventHandsOverNow({ ...freed, coming: 3 })).toBe(false);
    expect(eventHandsOverNow({ ...freed, waitlisted: 0 })).toBe(false);
    // No limit: everybody waiting is let in.
    expect(eventHandsOverNow({ ...freed, places: null, coming: 500 })).toBe(true);
  });
});

type Can = GymEventGoing["can"];
const NOTHING: Can = { come: false, joinWaitlist: false, claim: false, cancel: false, why: null };
const can = (over: Partial<Can>): Can => ({ ...NOTHING, ...over });

describe("what a member reads and can do", () => {
  // what, the event and the person, their place in line, what they can do.
  const table: [string, Partial<EventPlaceInput>, number | null, Can][] = [
    // ── nobody's yet ──
    ["no limit, not down for it", { places: null, coming: 500 }, null, can({ come: true })],
    ["places free", { places: 10, coming: 4 }, null, can({ come: true })],
    ["the last place", { places: 10, coming: 9 }, null, can({ come: true })],
    ["full, room in the line", { places: 10, coming: 10, waitlisted: 3 }, null, can({ joinWaitlist: true })],
    ["full, an empty line", { places: 10, coming: 10 }, null, can({ joinWaitlist: true })],
    ["full, the line full", { places: 10, coming: 10, waitlisted: 20 }, null, can({ why: "waitlist_full" })],
    ["full, a gym with no waitlist", { places: 10, coming: 10, settings: eventBookingSettings({ handoverMinutes: 1440, waitlistMax: 0 }) }, null, can({ why: "waitlist_full" })],
    // ── already down for it ──
    ["coming", { places: 10, coming: 10, mine: "coming" }, null, can({ cancel: true })],
    ["coming, no limit", { places: null, coming: 3, mine: "coming" }, null, can({ cancel: true })],
    ["waiting, full", { places: 10, coming: 10, waitlisted: 3, mine: "waitlisted" }, 2, can({ cancel: true })],
    // ── a place free with people waiting, far out: it is the line's ──
    ["one free, two waiting, not in line", { places: 10, coming: 9, waitlisted: 2 }, null, can({ joinWaitlist: true })],
    ["one free, first in line", { places: 10, coming: 9, waitlisted: 2, mine: "waitlisted" }, 1, can({ claim: true, cancel: true })],
    ["one free, second in line", { places: 10, coming: 9, waitlisted: 2, mine: "waitlisted" }, 2, can({ cancel: true })],
    ["three free, two waiting, not in line", { places: 10, coming: 7, waitlisted: 2 }, null, can({ come: true })],
    // The free place is the first in line's, which leaves the line one short of full.
    ["one free, the line full, not in line", { places: 10, coming: 9, waitlisted: 20 }, null, can({ joinWaitlist: true })],
    ["last day, one free, the line full, not in line", { nowMs: LAST_DAY, places: 10, coming: 9, waitlisted: 20 }, null, can({ come: true })],
    // ── the same inside the last day: the first to tap has it ──
    ["last day, one free, two waiting, not in line", { nowMs: LAST_DAY, places: 10, coming: 9, waitlisted: 2 }, null, can({ come: true })],
    ["last day, one free, second in line", { nowMs: LAST_DAY, places: 10, coming: 9, waitlisted: 2, mine: "waitlisted" }, 2, can({ claim: true, cancel: true })],
    ["last day, full", { nowMs: LAST_DAY, places: 10, coming: 10 }, null, can({ joinWaitlist: true })],
    // ── started ──
    ["started, places free", { nowMs: STARTED, places: 10, coming: 4 }, null, can({ why: "event_started" })],
    ["started, coming", { nowMs: STARTED, places: 10, coming: 4, mine: "coming" }, null, can({})],
    ["started, waiting", { nowMs: STARTED, places: 10, coming: 10, waitlisted: 1, mine: "waitlisted" }, 1, can({ cancel: true, why: "event_started" })],
    // ── cancelled by the gym ──
    ["cancelled, not down for it", { cancelled: true, places: 10, coming: 4 }, null, can({ why: "event_cancelled" })],
    ["cancelled, coming", { cancelled: true, places: 10, coming: 4, mine: "coming" }, null, can({ cancel: true })],
    ["cancelled, waiting", { cancelled: true, places: 10, coming: 10, waitlisted: 1, mine: "waitlisted" }, 1, can({ cancel: true, why: "event_cancelled" })],
  ];

  it.each(table)("%s", (_what, input, waitlistPlace, expected) => {
    const going = eventGoing({ ...at(input), waitlistPlace });
    expect(going.can).toEqual(expected);
    // Never both a place and the line offered, and nothing offered to somebody coming.
    expect([going.can.come, going.can.joinWaitlist, going.can.claim].filter(Boolean).length).toBeLessThanOrEqual(1);
  });

  it("says how many are coming and waiting as they are, and the person's own place", () => {
    expect(eventGoing({ ...at({ places: 10, coming: 9, waitlisted: 2, mine: "waitlisted" }), waitlistPlace: 2 })).toMatchObject({
      coming: 9,
      waiting: 2,
      mine: { status: "waitlisted", waitlistPlace: 2 },
    });
    expect(eventGoing({ ...at({ coming: 4, mine: "coming" }), waitlistPlace: null }).mine).toEqual({ status: "coming", waitlistPlace: null });
    expect(eventGoing({ ...at({ coming: 4 }), waitlistPlace: null }).mine).toBeNull();
  });
});

describe("the words", () => {
  it("say how many are coming when places are cut too far", () => {
    expect(GYM_EVENT_COMING_WORDS.places_below_coming(1)).toBe("1 person is coming, so the places can't be fewer than 1.");
    expect(GYM_EVENT_COMING_WORDS.places_below_coming(12)).toBe("12 people are coming, so the places can't be fewer than 12.");
  });
});
