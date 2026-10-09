// CHECK-IN MEETS BOOKINGS — Part 3 §13.6; ROADMAP Stage 2 item 17f.
//
// The rules that turn a booked place into "came" or "no-show": a check-in at the gym
// near the class, the marking of the rest once it is over, and staff's own mark. Pure:
// the instants and what was read are passed in.
import { z } from "zod";
import type { ClassBookingStatus } from "./classBookings.js";

/** A check-in counts for a booked class from this long before it starts until it ends
 *  (Kd, RULINGS 2026-10-09: one hour). */
export const CLASS_CHECKIN_BEFORE_MINUTES = 60;
/** The rest are marked no-show this long after the class ends. */
export const CLASS_NO_SHOW_AFTER_MINUTES = 15;
/** A class that ended longer ago than this is left as it is: staff mark it. */
export const CLASS_NO_SHOW_LOOKBACK_HOURS = 48;

const MINUTE_MS = 60_000;

/** The instants between which a check-in marks a booking of this class, both included. */
export function classCheckinWindow(startsAtMs: number, minutes: number): { fromMs: number; toMs: number } {
  return { fromMs: startsAtMs - CLASS_CHECKIN_BEFORE_MINUTES * MINUTE_MS, toMs: startsAtMs + minutes * MINUTE_MS };
}

export function inClassCheckinWindow(nowMs: number, startsAtMs: number, minutes: number): boolean {
  const { fromMs, toMs } = classCheckinWindow(startsAtMs, minutes);
  return nowMs >= fromMs && nowMs <= toMs;
}

/** What a check-in does to one of the person's own bookings: only a place still
 *  `booked`, in a class that runs, inside its window. */
export function checkinMarksBooking(i: { status: ClassBookingStatus; cancelled: boolean; nowMs: number; startsAtMs: number; minutes: number }): boolean {
  return i.status === "booked" && !i.cancelled && inClassCheckinWindow(i.nowMs, i.startsAtMs, i.minutes);
}

export type ClassSweepDecision = "attended" | "no_show" | "leave";

/** What becomes of a place still `booked` once its class is over.
 *
 *  `visit`: a check-in inside the class's window that names the person's own account
 *  (`account`), or only a record on the gym's list that the booking was made for
 *  (`record`: a key tag whose record the list cannot say is one person's), or none.
 *  `hereThatDay`: the person's account or record has a visit of ANY kind at the gym on
 *  the class's day: a check-in earlier than the window, their own tap, a visit staff
 *  added. Not enough to say they came to the class, and enough never to say they did not.
 *  `gymCheckedIn`: the gym checked ANYBODY in inside that window. A gym that does not
 *  use check-in, or whose desk was off that hour, has no evidence about who came, so
 *  nobody is called a no-show; staff mark the class themselves. */
export function decideClassSweep(i: {
  status: ClassBookingStatus;
  cancelled: boolean;
  nowMs: number;
  startsAtMs: number;
  minutes: number;
  visit: "account" | "record" | null;
  hereThatDay: boolean;
  gymCheckedIn: boolean;
}): ClassSweepDecision {
  if (i.status !== "booked" || i.cancelled) return "leave";
  const endMs = i.startsAtMs + i.minutes * MINUTE_MS;
  if (i.nowMs < endMs + CLASS_NO_SHOW_AFTER_MINUTES * MINUTE_MS) return "leave";
  if (i.nowMs > endMs + CLASS_NO_SHOW_LOOKBACK_HOURS * 60 * MINUTE_MS) return "leave";
  if (i.visit === "account") return "attended";
  if (i.visit === "record" || i.hereThatDay || !i.gymCheckedIn) return "leave";
  return "no_show";
}

export const classMarkSchema = z.enum(["attended", "no_show"]);
export type ClassMark = z.infer<typeof classMarkSchema>;

export type ClassMarkDecision = { kind: "mark" } | { kind: "already" } | { kind: "refuse"; reason: "not_started" | "mark_cancelled" | "mark_not_booked" };

/** Staff mark a place came or no-show: only once the class has started, never in a
 *  cancelled class, and only a place that is held. A mark can be changed to the other.
 *  Either way the class stays used: a pack keeps it and a limit counts it. */
export function decideClassMark(i: { status: ClassBookingStatus; cancelled: boolean; started: boolean; to: ClassMark }): ClassMarkDecision {
  if (i.cancelled) return { kind: "refuse", reason: "mark_cancelled" };
  if (i.status !== "booked" && i.status !== "attended" && i.status !== "no_show") return { kind: "refuse", reason: "mark_not_booked" };
  if (!i.started) return { kind: "refuse", reason: "not_started" };
  return i.status === i.to ? { kind: "already" } : { kind: "mark" };
}

export const CLASS_MARK_WORDS = {
  not_started: "This class hasn't started yet. Mark it once it has.",
  mark_cancelled: "This class was cancelled, so nobody in it can be marked.",
  mark_not_booked: "This person doesn't hold a place in this class, so they can't be marked.",
  booking_not_found: "That booking was not found.",
} as const;

/** Came or no-show, for one person's place in a class that has started. */
export const markClassBookingRequestSchema = z.object({ status: classMarkSchema }).strict();
export type MarkClassBookingRequest = z.infer<typeof markClassBookingRequestSchema>;
