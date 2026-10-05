// BOOKING A CLASS, AND ITS WAITLIST — Part 3 §13.4; ROADMAP Stage 2 item 17c-i.
//
// The ONE rule for Book, Join waitlist, Claim, Cancel and the hand-over of a freed
// place. Pure: the instant, the counts and the person's memberships are passed in, and
// the server reads them under the gym's lock.
import { z } from "zod";
import { classDaySchema } from "./classes.js";
import { addDays, heldMembershipView, type HeldMembership } from "./heldMemberships.js";
import type { MembershipAccess, MembershipLimitPeriod } from "./memberships.js";

export const CLASS_BOOKING_STATUSES = ["booked", "waitlisted", "cancelled", "late_cancelled", "attended", "no_show"] as const;
export const classBookingStatusSchema = z.enum(CLASS_BOOKING_STATUSES);
export type ClassBookingStatus = z.infer<typeof classBookingStatusSchema>;

/** The statuses that hold a place in the class. */
export const CLASS_BOOKING_HOLDS_PLACE = ["booked", "attended", "no_show"] as const;
/** The statuses a membership's bookings a week or a month count: a late cancel and a
 *  no-show are counted, a free cancel is not. */
export const CLASS_BOOKING_COUNTED = ["booked", "attended", "no_show", "late_cancelled"] as const;

/** A gym's own booking settings (RULINGS 2026-09-21: each a starting value it can change). */
export interface ClassBookingSettings {
  /** Booking opens this many days before the class starts, and closes at the start. */
  opensDays: number;
  /** Cancelling is free until this many minutes before the start. */
  freeCancelMinutes: number;
  /** A freed place goes to the first in line by itself while the class is more than
   *  this many minutes away; inside it, the first to claim the place has it. */
  handoverMinutes: number;
  /** How many people the waitlist holds. */
  waitlistMax: number;
}

export const CLASS_BOOKING_DEFAULTS: ClassBookingSettings = {
  opensDays: 7,
  freeCancelMinutes: 2 * 60,
  handoverMinutes: 24 * 60,
  waitlistMax: 20,
};

/** The least and the most each setting can be; `opensDays` stays inside the calendar's
 *  8 weeks. */
export const CLASS_BOOKING_LIMITS: Record<keyof ClassBookingSettings, readonly [number, number]> = {
  opensDays: [1, 56],
  freeCancelMinutes: [0, 7 * 24 * 60],
  handoverMinutes: [0, 7 * 24 * 60],
  waitlistMax: [0, 100],
};

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

export interface BookingTime {
  phase: "before_opening" | "open" | "started";
  /** A cancel now is free. */
  freeCancel: boolean;
  /** A free place goes to the first in line by itself now. */
  handsOver: boolean;
}

/** Where the instant `nowMs` stands against a class that starts at `startsAtMs`. */
export function bookingTime(nowMs: number, startsAtMs: number, s: ClassBookingSettings): BookingTime {
  const left = startsAtMs - nowMs;
  const phase = left <= 0 ? "started" : left > s.opensDays * DAY_MS ? "before_opening" : "open";
  return {
    phase,
    freeCancel: left > 0 && left >= s.freeCancelMinutes * MINUTE_MS,
    handsOver: phase === "open" && left > s.handoverMinutes * MINUTE_MS,
  };
}

/** The gym's own week (Monday to Sunday) or month holding `day`, both ends included. */
export function bookingPeriod(day: string, period: MembershipLimitPeriod): { from: string; to: string } {
  const [y, m, d] = day.split("-").map(Number);
  if (y === undefined || m === undefined || d === undefined) throw new Error(`not a day: ${day}`);
  if (period === "month") {
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return { from: addDays(day, 1 - d), to: addDays(day, last - d) };
  }
  // Sunday is 0: six days after its Monday.
  const sinceMonday = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  return { from: addDays(day, -sinceMonday), to: addDays(day, 6 - sinceMonday) };
}

/** One membership the person's record holds, as the booking rule needs it. */
export interface HeldCover {
  id: string;
  membership: HeldMembership;
  access: MembershipAccess;
  /** The membership type includes every class, or names this one. */
  coversClass: boolean;
  bookingsLimit: number | null;
  bookingsPeriod: MembershipLimitPeriod | null;
  /** Its bookings already counted in the class's own week or month. */
  used: number;
}

