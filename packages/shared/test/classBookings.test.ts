// Booking a class and its waitlist (spec Part 3 §13.4; ROADMAP 17c-i).
//
// The worst thing this job could do to a real person: tell two people "You're booked"
// for the last place, or take a class off somebody's pack for a booking they never got.
// The first block is that, on the rule alone; the same two are raced on the real
// database in `apps/api/test/classBookings.routes.test.ts`.
//
// The table's expected answers are written out from the spec's words, case by case
// (`expected` below), not read back from the rule.
import { describe, expect, it } from "vitest";
import {
  CLASS_BOOKING_DEFAULTS,
  bookingPeriod,
  bookingTime,
  decideBook,
  decideCancel,
  giveHeldMembership,
  handsOverNow,
  moveHeldMembership,
  pickCover,
  type BookDecision,
  type BookingTime,
  type Cover,
  type HeldCover,
  type HeldMembership,
  type HeldMembershipTerms,
} from "../src/index.js";

const HOUR = 60 * 60 * 1000;
const START = Date.UTC(2026, 9, 20, 17, 0); // a Tuesday
const CLASS_DAY = "2026-10-20";
const S = CLASS_BOOKING_DEFAULTS;

const monthly: HeldMembershipTerms = { kind: "recurring", termCount: 1, termUnit: "month", packClasses: null, packDays: null, priceMinor: 4999 };
const tenPack: HeldMembershipTerms = { kind: "pack", termCount: null, termUnit: null, packClasses: 10, packDays: 60, priceMinor: 9000 };

function given(type: HeldMembershipTerms, startsOn: string): HeldMembership {
  const made = giveHeldMembership(type, startsOn, true, startsOn);
  if (!made.ok) throw new Error(`not given: ${made.reason}`);
  return made.membership;
}

const held = (id: string, membership: HeldMembership, over: Partial<HeldCover> = {}): HeldCover => ({
  id,
  membership,
  access: "all_classes",
  coversClass: true,
  bookingsLimit: null,
  bookingsPeriod: null,
  used: 0,
  ...over,
});

const cover = (list: HeldCover[], openGym = false, gymHasTypes = true): Cover => pickCover({ gymHasTypes, openGym, classDay: CLASS_DAY, held: list });

/** The five times the spec names, as hours before the start. */
const TIMES = {
  "before opening": 8 * 24,
  open: 3 * 24,
  "inside the hand-over time": 5,
  "inside the free-cancel time": 1,
  "after the start": -0.5,
} as const;
type TimeName = keyof typeof TIMES;
const at = (name: TimeName): BookingTime => bookingTime(START - TIMES[name] * HOUR, START, S);

