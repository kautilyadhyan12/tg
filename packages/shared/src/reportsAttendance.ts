// The console's Reports page: the attendance figures (spec Part 3 §16.5; ROADMAP 21a-ii).
//
// `attendanceWindows` says which days each figure is counted over; the server counts the
// gym's visits and classes over them, and `attendanceReportFrom` turns the counts into the
// figures, and says why where a figure cannot be given.
import { z } from "zod";
import { addDays, daysBetween } from "./heldMemberships.js";

/** Visits day by day: this many days, today last. */
export const REPORT_VISIT_DAYS = 28;
/** Visits week by week: this many weeks, Monday to Sunday, the week in progress last. */
export const REPORT_VISIT_WEEKS = 12;
/** The busiest hours are counted over the newest full weeks, this many at most. */
export const REPORT_HOUR_WEEKS = 8;
/** Visits a member a week are counted over the newest full weeks, this many at most. */
export const REPORT_MEMBER_WEEKS = 4;
/** Both wait for this many full weeks of check-ins. */
export const REPORT_FULL_WEEKS_NEEDED = 2;
/** Classes are counted over this many days, today last. */
export const REPORT_CLASS_DAYS = 56;
/** How many classes the page lists, the ones that ran most first. */
export const REPORT_CLASS_TYPES_MAX = 100;
/** How many hours are named as the busiest when several tie. */
export const REPORT_BUSIEST_MAX = 3;

const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const countSchema = z.number().int().min(0);
/** A share out of 100, to one decimal place. */
const percentSchema = z.number().min(0).max(100);
/** Monday is 1, Sunday is 7. */
const weekdaySchema = z.number().int().min(1).max(7);
const hourSchema = z.number().int().min(0).max(23);

/** Monday is 1, Sunday is 7. */
export function weekdayOf(day: string): number {
  // 1 January 1970 was a Thursday.
  return ((((daysBetween("1970-01-01", day) + 3) % 7) + 7) % 7) + 1;
}

/** The Monday of the week that holds `day`. */
export function mondayOf(day: string): string {
  return addDays(day, 1 - weekdayOf(day));
}

/** Days `from` to `to`, both counted. */
export interface DayWindow {
  from: string;
  to: string;
  weeks: number;
}

export interface AttendanceWindows {
  /** The first of the days shown one by one. */
  daysFrom: string;
  /** The Monday of the first week shown. */
  weeksFrom: string;
  /** The Monday of the week in progress. */
  thisWeek: string;
  /** Whole weeks, Monday to Sunday, that began on or after the first check-in and have ended. */
  fullWeeks: number;
  /** Null before there are enough full weeks. */
  hours: DayWindow | null;
  member: DayWindow | null;
  /** The first day classes are counted from. */
  classesFrom: string;
}

/** Which days each figure is counted over, from the gym's own day today and the day of
 *  its first check-in. Only whole weeks feed the busiest hours and visits a member, so
 *  every weekday is counted the same number of times. */
export function attendanceWindows(today: string, firstVisitOn: string | null): AttendanceWindows {
  const thisWeek = mondayOf(today);
  let fullWeeks = 0;
  if (firstVisitOn !== null) {
    const monday = mondayOf(firstVisitOn);
    const firstFull = monday === firstVisitOn ? monday : addDays(monday, 7);
    fullWeeks = Math.max(0, Math.floor(daysBetween(firstFull, thisWeek) / 7));
  }
  const newest = (most: number): DayWindow | null => {
    if (fullWeeks < REPORT_FULL_WEEKS_NEEDED) return null;
    const weeks = Math.min(fullWeeks, most);
    return { from: addDays(thisWeek, -7 * weeks), to: addDays(thisWeek, -1), weeks };
  };
  return {
    daysFrom: addDays(today, 1 - REPORT_VISIT_DAYS),
    weeksFrom: addDays(thisWeek, -7 * (REPORT_VISIT_WEEKS - 1)),
    thisWeek,
    fullWeeks,
    hours: newest(REPORT_HOUR_WEEKS),
    member: newest(REPORT_MEMBER_WEEKS),
    classesFrom: addDays(today, 1 - REPORT_CLASS_DAYS),
  };
}