export type Cover =
  /** `membershipId` null: the gym has no membership types, so any member may book. */
  | { ok: true; membershipId: string | null; chargePack: boolean }
  | { ok: false; reason: "no_membership" | "not_covered" | "limit_week" | "limit_month" };

/** Which of a person's memberships covers a class on `classDay` (the gym's own day the
 *  class is on). A membership that includes the class without counting goes first, then
 *  one with bookings left in its week or month, then a pack, the one that ends soonest
 *  first; a pack is the only one charged. An open-gym slot is what "gym only" includes. */
export function pickCover(input: { gymHasTypes: boolean; openGym: boolean; classDay: string; held: readonly HeldCover[] }): Cover {
  if (!input.gymHasTypes) return { ok: true, membershipId: null, chargePack: false };
  const running = input.held
    .map((h) => ({ h, view: heldMembershipView(h.membership, input.classDay) }))
    .filter((r) => r.view.status === "active")
    .sort((a, b) => (a.h.id < b.h.id ? -1 : 1));
  if (running.length === 0) return { ok: false, reason: "no_membership" };
  const covering = running.filter(({ h }) => (h.access === "gym_only" ? input.openGym : h.coversClass));
  if (covering.length === 0) return { ok: false, reason: "not_covered" };

  const notPack = covering.filter(({ h }) => h.membership.kind !== "pack");
  const unlimited = notPack.find(({ h }) => h.access !== "limited");
  if (unlimited !== undefined) return { ok: true, membershipId: unlimited.h.id, chargePack: false };
  const limited = notPack.filter(({ h }) => h.access === "limited");
  const room = limited.find(({ h }) => h.bookingsLimit !== null && h.used < h.bookingsLimit);
  if (room !== undefined) return { ok: true, membershipId: room.h.id, chargePack: false };
  const pack = covering
    .filter(({ h }) => h.membership.kind === "pack" && (h.membership.classesLeft ?? 0) > 0)
    .sort((a, b) => ((a.view.endsOn ?? "") < (b.view.endsOn ?? "") ? -1 : (a.view.endsOn ?? "") > (b.view.endsOn ?? "") ? 1 : 0))[0];
  if (pack !== undefined) return { ok: true, membershipId: pack.h.id, chargePack: true };
  const full = limited[0];
  if (full === undefined) return { ok: false, reason: "not_covered" };
  return { ok: false, reason: full.h.bookingsPeriod === "month" ? "limit_month" : "limit_week" };
}

export const CLASS_BOOK_REFUSALS = [
  "class_cancelled",
  "class_started",
  "not_open_yet",
  "no_membership",
  "not_covered",
  "limit_week",
  "limit_month",
  "class_full",
  "waitlist_full",
] as const;
export const classBookRefusalSchema = z.enum(CLASS_BOOK_REFUSALS);
export type ClassBookRefusal = z.infer<typeof classBookRefusalSchema>;

export interface BookInput {
  time: BookingTime;
  /** Staff cancelled the class. */
  cancelled: boolean;
  /** Null: the class has no limit. */
  places: number | null;
  /** People holding a place. */
  booked: number;
  waitlisted: number;
  waitlistMax: number;
  /** What this person already has in the class. */
  mine: "booked" | "waitlisted" | null;
  /** The person asked for the waitlist if the class is full. */
  joinWaitlist: boolean;
  cover: Cover;
}

export type BookDecision =
  | { kind: "book"; membershipId: string | null; chargePack: boolean; fromWaitlist: boolean }
  | { kind: "waitlist" }
  /** Nothing to do: they have it already. */
  | { kind: "already"; status: "booked" | "waitlisted" }
  | { kind: "refuse"; reason: ClassBookRefusal };

/** Book, Join waitlist and Claim: one rule. A free place goes to whoever asks and is
 *  covered, on the waitlist or not; with none free, the waitlist if they asked for it. */
