// PERSONAL TRAINING — Part 3 §13.5; ROADMAP Stage 2 item 17e-i.
//
// A trainer's hours and session length, the free times worked out from them, and the ONE
// rule for booking and cancelling a session. Pure: the instant, what is already booked and
// the person's memberships are passed in, and the server reads them under the gym's lock.
// The database refuses two overlapping sessions of one trainer by itself (`0079`); this
// rule is what answers in words before it has to. A class the trainer coaches takes their
// time too: it comes off their free times, and a session cannot be booked over it.
import { z } from "zod";
import { CLASS_FILL_HORIZON_DAYS, classDaySchema } from "./classes.js";
import { addDays, heldMembershipView, type HeldMembership } from "./heldMemberships.js";

/** A session is as long as the gym says (RULINGS 2026-10-06; PushPress and TeamUp take any
 *  length): from 10 minutes to 4 hours, on a five-minute mark. */
export const PT_SESSION_MINUTES_MIN = 10;
export const PT_SESSION_MINUTES_MAX = 240;
/** The lengths the form offers to pick in one press. */
export const PT_SESSION_MINUTES_USUAL = [30, 45, 60, 90] as const;
export const ptSessionMinutesSchema = z.number().int().min(PT_SESSION_MINUTES_MIN).max(PT_SESSION_MINUTES_MAX).multipleOf(5);
export type PtSessionMinutes = z.infer<typeof ptSessionMinutesSchema>;

/** How many separate ranges of hours one weekday holds (a morning, an afternoon, an evening). */
export const PT_RANGES_PER_DAY = 3;
/** Hours start and end on a five-minute mark. */
export const PT_MINUTE_STEP = 5;
/** How far ahead a session can be booked: the calendar's own eight weeks. */
export const PT_HORIZON_DAYS = CLASS_FILL_HORIZON_DAYS;
/** How many days of one trainer a read answers. */
export const PT_WEEK_DAYS = 7;

export const PT_APPOINTMENT_STATUSES = ["booked", "cancelled", "late_cancelled", "attended", "no_show"] as const;
export const ptAppointmentStatusSchema = z.enum(PT_APPOINTMENT_STATUSES);
export type PtAppointmentStatus = z.infer<typeof ptAppointmentStatusSchema>;
/** The statuses that hold the trainer's time. */
export const PT_HOLDS_TIME = ["booked", "attended", "no_show"] as const;

const minuteOfDay = (max: number) => z.number().int().min(0).max(max).multipleOf(PT_MINUTE_STEP);

/** One range of a trainer's hours: ISO weekday (Monday 1 to Sunday 7) and minutes from
 *  midnight on the gym's clock. */
export const ptHoursRangeSchema = z
  .object({ weekday: z.number().int().min(1).max(7), fromMinute: minuteOfDay(1435), toMinute: minuteOfDay(1440) })
  .strict();
export type PtHoursRange = z.infer<typeof ptHoursRangeSchema>;

/** What is wrong with a set of hours, or null: a range that ends before it starts, too
 *  many on one weekday, or two on one weekday that overlap. */
export function ptHoursProblem(hours: readonly PtHoursRange[]): "range" | "too_many" | "overlap" | null {
  if (hours.some((h) => h.fromMinute >= h.toMinute)) return "range";
  for (let weekday = 1; weekday <= 7; weekday++) {
    const day = hours.filter((h) => h.weekday === weekday).sort((a, b) => a.fromMinute - b.fromMinute);
    if (day.length > PT_RANGES_PER_DAY) return "too_many";
    if (day.some((h, n) => n > 0 && h.fromMinute < (day[n - 1]?.toMinute ?? 0))) return "overlap";
  }
  return null;
}