/** One class the gym runs, counted over the classes of it that started in the window. */
export interface ReportClassCounts {
  name: string;
  /** Classes that ran: cancelled ones are not counted. */
  classes: number;
  /** Those with a limit on places, and their places together. */
  limitedClasses: number;
  places: number;
  /** Places taken in the classes with a limit, never more than a class's places. */
  booked: number;
  /** Places taken in every class: booked, came or no-show. */
  bookings: number;
  attended: number;
  noShows: number;
}

export interface AttendanceReportFacts {
  timezone: string;
  /** The gym's own day today. */
  today: string;
  /** The day of the gym's first check-in; null with none. */
  firstVisitOn: string | null;
  /** The days that had a visit, from `daysFrom`. */
  days: readonly { day: string; visits: number }[];
  /** The weeks that had a visit, from `weeksFrom`, each by its Monday. */
  weeks: readonly { weekStart: string; visits: number; people: number }[];
  /** Visits with a known time in the hours window, by weekday and hour on the gym's clock. */
  hours: readonly { weekday: number; hour: number; visits: number }[];
  /** Visits in the hours window that staff added on a later day, so no time is known. */
  hoursNoTime: number;
  /** People on the list today who were on it when the member window began, and their
   *  visits in it: somebody added since could not have come. */
  member: { members: number; visits: number; visitors: number };
  /** Whether the gym has set up any class, and the classes that started in the window. */
  classes: { ever: boolean; types: readonly ReportClassCounts[] };
}

const cellSchema = z.object({ weekday: weekdaySchema, hour: hourSchema }).strict();

const perMemberSchema = z.discriminatedUnion("state", [
  z
    .object({
      state: z.literal("ok"),
      /** Visits a member a week, to one decimal place. */
      perWeek: z.number().min(0),
      from: daySchema,
      to: daySchema,
      weeks: countSchema.min(1),
      /** On the list today and since `from` or before. */
      members: countSchema.min(1),
      visits: countSchema,
      /** How many of those members came at least once. */
      visitors: countSchema,
    })
    .strict(),
  /** Enough weeks, and nobody on the list today was on it when they began. */
  z.object({ state: z.literal("no_members"), from: daySchema, to: daySchema, weeks: countSchema.min(1) }).strict(),
  z.object({ state: z.literal("not_enough_data") }).strict(),
]);
export type ReportPerMember = z.infer<typeof perMemberSchema>;

const hoursSchema = z.discriminatedUnion("state", [
  z
    .object({
      state: z.literal("ok"),
      from: daySchema,
      to: daySchema,
      weeks: countSchema.min(1),
      /** Every weekday and hour that had a visit. */
      cells: z.array(cellSchema.extend({ visits: countSchema.min(1) }).strict()).min(1).max(7 * 24),
      /** The most visits any one hour had, and the hours that had it: the first few, in the week's order. */
      top: countSchema.min(1),
      busiest: z.array(cellSchema).min(1).max(REPORT_BUSIEST_MAX),
      /** How many hours had that many. */
      tied: countSchema.min(1),
      noTime: countSchema,
    })
    .strict(),
  /** Enough weeks, and no visit in them with a time. */
  z.object({ state: z.literal("no_visits"), from: daySchema, to: daySchema, weeks: countSchema.min(1), noTime: countSchema }).strict(),
  z.object({ state: z.literal("not_enough_data") }).strict(),
]);
export type ReportHours = z.infer<typeof hoursSchema>;

const fillSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("ok"), percent: percentSchema, booked: countSchema, places: countSchema.min(1), classes: countSchema.min(1) }).strict(),
  /** No class that ran had a limit on places. */
  z.object({ state: z.literal("no_limit") }).strict(),
]);
export type ReportFill = z.infer<typeof fillSchema>;

const noShowsSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("ok"), percent: percentSchema, noShows: countSchema, marked: countSchema.min(1), unmarked: countSchema }).strict(),
  /** Places were booked and none is marked came or no-show. */
  z.object({ state: z.literal("nothing_marked"), unmarked: countSchema.min(1) }).strict(),
  z.object({ state: z.literal("no_bookings") }).strict(),
]);
export type ReportNoShows = z.infer<typeof noShowsSchema>;