export function decideBook(i: BookInput): BookDecision {
  if (i.mine === "booked") return { kind: "already", status: "booked" };
  if (i.cancelled) return { kind: "refuse", reason: "class_cancelled" };
  if (i.time.phase === "started") return { kind: "refuse", reason: "class_started" };
  if (i.time.phase === "before_opening") return { kind: "refuse", reason: "not_open_yet" };
  if (!i.cover.ok) return { kind: "refuse", reason: i.cover.reason };
  if (i.places === null || i.booked < i.places) {
    return { kind: "book", membershipId: i.cover.membershipId, chargePack: i.cover.chargePack, fromWaitlist: i.mine === "waitlisted" };
  }
  if (i.mine === "waitlisted") return { kind: "already", status: "waitlisted" };
  if (!i.joinWaitlist) return { kind: "refuse", reason: "class_full" };
  if (i.waitlisted >= i.waitlistMax) return { kind: "refuse", reason: "waitlist_full" };
  return { kind: "waitlist" };
}

/** Whether a free place goes to the waitlist by itself at this moment. */
export function handsOverNow(i: Pick<BookInput, "time" | "cancelled" | "places" | "booked">): boolean {
  return !i.cancelled && i.time.handsOver && (i.places === null || i.booked < i.places);
}

export type CancelDecision =
  | { kind: "cancel"; status: "cancelled" | "late_cancelled"; refundPack: boolean; freesPlace: boolean }
  | { kind: "refuse"; reason: "no_booking" | "class_started" | "late_cancel" };

/** Cancel a booking, or leave the waitlist. Free until the gym's time before the start,
 *  and the pack gets its class back; after it a late cancel, which the person must have
 *  said yes to (`lateOk`) and which keeps the pack's charge. */
export function decideCancel(i: {
  time: BookingTime;
  cancelled: boolean;
  mine: "booked" | "waitlisted" | null;
  packCharged: boolean;
  lateOk: boolean;
}): CancelDecision {
  if (i.mine === null) return { kind: "refuse", reason: "no_booking" };
  if (i.mine === "waitlisted") return { kind: "cancel", status: "cancelled", refundPack: false, freesPlace: false };
  if (i.cancelled) return { kind: "cancel", status: "cancelled", refundPack: i.packCharged, freesPlace: false };
  if (i.time.phase === "started") return { kind: "refuse", reason: "class_started" };
  if (i.time.freeCancel) return { kind: "cancel", status: "cancelled", refundPack: i.packCharged, freesPlace: true };
  if (!i.lateOk) return { kind: "refuse", reason: "late_cancel" };
  return { kind: "cancel", status: "late_cancelled", refundPack: false, freesPlace: true };
}

/** What the person reads when the server says no. */
export const CLASS_BOOKING_WORDS = {
  class_cancelled: "This class has been cancelled.",
  class_started: "This class has already started.",
  not_open_yet: "Booking for this class isn't open yet.",
  no_membership: "You need a membership to book this class. Ask at the front desk.",
  not_covered: "Your membership doesn't include this class. Ask at the front desk.",
  limit_week: "You've used all the bookings your membership includes for that week.",
  limit_month: "You've used all the bookings your membership includes for that month.",
  class_full: "This class is full.",
  waitlist_full: "This class and its waitlist are full.",
  no_booking: "You don't have a booking for this class.",
  cancel_started: "This class has already started, so the booking can't be cancelled.",
  late_cancel: "It's too late to cancel for free. Cancelling now counts as a late cancel.",
  late_cancel_pack: "It's too late to cancel for free. Cancelling now counts as a late cancel, and the class stays used on your pack.",
  request_reused: "That didn't go through. Try again.",
  class_not_found: "That class was not found.",
  /** Staff, on a change that ends bookings, until the request confirms how many. */
  class_has_bookings: "People have booked these classes. Their bookings will end if you go ahead.",
} as const;

export const CLASS_HAS_BOOKINGS_ERROR = "class_has_bookings";

export const CLASS_LATE_CANCEL_ERROR = "late_cancel";

// ── THE WIRE ──

export const bookClassRequestSchema = z.object({ requestKey: z.string().uuid(), joinWaitlist: z.boolean() }).strict();
export type BookClassRequest = z.infer<typeof bookClassRequestSchema>;

export const cancelClassBookingRequestSchema = z.object({ lateOk: z.boolean() }).strict();
export type CancelClassBookingRequest = z.infer<typeof cancelClassBookingRequestSchema>;