describe("the last place, and the pack", () => {
  it("fifty people ask for one place: one is booked and the next twenty wait, the rest are told it is full", () => {
    let booked = 0;
    let waitlisted = 0;
    const answers: string[] = [];
    for (let n = 0; n < 50; n++) {
      const d = decideBook({ time: at("open"), cancelled: false, places: 1, booked, waitlisted, waitlistMax: S.waitlistMax, mine: null, joinWaitlist: true, cover: cover([], false, false) });
      if (d.kind === "book") booked += 1;
      if (d.kind === "waitlist") waitlisted += 1;
      answers.push(d.kind === "refuse" ? d.reason : d.kind);
    }
    expect(booked).toBe(1);
    expect(waitlisted).toBe(20);
    expect(answers.filter((a) => a === "waitlist_full")).toHaveLength(29);
  });

  it("a pack is charged by the booking, and the same request again charges nothing", () => {
    const pack = held("p", given(tenPack, "2026-10-01"));
    const first = decideBook({ time: at("open"), cancelled: false, places: 10, booked: 3, waitlisted: 0, waitlistMax: 20, mine: null, joinWaitlist: false, cover: cover([pack]) });
    expect(first).toEqual({ kind: "book", membershipId: "p", chargePack: true, fromWaitlist: false });
    const again = decideBook({ time: at("open"), cancelled: false, places: 10, booked: 4, waitlisted: 0, waitlistMax: 20, mine: "booked", joinWaitlist: false, cover: cover([pack]) });
    expect(again).toEqual({ kind: "already", status: "booked" });
  });

  it("waiting charges nothing: the pack is charged when the place is theirs", () => {
    const pack = held("p", given(tenPack, "2026-10-01"));
    const wait = decideBook({ time: at("open"), cancelled: false, places: 1, booked: 1, waitlisted: 0, waitlistMax: 20, mine: null, joinWaitlist: true, cover: cover([pack]) });
    expect(wait).toEqual({ kind: "waitlist" });
    const movedIn = decideBook({ time: at("open"), cancelled: false, places: 1, booked: 0, waitlisted: 1, waitlistMax: 20, mine: "waitlisted", joinWaitlist: false, cover: cover([pack]) });
    expect(movedIn).toEqual({ kind: "book", membershipId: "p", chargePack: true, fromWaitlist: true });
  });

  it("a free cancel gives the pack its class back; a late cancel and a class that has started do not", () => {
    const base = { cancelled: false, mine: "booked" as const, packCharged: true };
    expect(decideCancel({ ...base, time: at("open"), lateOk: false })).toEqual({ kind: "cancel", status: "cancelled", refundPack: true, freesPlace: true });
    expect(decideCancel({ ...base, time: at("inside the hand-over time"), lateOk: false })).toEqual({ kind: "cancel", status: "cancelled", refundPack: true, freesPlace: true });
    expect(decideCancel({ ...base, time: at("inside the free-cancel time"), lateOk: false })).toEqual({ kind: "refuse", reason: "late_cancel" });
    expect(decideCancel({ ...base, time: at("inside the free-cancel time"), lateOk: true })).toEqual({ kind: "cancel", status: "late_cancelled", refundPack: false, freesPlace: true });
    expect(decideCancel({ ...base, time: at("after the start"), lateOk: true })).toEqual({ kind: "refuse", reason: "class_started" });
  });
});

describe("the gym's times, at their starting values", () => {
  const left = (hours: number) => bookingTime(START - hours * HOUR, START, S);

  it("booking opens 7 days before and closes at the start", () => {
    expect(left(7 * 24 + 0.01).phase).toBe("before_opening");
    expect(left(7 * 24).phase).toBe("open");
    expect(left(0.01).phase).toBe("open");
    expect(left(0).phase).toBe("started");
    expect(left(-1).phase).toBe("started");
  });

  it("cancelling is free until 2 hours before", () => {
    expect(left(2.01).freeCancel).toBe(true);
    expect(left(2).freeCancel).toBe(true);
    expect(left(1.99).freeCancel).toBe(false);
    expect(left(-1).freeCancel).toBe(false);
  });

  it("a freed place is handed over by itself only while the class is more than 1 day away", () => {
    expect(left(24.01).handsOver).toBe(true);
    expect(left(24).handsOver).toBe(false);
    expect(left(5).handsOver).toBe(false);
    expect(left(8 * 24).handsOver).toBe(false);
    expect(left(-1).handsOver).toBe(false);
  });

  it("a gym's own numbers move each line", () => {
    const own = { opensDays: 14, freeCancelMinutes: 12 * 60, handoverMinutes: 60, waitlistMax: 5 };
    const t = bookingTime(START - 10 * 24 * HOUR, START, own);
    expect(t).toEqual({ phase: "open", freeCancel: true, handsOver: true });
    expect(bookingTime(START - 6 * HOUR, START, own)).toEqual({ phase: "open", freeCancel: false, handsOver: true });
    expect(bookingTime(START - 0.5 * HOUR, START, own)).toEqual({ phase: "open", freeCancel: false, handsOver: false });
  });

  it("hands a place over only where one is free, the class runs and the time allows", () => {
    expect(handsOverNow({ time: at("open"), cancelled: false, places: 5, booked: 4 })).toBe(true);
    expect(handsOverNow({ time: at("open"), cancelled: false, places: null, booked: 400 })).toBe(true);
    expect(handsOverNow({ time: at("open"), cancelled: false, places: 5, booked: 5 })).toBe(false);
    expect(handsOverNow({ time: at("open"), cancelled: false, places: 5, booked: 6 })).toBe(false);
    expect(handsOverNow({ time: at("open"), cancelled: true, places: 5, booked: 4 })).toBe(false);
    expect(handsOverNow({ time: at("inside the hand-over time"), cancelled: false, places: 5, booked: 4 })).toBe(false);
  });
});