/** ISO weekday of a `YYYY-MM-DD` day: Monday 1 to Sunday 7. */
export function isoWeekday(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  if (y === undefined || m === undefined || d === undefined) throw new Error(`not a day: ${day}`);
  return ((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7) + 1;
}

export interface PtTime {
  localDate: string;
  startMinute: number;
}

/** Every time a trainer offers on these days: each range of hours cut into sessions of
 *  their length from its start, a last piece shorter than a session left out. */
export function ptOfferedTimes(hours: readonly PtHoursRange[], sessionMinutes: number, days: readonly string[]): PtTime[] {
  const times: PtTime[] = [];
  for (const localDate of days) {
    const weekday = isoWeekday(localDate);
    const ranges = hours.filter((h) => h.weekday === weekday).sort((a, b) => a.fromMinute - b.fromMinute);
    for (const range of ranges) {
      for (let start = range.fromMinute; start + sessionMinutes <= range.toMinute; start += sessionMinutes) {
        times.push({ localDate, startMinute: start });
      }
    }
  }
  return times;
}

export interface PtSpan {
  fromMs: number;
  toMs: number;
}

const overlaps = (a: PtSpan, b: PtSpan): boolean => a.fromMs < b.toMs && b.fromMs < a.toMs;

/** Whether a session starting at `startsAtMs` would run into one of `taken`. */
export function ptBusy(startsAtMs: number, minutes: number, taken: readonly PtSpan[]): boolean {
  const span = { fromMs: startsAtMs, toMs: startsAtMs + minutes * 60_000 };
  return taken.some((t) => overlaps(span, t));
}

/** The offered times still free: not started, and not running into anything in `taken`
 *  (a session already booked, or a class the trainer coaches). */
export function ptFreeTimes<T extends { startsAtMs: number }>(
  offered: readonly T[],
  input: { minutes: number; taken: readonly PtSpan[]; nowMs: number },
): T[] {
  return offered.filter((t) => t.startsAtMs > input.nowMs && !ptBusy(t.startsAtMs, input.minutes, input.taken));
}

/** One membership the person's record holds, as the booking rule needs it. */
export interface PtHeld {
  id: string;
  membership: HeldMembership;
  /** Its type includes personal training. */
  includesPt: boolean;
}

export type PtCover =
  /** `membershipId` null: the gym has no membership types, so anybody on its list may be booked. */
  | { ok: true; membershipId: string | null; chargePack: boolean }
  | { ok: false; reason: "no_membership" | "not_covered" | "pack_used" };

/** Which of a person's memberships pays for a session on `day` (the gym's own day). One
 *  that includes personal training and is not a pack goes first and is not charged; then
 *  a pack with a session left, the one that ends soonest first, which is. */
export function pickPtCover(input: { gymHasTypes: boolean; day: string; held: readonly PtHeld[] }): PtCover {
  if (!input.gymHasTypes) return { ok: true, membershipId: null, chargePack: false };
  const running = input.held
    .map((h) => ({ h, view: heldMembershipView(h.membership, input.day) }))
    .filter((r) => r.view.status === "active")
    .sort((a, b) => (a.h.id < b.h.id ? -1 : 1));
  // A pack with nothing left has ended by the clock's rule, so it is named before the
  // plainer answers: "no sessions left" is what staff need to hear.
  const usedUp = input.held.some(
    ({ includesPt, membership: m }) => includesPt && m.kind === "pack" && m.status === "active" && m.classesLeft === 0,
  );
  if (running.length === 0) return { ok: false, reason: usedUp ? "pack_used" : "no_membership" };
  const covering = running.filter(({ h }) => h.includesPt);
  if (covering.length === 0) return { ok: false, reason: usedUp ? "pack_used" : "not_covered" };
  const plain = covering.find(({ h }) => h.membership.kind !== "pack");
  if (plain !== undefined) return { ok: true, membershipId: plain.h.id, chargePack: false };
  const pack = covering
    .filter(({ h }) => (h.membership.classesLeft ?? 0) > 0)
    .sort((a, b) => ((a.view.endsOn ?? "") < (b.view.endsOn ?? "") ? -1 : (a.view.endsOn ?? "") > (b.view.endsOn ?? "") ? 1 : 0))[0];
  if (pack !== undefined) return { ok: true, membershipId: pack.h.id, chargePack: true };
  return { ok: false, reason: "pack_used" };
}

export const PT_BOOK_REFUSALS = [
  "trainer_not_offering",
  "not_a_time",
  "time_passed",
  "too_far",
  "time_taken",
  "trainer_in_class",
  "trainer_off",
  "person_busy",
  "no_membership",
  "not_covered",
  "pack_used",
] as const;
export const ptBookRefusalSchema = z.enum(PT_BOOK_REFUSALS);
export type PtBookRefusal = z.infer<typeof ptBookRefusalSchema>;

export interface PtBookInput {
  /** The trainer is on the gym's staff and takes personal training. */
  offers: boolean;
  /** The time is one their hours offer, and one the gym's clock has on that day. */
  offered: boolean;
  /** It has started. */
  started: boolean;
  /** It is further ahead than sessions are booked. */
  tooFar: boolean;
  /** The trainer has a session that runs into it. */
  trainerBusy: boolean;
  /** The trainer coaches a class that runs into it. */
  trainerInClass: boolean;
  /** The trainer has time off that runs into it. */
  trainerOff: boolean;
  /** The person has a session that runs into it. */
  personBusy: boolean;
  cover: PtCover;
}

export type PtBookDecision = { kind: "book"; membershipId: string | null; chargePack: boolean } | { kind: "refuse"; reason: PtBookRefusal };

/** Book a session: the time first, then who else has it, then what pays for it. */
export function decidePtBook(i: PtBookInput): PtBookDecision {
  if (!i.offers) return { kind: "refuse", reason: "trainer_not_offering" };
  if (!i.offered) return { kind: "refuse", reason: "not_a_time" };
  if (i.started) return { kind: "refuse", reason: "time_passed" };
  if (i.tooFar) return { kind: "refuse", reason: "too_far" };
  if (i.trainerBusy) return { kind: "refuse", reason: "time_taken" };
  if (i.trainerInClass) return { kind: "refuse", reason: "trainer_in_class" };
  if (i.trainerOff) return { kind: "refuse", reason: "trainer_off" };
  if (i.personBusy) return { kind: "refuse", reason: "person_busy" };
  if (!i.cover.ok) return { kind: "refuse", reason: i.cover.reason };
  return { kind: "book", membershipId: i.cover.membershipId, chargePack: i.cover.chargePack };
}

export type PtCancelDecision =
  | { kind: "cancel"; status: "cancelled" | "late_cancelled"; refundPack: boolean }
  /** `already`: it was cancelled before, and nothing changes. */
  | { kind: "already" }
  /** `kept_used`: it was already cancelled late, and this request believes the session
   *  comes back. `not_kept`: it was already cancelled with nothing kept, and this request
   *  is the late cancel. Nothing changes, and neither answer may read as a yes. */
  | { kind: "refuse"; reason: "started" | "late_cancel" | "kept_used" | "not_kept" };

/** Cancel a session. Free until the gym's cancel time before the start, and the pack has
 *  its session back. After that staff say which it is (`lateOk`): a late cancel, which
 *  keeps the session used, or `giveBack`, for a session the gym itself called off. */
export function decidePtCancel(i: {
  status: PtAppointmentStatus;
  started: boolean;
  freeCancel: boolean;
  packCharged: boolean;
  lateOk: boolean;
  giveBack: boolean;
}): PtCancelDecision {
  // A late cancel already made keeps the session used. A request that expects it back (a
  // free cancel, or `giveBack`) is told so; the late cancel sent again is the same answer.
  if (i.status === "late_cancelled" && (i.giveBack || !i.lateOk)) return { kind: "refuse", reason: "kept_used" };
  // The other way round: cancelled with nothing kept, and this is the late cancel.
  if (i.status === "cancelled" && i.lateOk && !i.giveBack) return { kind: "refuse", reason: "not_kept" };
  if (i.status === "cancelled" || i.status === "late_cancelled") return { kind: "already" };
  if (i.started || i.status !== "booked") return { kind: "refuse", reason: "started" };
  if (i.freeCancel) return { kind: "cancel", status: "cancelled", refundPack: i.packCharged };
  if (!i.lateOk) return { kind: "refuse", reason: "late_cancel" };
  if (i.giveBack) return { kind: "cancel", status: "cancelled", refundPack: i.packCharged };
  return { kind: "cancel", status: "late_cancelled", refundPack: false };
}

/** Where `nowMs` stands against a session that starts at `startsAtMs`. */
export function ptTime(nowMs: number, startsAtMs: number, freeCancelMinutes: number): { started: boolean; freeCancel: boolean } {
  const left = startsAtMs - nowMs;
  return { started: left <= 0, freeCancel: left > 0 && left >= freeCancelMinutes * 60_000 };
}

// ── A TRAINER'S TIME OFF (17e-iii-b) ──

/** How many times off, not yet over, one trainer holds. */
export const PT_TIME_OFF_MAX = 50;
/** The longest one time off, in days, and how far ahead one may start. */
export const PT_TIME_OFF_DAYS_MAX = 366;
export const PT_TIME_OFF_AHEAD_DAYS = 366;

/** Time off as staff gave it, on the gym's own clock: whole days from `fromDate` to
 *  `toDate` (both minutes null), or some hours of one day. */
export interface PtTimeOffSpan {
  fromDate: string;
  toDate: string;
  fromMinute: number | null;
  toMinute: number | null;
}

function isDay(day: string): boolean {
  const [y, m, d] = day.split("-").map(Number);
  if (y === undefined || m === undefined || d === undefined) return false;
  const made = new Date(Date.UTC(y, m - 1, d));
  return made.getUTCFullYear() === y && made.getUTCMonth() === m - 1 && made.getUTCDate() === d;
}

/** What is wrong with a time off as written, or null. */
export function ptTimeOffProblem(o: PtTimeOffSpan): "not_a_day" | "order" | "half" | "one_day" | "range" | "too_long" | null {
  // The 30th of February is written like a day and is not one.
  if (!isDay(o.fromDate) || !isDay(o.toDate)) return "not_a_day";
  if (o.toDate < o.fromDate) return "order";
  if ((o.fromMinute === null) !== (o.toMinute === null)) return "half";
  if (o.fromMinute !== null && o.toMinute !== null) {
    if (o.fromDate !== o.toDate) return "one_day";
    if (o.fromMinute >= o.toMinute) return "range";
  }
  if (o.toDate > addDays(o.fromDate, PT_TIME_OFF_DAYS_MAX - 1)) return "too_long";
  return null;
}

/** Why a time off is not added now, or null: one of its times is not on the gym's clock
 *  that day (the hour the clocks go forward over), it is already over, it starts too far
 *  ahead, or the trainer holds as many as one may. */
export function ptTimeOffRefusal(i: {
  onTheClock: boolean;
  over: boolean;
  today: string;
  fromDate: string;
  coming: number;
}): "time_off_not_a_time" | "time_off_ended" | "time_off_too_far" | "time_off_too_many" | null {
  if (!i.onTheClock) return "time_off_not_a_time";
  if (i.over) return "time_off_ended";
  if (i.fromDate > addDays(i.today, PT_TIME_OFF_AHEAD_DAYS)) return "time_off_too_far";
  if (i.coming >= PT_TIME_OFF_MAX) return "time_off_too_many";
  return null;
}

/** What a time off takes of one day of the gym's: nothing (null), all of it (both minutes
 *  null), or some hours. */
export function ptTimeOffOnDay(o: PtTimeOffSpan, day: string): { fromMinute: number | null; toMinute: number | null } | null {
  if (day < o.fromDate || day > o.toDate) return null;
  return { fromMinute: o.fromMinute, toMinute: o.toMinute };
}

/** What staff read when the server says no. */
export const PT_WORDS = {
  trainer_not_offering: "This trainer isn't taking personal training sessions.",
  not_a_time: "That isn't one of this trainer's times. Pick a time from the list.",
  time_passed: "That time has already passed.",
  too_far: "Sessions can be booked up to 8 weeks ahead.",
  time_taken: "This trainer already has a session at that time.",
  trainer_in_class: "This trainer is coaching a class at that time.",
  trainer_off: "This trainer has time off at that time.",
  person_busy: "This person already has a personal training session at that time.",
  no_membership: "This person has no membership in use on that day.",
  not_covered: "None of this person's memberships includes personal training.",
  pack_used: "This person's pack has no sessions left.",
  started: "This session has already started, so it can't be cancelled.",
  late_cancel: "It's too late to cancel for free.",
  kept_used: "This session was already cancelled as a late cancel. The session stays used.",
  not_kept: "This session was already cancelled, and not as a late cancel. No session was used.",
  request_reused: "That didn't go through. Try again.",
  appointment_not_found: "That session was not found.",
  person_not_found: "That person isn't on your member list.",
  trainer_not_found: "That person isn't on your staff.",
  hours_range: "Each set of hours must end after it starts.",
  hours_too_many: `A day can have up to ${String(PT_RANGES_PER_DAY)} sets of hours.`,
  hours_overlap: "Two sets of hours on the same day overlap.",
  time_off_no_hours: "Set this trainer's hours first.",
  time_off_not_a_time: "The clocks change on that day, and one of those times doesn't exist. Pick a different start or end time.",
  time_off_ended: "That time has already passed.",
  time_off_too_far: "Time off can start up to a year ahead.",
  time_off_too_many: `A trainer can have up to ${String(PT_TIME_OFF_MAX)} times off coming. Remove one first.`,
} as const;

export const PT_LATE_CANCEL_ERROR = "late_cancel";
export const PT_KEPT_USED_ERROR = "kept_used";
export const PT_NOT_KEPT_ERROR = "not_kept";

// ── THE WIRE ──

const personNameSchema = { name: z.string().nullable(), initials: z.string() };

/** One time off of a trainer's. Both minutes null: whole days. */
export const ptTimeOffSchema = z
  .object({
    id: z.string().uuid(),
    fromDate: classDaySchema,
    toDate: classDaySchema,
    fromMinute: z.number().int().nullable(),
    toMinute: z.number().int().nullable(),
  })
  .strict();
export type PtTimeOff = z.infer<typeof ptTimeOffSchema>;

/** One member of staff as the Personal training page lists them. `sessionMinutes` is null
 *  until their hours are first saved. */
export const ptTrainerSchema = z
  .object({
    userId: z.string().uuid(),
    ...personNameSchema,
    offers: z.boolean(),
    sessionMinutes: ptSessionMinutesSchema.nullable(),
    hours: z.array(ptHoursRangeSchema),
    /** Their time off that is not over yet, the earliest first. */
    timeOff: z.array(ptTimeOffSchema),
    /** The reader's own row. */
    mine: z.boolean(),
  })
  .strict();
export type PtTrainer = z.infer<typeof ptTrainerSchema>;

/** What the gym has done towards its first session, each a fact about this gym alone
 *  (ROADMAP 23d): the page's list of steps ticks from these. A fact holds while its thing
 *  is there: an archived type, a cancelled membership and a cancelled session do not count. */
export const ptSetupSchema = z
  .object({
    /** A membership type or pack on the price list includes personal training. */
    typeIncludesPt: z.boolean(),
    /** Somebody on the member list holds one of those, in use. */
    somebodyHoldsIt: z.boolean(),
    /** The member list has somebody on it. */
    listHasPeople: z.boolean(),
    /** A session is booked, or one took place. */
    sessionBooked: z.boolean(),
  })
  .strict();
export type PtSetup = z.infer<typeof ptSetupSchema>;

/** The gym's staff and their hours. `canManage`: the reader runs the timetable
 *  (`schedule.manage`) and sees and changes everybody; anybody else on staff has their own
 *  row alone. `canBook`: they may read the member list (`members.confirm`), so they can
 *  pick a person to book. */
export const ptTrainersResponseSchema = z
  .object({
    timezone: z.string(),
    canManage: z.boolean(),
    canBook: z.boolean(),
    /** The gym's own free-cancel time, the one classes use. */
    freeCancelMinutes: z.number().int(),
    /** The gym sells memberships, so a session needs one that includes personal training. */
    gymHasTypes: z.boolean(),
    /** For whoever runs the timetable; null for anybody else, who sets nothing up. */
    setup: ptSetupSchema.nullable(),
    trainers: z.array(ptTrainerSchema),
  })
  .strict();
export type PtTrainersResponse = z.infer<typeof ptTrainersResponseSchema>;

/** A trainer's hours, all of them every time: a save replaces, it never merges. */
export const savePtTrainerRequestSchema = z
  .object({
    offers: z.boolean(),
    sessionMinutes: ptSessionMinutesSchema,
    hours: z.array(ptHoursRangeSchema).max(7 * PT_RANGES_PER_DAY),
  })
  .strict()
  .superRefine((value, ctx) => {
    const problem = ptHoursProblem(value.hours);
    if (problem !== null) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["hours"], message: problem });
  });