/** One class as the person booking it sees it. */
export const classBookingViewSchema = z
  .object({
    sessionId: z.string().uuid(),
    className: z.string(),
    /** The gym's own day and clock time, and its time zone. */
    localDate: z.string(),
    localStartMinute: z.number().int(),
    timezone: z.string(),
    startsAt: z.string().datetime(),
    minutes: z.number().int(),
    cancelled: z.boolean(),
    places: z.number().int().nullable(),
    booked: z.number().int(),
    waitlisted: z.number().int(),
    opensAt: z.string().datetime(),
    freeCancelUntil: z.string().datetime(),
    mine: z
      .object({
        status: classBookingStatusSchema,
        /** 1 for the first in line; null unless waitlisted. */
        waitlistPlace: z.number().int().nullable(),
        packCharged: z.boolean(),
      })
      .strict()
      .nullable(),
    can: z
      .object({
        book: z.boolean(),
        joinWaitlist: z.boolean(),
        /** A place is free and they are on the waitlist. */
        claim: z.boolean(),
        cancel: z.enum(["free", "late"]).nullable(),
        /** Why they can neither book nor wait; null when they can, or already have it. */
        why: classBookRefusalSchema.nullable(),
      })
      .strict(),
  })
  .strict();
export type ClassBookingView = z.infer<typeof classBookingViewSchema>;

export const classBookingResponseSchema = z.object({ booking: classBookingViewSchema }).strict();
export type ClassBookingResponse = z.infer<typeof classBookingResponseSchema>;

/** How many late cancels the staff list shows; the count is whole. */
export const CLASS_BOOKINGS_LATE_SHOWN = 100;

const staffBookingSchema = z
  .object({
    bookingId: z.string().uuid(),
    name: z.string().nullable(),
    initials: z.string(),
    status: classBookingStatusSchema,
    /** The membership it was booked on; null where the gym has no membership types.
     *  It and `packCharged` are null for a coach reading their own class's list. */
    membership: z.string().nullable(),
    packCharged: z.boolean().nullable(),
    at: z.string().datetime(),
  })
  .strict();
export type StaffClassBooking = z.infer<typeof staffBookingSchema>;

/** A class's list for staff: who holds a place, who is waiting (first in line first),
 *  and the late cancels. */
export const classSessionBookingsResponseSchema = z
  .object({
    sessionId: z.string().uuid(),
    className: z.string(),
    startsAt: z.string().datetime(),
    cancelled: z.boolean(),
    places: z.number().int().nullable(),
    booked: z.array(staffBookingSchema),
    waitlisted: z.array(staffBookingSchema),
    lateCancelled: z.array(staffBookingSchema),
    lateCancelledTotal: z.number().int(),
  })
  .strict();
export type ClassSessionBookingsResponse = z.infer<typeof classSessionBookingsResponseSchema>;

// ── STAFF: BOOKINGS A CHANGE WOULD END, AND THE GYM'S SETTINGS (17c-ii-a) ──

/** How many names the 409 `class_has_bookings` carries, and how many a page of the whole
 *  list holds. */
export const CLASS_BOOKINGS_ENDING_SHOWN = 3;
export const CLASS_BOOKINGS_ENDING_PAGE = 100;

const endingPersonSchema = z
  .object({
    /** The booking's id: the list's key, and the cursor for the next page. */
    id: z.string().uuid(),
    name: z.string().nullable(),
    initials: z.string(),
    /** On the waitlist; false: holds a place. */
    waiting: z.boolean(),
    className: z.string(),
    /** The class's own day and clock time at the gym. */
    localDate: z.string(),
    localStartMinute: z.number().int(),
  })
  .strict();
export type ClassBookingsEndingPerson = z.infer<typeof endingPersonSchema>;

/** The bookings a change to the timetable would end: cancelling a class, cancelling a
 *  time slot, removing a class, or moving a time slot to another day or time. The 409
 *  `class_has_bookings` carries it as `ending`, with the first few; the request goes
 *  through when it sends `confirmBookings` equal to `booked + waiting`, counted again
 *  under the gym's lock. The number confirmed is a count, not the list: a booking made
 *  and another cancelled in the moment between the box and its button leave it equal. */