describe("the week and the month a limit is counted in", () => {
  // Read off a 2026–2028 calendar: 20 Oct 2026 is a Tuesday, 1 Nov 2026 a Sunday,
  // 28 Dec 2026 a Monday, 29 Feb 2028 a Tuesday.
  it.each([
    ["2026-10-20", "2026-10-19", "2026-10-25"],
    ["2026-10-19", "2026-10-19", "2026-10-25"],
    ["2026-10-25", "2026-10-19", "2026-10-25"],
    ["2026-11-01", "2026-10-26", "2026-11-01"],
    ["2026-12-31", "2026-12-28", "2027-01-03"],
    ["2028-02-29", "2028-02-28", "2028-03-05"],
  ])("the week of %s is Monday %s to Sunday %s", (day, from, to) => {
    expect(bookingPeriod(day, "week")).toEqual({ from, to });
  });

  it.each([
    ["2026-10-20", "2026-10-01", "2026-10-31"],
    ["2026-02-01", "2026-02-01", "2026-02-28"],
    ["2028-02-29", "2028-02-01", "2028-02-29"],
    ["2026-12-31", "2026-12-01", "2026-12-31"],
  ])("the month of %s is %s to %s", (day, from, to) => {
    expect(bookingPeriod(day, "month")).toEqual({ from, to });
  });
});

describe("which membership covers a class", () => {
  const unlimited = held("u", given(monthly, "2026-10-01"));
  const twoAWeek = (used: number) => held("l", given(monthly, "2026-10-01"), { access: "limited", bookingsLimit: 2, bookingsPeriod: "week", used });
  const pack = (id = "p", startsOn = "2026-10-01") => held(id, given(tenPack, startsOn));
  const gymOnly = held("g", given(monthly, "2026-10-01"), { access: "gym_only" });

  it("a gym with no membership types lets any member book, on no membership", () => {
    expect(cover([], false, false)).toEqual({ ok: true, membershipId: null, chargePack: false });
    expect(cover([pack()], false, false)).toEqual({ ok: true, membershipId: null, chargePack: false });
  });

  it("no membership at all, and one that does not include this class", () => {
    expect(cover([])).toEqual({ ok: false, reason: "no_membership" });
    expect(cover([held("x", given(monthly, "2026-10-01"), { coversClass: false })])).toEqual({ ok: false, reason: "not_covered" });
  });

  it("a membership that includes every class is used before a pack, which is left whole", () => {
    expect(cover([pack(), unlimited])).toEqual({ ok: true, membershipId: "u", chargePack: false });
  });

  it("bookings a week: within them it covers, past them the pack is charged, and with no pack it says the week is used", () => {
    expect(cover([twoAWeek(1)])).toEqual({ ok: true, membershipId: "l", chargePack: false });
    expect(cover([twoAWeek(2), pack()])).toEqual({ ok: true, membershipId: "p", chargePack: true });
    expect(cover([twoAWeek(2)])).toEqual({ ok: false, reason: "limit_week" });
    expect(cover([held("m", given(monthly, "2026-10-01"), { access: "limited", bookingsLimit: 8, bookingsPeriod: "month", used: 8 })])).toEqual({ ok: false, reason: "limit_month" });
  });

  it("of two packs the one that ends first is charged", () => {
    expect(cover([pack("a", "2026-10-10"), pack("b", "2026-10-01")])).toEqual({ ok: true, membershipId: "b", chargePack: true });
  });

  it("gym only includes an open-gym slot and no class", () => {
    expect(cover([gymOnly])).toEqual({ ok: false, reason: "not_covered" });
    expect(cover([gymOnly], true)).toEqual({ ok: true, membershipId: "g", chargePack: false });
  });

  it("a membership counts only if it runs on the class's own day", () => {
    const frozen = moveHeldMembership(given(monthly, "2026-10-01"), { type: "freeze" }, "2026-10-05");
    if (!frozen.ok) throw new Error("not frozen");
    expect(cover([held("f", frozen.membership)])).toEqual({ ok: false, reason: "no_membership" });
    // Starts the day after the class.
    expect(cover([held("s", given(monthly, "2026-10-21"))])).toEqual({ ok: false, reason: "no_membership" });
    // A 10-class pack used within 60 days from 1 August ended on 29 September.
    expect(cover([pack("old", "2026-08-01")])).toEqual({ ok: false, reason: "no_membership" });
    // A pack with no class left has ended.
    expect(cover([held("e", { ...given(tenPack, "2026-10-01"), classesLeft: 0 })])).toEqual({ ok: false, reason: "no_membership" });
    // Starts on the class's day.
    expect(cover([held("d", given(monthly, CLASS_DAY))])).toEqual({ ok: true, membershipId: "d", chargePack: false });
  });
});