export type SavePtTrainerRequest = z.infer<typeof savePtTrainerRequestSchema>;

export const ptAppointmentSchema = z
  .object({
    id: z.string().uuid(),
    /** Null: the trainer's account is gone. */
    trainerId: z.string().uuid().nullable(),
    /** The gym's own day and clock time. */
    localDate: classDaySchema,
    localStartMinute: z.number().int(),
    minutes: z.number().int(),
    startsAt: z.string().datetime(),
    status: ptAppointmentStatusSchema,
    ...personNameSchema,
    /** Their record on the gym's list, for staff who may open a person's page
     *  (`members.confirm`); null for anybody else. */
    entryId: z.string().uuid().nullable(),
    /** The membership it was booked on; null where the gym has no membership types, and
     *  for a reader who may not open a person's page. */
    membership: z.string().nullable(),
    packCharged: z.boolean(),
    /** What a cancel now would be; null once it has started or is cancelled. */
    cancel: z.enum(["free", "late"]).nullable(),
  })
  .strict();
export type PtAppointment = z.infer<typeof ptAppointmentSchema>;

/** `from`: the first of the seven days, the gym's own; today when left out. */
export const ptWeekQuerySchema = z.object({ trainer: z.string().uuid(), from: classDaySchema.optional() }).strict();
export type PtWeekQuery = z.infer<typeof ptWeekQuerySchema>;

