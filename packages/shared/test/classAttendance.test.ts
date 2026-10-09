// Check-in meets bookings (spec Part 3 §13.6; ROADMAP 17f).
//
// The worst thing this job could do to a real person: a member who came is marked
// No-show, or one person's check-in marks somebody else's booking as Came. The first
// block is the first half on the rule alone; both halves run on the real database in
// `apps/api/test/classAttendance.routes.test.ts`.
//
// The expected answers are written out from the spec's words, case by case, not read
// back from the rule.
import { describe, expect, it } from "vitest";
import {
  CLASS_BOOKING_STATUSES,
  checkinMarksBooking,
  classCheckinWindow,
  decideClassMark,
  decideClassSweep,
  inClassCheckinWindow,
  markClassBookingRequestSchema,
  type ClassBookingStatus,
  type ClassSweepDecision,
} from "../src/index.js";

const MIN = 60_000;
const START = Date.UTC(2026, 9, 20, 17, 0);
/** A 45-minute class: 17:00 to 17:45. */
const MINUTES = 45;
const END = START + MINUTES * MIN;

describe("somebody who came is never a no-show", () => {
  const sweep = (over: Partial<Parameters<typeof decideClassSweep>[0]>): ClassSweepDecision =>
    decideClassSweep({ status: "booked", cancelled: false, nowMs: END + 15 * MIN, startsAtMs: START, minutes: MINUTES, visit: null, hereThatDay: false, gymCheckedIn: true, ...over });

  it("a check-in of their own account in the window is came, whatever else is true", () => {
    expect(sweep({ visit: "account" })).toBe("attended");
    expect(sweep({ visit: "account", gymCheckedIn: false })).toBe("attended");
    expect(sweep({ visit: "account", nowMs: END + 47 * 60 * MIN })).toBe("attended");
  });

  it("a check-in on their record that may be somebody else's decides nothing", () => {
    expect(sweep({ visit: "record" })).toBe("leave");
    expect(sweep({ visit: "record", gymCheckedIn: false })).toBe("leave");
  });

  it("a gym that checked nobody in that hour calls nobody a no-show", () => {
    expect(sweep({ gymCheckedIn: false })).toBe("leave");
  });

  it("no check-in, at a gym that was checking people in, is a no-show", () => {
    expect(sweep({})).toBe("no_show");
  });

  it("somebody at the gym that day outside the window (an earlier check-in, their own tap, a visit added later) is left, never a no-show", () => {
    expect(sweep({ hereThatDay: true })).toBe("leave");
    expect(sweep({ hereThatDay: true, gymCheckedIn: false })).toBe("leave");
    expect(sweep({ hereThatDay: true, visit: "record" })).toBe("leave");
    // Their own check-in in the window is still came.
    expect(sweep({ hereThatDay: true, visit: "account" })).toBe("attended");
  });

  it("every case: a no-show needs no visit in the window, none that day, and a gym that was checking people in", () => {
    for (const visit of ["account", "record", null] as const) {
      for (const hereThatDay of [true, false]) {
        for (const gymCheckedIn of [true, false]) {
          const want = visit === "account" ? "attended" : visit === null && !hereThatDay && gymCheckedIn ? "no_show" : "leave";
          expect(sweep({ visit, hereThatDay, gymCheckedIn }), JSON.stringify({ visit, hereThatDay, gymCheckedIn })).toBe(want);
        }
      }
    }
  });

  it("nothing is decided before 15 minutes after the end, to the millisecond", () => {
    expect(sweep({ nowMs: END + 15 * MIN - 1 })).toBe("leave");
    expect(sweep({ nowMs: END + 15 * MIN })).toBe("no_show");
    expect(sweep({ nowMs: START })).toBe("leave");
    expect(sweep({ nowMs: END })).toBe("leave");
    // Somebody who came is not marked early either: one moment for the whole class.
    expect(sweep({ nowMs: END, visit: "account" })).toBe("leave");
  });

  it("a class that ended more than two days ago is left for staff", () => {
    expect(sweep({ nowMs: END + 48 * 60 * MIN })).toBe("no_show");
    expect(sweep({ nowMs: END + 48 * 60 * MIN + 1 })).toBe("leave");
    expect(sweep({ nowMs: END + 48 * 60 * MIN + 1, visit: "account" })).toBe("leave");
  });

  it("a cancelled class marks nobody", () => {
    expect(sweep({ cancelled: true })).toBe("leave");
    expect(sweep({ cancelled: true, visit: "account" })).toBe("leave");
  });

  it("only a place still booked is decided: every other status stays as it is", () => {
    const expected: Record<ClassBookingStatus, ClassSweepDecision> = {
      booked: "no_show",
      waitlisted: "leave",
      cancelled: "leave",
      late_cancelled: "leave",
      attended: "leave",
      no_show: "leave",
    };
    for (const status of CLASS_BOOKING_STATUSES) {
      expect(sweep({ status }), status).toBe(expected[status]);
      // A check-in never brings back a place given up, or changes staff's mark.
      expect(sweep({ status, visit: "account" }), status).toBe(status === "booked" ? "attended" : "leave");
    }
  });
});