export const classBookingsEndingSchema = z
  .object({
    /** Classes with a booking that holds a place or waits. */
    classes: z.number().int(),
    /** BOOKINGS that hold a place, and that wait: one person booked on three of the
     *  classes is three. In one class they are people. */
    booked: z.number().int(),
    waiting: z.number().int(),
    /** One row a booking, in the order they were made. */
    people: z.array(endingPersonSchema),
  })
  .strict();
export type ClassBookingsEnding = z.infer<typeof classBookingsEndingSchema>;

/** A membership staff cancel ends the bookings made on it (17c-iii): the 409 that asks
 *  first carries `ending` as above, its `people` one row a class of that one person, as
 *  many as this at most. */
export const MEMBERSHIP_HAS_BOOKINGS_ERROR = "membership_has_bookings";
export const MEMBERSHIP_BOOKINGS_ENDING_SHOWN = 100;

export const CLASS_BOOKINGS_ENDING_SCOPES = ["session", "slot", "class"] as const;

/** The whole list behind a box's "See all": one class (`session`), a time slot's coming
 *  classes from `from` on (`slot`), or every coming class of one kind (`class`). */
export const classBookingsEndingQuerySchema = z
  .object({
    by: z.enum(CLASS_BOOKINGS_ENDING_SCOPES),
    id: z.string().uuid(),
    from: classDaySchema.optional(),
    /** The `id` of the last booking already shown. */
    after: z.string().uuid().optional(),
  })
  .strict();
export type ClassBookingsEndingQuery = z.infer<typeof classBookingsEndingQuerySchema>;

export const classBookingsEndingResponseSchema = classBookingsEndingSchema
  .extend({
    /** `after` for the next page; null on the last. */
    next: z.string().uuid().nullable(),
  })
  .strict();
export type ClassBookingsEndingResponse = z.infer<typeof classBookingsEndingResponseSchema>;

const setting = (key: keyof ClassBookingSettings) => z.number().int().min(CLASS_BOOKING_LIMITS[key][0]).max(CLASS_BOOKING_LIMITS[key][1]);

/** The gym's four booking settings, every one every time. */
export const classBookingSettingsSchema = z
  .object({
    opensDays: setting("opensDays"),
    freeCancelMinutes: setting("freeCancelMinutes"),
    handoverMinutes: setting("handoverMinutes"),
    waitlistMax: setting("waitlistMax"),
  })
  .strict();

/** `movedIn`, on a save only: how many waiting people a shorter hand-over time gave a
 *  free place to at once. */
export const classBookingSettingsResponseSchema = z
  .object({ settings: classBookingSettingsSchema, movedIn: z.number().int().optional() })
  .strict();
export type ClassBookingSettingsResponse = z.infer<typeof classBookingSettingsResponseSchema>;

// ── A MEMBER'S LIST OF CLASSES (17d) ──

/** How many weeks ahead a member's list goes: the calendar's 8. */
export const MEMBER_CLASSES_WEEKS = 8;

/** `week`: 0 for the gym's next seven days from today, 1 for the seven after, and so on. */
export const memberClassesQuerySchema = z
  .object({
    week: z
      .string()
      .regex(new RegExp(`^[0-${String(MEMBER_CLASSES_WEEKS - 1)}]$`))
      .default("0")
      .transform(Number),
  })
  .strict();
export type MemberClassesQuery = z.infer<typeof memberClassesQuerySchema>;

/** How many classes one page of a member's list holds at most. */
export const MEMBER_CLASSES_MAX = 500;

/** The gym's classes in that week that have not started, the soonest first, each as the
 *  person reading meets it: what one class's own read answers. `from` and `to` are the
 *  week's first and last day, the gym's own. `more`: the week holds more classes than
 *  the page does, and the later ones are not on it. */
export const memberClassesResponseSchema = z
  .object({
    week: z.number().int(),
    from: classDaySchema,
    to: classDaySchema,
    timezone: z.string(),
    classes: z.array(classBookingViewSchema).max(MEMBER_CLASSES_MAX),
    more: z.boolean(),
  })
  .strict();
export type MemberClassesResponse = z.infer<typeof memberClassesResponseSchema>;