describe("every kind of membership × places × time × the request twice", () => {
  const MEMBERSHIPS: Record<string, { cover: Cover; covered: boolean; chargePack: boolean; refusal?: string }> = {
    "a gym with no membership types": { cover: cover([], false, false), covered: true, chargePack: false },
    "unlimited classes": { cover: cover([held("u", given(monthly, "2026-10-01"))]), covered: true, chargePack: false },
    "two a week, one used": { cover: cover([held("l", given(monthly, "2026-10-01"), { access: "limited", bookingsLimit: 2, bookingsPeriod: "week", used: 1 })]), covered: true, chargePack: false },
    "two a week, both used": { cover: cover([held("l", given(monthly, "2026-10-01"), { access: "limited", bookingsLimit: 2, bookingsPeriod: "week", used: 2 })]), covered: false, chargePack: false, refusal: "limit_week" },
    "a pack with a class left": { cover: cover([held("p", given(tenPack, "2026-10-01"))]), covered: true, chargePack: true },
    "gym only": { cover: cover([held("g", given(monthly, "2026-10-01"), { access: "gym_only" })]), covered: false, chargePack: false, refusal: "not_covered" },
    "no membership": { cover: cover([]), covered: false, chargePack: false, refusal: "no_membership" },
  };
  const PLACES = { free: { places: 10, booked: 4 }, last: { places: 10, booked: 9 }, full: { places: 10, booked: 10 }, "no limit": { places: null, booked: 250 } } as const;

  /** The spec's words, in order: a class that has started or is not open yet takes no
   *  booking; then who may book; then a place if one is free, else the waitlist. */
  const expected = (m: (typeof MEMBERSHIPS)[string], places: keyof typeof PLACES, time: TimeName, joinWaitlist: boolean): string => {
    if (time === "after the start") return "class_started";
    if (time === "before opening") return "not_open_yet";
    if (!m.covered) return m.refusal ?? "";
    if (places !== "full") return m.chargePack ? "book and charge the pack" : "book";
    return joinWaitlist ? "waitlist" : "class_full";
  };
  const said = (d: BookDecision): string =>
    d.kind === "refuse" ? d.reason : d.kind === "book" ? (d.chargePack ? "book and charge the pack" : "book") : d.kind;

  const cases: [string, keyof typeof PLACES, TimeName, boolean][] = [];
  for (const name of Object.keys(MEMBERSHIPS)) {
    for (const places of ["free", "last", "full", "no limit"] as const) {
      for (const time of Object.keys(TIMES) as TimeName[]) {
        for (const joinWaitlist of [false, true]) cases.push([name, places, time, joinWaitlist]);
      }
    }
  }

  it.each(cases)("%s · %s · %s · waitlist asked: %s", (name, places, time, joinWaitlist) => {
    const m = MEMBERSHIPS[name];
    if (m === undefined) throw new Error("no such membership");
    const input = { time: at(time), cancelled: false, ...PLACES[places], waitlisted: 3, waitlistMax: 20, mine: null, joinWaitlist, cover: m.cover };
    const first = decideBook(input);
    expect(said(first)).toBe(expected(m, places, time, joinWaitlist));

    // The request arriving twice: what the first one gave stands, and nothing more is given or charged.
    if (first.kind === "book") {
      expect(decideBook({ ...input, booked: input.booked + 1, mine: "booked" })).toEqual({ kind: "already", status: "booked" });
    } else if (first.kind === "waitlist") {
      expect(decideBook({ ...input, waitlisted: 4, mine: "waitlisted" })).toEqual({ kind: "already", status: "waitlisted" });
    } else {
      expect(decideBook(input)).toEqual(first);
    }
    // A cancelled class takes no booking whatever else is so.
    expect(decideBook({ ...input, cancelled: true })).toEqual({ kind: "refuse", reason: "class_cancelled" });
  });

  it("the table holds every case", () => {
    expect(cases).toHaveLength(7 * 4 * 5 * 2);
  });
});