/** A taught class the trainer coaches, as their week shows it: it takes that time off
 *  their free times. */
export const ptCoachedClassSchema = z
  .object({ name: z.string(), localStartMinute: z.number().int(), minutes: z.number().int() })
  .strict();
export type PtCoachedClass = z.infer<typeof ptCoachedClassSchema>;

/** Seven days of one trainer: each day's free times (minutes from midnight on the gym's
 *  clock), the sessions booked on it and the classes they coach on it, the earliest first. */
export const ptWeekResponseSchema = z
  .object({
    trainerId: z.string().uuid(),
    timezone: z.string(),
    today: classDaySchema,
    from: classDaySchema,
    to: classDaySchema,
    /** The last day a session can be booked on. */
    lastDay: classDaySchema,
    sessionMinutes: ptSessionMinutesSchema.nullable(),
    offers: z.boolean(),
    days: z.array(
      z
        .object({
          localDate: classDaySchema,
          free: z.array(z.number().int()),
          appointments: z.array(ptAppointmentSchema),
          classes: z.array(ptCoachedClassSchema),
          /** Their time off on this day: both minutes null for the whole day. */
          timeOff: z.array(z.object({ id: z.string().uuid(), fromMinute: z.number().int().nullable(), toMinute: z.number().int().nullable() }).strict()),
        })
        .strict(),
    ),
  })
  .strict();