describe("the check-in window", () => {
  it("is one hour before the start until the end, both ends included", () => {
    expect(classCheckinWindow(START, MINUTES)).toEqual({ fromMs: START - 60 * MIN, toMs: END });
    const cases: [number, boolean][] = [
      [START - 60 * MIN - 1, false],
      [START - 60 * MIN, true],
      [START - 31 * MIN, true],
      [START, true],
      [END, true],
      [END + 1, false],
      [START - 24 * 60 * MIN, false],
    ];
    for (const [now, inside] of cases) expect(inClassCheckinWindow(now, START, MINUTES), String(now - START)).toBe(inside);
  });

  it("a check-in marks only a place still booked, in a class that runs", () => {
    const at = (status: ClassBookingStatus, cancelled = false, nowMs = START - 10 * MIN) =>
      checkinMarksBooking({ status, cancelled, nowMs, startsAtMs: START, minutes: MINUTES });
    const marks: Record<ClassBookingStatus, boolean> = {
      booked: true,
      waitlisted: false,
      cancelled: false,
      late_cancelled: false,
      attended: false,
      no_show: false,
    };
    for (const status of CLASS_BOOKING_STATUSES) expect(at(status), status).toBe(marks[status]);
    expect(at("booked", true)).toBe(false);
    expect(at("booked", false, START - 61 * MIN)).toBe(false);
    expect(at("booked", false, END + MIN)).toBe(false);
  });
});

describe("staff's own mark", () => {
  const mark = (status: ClassBookingStatus, to: "attended" | "no_show", over: { started?: boolean; cancelled?: boolean } = {}) =>
    decideClassMark({ status, to, started: over.started ?? true, cancelled: over.cancelled ?? false });

  it("every status, both marks", () => {
    const table: [ClassBookingStatus, "attended" | "no_show", string][] = [
      ["booked", "attended", "mark"],
      ["booked", "no_show", "mark"],
      ["attended", "attended", "already"],
      ["attended", "no_show", "mark"],
      ["no_show", "no_show", "already"],
      ["no_show", "attended", "mark"],
      ["waitlisted", "attended", "mark_not_booked"],
      ["waitlisted", "no_show", "mark_not_booked"],
      ["cancelled", "attended", "mark_not_booked"],
      ["cancelled", "no_show", "mark_not_booked"],
      ["late_cancelled", "attended", "mark_not_booked"],
      ["late_cancelled", "no_show", "mark_not_booked"],
    ];
    for (const [status, to, want] of table) {
      const got = mark(status, to);
      expect(got.kind === "refuse" ? got.reason : got.kind, `${status} -> ${to}`).toBe(want);
    }
  });

  it("not before the class starts, and never in a cancelled class", () => {
    expect(mark("booked", "attended", { started: false })).toEqual({ kind: "refuse", reason: "not_started" });
    // A check-in before the start has already marked them came: still not staff's to change yet.
    expect(mark("attended", "no_show", { started: false })).toEqual({ kind: "refuse", reason: "not_started" });
    expect(mark("booked", "no_show", { cancelled: true })).toEqual({ kind: "refuse", reason: "mark_cancelled" });
    expect(mark("attended", "no_show", { cancelled: true, started: false })).toEqual({ kind: "refuse", reason: "mark_cancelled" });
  });

  it("the request names one of the two marks and nothing else", () => {
    expect(markClassBookingRequestSchema.safeParse({ status: "attended" }).success).toBe(true);
    expect(markClassBookingRequestSchema.safeParse({ status: "no_show" }).success).toBe(true);
    for (const bad of [{ status: "booked" }, { status: "cancelled" }, {}, { status: "attended", userId: "x" }]) {
      expect(markClassBookingRequestSchema.safeParse(bad).success).toBe(false);
    }
  });
});