describe("the waitlist", () => {
  const any = cover([], false, false);
  const full = { time: at("open"), cancelled: false, places: 2, booked: 2, waitlistMax: 20, cover: any };

  it("holds the gym's number and no more", () => {
    expect(decideBook({ ...full, waitlisted: 19, mine: null, joinWaitlist: true })).toEqual({ kind: "waitlist" });
    expect(decideBook({ ...full, waitlisted: 20, mine: null, joinWaitlist: true })).toEqual({ kind: "refuse", reason: "waitlist_full" });
    expect(decideBook({ ...full, waitlisted: 0, waitlistMax: 0, mine: null, joinWaitlist: true })).toEqual({ kind: "refuse", reason: "waitlist_full" });
  });

  it("inside the hand-over time a free place is the first to claim it's, waiting or not", () => {
    const free = { ...full, time: at("inside the hand-over time"), booked: 1, waitlisted: 3, joinWaitlist: false };
    expect(decideBook({ ...free, mine: "waitlisted" })).toEqual({ kind: "book", membershipId: null, chargePack: false, fromWaitlist: true });
    expect(decideBook({ ...free, mine: null })).toEqual({ kind: "book", membershipId: null, chargePack: false, fromWaitlist: false });
  });

  it("somebody waiting whose membership no longer covers the class is not moved in", () => {
    expect(decideBook({ ...full, booked: 1, waitlisted: 1, mine: "waitlisted", joinWaitlist: false, cover: cover([]) })).toEqual({ kind: "refuse", reason: "no_membership" });
  });

  it("leaving the waitlist is free at any time and frees no place", () => {
    for (const time of Object.keys(TIMES) as TimeName[]) {
      expect(decideCancel({ time: at(time), cancelled: false, mine: "waitlisted", packCharged: false, lateOk: false })).toEqual({ kind: "cancel", status: "cancelled", refundPack: false, freesPlace: false });
    }
  });
});

describe("cancel", () => {
  it("nothing to cancel", () => {
    expect(decideCancel({ time: at("open"), cancelled: false, mine: null, packCharged: false, lateOk: true })).toEqual({ kind: "refuse", reason: "no_booking" });
  });

  it("a class staff cancelled gives the pack back whenever the person cancels", () => {
    for (const time of Object.keys(TIMES) as TimeName[]) {
      expect(decideCancel({ time: at(time), cancelled: true, mine: "booked", packCharged: true, lateOk: false })).toEqual({ kind: "cancel", status: "cancelled", refundPack: true, freesPlace: false });
    }
  });

  it("a booking with no pack behind it gives nothing back", () => {
    expect(decideCancel({ time: at("open"), cancelled: false, mine: "booked", packCharged: false, lateOk: false })).toEqual({ kind: "cancel", status: "cancelled", refundPack: false, freesPlace: true });
  });
});