export type PtWeekResponse = z.infer<typeof ptWeekResponseSchema>;

export const bookPtRequestSchema = z
  .object({
    requestKey: z.string().uuid(),
    trainerId: z.string().uuid(),
    /** The person's record on the gym's member list. */
    entryId: z.string().uuid(),
    localDate: classDaySchema,
    startMinute: minuteOfDay(1435),
    /** The session's length as the screen showed it: a trainer whose length has changed
     *  since is not booked for a time nobody read. */
    minutes: ptSessionMinutesSchema,
  })
  .strict();
export type BookPtRequest = z.infer<typeof bookPtRequestSchema>;

/** How many people one read of the picker answers. */
export const PT_PEOPLE_SHOWN = 30;

/** `query`: part of a name or an email; left out, the start of the list. `day`: the day
 *  of the session being booked, the gym's own; today when left out. */
export const ptPeopleQuerySchema = z.object({ query: z.string().trim().max(100).optional(), day: classDaySchema.optional() }).strict();
export type PtPeopleQuery = z.infer<typeof ptPeopleQuerySchema>;

/** The people on the member list a session can be booked for, those who hold something
 *  that pays for a session on that day first, then by name. `pt` is what a booking on
 *  that day would be made on, by the booking's own rule (`pickPtCover`): the membership's
 *  name and, for a pack, the sessions left; null where nothing they hold pays for it. */