const classTypeSchema = z
  .object({
    name: z.string(),
    classes: countSchema.min(1),
    /** Null where none of its classes had a limit. */
    places: countSchema.min(1).nullable(),
    booked: countSchema,
    fillPercent: percentSchema.nullable(),
    attended: countSchema,
    noShows: countSchema,
    /** Null where none of its places is marked. */
    noShowPercent: percentSchema.nullable(),
  })
  .strict();

const classesSchema = z.discriminatedUnion("state", [
  /** The gym has set up no class. */
  z.object({ state: z.literal("none_ever") }).strict(),
  /** It has, and none started in the window. */
  z.object({ state: z.literal("none_recent"), from: daySchema }).strict(),
  z
    .object({
      state: z.literal("ok"),
      from: daySchema,
      classes: countSchema.min(1),
      bookings: countSchema,
      fill: fillSchema,
      noShows: noShowsSchema,
      types: z.array(classTypeSchema).min(1).max(REPORT_CLASS_TYPES_MAX),
      /** Classes counted in the totals and not listed. */
      moreTypes: countSchema,
    })
    .strict(),
]);
export type ReportClasses = z.infer<typeof classesSchema>;

export const attendanceReportSchema = z
  .object({
    timezone: z.string(),
    today: daySchema,
    /** Null while nobody has ever checked in: the visit figures are then said in words. */
    firstVisitOn: daySchema.nullable(),
    fullWeeks: countSchema,
    /** From the first check-in or `REPORT_VISIT_DAYS` back, whichever is later, to today. */
    days: z.array(z.object({ day: daySchema, visits: countSchema }).strict()).max(REPORT_VISIT_DAYS),
    /** `full` is a whole week of check-ins that has ended; the week in progress is last. */
    weeks: z
      .array(z.object({ weekStart: daySchema, visits: countSchema, people: countSchema, full: z.boolean() }).strict())
      .max(REPORT_VISIT_WEEKS),
    perMember: perMemberSchema,
    hours: hoursSchema,
    classes: classesSchema,
  })
  .strict();
export type AttendanceReport = z.infer<typeof attendanceReportSchema>;

export const attendanceReportResponseSchema = z.object({ report: attendanceReportSchema }).strict();
export type AttendanceReportResponse = z.infer<typeof attendanceReportResponseSchema>;

/** `part` out of `whole` as a share of 100 to one decimal; `whole` is above zero. */
function percentOf(part: number, whole: number): number {
  return Math.round((Math.min(part, whole) / whole) * 1000) / 10;
}

function hoursFrom(facts: AttendanceReportFacts, window: DayWindow | null): ReportHours {
  if (window === null) return { state: "not_enough_data" };
  const cells = facts.hours
    .filter((c) => c.visits > 0)
    .map((c) => ({ weekday: c.weekday, hour: c.hour, visits: c.visits }))
    .sort((a, b) => a.weekday - b.weekday || a.hour - b.hour);
  if (cells.length === 0) return { state: "no_visits", ...window, noTime: facts.hoursNoTime };
  const top = Math.max(...cells.map((c) => c.visits));
  const atTop = cells.filter((c) => c.visits === top);
  return {
    state: "ok",
    ...window,
    cells,
    top,
    busiest: atTop.slice(0, REPORT_BUSIEST_MAX).map((c) => ({ weekday: c.weekday, hour: c.hour })),
    tied: atTop.length,
    noTime: facts.hoursNoTime,
  };
}