export const ptPeopleResponseSchema = z
  .object({
    /** The gym sells memberships: somebody with `pt` null cannot be booked. */
    gymHasTypes: z.boolean(),
    people: z
      .array(
        z
          .object({
            entryId: z.string().uuid(),
            name: z.string(),
            pt: z.object({ membership: z.string(), sessionsLeft: z.number().int().nullable() }).strict().nullable(),
          })
          .strict(),
      )
      .max(PT_PEOPLE_SHOWN),
    /** More people match than are shown. */
    more: z.boolean(),
  })
  .strict();
export type PtPeopleResponse = z.infer<typeof ptPeopleResponseSchema>;

export const cancelPtRequestSchema = z.object({ lateOk: z.boolean(), giveBack: z.boolean() }).strict();
export type CancelPtRequest = z.infer<typeof cancelPtRequestSchema>;

export const ptAppointmentResponseSchema = z.object({ appointment: ptAppointmentSchema }).strict();
export type PtAppointmentResponse = z.infer<typeof ptAppointmentResponseSchema>;

// ── TIME OFF ON THE WIRE (17e-iii-b) ──

/** The 409 a time off answers when sessions are already booked with the trainer in it, or
 *  they coach a class in it. Nothing is written until the request sends `confirm` equal to
 *  `mark`, worked out again under the gym's lock; the sessions and classes then stay as
 *  they are, for staff to move. */
export const PT_TIME_OFF_OVER_ERROR = "time_off_over_bookings";
export const PT_TIME_OFF_OVER_MESSAGE = "This trainer has sessions or classes in that time.";
/** How many of each the 409 names; each `count` is whole. */
export const PT_TIME_OFF_OVER_SHOWN = 100;

const overRow = z
  .object({
    id: z.string().uuid(),
    /** The person booked (null where their record has gone), or the class's name. */
    name: z.string().nullable(),
    localDate: z.string(),
    localStartMinute: z.number().int(),
    minutes: z.number().int(),
  })
  .strict();

export const ptTimeOffOverSchema = z
  .object({
    /** One value for exactly these sessions and classes, all of them. */
    mark: z.string().regex(/^[0-9a-f]{64}$/),
    /** Each the earliest first. */
    sessions: z.object({ count: z.number().int().min(0), shown: z.array(overRow).max(PT_TIME_OFF_OVER_SHOWN) }).strict(),
    classes: z.object({ count: z.number().int().min(0), shown: z.array(overRow).max(PT_TIME_OFF_OVER_SHOWN) }).strict(),
    /** The last day whose classes are on the calendar: later ones cannot be named yet. */
    classesUpTo: classDaySchema,
  })
  .strict();
export type PtTimeOffOver = z.infer<typeof ptTimeOffOverSchema>;

export const addPtTimeOffRequestSchema = z
  .object({
    requestKey: z.string().uuid(),
    fromDate: classDaySchema,
    toDate: classDaySchema,
    fromMinute: minuteOfDay(1435).nullable(),
    toMinute: minuteOfDay(1440).nullable(),
    /** The `mark` the screen was shown. */
    confirm: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const problem = ptTimeOffProblem(value);
    if (problem !== null) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["toDate"], message: problem });
  });
export type AddPtTimeOffRequest = z.infer<typeof addPtTimeOffRequestSchema>;