function classesFrom(facts: AttendanceReportFacts, from: string): ReportClasses {
  const ran = facts.classes.types.filter((t) => t.classes > 0);
  if (ran.length === 0) return facts.classes.ever ? { state: "none_recent", from } : { state: "none_ever" };
  const sum = (pick: (t: ReportClassCounts) => number): number => ran.reduce((total, t) => total + pick(t), 0);
  const limited = sum((t) => t.limitedClasses);
  const places = sum((t) => t.places);
  const bookings = sum((t) => t.bookings);
  const attended = sum((t) => t.attended);
  const noShows = sum((t) => t.noShows);
  const marked = attended + noShows;

  let noShowFigure: ReportNoShows;
  if (bookings === 0) noShowFigure = { state: "no_bookings" };
  else if (marked === 0) noShowFigure = { state: "nothing_marked", unmarked: bookings };
  else noShowFigure = { state: "ok", percent: percentOf(noShows, marked), noShows, marked, unmarked: Math.max(0, bookings - marked) };

  const listed = [...ran].sort((a, b) => b.classes - a.classes || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return {
    state: "ok",
    from,
    classes: sum((t) => t.classes),
    bookings,
    fill:
      limited === 0 || places === 0
        ? { state: "no_limit" }
        : { state: "ok", percent: percentOf(sum((t) => t.booked), places), booked: Math.min(sum((t) => t.booked), places), places, classes: limited },
    noShows: noShowFigure,
    types: listed.slice(0, REPORT_CLASS_TYPES_MAX).map((t) => {
      const typeMarked = t.attended + t.noShows;
      const hasLimit = t.limitedClasses > 0 && t.places > 0;
      return {
        name: t.name,
        classes: t.classes,
        places: hasLimit ? t.places : null,
        booked: hasLimit ? Math.min(t.booked, t.places) : t.bookings,
        fillPercent: hasLimit ? percentOf(t.booked, t.places) : null,
        attended: t.attended,
        noShows: t.noShows,
        noShowPercent: typeMarked === 0 ? null : percentOf(t.noShows, typeMarked),
      };
    }),
    moreTypes: Math.max(0, listed.length - REPORT_CLASS_TYPES_MAX),
  };
}

/** The figures from the counts.
 *
 *  A day or a week nobody came is a zero, from the gym's first check-in on; nothing
 *  earlier is shown. The busiest hours and visits a member a week are given only once
 *  there are `REPORT_FULL_WEEKS_NEEDED` full weeks of check-ins. No-shows are a share of
 *  the places marked came or no-show, so a gym that marks nobody is told so. */
export function attendanceReportFrom(facts: AttendanceReportFacts): AttendanceReport {
  const windows = attendanceWindows(facts.today, facts.firstVisitOn);
  const first = facts.firstVisitOn;

  const days: AttendanceReport["days"] = [];
  const weeks: AttendanceReport["weeks"] = [];
  if (first !== null && first <= facts.today) {
    const visitsOn = new Map(facts.days.map((d) => [d.day, d.visits]));
    for (let day = first > windows.daysFrom ? first : windows.daysFrom; day <= facts.today; day = addDays(day, 1)) {
      days.push({ day, visits: visitsOn.get(day) ?? 0 });
    }
    const weekOf = new Map(facts.weeks.map((w) => [w.weekStart, w]));
    const firstWeek = mondayOf(first);
    const firstFull = firstWeek === first ? firstWeek : addDays(firstWeek, 7);
    for (let week = firstWeek > windows.weeksFrom ? firstWeek : windows.weeksFrom; week <= windows.thisWeek; week = addDays(week, 7)) {
      const found = weekOf.get(week);
      weeks.push({ weekStart: week, visits: found?.visits ?? 0, people: found?.people ?? 0, full: week >= firstFull && week < windows.thisWeek });
    }
  }

  let perMember: ReportPerMember;
  if (windows.member === null) perMember = { state: "not_enough_data" };
  else if (facts.member.members === 0) perMember = { state: "no_members", ...windows.member };
  else {
    perMember = {
      state: "ok",
      perWeek: Math.round((facts.member.visits / windows.member.weeks / facts.member.members) * 10) / 10,
      ...windows.member,
      members: facts.member.members,
      visits: facts.member.visits,
      visitors: Math.min(facts.member.visitors, facts.member.members),
    };
  }

  return {
    timezone: facts.timezone,
    today: facts.today,
    firstVisitOn: first !== null && first <= facts.today ? first : null,
    fullWeeks: windows.fullWeeks,
    days,
    weeks,
    perMember,
    hours: hoursFrom(facts, windows.hours),
    classes: classesFrom(facts, windows.classesFrom),
  };
}
